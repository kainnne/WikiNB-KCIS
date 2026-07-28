import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTeacherRole, requiresNicknameOnSetup, slugifyTeacherId } from './lib/account.js';
import { getDriveStatus } from './lib/drive.js';
import { normalizeEmail, rejectReasonForEmail } from './lib/domain.js';
import { chatOnce, chatStream, getModelsPayload, stopJob } from './lib/llm.js';
import { createLoginCode, checkLoginCode, sendCodeEmail, verifyLoginCode } from './lib/mail-code.js';
import { getRosterPath, resolveLoginRoster } from './lib/roster.js';
import {
  createSessionToken,
  getSessionCookieName,
  sessionCookieOptions,
  clearSessionCookieOptions,
  verifySessionToken,
} from './lib/session.js';
import {
  findUserByEmail,
  ensureUserFromRoster,
  getUsersFilePath,
  isAccountReady,
  needsNicknameSetup,
  publicUser,
  completeOtpLogin,
  updateNickname,
  setPassword,
  verifyPassword,
} from './lib/users.js';
import {
  listSubjectsForTeacher,
  listTeacherFiles,
  listAllTeacherFiles,
  buildLocalWikiCatalog,
  readTeacherFile,
  readWikiNoteContent,
  renameTeacherFile,
  resolveWriteTeacherId,
  runWikiSync,
  uploadTeacherFile,
  uploadTeacherImage,
  deleteTeacherFile,
  provisionTeacherWorkspace,
  syncTeacherNicknameToWiki,
} from './lib/wiki.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// override:true — 避免父程序殘留 PORT=8788 蓋掉 auth/.env 的 8790
dotenv.config({ path: path.join(__dirname, '.env'), override: true });

const PORT = Number(process.env.PORT || 8790);
// 0.0.0.0：同時接受 localhost 與 127.0.0.1（避免本機前端打不通）
const HOST = process.env.HOST || '0.0.0.0';
const PROJECT_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '..');
process.env.PROJECT_ROOT = PROJECT_ROOT;

const app = express();
app.use(express.json({ limit: '8mb' }));
app.use(cookieParser());
const allowedOrigins = [
  process.env.FRONTEND_ORIGIN || 'http://127.0.0.1:4322',
  'http://localhost:4322',
  'http://127.0.0.1:4322',
  'http://localhost:4323',
  'http://127.0.0.1:4323',
  'http://localhost:4321',
  'http://127.0.0.1:4321',
  'https://zx50416.github.io',
  ...(process.env.FRONTEND_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
];

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) {
        cb(null, true);
        return;
      }
      cb(
        null,
        allowedOrigins.some((o) => origin === o || origin.startsWith(o.replace(/\/$/, ''))),
      );
    },
    credentials: true,
  }),
);

/** Chrome Private Network Access：公開 HTTPS 站打本機 Auth 的 preflight */
app.use((req, res, next) => {
  if (req.headers['access-control-request-private-network'] === 'true') {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  next();
});

async function readSession(req) {
  const header = String(req.headers.authorization || '');
  const bearer = header.toLowerCase().startsWith('bearer ')
    ? header.slice(7).trim()
    : '';
  const cookieTok = req.cookies?.[getSessionCookieName()];
  return verifySessionToken(bearer || cookieTok);
}

async function requireAuth(req, res, next) {
  const session = await readSession(req);
  if (!session) {
    res.status(401).json({ error: '未登入或 session 已過期' });
    return;
  }
  req.user = session;
  next();
}

async function requireTeacher(req, res, next) {
  const session = await readSession(req);
  if (!session) {
    res.status(401).json({ error: '未登入或 session 已過期' });
    return;
  }
  if (!resolveWriteTeacherId(session)) {
    res.status(403).json({ error: '僅老師或管理員可執行此操作' });
    return;
  }
  req.user = session;
  next();
}

/** 設 cookie（本機同站）並回傳 token（Pages 跨站用 Bearer） */
async function issueSession(res, user) {
  const token = await createSessionToken(user);
  res.cookie(getSessionCookieName(), token, sessionCookieOptions());
  return token;
}

async function maybeProvisionTeacher(user) {
  if (isTeacherRole(user.role) && user.teacherId) {
    await provisionTeacherWorkspace({
      teacherId: user.teacherId,
      nickname: user.nickname,
      name: user.name,
    });
  }
}

/** 只有「自己的老師資料夾」才用暱稱覆寫 wiki 顯示名（避免 admin 共用 teacherId 蓋掉老師暱稱） */
function shouldSyncWikiNickname(user) {
  if (!user?.teacherId || !user?.nickname) return false;
  if (user.role === 'teacher') return true;
  return slugifyTeacherId(user.email) === user.teacherId;
}

async function syncWikiNicknameIfOwner(user) {
  if (!shouldSyncWikiNickname(user)) return null;
  return syncTeacherNicknameToWiki(user.teacherId, user.nickname);
}

app.get('/api/health', (_req, res) => {
  res.json({
    online: true,
    service: 'wikinb-kcis-api',
    authMode: 'email-otp',
    llmProvider: process.env.LLM_PROVIDER || 'gemini',
    drive: getDriveStatus(),
    rosterFile: getRosterPath(),
    usersFile: getUsersFilePath(),
  });
});

app.get('/api/auth/config', (_req, res) => {
  res.json({
    ok: true,
    mode: 'email-otp',
    message: '僅 @kcis.com.tw 與核准測試信箱可登入；每次以 Email 驗證碼登入。',
  });
});

app.get('/api/auth/me', async (req, res) => {
  const session = await readSession(req);
  if (!session) {
    res.status(401).json({ ok: false, authenticated: false });
    return;
  }
  const dbUser = findUserByEmail(session.email);
  const user = dbUser ? publicUser(dbUser) : session;
  res.json({ ok: true, authenticated: true, user });
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie(getSessionCookieName(), clearSessionCookieOptions());
  res.json({ ok: true });
});

/**
 * 第一步：只送 Email → 一律寄驗證碼（驗證碼登入）
 */
app.post('/api/auth/lookup', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email) {
      res.status(400).json({ error: '請輸入 Email' });
      return;
    }
    const denied = rejectReasonForEmail(email);
    if (denied) {
      res.status(403).json({ error: denied });
      return;
    }
    const roster = resolveLoginRoster(email);
    if (!roster) {
      res.status(403).json({ error: rejectReasonForEmail(email) || '此帳號不允許登入' });
      return;
    }

    ensureUserFromRoster(roster);
    const { code, expiresIn } = createLoginCode(email, 'login');
    const sendResult = await sendCodeEmail(email, code);
    res.json({
      ok: true,
      step: 'code',
      email,
      name: roster.name || email,
      role: roster.role || 'student',
      teacherId: roster.teacherId || '',
      needsNickname: needsNicknameSetup(email),
      ready: isAccountReady(email),
      expiresIn,
      purpose: 'login',
      message: sendResult.message
        ? sendResult.message
        : sendResult.dev
          ? '驗證碼已顯示於 Auth 終端機（請看 npm run auth 視窗）'
          : '驗證碼已寄至你的 Email 信箱，請查收',
      dev: Boolean(sendResult.dev),
      fallback: Boolean(sendResult.fallback),
    });
  } catch (err) {
    console.error('lookup:', err);
    res.status(err.message?.includes('SMTP') || err.message?.includes('寄信') ? 503 : 500).json({
      error: err.message || '無法驗證 Email，請稍後再試',
    });
  }
});

/** 寄驗證碼：login／setup／reset */
app.post('/api/auth/send-code', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const purpose =
      req.body?.purpose === 'reset'
        ? 'reset'
        : req.body?.purpose === 'setup'
          ? 'setup'
          : 'login';
    if (!email) {
      res.status(400).json({ error: '請輸入 Email' });
      return;
    }
    const roster = resolveLoginRoster(email);
    if (!roster) {
      res.status(403).json({ error: rejectReasonForEmail(email) || '此帳號不允許登入' });
      return;
    }

    ensureUserFromRoster(roster);
    const { code, expiresIn } = createLoginCode(email, purpose);
    const sendResult = await sendCodeEmail(email, code);
    res.json({
      ok: true,
      expiresIn,
      purpose,
      needsNickname: needsNicknameSetup(email),
      message: sendResult.message
        ? sendResult.message
        : sendResult.dev
          ? '驗證碼已顯示於 Auth 終端機（請看 npm run auth 視窗）'
          : '驗證碼已寄至你的 Email 信箱，請查收',
      dev: Boolean(sendResult.dev),
      fallback: Boolean(sendResult.fallback),
    });
  } catch (err) {
    console.error('send-code:', err);
    res.status(err.message?.includes('SMTP') || err.message?.includes('寄信') ? 503 : 500).json({
      error: err.message || '寄送驗證碼失敗',
    });
  }
});

/** 驗證驗證碼（不登入、不消耗）；若已有暱稱可直接走 login-with-code */
app.post('/api/auth/verify-code', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || '');
    const purpose =
      req.body?.purpose === 'reset'
        ? 'reset'
        : req.body?.purpose === 'setup'
          ? 'setup'
          : 'login';
    if (!email || !code) {
      res.status(400).json({ error: '請輸入 Email 與驗證碼' });
      return;
    }
    if (!resolveLoginRoster(email)) {
      res.status(403).json({ error: '此帳號不允許登入' });
      return;
    }
    const checked = checkLoginCode(email, code, purpose);
    if (!checked.ok) {
      // 相容：若前端傳 setup 但實際是 login 碼
      if (purpose !== 'login') {
        const alt = checkLoginCode(email, code, 'login');
        if (!alt.ok) {
          res.status(400).json({ error: checked.error });
          return;
        }
      } else {
        res.status(400).json({ error: checked.error });
        return;
      }
    }
    const roster = resolveLoginRoster(email);
    const needNick = needsNicknameSetup(email);
    res.json({
      ok: true,
      message: needNick ? '驗證碼正確，請設定暱稱' : '驗證碼正確，可完成登入',
      role: roster?.role || 'student',
      needsNickname: needNick,
      next: needNick ? 'setup' : 'login',
    });
  } catch (err) {
    console.error('verify-code:', err);
    res.status(500).json({ error: '驗證失敗' });
  }
});

/** 驗證碼登入（已有暱稱） */
app.post('/api/auth/login-with-code', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || '');
    const purpose = req.body?.purpose === 'setup' ? 'setup' : 'login';
    if (!email || !code) {
      res.status(400).json({ error: '請輸入 Email 與驗證碼' });
      return;
    }
    const roster = resolveLoginRoster(email);
    if (!roster) {
      res.status(403).json({ error: '此帳號不允許登入' });
      return;
    }
    if (needsNicknameSetup(email)) {
      res.status(400).json({
        error: '首次登入請先設定暱稱',
        needSetup: true,
      });
      return;
    }

    let checked = verifyLoginCode(email, code, purpose);
    if (!checked.ok && purpose !== 'login') {
      checked = verifyLoginCode(email, code, 'login');
    }
    if (!checked.ok) {
      res.status(400).json({ error: checked.error });
      return;
    }

    ensureUserFromRoster(roster);
    const user = completeOtpLogin(email);
    await maybeProvisionTeacher(user);
    const token = await issueSession(res, user);
    res.json({ ok: true, user, token, message: '登入成功' });
  } catch (err) {
    console.error('login-with-code:', err);
    res.status(500).json({ error: err.message || '登入失敗' });
  }
});

/** 首次：驗證碼 + 暱稱 → 登入（不再要求密碼） */
app.post('/api/auth/complete-setup', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || '');
    const nickname = String(req.body?.nickname || '').trim();
    const purpose = req.body?.purpose === 'setup' ? 'setup' : 'login';

    if (!email || !code) {
      res.status(400).json({ error: '請提供 Email 與驗證碼' });
      return;
    }
    const roster = resolveLoginRoster(email);
    if (!roster) {
      res.status(403).json({ error: '此帳號不允許登入' });
      return;
    }
    if (requiresNicknameOnSetup(roster.role, 'setup') && !nickname) {
      res.status(400).json({ error: '首次設定請填寫暱稱（顯示名稱）' });
      return;
    }

    let checked = verifyLoginCode(email, code, purpose);
    if (!checked.ok) {
      checked = verifyLoginCode(email, code, purpose === 'login' ? 'setup' : 'login');
    }
    if (!checked.ok) {
      res.status(400).json({ error: checked.error });
      return;
    }

    ensureUserFromRoster(roster);
    const user = completeOtpLogin(email, { nickname });
    await maybeProvisionTeacher(user);
    await syncWikiNicknameIfOwner(user);
    const token = await issueSession(res, user);
    res.json({
      ok: true,
      user,
      token,
      message: '帳號設定完成並已登入',
    });
  } catch (err) {
    console.error('complete-setup:', err);
    res.status(400).json({ error: err.message || '設定失敗' });
  }
});

/** 相容舊前端：驗證碼 + 密碼（可選） */
app.post('/api/auth/set-password', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || '');
    const password = String(req.body?.password || '');
    const nickname = String(req.body?.nickname || '').trim();
    const purpose = req.body?.purpose === 'reset' ? 'reset' : 'setup';

    if (!email || !code) {
      res.status(400).json({ error: '請提供 Email、驗證碼' });
      return;
    }
    const roster = resolveLoginRoster(email);
    if (!roster) {
      res.status(403).json({ error: '此帳號不允許登入' });
      return;
    }

    // 新流程：若沒有密碼，改走暱稱設定
    if (!password) {
      if (!nickname && needsNicknameSetup(email)) {
        res.status(400).json({ error: '請填寫暱稱' });
        return;
      }
      let checked = verifyLoginCode(email, code, purpose === 'reset' ? 'login' : purpose);
      if (!checked.ok) checked = verifyLoginCode(email, code, 'login');
      if (!checked.ok) {
        res.status(400).json({ error: checked.error });
        return;
      }
      ensureUserFromRoster(roster);
      const user = completeOtpLogin(email, { nickname });
      await maybeProvisionTeacher(user);
      const token = await issueSession(res, user);
      res.json({ ok: true, user, token, message: '已登入' });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ error: '密碼至少 8 碼' });
      return;
    }
    if (requiresNicknameOnSetup(roster.role, purpose) && needsNicknameSetup(email) && !nickname) {
      res.status(400).json({ error: '首次設定請填寫暱稱（顯示名稱）' });
      return;
    }

    const checked = verifyLoginCode(email, code, purpose === 'reset' ? 'login' : purpose);
    if (!checked.ok) {
      const alt = verifyLoginCode(email, code, 'login');
      if (!alt.ok) {
        res.status(400).json({ error: checked.error });
        return;
      }
    }

    ensureUserFromRoster(roster);
    const user = await setPassword(email, password, { nickname });
    await maybeProvisionTeacher(user);
    const token = await issueSession(res, user);
    res.json({
      ok: true,
      user: publicUser(user),
      token,
      message: purpose === 'reset' ? '密碼已重設並登入' : '密碼已設定並登入',
    });
  } catch (err) {
    console.error('set-password:', err);
    res.status(500).json({ error: err.message || '設定密碼失敗' });
  }
});

/** 舊版密碼登入（相容；建議改驗證碼） */
app.post('/api/auth/login', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    if (!email || !password) {
      res.status(400).json({ error: '請輸入 Email 與密碼' });
      return;
    }
    if (!resolveLoginRoster(email)) {
      res.status(403).json({ error: '此帳號不允許登入' });
      return;
    }
    if (!isAccountReady(email)) {
      res.status(400).json({
        error: '尚未完成首次設定。請改用 Email 驗證碼登入。',
        needSetup: true,
      });
      return;
    }
    const user = await verifyPassword(email, password);
    if (!user) {
      res.status(401).json({ error: 'Email 或密碼錯誤。建議改用驗證碼登入。' });
      return;
    }
    await maybeProvisionTeacher(user);
    const token = await issueSession(res, user);
    res.json({ ok: true, user, token, message: '登入成功' });
  } catch (err) {
    console.error('login:', err);
    res.status(500).json({ error: '登入失敗' });
  }
});

/** 登入後修改暱稱（teacherId／Drive 資料夾不變） */
app.patch('/api/auth/nickname', requireAuth, async (req, res) => {
  try {
    const nickname = String(req.body?.nickname || '').trim();
    const user = updateNickname(req.user.email, nickname);
    await syncWikiNicknameIfOwner(user);
    const token = await issueSession(res, user);
    res.json({ ok: true, user, token, message: '暱稱已更新' });
  } catch (err) {
    res.status(400).json({ error: err.message || '無法更新暱稱' });
  }
});

app.get('/api/codex/models', requireAuth, (_req, res) => {
  res.json(getModelsPayload());
});

app.post('/api/codex/stop', requireAuth, (req, res) => {
  const key = req.user?.email || '';
  const result = stopJob(key);
  res.json({
    ok: true,
    stopped: result.stopped,
    message: result.stopped ? '已送出停止訊號' : '目前沒有執行中的工作',
  });
});

app.post('/api/codex/chat', requireAuth, async (req, res) => {
  const { message, model, reasoningEffort, history, teacherId, subjectId } = req.body || {};
  if (!message?.trim()) {
    res.status(400).json({ error: '請輸入訊息' });
    return;
  }

  const wantStream =
    String(req.query.stream || '') === '1' ||
    (req.headers.accept || '').includes('text/event-stream');

  if (wantStream) {
    chatStream(res, {
      message,
      history,
      model,
      reasoningEffort,
      teacherId,
      subjectId,
      sessionKey: req.user.email,
    });
    return;
  }

  try {
    const result = await chatOnce({ message, history, model, reasoningEffort, teacherId, subjectId });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('chat:', err);
    res.status(500).json({
      error: err.message || 'AI 執行失敗',
      detail: String(err.message || err).slice(0, 400),
    });
  }
});

app.get('/api/wiki/subjects', requireTeacher, (req, res) => {
  try {
    const teacherId = resolveWriteTeacherId(req.user, req.query.teacherId);
    if (!teacherId) {
      res.status(403).json({ error: '此帳號未綁定 teacherId' });
      return;
    }
    res.json({ ok: true, teacherId, subjects: listSubjectsForTeacher(teacherId) });
  } catch (err) {
    res.status(500).json({ error: err.message || '無法讀取科目列表' });
  }
});

app.get('/api/wiki/catalog', requireAuth, (_req, res) => {
  try {
    res.json(buildLocalWikiCatalog());
  } catch (err) {
    res.status(500).json({ error: err.message || '無法讀取筆記目錄' });
  }
});

app.get('/api/wiki/list', requireTeacher, async (req, res) => {
  try {
    const result = await listTeacherFiles(req.user, {
      subjectId: req.query.subjectId,
      teacherId: req.query.teacherId,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message || '無法讀取 wiki 列表' });
  }
});

app.get('/api/wiki/list-all', requireTeacher, async (req, res) => {
  try {
    const result = await listAllTeacherFiles(req.user, {
      teacherId: req.query.teacherId,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message || '無法讀取 wiki 列表' });
  }
});

app.get('/api/wiki/read', requireAuth, async (req, res) => {
  try {
    const teacherId = String(req.query.teacherId || '').trim();
    const subjectId = String(req.query.subjectId || '').trim();
    const slug = String(req.query.slug || '').trim();
    const ownId = resolveWriteTeacherId(req.user, teacherId || undefined);
    const targetTeacherId = teacherId || ownId;
    if (!targetTeacherId) {
      res.status(400).json({ error: '請指定 teacherId' });
      return;
    }
    // 自己的資料夾可打 Drive；其他人只能讀本機已鏡像的筆記
    const allowDrive = Boolean(ownId && ownId === targetTeacherId);
    const result = await readWikiNoteContent({
      teacherId: targetTeacherId,
      subjectId,
      slug,
      allowDrive,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message || '無法讀取筆記' });
  }
});

app.post('/api/wiki/upload', requireTeacher, async (req, res) => {
  try {
    const { filename, content, subjectId, teacherId } = req.body || {};
    const result = await uploadTeacherFile(req.user, { filename, content, subjectId, teacherId });
    res.json(result);
  } catch (err) {
    console.error('wiki upload:', err);
    res.status(400).json({ error: err.message || '儲存失敗' });
  }
});

app.post('/api/wiki/upload-image', requireTeacher, async (req, res) => {
  try {
    const { filename, dataBase64, subjectId, teacherId } = req.body || {};
    const result = await uploadTeacherImage(req.user, {
      filename,
      dataBase64,
      subjectId,
      teacherId,
    });
    res.json(result);
  } catch (err) {
    console.error('wiki upload-image:', err);
    res.status(400).json({ error: err.message || '圖片上傳失敗' });
  }
});

app.post('/api/wiki/rename', requireTeacher, async (req, res) => {
  try {
    const { oldSlug, newSlug, from, to, subjectId, teacherId } = req.body || {};
    const result = await renameTeacherFile(req.user, {
      subjectId,
      teacherId,
      oldSlug: oldSlug || from,
      newSlug: newSlug || to,
    });
    res.json(result);
  } catch (err) {
    console.error('wiki rename:', err);
    res.status(400).json({ error: err.message || '重新命名失敗' });
  }
});

app.post('/api/wiki/delete', requireTeacher, async (req, res) => {
  try {
    const { subjectId, slug, teacherId } = req.body || {};
    const result = await deleteTeacherFile(req.user, { subjectId, slug, teacherId });
    res.json(result);
  } catch (err) {
    console.error('wiki delete:', err);
    res.status(400).json({ error: err.message || '刪除失敗' });
  }
});

app.post('/api/sync', requireTeacher, async (req, res) => {
  try {
    const result = await runWikiSync(req.user);
    res.json(result);
  } catch (err) {
    console.error('sync:', err);
    res.status(500).json({ error: '同步失敗', detail: String(err.message || err) });
  }
});

app.listen(PORT, HOST, () => {
  const drive = getDriveStatus();
  console.log(`\n🔐 WikiNB KCIS API  http://127.0.0.1:${PORT}  (bind ${HOST})`);
  console.log(`   Auth: Email OTP（@kcis.com.tw + 核准測試信箱）`);
  console.log(`   AUTH_BASE_URL: ${process.env.AUTH_BASE_URL || '(unset)'}`);
  console.log(`   Roster overrides: ${getRosterPath()}`);
  console.log(`   LLM: ${process.env.LLM_PROVIDER || 'gemini'}`);
  console.log(
    drive.configured
      ? `   Drive: 已設定 folder=${drive.folderId}`
      : '   Drive: ⚠ 未設定服務帳號（筆記暫存本機 wiki/）',
  );
  const smtpOn = Boolean(
    process.env.SMTP_USER?.trim() && String(process.env.SMTP_PASS || '').replace(/\s/g, ''),
  );
  console.log(
    smtpOn
      ? `   SMTP: ${process.env.SMTP_USER}（驗證碼寄信箱）`
      : process.env.DEV_LOG_CODE === 'false'
        ? '   SMTP: ⚠ 未設定完整，驗證碼無法寄信'
        : '   SMTP: 未設定（DEV 模式：驗證碼印終端機）',
  );
  console.log(`   Project: ${PROJECT_ROOT}\n`);
});
