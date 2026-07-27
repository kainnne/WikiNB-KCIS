/**
 * Auth API client
 * - 本機 dev（127.0.0.1）：打 auth.url → http://127.0.0.1:8790
 * - GitHub Pages：若有 auth.productionUrl（未來 Cloud Run）則用之；否則提示改走本機登入
 * 過渡期不依賴 Mac＋Cloudflare Tunnel 主機腳本。
 */
import { t } from './i18n.js';
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

  if (typeof location !== 'undefined') {
    const onPages = location.hostname.endsWith('github.io');
    if (onPages) {
      // 只有填了雲端／HTTPS 後端才走 production；否則不要撞舊 Tunnel
      if (production) return production;
      return local;
    }
    if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
      return local;
    }
    if (production) return production;
  }
  return local;
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

/** 登入回應若帶 token（Pages 跨站），存起來之後用 Bearer */
function rememberSessionFrom(data) {
  if (data?.token) setStoredToken(data.token);
  return data;
}

async function authFetch(path, options = {}) {
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
    let message = data.error || data.message;
    if (!message) {
      if (res.status === 404) {
        message = 'Auth API 找不到此功能，請重新啟動本機 npm run auth';
      } else {
        message = `連線失敗（HTTP ${res.status}）`;
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
  'Auth／Tunnel 啟動後，請強制重新整理本頁（Mac：Cmd+Shift+R）。若 Tunnel 網址變了，還要更新 productionUrl 並重新部署 Pages。';

export const CODE_SENT_HINT =
  '驗證碼已寄至你的 Email 信箱，請查收（若沒看到請看垃圾郵件）。10 分鐘內有效。';

export const HOST_PROJECT_DIR = '/Users/kaine/Desktop/Projects/WikiNB_for_KCIS';

function hostCommands() {
  const q = `"${HOST_PROJECT_DIR}"`;
  return {
    localLogin: 'http://127.0.0.1:4322/WikiNB-KCIS/login',
    auth: `cd ${q} && npm run auth`,
    tunnel: `cloudflared tunnel --url http://127.0.0.1:8790`,
    oneCommand: `cd ${q} && ./host/one-command-mac.sh`,
    dev: `cd ${q} && npm run dev`,
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
  const cmds = hostCommands();
  const production = String(readAuthConfig().productionUrl || '').trim();

  const blocked = getAuthMixedContentBlock();
  if (blocked) {
    return {
      ...blocked,
      title: '線上站尚無雲端後端',
      hint: 'GitHub Pages 無法直連本機。請啟動 Auth + Cloudflare Tunnel，或暫時用本機登入頁。',
      commands: [
        { id: 'auth', label: '終端機 1：啟動 Auth（埠 8790）', cmd: cmds.auth },
        { id: 'tunnel', label: '終端機 2：啟動 Tunnel（讓 github.io 連得到）', cmd: cmds.tunnel },
        {
          id: 'one',
          label: '（可選）一鍵：Auth + Tunnel',
          cmd: cmds.oneCommand,
        },
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
      ...health,
    };
  } catch {
    if (onPages) {
      return {
        online: false,
        reason: production ? 'cloud-offline' : 'need-local-dev',
        title: production ? '雲端 Auth 目前離線' : '請啟動 Auth + Tunnel',
        message: production
          ? `productionUrl 連不上（目前設定：${production}）。github.io 只顯示畫面，登入要靠本機 Auth + Cloudflare Tunnel。請依下方開兩個終端機；Mac 需保持清醒。`
          : 'GitHub Pages 只有畫面。請先啟動本機 Auth，再用 Cloudflare Tunnel 公開 :8790，並把新網址寫入 productionUrl 後重新部署。',
        hint: REFRESH_AFTER_HOST_HINT,
        commands: [
          { id: 'auth', label: '終端機 1：啟動 Auth', cmd: cmds.auth },
          {
            id: 'tunnel',
            label: '終端機 2：啟動 Tunnel（固定指令）',
            cmd: cmds.tunnel,
          },
          {
            id: 'one',
            label: '（可選）一鍵腳本：Auth + Tunnel + 寫入 productionUrl',
            cmd: cmds.oneCommand,
          },
          {
            id: 'check',
            label: '除錯：確認本機 Auth 是否健康',
            cmd: 'curl -s http://127.0.0.1:8790/api/health',
          },
        ],
        authBase: getAuthBase(),
        productionUrl: production,
      };
    }

    if (onLocal) {
      return {
        online: false,
        reason: 'local-auth-offline',
        title: '本機 Auth 未連線',
        message: '請先在終端機執行 npm run auth（埠 8790），再重新整理本頁。本機開發不需要 Tunnel。',
        hint: '建議開兩個終端機：一個 Auth、一個 npm run dev。',
        commands: [
          { id: 'auth', label: '終端機 1：啟動 Auth', cmd: cmds.auth },
          { id: 'dev', label: '終端機 2：啟動網站（若還沒開）', cmd: cmds.dev },
        ],
        authBase: getAuthBase(),
      };
    }

    return {
      online: false,
      reason: 'offline',
      title: 'Auth 未連線',
      message: '請啟動本機 Auth：npm run auth',
      hint: '',
      commands: [{ id: 'auth', label: '啟動 Auth', cmd: cmds.auth }],
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

export async function fetchMe() {
  try {
    return await authFetch('/api/auth/me');
  } catch (err) {
    if (err.status === 401) return { ok: false, authenticated: false };
    throw err;
  }
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
  setStoredToken('');
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
  if (!res.body) throw new Error('瀏覽器不支援串流');

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
      return { type: 'done', ok: true, stopped: true, answer: '（已停止）' };
    }
    throw err;
  }

  if (!finalPayload) throw new Error('串流中斷');
  if (finalPayload.type === 'error' && !finalPayload.answer) {
    throw new Error(finalPayload.error || finalPayload.detail || '執行失敗');
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
  return name ? `Hello! ${name}` : '';
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

  const closeMenu = () => {
    userMenu?.classList.add('hidden');
    userLabel?.setAttribute('aria-expanded', 'false');
  };

  const openMenu = () => {
    userMenu?.classList.remove('hidden');
    userLabel?.setAttribute('aria-expanded', 'true');
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
        navRoleCta.href = navRoleCta.dataset.studentHref || navRoleCta.href;
        if (navRoleCtaLabel) {
          navRoleCtaLabel.setAttribute('data-i18n', 'nav.gemini');
          navRoleCtaLabel.textContent = t('nav.gemini');
        }
      }
    }
    if (userWrap && userLabel) {
      if (loggedIn) {
        userLabel.textContent = helloLabel(me.user);
        userLabel.title = 'Account menu';
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

  document.addEventListener('click', (e) => {
    if (!userWrap?.contains(e.target)) closeMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });

  logoutBtn?.addEventListener('click', async (e) => {
    e.preventDefault();
    closeMenu();
    await logout();
    await update();
    const base = document.documentElement.dataset.base || '/';
    window.location.href = `${base}login?logged_out=1`;
  });

  await update();
}
