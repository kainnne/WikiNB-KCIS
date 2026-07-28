/**
 * Wiki 寫入／同步
 * - 正式來源：Google Drive（GOOGLE_DRIVE_FOLDER_ID + 服務帳號）
 * - 本機 wiki/：開發快取／未設定 Drive 時的後備
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  getDriveStatus,
  isDriveConfigured,
  listTeacherMarkdownFiles,
  provisionTeacherOnDrive,
  readTeacherMarkdown,
  updateTeacherDisplayNameOnDrive,
  upsertTeacherMarkdown,
  deleteTeacherMarkdown,
} from './drive.js';
import { findSubjectInCatalog, getSubjectCatalog } from './subjects.js';

const execFileAsync = promisify(execFile);

function projectRoot() {
  return process.env.PROJECT_ROOT || path.resolve(process.cwd(), '..');
}

function wikiRoot() {
  return path.join(projectRoot(), 'wiki');
}

function teacherDir(teacherId) {
  return path.join(wikiRoot(), 'teachers', teacherId);
}

function subjectDir(teacherId, subjectId) {
  return path.join(teacherDir(teacherId), subjectId);
}

/** 台北時間：2026年7月23日 上午／下午 */
export function formatTaipeiDateLabel(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = Number(get('hour') || 0);
  const period = hour < 12 ? '上午' : '下午';
  return `${year}年${month}月${day}日 ${period}`;
}

export function taipeiDateISO(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** 建立／補齊科目資料夾與 _meta.json（來自科目目錄） */
export function ensureSubjectFolder(teacherId, subjectId, teacherDisplayName = '') {
  const catalog = findSubjectInCatalog(subjectId);
  if (!catalog) {
    throw new Error(`無效的科目／處室：${subjectId}`);
  }
  const dir = subjectDir(teacherId, catalog.id);
  fs.mkdirSync(dir, { recursive: true });
  const metaPath = path.join(dir, '_meta.json');
  const nick = String(teacherDisplayName || '').trim();
  const keywords = [catalog.name, nick].filter(Boolean);
  const meta = {
    id: catalog.id,
    name: catalog.name,
    nameEn: catalog.nameEn,
    teacherId,
    keywords,
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');

  const teacherMetaPath = path.join(teacherDir(teacherId), '_meta.json');
  const teacherMeta = readJson(teacherMetaPath) || {
    id: teacherId,
    name: nick || teacherId,
    displayName: nick || teacherId,
    subjects: [],
    status: 'active',
  };
  const subjects = Array.isArray(teacherMeta.subjects) ? teacherMeta.subjects : [];
  if (!subjects.includes(catalog.id)) {
    teacherMeta.subjects = [...subjects, catalog.id];
    fs.writeFileSync(teacherMetaPath, JSON.stringify(teacherMeta, null, 2), 'utf8');
  }
  return meta;
}

export function canWriteWiki(user) {
  return user?.role === 'teacher' || user?.role === 'admin';
}

export function resolveWriteTeacherId(user, requestedTeacherId) {
  if (!canWriteWiki(user)) return null;
  if (user.role === 'teacher') {
    return user.teacherId || null;
  }
  if (user.role === 'admin') {
    return requestedTeacherId || user.teacherId || null;
  }
  return null;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function listSubjectsForTeacher(teacherId) {
  const catalog = getSubjectCatalog();
  const dir = teacherDir(teacherId);
  const existing = new Map();
  if (fs.existsSync(dir)) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('_')) continue;
      const meta = readJson(path.join(dir, e.name, '_meta.json')) || {};
      existing.set(e.name, {
        id: meta.id || e.name,
        name: meta.name || e.name,
        nameEn: meta.nameEn || meta.name || e.name,
        teacherId,
        keywords: meta.keywords || [],
      });
    }
  }
  return catalog.map((c) => {
    const hit = existing.get(c.id);
    return (
      hit || {
        id: c.id,
        name: c.name,
        nameEn: c.nameEn,
        teacherId,
        keywords: [c.name],
      }
    );
  });
}

export function listSubjectCatalog() {
  return getSubjectCatalog();
}

export function getTeacherMeta(teacherId) {
  return readJson(path.join(teacherDir(teacherId), '_meta.json')) || { id: teacherId };
}

export function getSubjectMeta(teacherId, subjectId) {
  return readJson(path.join(subjectDir(teacherId, subjectId), '_meta.json')) || { id: subjectId };
}

function safeFilename(name) {
  const base = path.basename(String(name || 'note.md')).replace(/[^\w.\-()\u4e00-\u9fff]+/g, '_');
  if (!base || base === '.' || base === '..') return `note-${Date.now()}.md`;
  return base.endsWith('.md') ? base : `${base}.md`;
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

function safeImageFilename(name) {
  const raw = path.basename(String(name || 'image.png'));
  const ext = path.extname(raw).toLowerCase();
  const stem = path
    .basename(raw, ext)
    .replace(/[^\w.\-()\u4e00-\u9fff]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  const useExt = IMAGE_EXTS.has(ext) ? ext : '.png';
  const base = stem || `image-${Date.now()}`;
  return `${base}${useExt}`;
}

function publicAssetsDir(teacherId, subjectId) {
  return path.join(projectRoot(), 'public', 'wiki', 'teachers', teacherId, subjectId, 'assets');
}

function wikiAssetsDir(teacherId, subjectId) {
  return path.join(subjectDir(teacherId, subjectId), 'assets');
}

export function normalizeSlug(input) {
  const raw = String(input || '')
    .trim()
    .replace(/\.md$/i, '');
  if (!raw || raw === 'index' || raw === '.' || raw === '..') return null;
  if (raw.includes('/') || raw.includes('\\') || raw.includes('..')) return null;
  if (!/^[\u4e00-\u9fffA-Za-z0-9_-]+$/.test(raw)) return null;
  return raw.slice(0, 80);
}

function splitFrontmatter(content) {
  const text = String(content || '');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: text.trim() };
  const block = m[1];
  const body = m[2].trim();
  const data = {};
  for (const line of block.split('\n')) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1];
    let val = kv[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key === 'keywords' || key === 'tags') continue;
    data[key] = val;
  }
  const kwMatch = block.match(/^keywords:\s*\n((?:\s+-\s+.+\n?)+)/m);
  if (kwMatch) {
    data.keywords = kwMatch[1]
      .split('\n')
      .map((l) => l.replace(/^\s*-\s*/, '').trim())
      .filter(Boolean);
  }
  const tagsMatch = block.match(/^tags:\s*\n((?:\s+-\s+.+\n?)+)/m);
  if (tagsMatch) {
    data.tags = tagsMatch[1]
      .split('\n')
      .map((l) => l.replace(/^\s*-\s*/, '').trim())
      .filter(Boolean);
  }
  return { data, body };
}

function extractTitle(content, fallbackSlug) {
  const { data } = splitFrontmatter(content);
  if (data.title) return String(data.title).trim();
  return fallbackSlug;
}

function yamlQuote(value) {
  return JSON.stringify(String(value ?? ''));
}

function ensureFrontmatter(content, ctx) {
  const { teacher, teacherId, subject, subjectId, keywords } = ctx;
  const today = taipeiDateISO();
  const todayLabel = formatTaipeiDateLabel();
  const { data, body } = splitFrontmatter(content);
  const forcedKeywords = Array.isArray(keywords) && keywords.length ? keywords : [subject, teacher].filter(Boolean);
  const merged = {
    title: data.title || ctx.title || '未命名筆記',
    description: data.description || '',
    teacher: teacher || data.teacher || teacherId,
    teacher_id: teacherId,
    subject: subject || data.subject || subjectId,
    subject_id: subjectId,
    keywords: forcedKeywords,
    status: data.status || 'published',
    audience: data.audience || 'students',
    date: data.date || today,
    date_label: data.date_label || todayLabel,
    updated: today,
    updated_label: todayLabel,
    tags: Array.isArray(data.tags) ? data.tags : undefined,
  };

  const lines = [
    '---',
    `title: ${yamlQuote(merged.title)}`,
    merged.description ? `description: ${yamlQuote(merged.description)}` : null,
    `teacher: ${yamlQuote(merged.teacher)}`,
    `teacher_id: ${merged.teacher_id}`,
    `subject: ${yamlQuote(merged.subject)}`,
    `subject_id: ${merged.subject_id}`,
    'keywords:',
    ...merged.keywords.map((k) => `  - ${yamlQuote(k)}`),
    `status: ${merged.status}`,
    `audience: ${merged.audience}`,
    `date: ${merged.date}`,
    `date_label: ${yamlQuote(merged.date_label)}`,
    `updated: ${merged.updated}`,
    `updated_label: ${yamlQuote(merged.updated_label)}`,
    merged.tags?.length ? 'tags:' : null,
    ...(merged.tags || []).map((t) => `  - ${yamlQuote(t)}`),
    '---',
    '',
    body.trim() || '',
    '',
  ].filter((l) => l !== null);

  return lines.join('\n');
}

function wikiLinkSlug(teacherId, subjectId, noteSlug) {
  return `teachers/${teacherId}/${subjectId}/${noteSlug}`;
}

function upsertWikiIndexLink(teacherId, subjectId, noteSlug, label) {
  const indexPath = path.join(wikiRoot(), 'index.md');
  const teacherMeta = getTeacherMeta(teacherId);
  const subjectMeta = getSubjectMeta(teacherId, subjectId);
  const sectionTitle = `${teacherMeta.displayName || teacherMeta.name || teacherId} · ${subjectMeta.name || subjectId}`;
  const linkSlug = wikiLinkSlug(teacherId, subjectId, noteSlug);
  const link = label ? `- [[${linkSlug}]] — ${label}` : `- [[${linkSlug}]]`;
  const today = new Date().toISOString().slice(0, 10);

  let text = fs.existsSync(indexPath)
    ? fs.readFileSync(indexPath, 'utf8')
    : '# 康橋教學筆記庫索引\n\n> 最後更新：' + today + '\n';

  if (/> 最後更新：\d{4}-\d{2}-\d{2}/.test(text)) {
    text = text.replace(/> 最後更新：\d{4}-\d{2}-\d{2}/, `> 最後更新：${today}`);
  }

  if (text.includes(`[[${linkSlug}]]`)) {
    text = text.replace(new RegExp(`^- \\[\\[${linkSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\][^\\n]*$`, 'm'), link);
    fs.writeFileSync(indexPath, text, 'utf8');
    return;
  }

  const sectionHeader = `## ${sectionTitle}`;
  const headerIdx = text.indexOf(sectionHeader);
  if (headerIdx === -1) {
    text = text.replace(/\s*$/, '\n\n') + `${sectionHeader}\n\n${link}\n`;
    fs.writeFileSync(indexPath, text, 'utf8');
    return;
  }

  const afterHeader = headerIdx + sectionHeader.length;
  let sectionEnd = text.length;
  for (const m of text.matchAll(/^## /gm)) {
    if (m.index > afterHeader) {
      sectionEnd = m.index;
      break;
    }
  }
  const before = text.slice(0, sectionEnd).replace(/\s*$/, '\n');
  const after = text.slice(sectionEnd).replace(/^\n*/, '\n');
  fs.writeFileSync(indexPath, `${before}\n${link}\n${after}`, 'utf8');
}

function assertSubjectExists(teacherId, subjectId) {
  const dir = subjectDir(teacherId, subjectId);
  if (!fs.existsSync(dir)) {
    throw new Error(`找不到科目資料夾：${subjectId}`);
  }
}

function listLocalTeacherFiles(teacherId, subjectId) {
  const dir = subjectDir(teacherId, subjectId);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== 'index.md' && f !== 'README.md')
    .sort()
    .map((filename) => {
      const slug = filename.replace(/\.md$/i, '');
      const content = fs.readFileSync(path.join(dir, filename), 'utf8');
      return {
        filename,
        slug,
        title: extractTitle(content, slug),
        path: `wiki/teachers/${teacherId}/${subjectId}/${filename}`,
        storage: 'local',
      };
    });
}

/**
 * 老師筆記以 wiki/teachers/{teacherId}/ 為準；
 * Drive 有設定時與本機合併（本機有的一定顯示，雲端多出的也顯示）。
 * 列表不會在 Drive 上 ensure 空科目資料夾（避免 12 科逐一建立拖到 1 分鐘）。
 */
export async function listTeacherFiles(user, { subjectId, teacherId: reqTeacherId } = {}) {
  const teacherId = resolveWriteTeacherId(user, reqTeacherId);
  if (!teacherId) throw new Error('無權限讀取 wiki 列表');
  if (!subjectId) throw new Error('請指定 subjectId');

  const bySlug = new Map();
  for (const f of listLocalTeacherFiles(teacherId, subjectId)) {
    bySlug.set(f.slug, f);
  }

  let storage = 'local';
  if (isDriveConfigured()) {
    storage = 'merged';
    try {
      const files = await withTimeout(
        listTeacherMarkdownFiles(teacherId, subjectId, { create: false }),
        4000,
        'Drive list timeout',
      );
      for (const f of files) {
        if (bySlug.has(f.slug)) {
          bySlug.set(f.slug, { ...bySlug.get(f.slug), storage: 'merged' });
          continue;
        }
        let title = f.slug;
        let readable = true;
        try {
          const full = await withTimeout(
            readTeacherMarkdown(teacherId, subjectId, f.slug),
            3000,
            'Drive read timeout',
          );
          title = extractTitle(full.content, f.slug);
        } catch {
          readable = false;
        }
        if (!readable) continue;
        bySlug.set(f.slug, {
          filename: f.filename,
          slug: f.slug,
          title,
          path: f.path || `drive:teachers/${teacherId}/${subjectId}/${f.filename}`,
          storage: 'google-drive',
        });
      }
    } catch {
      /* Drive 失敗／逾時：仍回傳本機列表 */
      storage = 'local';
    }
  }

  const files = [...bySlug.values()].sort((a, b) =>
    String(a.title || a.slug).localeCompare(String(b.title || b.slug), 'zh-Hant'),
  );
  return { ok: true, teacherId, subjectId, files, storage };
}

function withTimeout(promise, ms, label = 'timeout') {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), ms);
    }),
  ]);
}

/**
 * 列出該老師所有科目筆記。
 * 1) 先掃本機資料夾（通常 <1 秒）
 * 2) 再只對「本機已有科目」問 Drive（不建立空夾、有總逾時）
 */
export async function listAllTeacherFiles(user, { teacherId: reqTeacherId } = {}) {
  const teacherId = resolveWriteTeacherId(user, reqTeacherId);
  if (!teacherId) throw new Error('無權限讀取 wiki 列表');

  const catalogById = new Map(getSubjectCatalog().map((s) => [s.id, s]));
  const byKey = new Map();
  const localSubjectIds = [];

  const dir = teacherDir(teacherId);
  if (fs.existsSync(dir)) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('_')) continue;
      localSubjectIds.push(e.name);
      const cat = catalogById.get(e.name);
      for (const f of listLocalTeacherFiles(teacherId, e.name)) {
        byKey.set(`${e.name}::${f.slug}`, {
          ...f,
          teacherId,
          subjectId: e.name,
          subjectName: cat?.name || e.name,
          subjectNameEn: cat?.nameEn || cat?.name || e.name,
        });
      }
    }
  }

  let storage = 'local';
  if (isDriveConfigured() && localSubjectIds.length) {
    try {
      await withTimeout(
        Promise.all(
          localSubjectIds.map(async (subjectId) => {
            try {
              const files = await listTeacherMarkdownFiles(teacherId, subjectId, { create: false });
              const cat = catalogById.get(subjectId);
              const driveSlugs = new Set(files.map((f) => f.slug));
              for (const f of files) {
                const key = `${subjectId}::${f.slug}`;
                if (byKey.has(key)) {
                  byKey.set(key, { ...byKey.get(key), storage: 'merged' });
                  continue;
                }
                let title = f.slug;
                let readable = true;
                try {
                  const full = await withTimeout(
                    readTeacherMarkdown(teacherId, subjectId, f.slug),
                    2500,
                    'Drive read timeout',
                  );
                  title = extractTitle(full.content, f.slug);
                } catch {
                  readable = false;
                }
                // Drive 列得出但讀不到 → 視為幽靈，不進列表
                if (!readable) continue;
                byKey.set(key, {
                  filename: f.filename,
                  slug: f.slug,
                  title,
                  path: f.path || `teachers/${teacherId}/${subjectId}/${f.filename}`,
                  storage: 'google-drive',
                  teacherId,
                  subjectId,
                  subjectName: cat?.name || subjectId,
                  subjectNameEn: cat?.nameEn || cat?.name || subjectId,
                });
              }
              // 本機有、Drive 無：標成 local-only（仍顯示，方便未上傳草稿）
              for (const [key, row] of byKey) {
                if (row.subjectId !== subjectId) continue;
                if (!driveSlugs.has(row.slug) && row.storage === 'local') {
                  byKey.set(key, { ...row, storage: 'local-only' });
                }
              }
            } catch {
              /* ignore one subject */
            }
          }),
        ),
        8000,
        'Drive list-all timeout',
      );
      storage = 'merged';
    } catch {
      storage = 'local';
    }
  }

  const all = [...byKey.values()].sort((a, b) =>
    String(a.title || a.slug).localeCompare(String(b.title || b.slug), 'zh-Hant'),
  );
  return { ok: true, teacherId, files: all, storage, count: all.length };
}

export async function readTeacherFile(user, { subjectId, slug, teacherId: reqTeacherId }) {
  const teacherId = resolveWriteTeacherId(user, reqTeacherId);
  if (!teacherId) throw new Error('無權限讀取筆記');
  return readWikiNoteContent({ teacherId, subjectId, slug, allowDrive: true });
}

/**
 * 任一登入者可讀：優先本機 wiki/；若本機沒有且呼叫端允許，再試 Drive。
 */
export async function readWikiNoteContent({ teacherId, subjectId, slug, allowDrive = true }) {
  const noteSlug = normalizeSlug(slug);
  if (!noteSlug) throw new Error('檔名無效');
  if (!subjectId) throw new Error('請指定 subjectId');
  if (!teacherId) throw new Error('請指定 teacherId');

  const localPath = path.join(subjectDir(teacherId, subjectId), `${noteSlug}.md`);
  if (fs.existsSync(localPath)) {
    const content = fs.readFileSync(localPath, 'utf8');
    return {
      ok: true,
      teacherId,
      subjectId,
      slug: noteSlug,
      filename: `${noteSlug}.md`,
      content,
      title: extractTitle(content, noteSlug),
      storage: 'local',
      wikiSlug: `teachers/${teacherId}/${subjectId}/${noteSlug}`,
    };
  }

  if (allowDrive && isDriveConfigured()) {
    const file = await readTeacherMarkdown(teacherId, subjectId, noteSlug);
    // 讀到即寫回本機鏡像，讓 WikiNB 目錄／下次建置看得到
    try {
      fs.mkdirSync(subjectDir(teacherId, subjectId), { recursive: true });
      fs.writeFileSync(localPath, file.content, 'utf8');
      upsertWikiIndexLink(teacherId, subjectId, noteSlug, extractTitle(file.content, noteSlug));
    } catch (err) {
      console.warn('mirror drive→local failed:', err.message || err);
    }
    return {
      ok: true,
      teacherId,
      subjectId,
      slug: noteSlug,
      filename: file.filename,
      content: file.content,
      title: extractTitle(file.content, noteSlug),
      storage: 'google-drive',
      wikiSlug: `teachers/${teacherId}/${subjectId}/${noteSlug}`,
    };
  }

  throw new Error(`找不到筆記：${noteSlug}.md`);
}

/** 掃本機 wiki/teachers — 即時目錄（不需等 Pages 建置） */
export function buildLocalWikiCatalog() {
  const teachersRoot = path.join(wikiRoot(), 'teachers');
  const files = [];
  if (!fs.existsSync(teachersRoot)) {
    return { ok: true, files, storage: 'local', count: 0 };
  }

  for (const tEnt of fs.readdirSync(teachersRoot, { withFileTypes: true })) {
    if (!tEnt.isDirectory() || tEnt.name.startsWith('_')) continue;
    const teacherId = tEnt.name;
    const teacherMeta = getTeacherMeta(teacherId);
    const teacherName = teacherMeta.displayName || teacherMeta.name || teacherId;
    const tDir = path.join(teachersRoot, teacherId);
    for (const sEnt of fs.readdirSync(tDir, { withFileTypes: true })) {
      if (!sEnt.isDirectory() || sEnt.name.startsWith('_')) continue;
      const subjectId = sEnt.name;
      const cat = findSubjectInCatalog(subjectId);
      const subjectMeta = readJson(path.join(tDir, subjectId, '_meta.json')) || {};
      const subjectName = subjectMeta.name || cat?.name || subjectId;
      const subjectNameEn = subjectMeta.nameEn || cat?.nameEn || subjectName;
      for (const f of listLocalTeacherFiles(teacherId, subjectId)) {
        let status = 'published';
        try {
          const raw = fs.readFileSync(path.join(subjectDir(teacherId, subjectId), f.filename), 'utf8');
          const statusMatch = raw.match(/^---[\s\S]*?^status:\s*["']?(\w+)/m);
          status = (statusMatch?.[1] || 'published').toLowerCase();
        } catch {
          /* ignore */
        }
        if (status === 'draft') continue;
        files.push({
          slug: `teachers/${teacherId}/${subjectId}/${f.slug}`,
          title: f.title || f.slug,
          description: '',
          teacher: teacherName,
          teacherId,
          subject: subjectName,
          subjectEn: subjectNameEn,
          subjectId,
          noteSlug: f.slug,
          keywords: [teacherName, subjectName].filter(Boolean),
          keywordsEn: [teacherName, subjectNameEn].filter(Boolean),
          tags: [],
          date: '',
          updated: '',
          html: '',
          bodyText: f.title || f.slug,
          live: true,
        });
      }
    }
  }

  files.sort((a, b) => String(a.title).localeCompare(String(b.title), 'zh-Hant'));
  return { ok: true, files, storage: 'local', count: files.length };
}

/** 把該老師 Drive 上的 .md 拉回本機 wiki/（讓目錄／建置看得到） */
export async function pullTeacherDriveToLocal(teacherId) {
  if (!teacherId) throw new Error('缺少 teacherId');
  if (!isDriveConfigured()) {
    return { ok: true, pulled: 0, skipped: true, reason: 'drive-not-configured' };
  }

  const dir = teacherDir(teacherId);
  const subjectIds = new Set();
  if (fs.existsSync(dir)) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && !e.name.startsWith('_')) subjectIds.add(e.name);
    }
  }
  // 若本機尚無科目夾，至少試科目目錄裡常見的（避免掃全部 12 科太慢）
  if (!subjectIds.size) {
    for (const s of getSubjectCatalog().slice(0, 6)) subjectIds.add(s.id);
  }

  let pulled = 0;
  const errors = [];
  for (const subjectId of subjectIds) {
    try {
      const remote = await listTeacherMarkdownFiles(teacherId, subjectId, { create: false });
      for (const f of remote) {
        try {
          const full = await readTeacherMarkdown(teacherId, subjectId, f.slug);
          const destDir = subjectDir(teacherId, subjectId);
          fs.mkdirSync(destDir, { recursive: true });
          fs.writeFileSync(path.join(destDir, f.filename), full.content, 'utf8');
          upsertWikiIndexLink(teacherId, subjectId, f.slug, extractTitle(full.content, f.slug));
          pulled += 1;
        } catch (err) {
          errors.push(`${subjectId}/${f.slug}: ${err.message || err}`);
        }
      }
    } catch {
      /* subject folder may not exist on Drive */
    }
  }

  return { ok: true, pulled, errors: errors.slice(0, 8) };
}

export async function uploadTeacherFile(user, { subjectId, filename, content, teacherId: reqTeacherId }) {
  const teacherId = resolveWriteTeacherId(user, reqTeacherId);
  if (!teacherId) throw new Error('無權限上傳筆記');
  if (!subjectId) throw new Error('請選擇科目或處室');
  if (!content?.trim()) throw new Error('請提供筆記內容');
  if (!findSubjectInCatalog(subjectId)) throw new Error('請選擇有效的科目或處室');

  const teacherMeta = getTeacherMeta(teacherId);
  const displayName =
    String(user.nickname || teacherMeta.displayName || teacherMeta.name || teacherId).trim();
  const subjectMeta = ensureSubjectFolder(teacherId, subjectId, displayName);
  const safeName = safeFilename(filename);
  if (safeName === 'index.md') throw new Error('請勿使用 index.md 作為檔名');

  const noteSlug = safeName.replace(/\.md$/i, '');
  const finalContent = ensureFrontmatter(content, {
    teacher: displayName,
    teacherId,
    subject: subjectMeta.name || subjectId,
    subjectId: subjectMeta.id || subjectId,
    keywords: [subjectMeta.name, displayName].filter(Boolean),
    title: extractTitle(content, noteSlug),
  });

  // 本機鏡像（Pages 建置／離線後備）
  const dir = subjectDir(teacherId, subjectMeta.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, safeName), finalContent, 'utf8');
  upsertWikiIndexLink(teacherId, subjectMeta.id, noteSlug, extractTitle(finalContent, noteSlug));

  let storage = 'local';
  let drivePath = null;
  if (isDriveConfigured()) {
    const saved = await upsertTeacherMarkdown(teacherId, subjectMeta.id, safeName, finalContent);
    storage = 'google-drive';
    drivePath = saved.path;
  }

  return {
    ok: true,
    teacherId,
    subjectId: subjectMeta.id,
    filename: safeName,
    slug: noteSlug,
    path: drivePath || `wiki/teachers/${teacherId}/${subjectMeta.id}/${safeName}`,
    storage,
    message:
      storage === 'google-drive'
        ? `已儲存到你的 Wiki（Google Drive：${drivePath}）。`
        : `已儲存到本機 wiki/teachers/${teacherId}/${subjectMeta.id}/${safeName}。`,
  };
}

/**
 * 上傳教學圖片：寫入 wiki/.../assets（與筆記同目錄樹）+ public/wiki/.../assets（本機／Pages 靜態提供）
 * body.dataBase64 可含 data URL 前綴
 */
export async function uploadTeacherImage(
  user,
  { subjectId, filename, dataBase64, teacherId: reqTeacherId } = {},
) {
  const teacherId = resolveWriteTeacherId(user, reqTeacherId);
  if (!teacherId) throw new Error('無權限上傳圖片');
  if (!subjectId) throw new Error('請選擇科目或處室');
  if (!findSubjectInCatalog(subjectId)) throw new Error('請選擇有效的科目或處室');

  const raw = String(dataBase64 || '');
  const m = raw.match(/^data:([^;]+);base64,(.+)$/s);
  const b64 = (m ? m[2] : raw).replace(/\s/g, '');
  if (!b64) throw new Error('請提供圖片資料');

  let buffer;
  try {
    buffer = Buffer.from(b64, 'base64');
  } catch {
    throw new Error('圖片資料無效');
  }
  if (!buffer.length) throw new Error('圖片是空的');
  if (buffer.length > 6 * 1024 * 1024) throw new Error('圖片請小於 6MB');

  const teacherMeta = getTeacherMeta(teacherId);
  const displayName =
    String(user.nickname || teacherMeta.displayName || teacherMeta.name || teacherId).trim();
  const subjectMeta = ensureSubjectFolder(teacherId, subjectId, displayName);
  const safeName = safeImageFilename(filename);
  const wikiDir = wikiAssetsDir(teacherId, subjectMeta.id);
  const pubDir = publicAssetsDir(teacherId, subjectMeta.id);
  fs.mkdirSync(wikiDir, { recursive: true });
  fs.mkdirSync(pubDir, { recursive: true });
  fs.writeFileSync(path.join(wikiDir, safeName), buffer);
  fs.writeFileSync(path.join(pubDir, safeName), buffer);

  const relPath = `wiki/teachers/${teacherId}/${subjectMeta.id}/assets/${safeName}`;
  return {
    ok: true,
    teacherId,
    subjectId: subjectMeta.id,
    filename: safeName,
    path: relPath,
    /** 相對站台 root（前端請加 BASE_URL） */
    publicPath: relPath,
    bytes: buffer.length,
    message: `圖片已上傳：${safeName}`,
  };
}

function removeWikiIndexLink(teacherId, subjectId, noteSlug) {
  const indexPath = path.join(wikiRoot(), 'index.md');
  if (!fs.existsSync(indexPath)) return;
  const linkSlug = wikiLinkSlug(teacherId, subjectId, noteSlug);
  let text = fs.readFileSync(indexPath, 'utf8');
  text = text.replace(new RegExp(`^- \\[\\[${linkSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\][^\\n]*\\n?`, 'm'), '');
  fs.writeFileSync(indexPath, text, 'utf8');
}

export async function deleteTeacherFile(user, { subjectId, slug, teacherId: reqTeacherId }) {
  const teacherId = resolveWriteTeacherId(user, reqTeacherId);
  if (!teacherId) throw new Error('無權限刪除筆記');
  if (!subjectId) throw new Error('請指定 subjectId');
  const noteSlug = normalizeSlug(slug);
  if (!noteSlug) throw new Error('檔名無效');

  const filePath = path.join(subjectDir(teacherId, subjectId), `${noteSlug}.md`);
  const hadLocal = fs.existsSync(filePath);

  // 先刪本機，避免列表「本機優先」又把已刪雲端檔掃回來
  let localDeleted = false;
  if (hadLocal) {
    fs.unlinkSync(filePath);
    localDeleted = true;
  }

  let driveResult = { skipped: true };
  if (isDriveConfigured()) {
    try {
      driveResult = await deleteTeacherMarkdown(teacherId, subjectId, `${noteSlug}.md`);
    } catch (err) {
      console.error('Drive deleteTeacherMarkdown:', err);
      driveResult = { ok: false, error: String(err.message || err) };
    }
  }

  removeWikiIndexLink(teacherId, subjectId, noteSlug);

  // 雙重確認本機已不存在
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      localDeleted = true;
    } catch (err) {
      throw new Error(`本機刪除失敗：${err.message || err}`);
    }
  }

  const driveGone =
    driveResult.skipped ||
    driveResult.ok === true ||
    /already-gone|not-on-drive|no-folder/i.test(String(driveResult.reason || ''));

  if (!localDeleted && !driveGone && driveResult.ok === false) {
    throw new Error(driveResult.error || `刪除失敗：找不到 ${noteSlug}.md`);
  }

  if (!localDeleted && driveResult.skipped && driveResult.reason === 'not-on-drive') {
    // 本機與雲端都不存在：視為已刪（列表重整即可）
    return {
      ok: true,
      teacherId,
      subjectId,
      slug: noteSlug,
      storage: isDriveConfigured() ? 'google-drive' : 'local',
      drive: driveResult,
      localDeleted: false,
      message: `${noteSlug}.md 已不存在（可能先前已刪）`,
    };
  }

  return {
    ok: true,
    teacherId,
    subjectId,
    slug: noteSlug,
    storage: isDriveConfigured() ? (driveGone ? 'google-drive' : 'local') : 'local',
    drive: driveResult,
    localDeleted,
    message: `已刪除 ${noteSlug}.md`,
  };
}


function rewriteWikiLinks(text, oldSlug, newSlug) {
  const re = new RegExp(`\\[\\[${oldSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\|[^\\]]*)?\\]\\]`, 'g');
  return text.replace(re, (_m, label) => `[[${newSlug}${label || ''}]]`);
}

export function renameTeacherFile(user, { subjectId, oldSlug, newSlug, teacherId: reqTeacherId }) {
  const teacherId = resolveWriteTeacherId(user, reqTeacherId);
  if (!teacherId) throw new Error('無權限重新命名');
  if (!subjectId) throw new Error('請指定 subjectId');

  const fromSlug = normalizeSlug(oldSlug);
  const toSlug = normalizeSlug(newSlug);
  if (!fromSlug) throw new Error('原檔名無效');
  if (!toSlug) throw new Error('新檔名無效。可用中文、英文、數字、_ 與 -；不可空白或其他符號。');
  if (fromSlug === toSlug) throw new Error('新檔名與舊檔名相同');

  const dir = subjectDir(teacherId, subjectId);
  const fromPath = path.join(dir, `${fromSlug}.md`);
  const toPath = path.join(dir, `${toSlug}.md`);
  if (!fs.existsSync(fromPath)) throw new Error(`找不到 ${fromSlug}.md`);
  if (fs.existsSync(toPath)) throw new Error(`已存在 ${toSlug}.md，請換一個名字`);

  fs.renameSync(fromPath, toPath);

  const oldLink = wikiLinkSlug(teacherId, subjectId, fromSlug);
  const newLink = wikiLinkSlug(teacherId, subjectId, toSlug);
  const content = fs.readFileSync(toPath, 'utf8');
  const title = extractTitle(content, toSlug);

  const walk = (rootDir) => {
    if (!fs.existsSync(rootDir)) return;
    for (const ent of fs.readdirSync(rootDir, { withFileTypes: true })) {
      const fp = path.join(rootDir, ent.name);
      if (ent.isDirectory()) walk(fp);
      else if (ent.name.endsWith('.md')) {
        const before = fs.readFileSync(fp, 'utf8');
        let after = rewriteWikiLinks(before, oldLink, newLink);
        if (fp === path.join(wikiRoot(), 'index.md') && after.includes(`[[${oldLink}]]`)) {
          after = after.replace(
            new RegExp(`^- \\[\\[${oldLink.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\][^\\n]*$`, 'm'),
            `- [[${newLink}]] — ${title}`,
          );
        }
        if (after !== before) fs.writeFileSync(fp, after, 'utf8');
      }
    }
  };
  walk(wikiRoot());

  return {
    ok: true,
    teacherId,
    subjectId,
    oldSlug: fromSlug,
    newSlug: toSlug,
    filename: `${toSlug}.md`,
    message: `已將 ${fromSlug}.md 重新命名為 ${toSlug}.md（含目錄與交叉連結）。`,
  };
}

export async function runWikiSync(user) {
  const drive = getDriveStatus();
  const teacherId = resolveWriteTeacherId(user);
  let pull = { pulled: 0, skipped: true };

  if (drive.configured && teacherId) {
    pull = await pullTeacherDriveToLocal(teacherId);
  }

  if (drive.configured) {
    return {
      ok: true,
      message:
        pull.pulled > 0
          ? `已從 Google Drive 拉回 ${pull.pulled} 篇到本機鏡像。請重新整理 WikiNB／我的筆記；瀏覽請用即時筆記頁（不會再 404）。`
          : '雲端已對齊本機鏡像（無新檔可拉）。WikiNB 搜尋會讀即時目錄；開啟筆記請用即時頁，勿依賴舊的靜態 /wiki/ 網址。',
      gitPush: false,
      storage: 'google-drive',
      drive,
      pull,
    };
  }

  const root = projectRoot();
  const autoPush = process.env.AUTO_GIT_PUSH === 'true';

  if (!autoPush) {
    await execFileAsync('npm', ['run', 'build'], { cwd: root, timeout: 180000 });
    return {
      ok: true,
      message:
        'Drive 尚未設定：已本機建置。請設定 Google Drive 後，筆記會即時可讀，不必等 git push。',
      gitPush: false,
      storage: 'local',
      drive,
    };
  }

  await execFileAsync('git', ['add', 'wiki/'], { cwd: root });
  try {
    await execFileAsync('git', ['commit', '-m', 'sync: update wiki from KCIS host'], {
      cwd: root,
      env: process.env,
    });
  } catch (err) {
    const msg = String(err.stdout || err.stderr || err.message || '');
    if (!/nothing to commit|no changes added|clean working tree/i.test(msg)) {
      console.warn('git commit:', msg.slice(0, 300));
    }
  }

  const pushEnv = { ...process.env };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) {
    pushEnv.GIT_ASKPASS = 'echo';
    pushEnv.GIT_TERMINAL_PROMPT = '0';
    const remote = `https://x-access-token:${token}@github.com/zx50416/WikiNB-KCIS.git`;
    await execFileAsync('git', ['push', remote, 'HEAD:main'], {
      cwd: root,
      env: pushEnv,
      timeout: 120000,
    });
  } else {
    await execFileAsync('git', ['push', 'origin', 'HEAD'], {
      cwd: root,
      env: pushEnv,
      timeout: 120000,
    });
  }

  return {
    ok: true,
    message: 'Wiki 已推送至 GitHub，Pages 將自動重新部署（約 1–2 分鐘）',
    gitPush: true,
  };
}

/** 老師首次開通／每次登入補齊：本機鏡像 +（若已設定）Google Drive 真實資料夾 */
export async function provisionTeacherWorkspace({
  teacherId,
  nickname,
  name,
  driveTimeoutMs = 4000,
} = {}) {
  if (!teacherId) return { ok: false, reason: 'missing teacherId' };
  const dir = teacherDir(teacherId);
  fs.mkdirSync(dir, { recursive: true });
  const metaPath = path.join(dir, '_meta.json');
  const existingMeta = readJson(metaPath) || {};
  const displayName = String(
    nickname || name || existingMeta.displayName || existingMeta.name || teacherId,
  ).trim();
  const subjects =
    Array.isArray(existingMeta.subjects) && existingMeta.subjects.length
      ? [...existingMeta.subjects]
      : ['general'];
  if (!subjects.includes('general')) subjects.unshift('general');

  const meta = {
    ...existingMeta,
    id: teacherId,
    name: displayName,
    displayName,
    subjects,
    status: existingMeta.status || 'active',
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');

  const subjectPath = path.join(dir, 'general');
  fs.mkdirSync(subjectPath, { recursive: true });
  const subjectMeta = path.join(subjectPath, '_meta.json');
  if (!fs.existsSync(subjectMeta)) {
    fs.writeFileSync(
      subjectMeta,
      JSON.stringify(
        {
          id: 'general',
          name: '一般筆記',
          nameEn: 'General',
          teacherId,
          keywords: [displayName, '一般筆記'].filter(Boolean),
        },
        null,
        2,
      ),
      'utf8',
    );
  }

  let driveResult = { skipped: true };
  if (isDriveConfigured()) {
    try {
      driveResult = await withTimeout(
        provisionTeacherOnDrive({ teacherId, nickname: displayName, name: displayName }),
        driveTimeoutMs,
        'Drive provision timeout',
      );
    } catch (err) {
      console.error('provisionTeacherOnDrive:', err);
      driveResult = { ok: false, error: String(err.message || err) };
      // 背景再試一次，不擋登入回應
      provisionTeacherOnDrive({ teacherId, nickname: displayName, name: displayName }).catch(
        (e) => console.error('provisionTeacherOnDrive(bg):', e),
      );
    }
  }
  return { ok: true, teacherId, local: true, path: `wiki/teachers/${teacherId}/`, drive: driveResult };
}

export async function syncTeacherNicknameToWiki(teacherId, displayName) {
  if (!teacherId || !displayName) return { ok: false, reason: 'missing' };
  const nick = String(displayName).trim();
  if (!nick) return { ok: false, reason: 'empty nickname' };

  const dir = teacherDir(teacherId);
  fs.mkdirSync(dir, { recursive: true });
  const metaPath = path.join(dir, '_meta.json');
  const meta = readJson(metaPath) || { id: teacherId, subjects: ['general'], status: 'active' };
  const previousNames = new Set(
    [meta.displayName, meta.name, teacherId]
      .map((s) => String(s || '').trim())
      .filter((s) => s && s !== nick),
  );

  // 先掃筆記 frontmatter，把仍殘留的舊暱稱一併列入替換
  if (fs.existsSync(dir)) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const subjectPath = path.join(dir, ent.name);
      for (const name of fs.readdirSync(subjectPath)) {
        if (!name.endsWith('.md')) continue;
        const raw = fs.readFileSync(path.join(subjectPath, name), 'utf8');
        const m = raw.match(/^teacher:\s*["']?([^\n"']+)["']?\s*$/m);
        const old = String(m?.[1] || '').trim();
        if (old && old !== nick) previousNames.add(old);
      }
      const sub = readJson(path.join(subjectPath, '_meta.json'));
      if (Array.isArray(sub?.keywords)) {
        for (const k of sub.keywords) {
          const val = String(k || '').trim();
          if (val && val !== nick && val === teacherId) previousNames.add(val);
        }
      }
    }
  }

  meta.id = teacherId;
  meta.name = nick;
  meta.displayName = nick;
  meta.status = meta.status || 'active';
  if (!Array.isArray(meta.subjects)) meta.subjects = ['general'];
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');

  const replaceNameList = (list) => {
    const arr = Array.isArray(list) ? list.map((x) => String(x || '').trim()).filter(Boolean) : [];
    const next = arr.map((k) => (previousNames.has(k) ? nick : k));
    if (!next.includes(nick)) next.push(nick);
    return [...new Set(next)];
  };

  const rewriteNoteFrontmatter = (raw) => {
    if (!raw.startsWith('---')) return { text: raw, changed: false };
    const end = raw.indexOf('\n---', 3);
    if (end < 0) return { text: raw, changed: false };
    let fm = raw.slice(0, end + 4);
    const body = raw.slice(end + 4);
    let changed = false;

    const teacherRe = /^(teacher:\s*)(["']?)([^\n"']+)\2\s*$/m;
    const tm = fm.match(teacherRe);
    if (tm) {
      const old = String(tm[3] || '').trim();
      if (old !== nick && (previousNames.has(old) || !old)) {
        fm = fm.replace(teacherRe, `$1"${nick}"`);
        changed = true;
        if (old) previousNames.add(old);
      }
    } else {
      fm = fm.replace(/\n---\s*$/, `\nteacher: "${nick}"\n---`);
      changed = true;
    }

    // keywords 清單內替換舊暱稱
    const kwBlock = fm.match(/^keywords:\s*\n((?:\s+-\s+.+\n?)*)/m);
    if (kwBlock) {
      const lines = kwBlock[1]
        .split('\n')
        .map((line) => {
          const m = line.match(/^(\s+-\s+)["']?([^"'\n]+)["']?\s*$/);
          if (!m) return line;
          const val = m[2].trim();
          if (previousNames.has(val)) {
            changed = true;
            return `${m[1]}"${nick}"`;
          }
          return line;
        })
        .filter((line) => line.trim() !== '');
      const hasNick = lines.some((line) => {
        const m = line.match(/^\s+-\s+["']?([^"'\n]+)["']?\s*$/);
        return m && m[1].trim() === nick;
      });
      if (!hasNick) {
        lines.push(`  - "${nick}"`);
        changed = true;
      }
      fm = fm.replace(/^keywords:\s*\n((?:\s+-\s+.+\n?)*)/m, `keywords:\n${lines.join('\n')}\n`);
    }

    return { text: changed ? fm + body : raw, changed };
  };

  let subjectsUpdated = 0;
  let notesUpdated = 0;

  if (fs.existsSync(dir)) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const subjectPath = path.join(dir, ent.name);
      const subMetaPath = path.join(subjectPath, '_meta.json');
      const sub = readJson(subMetaPath);
      if (sub) {
        const before = JSON.stringify(sub.keywords || []);
        sub.teacherId = teacherId;
        sub.keywords = replaceNameList(sub.keywords);
        if (Array.isArray(sub.keywordsEn)) {
          sub.keywordsEn = replaceNameList(sub.keywordsEn);
        }
        if (JSON.stringify(sub.keywords || []) !== before) subjectsUpdated += 1;
        fs.writeFileSync(subMetaPath, JSON.stringify(sub, null, 2), 'utf8');
      }

      for (const name of fs.readdirSync(subjectPath)) {
        if (!name.endsWith('.md')) continue;
        const fp = path.join(subjectPath, name);
        const raw = fs.readFileSync(fp, 'utf8');
        const { text, changed } = rewriteNoteFrontmatter(raw);
        if (changed) {
          fs.writeFileSync(fp, text, 'utf8');
          notesUpdated += 1;
          if (isDriveConfigured()) {
            try {
              await upsertTeacherMarkdown(teacherId, ent.name, name, text);
            } catch (err) {
              console.warn('sync nickname drive note:', err.message || err);
            }
          }
        }
      }
    }
  }

  if (isDriveConfigured()) {
    try {
      await updateTeacherDisplayNameOnDrive(teacherId, nick);
    } catch (err) {
      console.warn('sync nickname drive meta:', err.message || err);
    }
  }

  return {
    ok: true,
    teacherId,
    displayName: nick,
    subjectsUpdated,
    notesUpdated,
    replaced: [...previousNames],
  };
}
