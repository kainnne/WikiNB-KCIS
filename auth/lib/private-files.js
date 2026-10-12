import {queryTerms,relevantExcerpt} from './retrieval.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertDocument, isSupportedDocument, supportedDocumentExtensions } from './document-import.js';
import { canStudentAccessTeacher } from './student-accounts.js';
import { uploadTeacherFile } from './wiki.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MANIFEST = path.join(__dirname, '..', 'data', 'private-files.json');
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

function projectRoot() {
  return process.env.PROJECT_ROOT || path.resolve(__dirname, '..', '..');
}

function manifestPath() {
  return process.env.PRIVATE_FILES_MANIFEST || DEFAULT_MANIFEST;
}

function ensureManifest() {
  const file = manifestPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ files: [] }, null, 2));
  return file;
}

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(ensureManifest(), 'utf8'));
  } catch {
    return { files: [] };
  }
}

function writeManifest(store) {
  const file = ensureManifest();
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

function safeFilename(value) {
  const raw = path.basename(String(value || 'document'));
  const ext = path.extname(raw).toLowerCase();
  const stem = path
    .basename(raw, ext)
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}_.()-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return `${stem || 'document'}${ext}`;
}

function safePathId(value, label) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error(`${label}格式無效`);
  return id;
}

function decodeBase64(value) {
  const raw = String(value || '');
  const match = raw.match(/^data:[^;]+;base64,(.+)$/s);
  const encoded = (match ? match[1] : raw).replace(/\s/g, '');
  if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('檔案資料無效');
  const buffer = Buffer.from(encoded, 'base64');
  if (!buffer.length) throw new Error('上傳檔案是空的');
  if (buffer.length > MAX_UPLOAD_BYTES) throw new Error('單一檔案請小於 12MB');
  return buffer;
}

function assertFileSignature(filename, buffer) {
  const ext = path.extname(filename).toLowerCase();
  const ascii = buffer.subarray(0, 12).toString('ascii');
  const matches =
    ext === '.pdf'
      ? ascii.startsWith('%PDF-')
      : ext === '.png'
        ? buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        : ext === '.jpg' || ext === '.jpeg'
          ? buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
          : ext === '.gif'
            ? ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')
            : ext === '.webp'
              ? ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP'
              : true;
  if (!matches) throw new Error(`檔案內容與 ${ext} 副檔名不符`);
}

function userCanUploadToTeacher(user, teacherId) {
  if (user.role === 'admin') return Boolean(teacherId);
  if (user.role === 'teacher') return user.teacherId === teacherId;
  if (user.authType === 'student-code') {
    return canStudentAccessTeacher(user.studentAccountId, teacherId);
  }
  return false;
}

function userCanReadRecord(user, record) {
  if (!user || !record) return false;
  if (record.visibility === 'public') return true;
  if (user.role === 'admin') return true;
  if (user.role === 'teacher') return user.teacherId === record.teacherId;
  return user.authType === 'student-code' && record.ownerId === user.studentAccountId;
}

function publicRecord(record) {
  const { storedPath, convertedPath, documentPath, assetPath, ...safe } = record;
  return safe;
}

function normalizeKeywords(values) {
  const keywords = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const keyword = String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').slice(0, 40);
    const key = keyword.toLocaleLowerCase();
    if (!keyword || seen.has(key)) continue;
    keywords.push(keyword);
    seen.add(key);
    if (keywords.length >= 8) break;
  }
  return keywords;
}

export async function importUploadedDocument(user, payload = {}) {
  const filename = safeFilename(payload.filename);
  if (!isSupportedDocument(filename)) {
    throw new Error(`支援格式：${supportedDocumentExtensions().join(', ')}`);
  }
  const teacherId = safePathId(payload.teacherId || user.teacherId, 'teacherId');
  if (!userCanUploadToTeacher(user, teacherId)) throw new Error('無權上傳到此老師的課堂');

  const isTeacher = user.role === 'teacher' || user.role === 'admin';
  const visibility = isTeacher && payload.visibility === 'public' ? 'public' : 'private';
  if (visibility === 'public' && !payload.subjectId) throw new Error('公開筆記請選擇科目');
  const subjectId = visibility === 'public' ? safePathId(payload.subjectId, '科目') : '';
  const keywords = visibility === 'public' ? normalizeKeywords(payload.keywords) : [];

  const buffer = decodeBase64(payload.dataBase64);
  assertFileSignature(filename, buffer);
  const fileId = crypto.randomUUID();
  const ownerType = isTeacher ? 'teacher' : 'student';
  const ownerId = isTeacher ? teacherId : user.studentAccountId;
  const privateDir = path.join(
    projectRoot(),
    'wiki',
    'teachers',
    teacherId,
    'private',
    ownerType,
    ownerId,
    fileId,
  );
  fs.mkdirSync(privateDir, { recursive: true });
  const originalPath = path.join(privateDir, filename);
  fs.writeFileSync(originalPath, buffer);

  let assetDir = path.join(privateDir, 'assets');
  let assetUrlPrefix = '';
  let originalUrl = '';
  if (visibility === 'public') {
    const importRel = path.posix.join(
      'wiki', 'teachers', teacherId, subjectId, 'imports', fileId,
    );
    const publicDir = path.join(projectRoot(), 'public', ...importRel.split('/'));
    fs.mkdirSync(publicDir, { recursive: true });
    assetDir = path.join(publicDir, 'assets');
    assetUrlPrefix = `/WikiNB-KCIS/${importRel}/assets`;
    const previewable = /\.(png|jpe?g|gif|webp)$/i.test(filename);
    if (previewable) {
      fs.writeFileSync(path.join(publicDir, filename), buffer);
      originalUrl = `/WikiNB-KCIS/${importRel}/${encodeURIComponent(filename)}`;
    }
  } else {
    assetUrlPrefix = `/api/private-files/${fileId}/assets`;
  }

  let converted;
  try {
    converted = await convertDocument({ filename, buffer, assetDir, assetUrlPrefix, originalUrl });
  } catch (error) {
    fs.writeFileSync(path.join(privateDir, 'conversion-error.txt'), String(error?.message || error));
    throw error;
  }
  const convertedPath = path.join(privateDir, 'converted.md');
  fs.writeFileSync(convertedPath, converted.body, 'utf8');
  const documentPath = path.join(privateDir, 'document.json');
  fs.writeFileSync(documentPath, JSON.stringify(converted.document || {
    schemaVersion: 1,
    conversionVersion: converted.document?.conversionVersion || 2,
    sourceType: converted.extension.slice(1),
    originalName: filename,
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(privateDir, 'conversion-report.json'), JSON.stringify({
    convertedAt: new Date().toISOString(),
    warnings: converted.warnings,
  }, null, 2), 'utf8');

  let published = null;
  if (visibility === 'public') {
    published = await uploadTeacherFile(user, {
      teacherId,
      subjectId,
      filename: `${payload.slug || path.basename(filename, path.extname(filename))}.md`,
      content: converted.body,
      keywords,
    });
  }

  const now = new Date().toISOString();
  const record = {
    id: fileId,
    teacherId,
    subjectId,
    ownerType,
    ownerId,
    uploaderName: String(user.nickname || user.name || '未命名'),
    visibility,
    originalName: filename,
    mimeType: String(payload.mimeType || 'application/octet-stream'),
    size: buffer.length,
    uploadedAt: now,
    convertedAt: now,
    storedPath: path.relative(projectRoot(), originalPath),
    convertedPath: path.relative(projectRoot(), convertedPath),
    documentPath: path.relative(projectRoot(), documentPath),
    assetPath: path.relative(projectRoot(), assetDir),
    sourceType: converted.source?.type || converted.extension.slice(1),
    sourcePageCount: converted.source?.pageCount || null,
    keywords,
    conversionVersion: converted.document?.conversionVersion || 2,
    conversionWarnings: converted.warnings,
    publishedSlug: published?.slug || '',
  };
  const store = readManifest();
  store.files.push(record);
  writeManifest(store);
  return { ok: true, file: publicRecord(record), published, message: visibility === 'public' ? '已轉換並發布到 Wiki' : '已安全存入課堂私有區' };
}

export function listUploadedDocuments(user, { teacherId } = {}) {
  const target = String(teacherId || user.teacherId || '').trim();
  return readManifest().files
    .filter((record) => {
      if (user.role === 'admin') return !target || record.teacherId === target;
      if (user.role === 'teacher') return record.teacherId === user.teacherId;
      return record.ownerId === user.studentAccountId && (!target || record.teacherId === target);
    })
    .map(publicRecord)
    .sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
}

export function readUploadedDocument(user, fileId, { converted = false } = {}) {
  const record = readManifest().files.find((item) => item.id === String(fileId || ''));
  if (!record || !userCanReadRecord(user, record)) throw new Error('找不到檔案或沒有權限');
  const relativePath = converted ? record.convertedPath : record.storedPath;
  const absolutePath = path.resolve(projectRoot(), relativePath);
  const privateRoot = path.resolve(projectRoot(), 'wiki', 'teachers');
  if (!absolutePath.startsWith(`${privateRoot}${path.sep}`) || !fs.existsSync(absolutePath)) {
    throw new Error('檔案不存在');
  }
  return { record: publicRecord(record), absolutePath };
}

export function findPublicDocumentByPublishedNote({ teacherId, subjectId, slug }) {
  const record = readManifest().files
    .filter((item) => (
      item.visibility === 'public'
      && item.teacherId === String(teacherId || '')
      && item.subjectId === String(subjectId || '')
      && item.publishedSlug === String(slug || '')
    ))
    .sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)))[0];
  return record ? publicRecord(record) : null;
}

function recordsVisibleToAi(user) {
  const files = readManifest().files.filter((record) => record.visibility === 'private');
  if (user?.role === 'admin') return files;
  if (user?.role === 'teacher') return files.filter((record) => record.teacherId === user.teacherId);
  if (user?.authType === 'student-code') {
    const allowed = new Set(user.teacherIds || []);
    return files.filter((record) => allowed.has(record.teacherId));
  }
  return [];
}

export function loadPrivateCorpusForUser(user, maxChars = 28000, {query=''} = {}) {
  const chunks = [];
  let used = 0;
  for (const record of recordsVisibleToAi(user)) {
    if (used >= maxChars) break;
    const file = path.resolve(projectRoot(), record.convertedPath);
    if (!fs.existsSync(file)) continue;
    const raw=fs.readFileSync(file,'utf8').slice(0,100000);
    const terms=queryTerms(query),haystack=(record.originalName+' '+raw).normalize('NFKC').toLowerCase();
    if(query&&(!terms.length||!terms.some(term=>haystack.includes(term))))continue;
    const body=query?relevantExcerpt(raw,terms,1600):raw.slice(0,5000);
    const author = record.ownerType === 'student' ? record.uploaderName : '老師教材';
    const piece = `\n---\n私有課堂：${record.teacherId}\n作者：${author}\n檔案：${record.originalName}\n${body}\n`;
    if (used + piece.length > maxChars) break;
    chunks.push(piece);
    used += piece.length;
  }
  return chunks.join('') || '（此帳號沒有可用的私有課堂文件）';
}

const GEMINI_MEDIA_TYPES = new Map([
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
]);

function authorizedMediaRecords(user, { includePublic = true } = {}) {
  const privateIds = new Set(recordsVisibleToAi(user).map((record) => record.id));
  const seenPublicNotes = new Set();
  return readManifest().files
    .slice()
    .sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)))
    .filter((record) => {
      if (record.visibility === 'public') {
        if (!includePublic || !user) return false;
        const key = `${record.teacherId}/${record.subjectId}/${record.publishedSlug || record.originalName}`;
        if (seenPublicNotes.has(key)) return false;
        seenPublicNotes.add(key);
        return true;
      }
      return privateIds.has(record.id);
    });
}

function mediaQueryScore(record, query) {
  const normalized = String(query || '').normalize('NFKC').toLocaleLowerCase();
  const tokens = normalized.match(/[\p{L}\p{N}_-]{2,}/gu) || [];
  let documentText = '';
  try {
    if (record.convertedPath) {
      documentText = fs.readFileSync(path.resolve(projectRoot(), record.convertedPath), 'utf8').slice(0, 5000);
    }
  } catch {
    /* the original media can still be used */
  }
  const haystack = [
    record.originalName,
    record.publishedSlug,
    record.teacherId,
    record.subjectId,
    ...(record.keywords || []),
    documentText,
  ].join(' ').normalize('NFKC').toLocaleLowerCase();
  let score = 0;
  for (const token of new Set(tokens)) {
    if (haystack.includes(token)) score += token.length >= 4 ? 3 : 1;
  }
  if (/(pdf|圖片|圖表|圖形|插圖|教材|文件|附件|第.{0,3}頁|這份)/i.test(normalized)) score += 2;
  if (record.visibility === 'private' && /(同學|學生|作業|作品|比較|評分)/.test(normalized)) score += 3;
  return score;
}

function mediaRecordLabel(record) {
  let detail = '';
  try {
    if (record.documentPath) {
      const document = JSON.parse(fs.readFileSync(path.resolve(projectRoot(), record.documentPath), 'utf8'));
      const visualPages = (document.pages || []).filter((page) => page.visualHeavy).length;
      detail = ` · ${document.pageCount || record.sourcePageCount || '?'} 頁`;
      if (visualPages) detail += ` · ${visualPages} 頁含圖片或向量版面`;
    }
  } catch {
    if (record.sourcePageCount) detail = ` · ${record.sourcePageCount} 頁`;
  }
  const access = record.visibility === 'public' ? '公開教材' : '私有課堂附件';
  const author = record.ownerType === 'student' ? record.uploaderName : '老師教材';
  return `${access} · ${record.teacherId} · ${author} · ${record.originalName}${detail}`;
}

/** 依登入權限與問題內容挑選 PDF／圖片，直接交給 Gemini 多模態模型。 */
export function loadAuthorizedMediaForUser(
  user,
  { query = '', maxBytes = 10 * 1024 * 1024, maxFiles = 8, includePublic = true } = {},
) {
  const media = [];
  let used = 0;
  const pushFile = (absolutePath, label) => {
    if (media.length >= maxFiles || !fs.existsSync(absolutePath)) return;
    const mimeType = GEMINI_MEDIA_TYPES.get(path.extname(absolutePath).toLowerCase());
    if (!mimeType) return;
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024 || used + stat.size > maxBytes) return;
    media.push({ label, mimeType, data: fs.readFileSync(absolutePath).toString('base64') });
    used += stat.size;
  };

  const mediaIntent = /(pdf|圖片|圖表|圖形|插圖|教材|文件|附件|第.{0,3}頁|這份)/i.test(String(query || ''));
  const records = authorizedMediaRecords(user, { includePublic })
    .map((record) => ({ record, score: mediaQueryScore(record, query) }))
    .filter(({ record, score }) => record.visibility === 'private' || mediaIntent || score > 0)
    .sort((a, b) => b.score - a.score || String(b.record.uploadedAt).localeCompare(String(a.record.uploadedAt)))
    .map(({ record }) => record);
  let publicRecordsUsed = 0;
  for (const record of records) {
    if (media.length >= maxFiles || used >= maxBytes) break;
    if (record.visibility === 'public' && publicRecordsUsed >= 2) continue;
    const label = mediaRecordLabel(record);
    const beforeOriginal = media.length;
    pushFile(path.resolve(projectRoot(), record.storedPath), label);
    if (record.visibility === 'public' && media.length > beforeOriginal) publicRecordsUsed += 1;
    if (path.extname(record.originalName).toLowerCase() === '.docx') {
      const assetDir = path.resolve(projectRoot(), record.assetPath);
      if (fs.existsSync(assetDir)) {
        for (const name of fs.readdirSync(assetDir).sort()) {
          pushFile(path.join(assetDir, name), `${label} · 內嵌圖片`);
          if (media.length >= maxFiles || used >= maxBytes) break;
        }
      }
    } else if (path.extname(record.originalName).toLowerCase() === '.pdf' && media.length === beforeOriginal) {
      const assetDir = path.resolve(projectRoot(), record.assetPath);
      if (fs.existsSync(assetDir)) {
        for (const name of fs.readdirSync(assetDir).filter((item) => /^pdf-(?:page|figure)-\d+\.png$/i.test(item)).sort()) {
          pushFile(path.join(assetDir, name), `${label} · ${name}`);
          if (media.length >= maxFiles || used >= maxBytes) break;
        }
      }
    }
  }
  return media;
}

/** 舊介面保留給既有程式與測試：只回傳私有課堂媒體。 */
export function loadPrivateMediaForUser(user, options = {}) {
  return loadAuthorizedMediaForUser(user, { ...options, includePublic: false });
}

export function getPrivateFilesManifestPath() {
  return ensureManifest();
}
