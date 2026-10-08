/**
 * Auth API client
 * - 本機 dev（127.0.0.1）：打 auth.url → http://127.0.0.1:8790
 * - GitHub Pages：若有 auth.productionUrl（未來 Cloud Run）則用之；否則提示改走本機登入
 * 過渡期不依賴 Mac＋Cloudflare Tunnel 主機腳本。
 */
import { t } from './i18n.js';
import { mountSchoolAccount } from './school-account.js';
function readAuthConfig() {
  const el = document.getElementById('auth-config');
  if (el?.textContent) {
    try {
      return JSON.parse(el.textContent);
    } catch {
      /* ignore */
    }
  }
  return {};
}

function getAuthBase() {
  const cfg = readAuthConfig();
  const local = (
    cfg.url ||
    import.meta.env.PUBLIC_AUTH_URL ||
    'http://127.0.0.1:8790'
  ).replace(/\/$/, '');
  const production = String(
    cfg.productionUrl || import.meta.env.PUBLIC_AUTH_PRODUCTION_URL || '',
  ).replace(/\/$/, '');

  if(typeof location !== 'undefined' && ['localhost','127.0.0.1'].includes(location.hostname)) {
    const endpoint=new URL(local);if(['localhost','127.0.0.1'].includes(endpoint.hostname))endpoint.hostname=location.hostname;return endpoint.href.replace(/\/$/,'');
  }
  return /^https:\/\//i.test(production) ? production : '';
}

export function getAuthUrl() {
  return getAuthBase();
}

const TOKEN_KEY = 'wikinb_kcis_token';

function getStoredToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

function setStoredToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/** 同步提示：僅有 localStorage token。不可當成資安依據，只用來決定連到 login 還是 note。 */
export function hasSessionHint() {
  return Boolean(getStoredToken());
}

export function clearSessionHint() {
  setStoredToken('');
  if (typeof document !== 'undefined') {
    document.dispatchEvent(
      new CustomEvent('wikinb:auth-change', {
        detail: { loggedIn: false, user: null, isTeacher: false },
      }),
    );
  }
}

/** 登入回應若帶 token（Pages 跨站），存起來之後用 Bearer */
function rememberSessionFrom(data) {
  if (data?.token) setStoredToken(data.token);
  return data;
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

async function authFetch(path, options = {}) {
  if(!getAuthBase()) throw new Error(t('library.disconnected'));
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  const tok = getStoredToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;

  const res = await fetch(`${getAuthBase()}${path}`, {
    credentials: 'include',
    ...options,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      clearSessionHint();
    }
    let message = data.error || data.message;
    if (!message) {
      if (res.status === 404) {
        message = t('auth.apiNotFound');
      } else {
        message = t('auth.connectionFailed', { status: res.status });
      }
    }
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function getAuthMixedContentBlock() {
  if (typeof location === 'undefined') return null;
  const base = getAuthBase();
  const pageIsHttps = location.protocol === 'https:';
  const authIsHttp = /^http:\/\//i.test(base);
  if (!(pageIsHttps && authIsHttp)) return null;

  return {
    online: false,
    reason: 'need-cloud-backend',
    message:
      '線上 GitHub Pages 無法直連本機 Auth。過渡期請改用本機登入頁；未來填上 Cloud Run 的 productionUrl 即可線上登入。',
  };
}

export const REFRESH_AFTER_HOST_HINT =
  '修好後請強制重新整理（Mac：Cmd+Shift+R）。本機測試用 4322 網址；github.io 還要 Tunnel 網址寫進 productionUrl 並 push。';

export const CODE_SENT_HINT =
  '驗證碼已寄至你的 Email 信箱，請查收（若沒看到請看垃圾郵件）。10 分鐘內有效。';

export const HOST_PROJECT_DIR = '/Users/kaine/Desktop/Projects/WikiNB_for_KCIS';
export const LOCAL_LOGIN_URL = 'http://127.0.0.1:4322/WikiNB-KCIS/login';

function hostCommands() {
  const q = `"${HOST_PROJECT_DIR}"`;
  return {
    localLogin: LOCAL_LOGIN_URL,
    doctor: `cd ${q} && ./host/doctor-mac.sh`,
    localAll: `cd ${q} && ./host/local-login-mac.sh`,
    auth: `cd ${q} && npm run auth`,
    tunnel: `cloudflared tunnel --url http://127.0.0.1:8790`,
    oneCommand: `cd ${q} && ./host/one-command-mac.sh`,
    dev: `cd ${q} && npm run dev`,
    health: 'curl -s http://127.0.0.1:8790/api/health',
  };
}

/**
 * 依目前網頁環境＋ Auth 健康狀態，回傳該顯示的說明與可複製終端機指令
 */
export async function diagnoseAuthConnection() {
  const onPages = typeof location !== 'undefined' && location.hostname.endsWith('github.io');
  const onLocal =
    typeof location !== 'undefined' &&
    (location.hostname === '127.0.0.1' || location.hostname === 'localhost');
  if(!onLocal) {
    if(!getAuthBase())return {online:false,reason:'not-configured',title:t('library.disconnected'),message:t('library.disconnected'),commands:[]};
    try { const health=await authFetch('/api/health');return {online:true,...health,commands:[]}; } catch { return {online:false,title:t('library.failed'),message:t('library.failed'),commands:[]}; }
  }
  const cmds = hostCommands();
  const production = String(readAuthConfig().productionUrl || '').trim();
  const looksLikeTunnel =
    /^https:\/\/[a-z0-9.-]+\.trycloudflare\.com\/?$/i.test(production) ||
    /^https:\/\//i.test(production);

  const portHint =
    '埠號對照：KCIS 網站 4322、Auth 8790。個人 WikiNB 是另一專案（常見 4321／8787），不要混用。';

  // Pages + 誤指到本機 HTTP → 瀏覽器會擋（mixed content）
  const blocked = getAuthMixedContentBlock();
  if (blocked) {
    return {
      ...blocked,
      title: '線上站無法直連本機 Auth',
      hint: `${portHint} 請先用本機登入頁測試，或開 Auth + Tunnel。`,
      localLoginUrl: cmds.localLogin,
      commands: [
        {
          id: 'local',
          label: '建議先本機測試（複製後用瀏覽器開）',
          cmd: cmds.localLogin,
        },
        { id: 'localAll', label: '一鍵啟動本機 Auth + 網站', cmd: cmds.localAll },
        { id: 'auth', label: '終端機 1：只開 Auth（8790）', cmd: cmds.auth },
        { id: 'tunnel', label: '終端機 2：Tunnel（僅 github.io 需要）', cmd: cmds.tunnel },
      ],
    };
  }

  try {
    const health = await authFetch('/api/health');
    return {
      online: true,
      reason: 'ok',
      title: '',
      message: '',
      hint: '',
      commands: [],
      localLoginUrl: cmds.localLogin,
      ...health,
    };
  } catch {
    if (onPages) {
      return {
        online: false,
        reason: looksLikeTunnel ? 'cloud-offline' : 'need-local-dev',
        title: looksLikeTunnel ? '雲端 Auth／Tunnel 目前離線' : '請啟動 Auth + Tunnel',
        message: looksLikeTunnel
          ? `github.io 連不到 productionUrl（${production}）。常見原因：Tunnel 沒開、網址過期、或 sites.json 還沒 push。本機請改開：${cmds.localLogin}`
          : `GitHub Pages 只有靜態畫面。要登入請開本機 ${cmds.localLogin}，或 Auth + Tunnel 後更新 productionUrl 並 push。`,
        hint: `${REFRESH_AFTER_HOST_HINT} ${portHint}`,
        localLoginUrl: cmds.localLogin,
        commands: [
          {
            id: 'local',
            label: '本機登入網址（最快可測）',
            cmd: cmds.localLogin,
          },
          { id: 'localAll', label: '一鍵啟動本機 Auth + 網站', cmd: cmds.localAll },
          { id: 'doctor', label: '除錯：一鍵診斷', cmd: cmds.doctor },
          { id: 'auth', label: '終端機 1：Auth（8790）', cmd: cmds.auth },
          {
            id: 'tunnel',
            label: '終端機 2：Tunnel（必須對準 8790，不是 8788）',
            cmd: cmds.tunnel,
          },
          {
            id: 'one',
            label: '（線上）一鍵 Auth + Tunnel + 寫入 productionUrl',
            cmd: cmds.oneCommand,
          },
          { id: 'check', label: '確認 Auth 健康', cmd: cmds.health },
        ],
        authBase: getAuthBase(),
        productionUrl: production,
      };
    }

    if (onLocal) {
      return {
        online: false,
        reason: 'local-auth-offline',
        title: '本機 Auth 未連線（8790）',
        message: `請確認登入網址是 ${cmds.localLogin}（光開 http://127.0.0.1:4322/ 會找不到頁面）。然後啟動 Auth；本機測試不需要 Tunnel。`,
        hint: `${portHint} 建議：一個終端機 Auth、一個 npm run dev；或直接跑一鍵腳本。`,
        localLoginUrl: cmds.localLogin,
        commands: [
          {
            id: 'local',
            label: '正確登入網址',
            cmd: cmds.localLogin,
          },
          { id: 'localAll', label: '一鍵啟動本機 Auth + 網站', cmd: cmds.localAll },
          { id: 'doctor', label: '除錯：一鍵診斷', cmd: cmds.doctor },
          { id: 'auth', label: '終端機 1：Auth', cmd: cmds.auth },
          { id: 'dev', label: '終端機 2：網站（4322）', cmd: cmds.dev },
          { id: 'check', label: '確認 Auth 健康', cmd: cmds.health },
        ],
        authBase: getAuthBase(),
      };
    }

    return {
      online: false,
      reason: 'offline',
      title: 'Auth 未連線',
      message: `請開本機登入頁 ${cmds.localLogin}，並執行 npm run auth。`,
      hint: portHint,
      localLoginUrl: cmds.localLogin,
      commands: [
        { id: 'local', label: '本機登入網址', cmd: cmds.localLogin },
        { id: 'localAll', label: '一鍵啟動', cmd: cmds.localAll },
        { id: 'auth', label: '啟動 Auth', cmd: cmds.auth },
      ],
    };
  }
}

export async function checkAuthHealth() {
  const d = await diagnoseAuthConnection();
  if (d.online) return d;
  return {
    online: false,
    reason: d.reason,
    message: d.message || d.title || 'Auth 未連線',
    title: d.title,
    hint: d.hint,
    commands: d.commands || [],
  };
}

export async function fetchMe(options = {}) {
  const timeoutMs = Number(options.timeoutMs ?? 4000);
  try {
    const shared = await withTimeout(authFetch('/api/auth/shared-session'), timeoutMs, 'auth-me-timeout');
    const data = { ...shared, authenticated: Boolean(shared.user) };
    if (!data?.authenticated) {
      clearSessionHint();
      return { ok: false, authenticated: false };
    }
    return data;
  } catch (err) {
    if (err.status === 401) {
      clearSessionHint();
      return { ok: false, authenticated: false };
    }
    // 逾時／斷線：fail-closed（視為未登入），並清掉可能失效的 token 提示
    // 不在此清 token：避免 Auth 短暫抖動就踢人；由呼叫端決定
    return {
      ok: false,
      authenticated: false,
      offline: true,
      error: String(err.message || err),
    };
  }
}

/**
 * 開筆記前唯一可信檢查：必須伺服器確認已登入。
 * fail-closed：失敗／逾時＝未登入。
 */
export async function requireLogin(options = {}) {
  const me = await fetchMe(options);
  if (me?.authenticated && me.user) {
    return { ok: true, authenticated: true, user: me.user, me };
  }
  return {
    ok: false,
    authenticated: false,
    offline: Boolean(me?.offline),
    error: me?.error || '',
    me,
  };
}

export async function lookupEmail(email) {
  return authFetch('/api/auth/lookup', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function sendAuthCode(email, purpose = 'login') {
  return authFetch('/api/auth/send-code', {
    method: 'POST',
    body: JSON.stringify({ email, purpose }),
  });
}

export async function verifyAuthCode(email, code, purpose = 'login') {
  return authFetch('/api/auth/verify-code', {
    method: 'POST',
    body: JSON.stringify({ email, code, purpose }),
  });
}

const SETUP_SESSION_KEY = 'wikinb_kcis_setup';
const SETUP_SESSION_TTL_MS = 15 * 60 * 1000;

/** 驗證碼通過後暫存，供 /login/setup 使用（不放在網址） */
export function saveSetupSession(payload) {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(
    SETUP_SESSION_KEY,
    JSON.stringify({ ...payload, ts: Date.now() }),
  );
}

export function readSetupSession(maxAgeMs = SETUP_SESSION_TTL_MS) {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SETUP_SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.email || !data?.code) return null;
    if (Date.now() - Number(data.ts || 0) > maxAgeMs) {
      sessionStorage.removeItem(SETUP_SESSION_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function clearSetupSession() {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(SETUP_SESSION_KEY);
}

export async function setPasswordWithCode({ email, code, password, nickname, purpose = 'setup' }) {
  const data = await authFetch('/api/auth/set-password', {
    method: 'POST',
    body: JSON.stringify({ email, code, password, nickname, purpose }),
  });
  return rememberSessionFrom(data);
}

export async function completeSetup({ email, code, nickname, purpose = 'login' }) {
  const data = await authFetch('/api/auth/complete-setup', {
    method: 'POST',
    body: JSON.stringify({ email, code, nickname, purpose }),
  });
  return rememberSessionFrom(data);
}

export async function loginWithCode({ email, code, purpose = 'login' }) {
  const data = await authFetch('/api/auth/login-with-code', {
    method: 'POST',
    body: JSON.stringify({ email, code, purpose }),
  });
  return rememberSessionFrom(data);
}

export async function loginWithPassword(email, password) {
  const data = await authFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  return rememberSessionFrom(data);
}

export async function loginStudent(nickname, password) {
  const data = await authFetch('/api/auth/student-login', {
    method: 'POST',
    body: JSON.stringify({ nickname, password }),
  });
  return rememberSessionFrom(data);
}

export async function updateMyNickname(nickname) {
  const data = await authFetch('/api/auth/nickname', {
    method: 'PATCH',
    body: JSON.stringify({ nickname }),
  });
  return rememberSessionFrom(data);
}

export async function logout() {
  try {
    await authFetch('/api/auth/logout', { method: 'POST', body: '{}' });
  } catch {
    /* ignore */
  }
  clearSessionHint();
}

export async function fetchCodexModels() {
  return authFetch('/api/codex/models');
}

export async function stopCodex() {
  return authFetch('/api/codex/stop', { method: 'POST', body: '{}' });
}

export async function codexChatStream(message, onEvent = () => {}, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  const tok = getStoredToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const res = await fetch(`${getAuthBase()}/api/codex/chat?stream=1`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({
      message,
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      history: options.history || [],
      teacherId: options.teacherId,
      subjectId: options.subjectId,
    }),
    signal: options.signal,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || data.detail || `HTTP ${res.status}`);
  }
  if (!res.body) throw new Error(t('auth.streamUnsupported'));

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalPayload = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        const line = part
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('');
        if (!line) continue;
        try {
          const payload = JSON.parse(line);
          onEvent(payload);
          if (payload.type === 'done' || payload.type === 'error') finalPayload = payload;
        } catch {
          onEvent({ type: 'log', text: line });
        }
      }
    }
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { type: 'done', ok: true, stopped: true, answer: t('gemini.stopped') };
    }
    throw err;
  }

  if (!finalPayload) throw new Error(t('auth.streamInterrupted'));
  if (finalPayload.type === 'error' && !finalPayload.answer) {
    throw new Error(finalPayload.error || finalPayload.detail || t('gemini.runFailed'));
  }
  return finalPayload;
}

export async function syncWiki() {
  return authFetch('/api/sync', { method: 'POST', body: '{}' });
}

export async function uploadWikiNote({ filename, content, subjectId, teacherId }) {
  return authFetch('/api/wiki/upload', {
    method: 'POST',
    body: JSON.stringify({ filename, content, subjectId, teacherId }),
  });
}

/** 上傳教學圖片（base64），回傳 publicPath 供插入 Markdown */
export async function uploadWikiImage({ filename, dataBase64, subjectId, teacherId }) {
  return authFetch('/api/wiki/upload-image', {
    method: 'POST',
    body: JSON.stringify({ filename, dataBase64, subjectId, teacherId }),
  });
}

export async function importDocument({ filename, mimeType, dataBase64, teacherId, subjectId, visibility, slug, keywords = [] }) {
  return authFetch('/api/files/import', {
    method: 'POST',
    body: JSON.stringify({ filename, mimeType, dataBase64, teacherId, subjectId, visibility, slug, keywords }),
  });
}

export async function listUploadedFiles({ teacherId } = {}) {
  const query = teacherId ? `?teacherId=${encodeURIComponent(teacherId)}` : '';
  return authFetch(`/api/files${query}`);
}

export async function fetchStudentClasses() {
  return authFetch('/api/student/classes');
}

export async function listClassStudents({ teacherId } = {}) {
  const query = teacherId ? `?teacherId=${encodeURIComponent(teacherId)}` : '';
  return authFetch(`/api/students${query}`);
}

export async function createStudentAccess({ studentNumber, nickname, teacherId }) {
  return authFetch('/api/students', {
    method: 'POST',
    body: JSON.stringify({ studentNumber, nickname, teacherId }),
  });
}

export async function resetStudentAccess({ studentId, teacherId }) {
  return authFetch(`/api/students/${encodeURIComponent(studentId)}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ teacherId }),
  });
}

export async function revokeStudentAccess({ studentId, teacherId }) {
  return authFetch(`/api/students/${encodeURIComponent(studentId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ teacherId }),
  });
}

async function fetchUploadedFileBlob(fileId) {
  const headers = {};
  const tok = getStoredToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const res = await fetch(`${getAuthBase()}/api/files/${encodeURIComponent(fileId)}/download`, {
    credentials: 'include',
    headers,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || t('auth.downloadFailed', { status: res.status }));
  }
  return res.blob();
}

export async function openUploadedFile(fileId) {
  const popup = window.open('about:blank', '_blank');
  if (!popup) throw new Error(t('note.popupBlocked'));
  try {
    popup.opener = null;
    popup.document.title = t('note.opening');
    popup.document.body.textContent = t('note.opening');
    const blob = await fetchUploadedFileBlob(fileId);
    const url = URL.createObjectURL(blob);
    popup.location.replace(url);
    setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
  } catch (error) {
    popup.close();
    throw error;
  }
}

export async function downloadUploadedFile(fileId, filename = 'download') {
  const blob = await fetchUploadedFileBlob(fileId);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function listWikiFiles({ subjectId, teacherId } = {}) {
  const qs = new URLSearchParams();
  if (subjectId) qs.set('subjectId', subjectId);
  if (teacherId) qs.set('teacherId', teacherId);
  const q = qs.toString();
  return authFetch(`/api/wiki/list${q ? `?${q}` : ''}`);
}

/** 一次列出該老師全部科目筆記 */
export async function listAllWikiFiles({ teacherId } = {}) {
  const qs = teacherId ? `?teacherId=${encodeURIComponent(teacherId)}` : '';
  return authFetch(`/api/wiki/list-all${qs}`);
}

/** 本機 wiki/ 即時目錄（登入後 WikiNB 搜尋用，不需等 Pages 建置） */
export async function fetchWikiCatalog() {
  return authFetch('/api/wiki/catalog');
}

export async function readWikiFile({ subjectId, slug, teacherId }) {
  const qs = new URLSearchParams();
  if (subjectId) qs.set('subjectId', subjectId);
  if (slug) qs.set('slug', slug);
  if (teacherId) qs.set('teacherId', teacherId);
  return authFetch(`/api/wiki/read?${qs.toString()}`);
}

export async function renameWikiFile({ oldSlug, newSlug, subjectId, teacherId }) {
  return authFetch('/api/wiki/rename', {
    method: 'POST',
    body: JSON.stringify({ oldSlug, newSlug, subjectId, teacherId }),
  });
}

export async function deleteWikiNote({ subjectId, slug, teacherId }) {
  return authFetch('/api/wiki/delete', {
    method: 'POST',
    body: JSON.stringify({ subjectId, slug, teacherId }),
  });
}

export async function fetchWikiSubjects({ teacherId } = {}) {
  const qs = teacherId ? `?teacherId=${encodeURIComponent(teacherId)}` : '';
  return authFetch(`/api/wiki/subjects${qs}`);
}

export function isTeacherUser(user) {
  if (!user) return false;
  return (user.role === 'teacher' || user.role === 'admin') && Boolean(user.teacherId);
}

export function displayUserName(user) {
  if (!user) return '';
  return user.nickname || user.name || user.email || '';
}

export function helloLabel(user) {
  const name = displayUserName(user);
  return name ? t('nav.hello', { name }) : '';
}

export async function isLoggedIn() {
  const me = await fetchMe();
  return Boolean(me.authenticated && me.user);
}

export async function mountNavAuth() {
  const loginLink = document.getElementById('nav-login');
  const logoutBtn = document.getElementById('nav-logout');
  const userLabel = document.getElementById('nav-user');
  const userWrap = document.getElementById('nav-user-wrap');
  const userMenu = document.getElementById('nav-user-menu');
  const navAi = document.getElementById('nav-ai');
  const navRoleCta = document.getElementById('nav-role-cta');
  const navRoleCtaLabel = navRoleCta?.querySelector('.nav-addnote-label');
  const editNicknameLink = document.getElementById('nav-edit-nick');
  const mobileWrap = document.getElementById('nav-mobile-wrap');
  const mobileToggle = document.getElementById('nav-mobile-toggle');
  const mobileMenu = document.getElementById('nav-mobile-menu');
  const mobileAi = document.getElementById('nav-mobile-ai');
  const mobileRoleCta = document.getElementById('nav-mobile-role-cta');
  const mobileRoleCtaLabel = mobileRoleCta?.querySelector('span');
  const mobileLogin = document.getElementById('nav-mobile-login');
  const mobileAccount = document.getElementById('nav-mobile-account');
  const mobileUser = document.getElementById('nav-mobile-user');
  const mobileEditNickname = document.getElementById('nav-mobile-edit-nick');
  const mobileLogout = document.getElementById('nav-mobile-logout');

  const closeMenu = () => {
    userMenu?.classList.add('hidden');
    userLabel?.setAttribute('aria-expanded', 'false');
  };

  const openMenu = () => {
    userMenu?.classList.remove('hidden');
    userLabel?.setAttribute('aria-expanded', 'true');
  };

  const closeMobileMenu = () => {
    mobileMenu?.classList.add('hidden');
    mobileToggle?.setAttribute('aria-expanded', 'false');
  };

  const openMobileMenu = () => {
    mobileMenu?.classList.remove('hidden');
    mobileToggle?.setAttribute('aria-expanded', 'true');
  };

  const setRoleCta = ({ link, label, teacher, student, classroomStudent }) => {
    const showCta = teacher || student;
    link?.classList.toggle('hidden', !showCta);
    if (!link || !label || !showCta) return;
    if (teacher) {
      link.href = link.dataset.teacherHref || link.href;
      label.setAttribute('data-i18n', 'home.myNotes');
      label.textContent = t('home.myNotes');
    } else {
      link.href = classroomStudent
        ? link.dataset.classroomHref || link.href
        : link.dataset.studentHref || link.href;
      label.setAttribute('data-i18n', classroomStudent ? 'student.nav' : 'nav.gemini');
      label.textContent = t(classroomStudent ? 'student.nav' : 'nav.gemini');
    }
  };

  const update = async () => {
    let me = { authenticated: false };
    try {
      me = await fetchMe();
    } catch {
      me = { authenticated: false };
    }
    const loggedIn = Boolean(me.authenticated && me.user);
    const teacher = loggedIn && isTeacherUser(me.user);
    const student = loggedIn && !teacher;
    const classroomStudent = student && me.user?.authType === 'student-code';
    loginLink?.classList.toggle('hidden', loggedIn);
    // 訪客：AI應用導航；登入後（老師／學生）隱藏
    navAi?.classList.toggle('hidden', loggedIn);
    // 彩色 CTA：老師 → My notes；學生 → Gemini × KCIS
    if (navRoleCta) {
      const showCta = teacher || student;
      navRoleCta.classList.toggle('is-cta-visible', showCta);
      navRoleCta.toggleAttribute('hidden', !showCta);
      navRoleCta.setAttribute('aria-hidden', showCta ? 'false' : 'true');
      if (showCta) navRoleCta.removeAttribute('tabindex');
      else navRoleCta.setAttribute('tabindex', '-1');

      if (teacher) {
        navRoleCta.href = navRoleCta.dataset.teacherHref || navRoleCta.href;
        if (navRoleCtaLabel) {
          navRoleCtaLabel.setAttribute('data-i18n', 'home.myNotes');
          navRoleCtaLabel.textContent = t('home.myNotes');
        }
      } else if (student) {
        navRoleCta.href = classroomStudent
          ? navRoleCta.dataset.classroomHref || navRoleCta.href
          : navRoleCta.dataset.studentHref || navRoleCta.href;
        if (navRoleCtaLabel) {
          navRoleCtaLabel.setAttribute('data-i18n', classroomStudent ? 'student.nav' : 'nav.gemini');
          navRoleCtaLabel.textContent = t(classroomStudent ? 'student.nav' : 'nav.gemini');
        }
      }
    }
    setRoleCta({
      link: mobileRoleCta,
      label: mobileRoleCtaLabel,
      teacher,
      student,
      classroomStudent,
    });
    mobileLogin?.classList.toggle('hidden', loggedIn);
    mobileAi?.classList.toggle('hidden', loggedIn);
    mobileAccount?.classList.toggle('hidden', !loggedIn);
    mobileEditNickname?.classList.toggle('hidden', classroomStudent);
    if (mobileUser) mobileUser.textContent = loggedIn ? helloLabel(me.user) : '';
    editNicknameLink?.classList.toggle('hidden', classroomStudent);
    if (userWrap && userLabel) {
      if (loggedIn) {
        userLabel.textContent = helloLabel(me.user);
        userLabel.title = t('nav.accountMenu');
        userWrap.classList.remove('hidden');
      } else {
        userWrap.classList.add('hidden');
        closeMenu();
      }
    }
    document.dispatchEvent(
      new CustomEvent('wikinb:auth-change', {
        detail: { loggedIn, user: me.user || null, isTeacher: teacher },
      }),
    );
  };

  userLabel?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!userMenu) return;
    if (userMenu.classList.contains('hidden')) openMenu();
    else closeMenu();
  });

  mobileToggle?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!mobileMenu) return;
    if (mobileMenu.classList.contains('hidden')) openMobileMenu();
    else closeMobileMenu();
  });

  mobileMenu?.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', closeMobileMenu);
  });

  document.addEventListener('click', (e) => {
    if (!userWrap?.contains(e.target)) closeMenu();
    if (!mobileWrap?.contains(e.target)) closeMobileMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeMenu();
      closeMobileMenu();
    }
  });

  /* Account actions stay on the current tool. */
  await mountSchoolAccount({onChange:update});
  document.addEventListener('wikinb:locale-change', update);
  window.addEventListener('kcis:session', update);
  window.addEventListener('storage', e => { if(e.key==='kcis:auth-change')void update(); });
  document.addEventListener('visibilitychange', () => { if(document.visibilityState==='visible')void update(); });

  await update();
}
