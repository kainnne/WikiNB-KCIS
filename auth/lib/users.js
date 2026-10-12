import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { normalizeEmail } from './domain.js';
import { effectiveRosterEntry, isTeacherRole, accountKeywords } from './account.js';
import { validateNickname } from './nickname.js';
import { assertStoredNicknameAvailable, usersStorePath } from './nickname-store.js';

function ensureStore() {
  fs.mkdirSync(path.dirname(usersStorePath()), { recursive: true });
  if (!fs.existsSync(usersStorePath())) {
    fs.writeFileSync(usersStorePath(), JSON.stringify({ users: [] }, null, 2), 'utf8');
  }
}

function readStore() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(usersStorePath(), 'utf8'));
  } catch {
    return { users: [] };
  }
}

function writeStore(store) {
  ensureStore();
  fs.writeFileSync(usersStorePath(), JSON.stringify(store, null, 2), 'utf8');
}

export function findUserByEmail(email) {
  const key = normalizeEmail(email);
  return readStore().users.find((u) => normalizeEmail(u.email) === key) || null;
}

export function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return { ...rest, keywords: accountKeywords(user) };
}

/** 從 roster／網域規則建立／更新使用者殼 */
function defaultNickname(email) {
  const base = email.split('@')[0];
  for (let suffix = 1; suffix < 10000; suffix++) {
    const candidate = suffix === 1 ? base : `${base}_${suffix}`;
    try { assertStoredNicknameAvailable(candidate, { email }); return candidate; }
    catch (error) { if (error.code !== 'nickname_taken') throw error; }
  }
  throw new Error('Could not assign a display name. Please contact the administrator.');
}

export function ensureUserFromRoster(rosterEntry) {
  const effective = effectiveRosterEntry(rosterEntry, rosterEntry.email) || rosterEntry;
  const store = readStore();
  const key = normalizeEmail(effective.email);
  const now = new Date().toISOString();
  let user = store.users.find((u) => normalizeEmail(u.email) === key);

  if (!user) {
    user = {
      email: key,
      name: effective.name || key,
      nickname: defaultNickname(key),
      nicknameCustomized: false,
      role: effective.role || 'student',
      teacherId: effective.teacherId || '',
      passwordHash: '',
      passwordSetAt: null,
      verifiedAt: null,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
    };
    store.users.push(user);
  } else {
    user.name = effective.name || user.name;
    if (!user.nickname) { user.nickname = defaultNickname(key); user.nicknameCustomized = false; }
    // 角色以 roster／規則為準（管理員改 student→teacher 會反映進來）
    user.role = effective.role || user.role;
    if (effective.teacherId) user.teacherId = effective.teacherId;
    else if (!isTeacherRole(user.role)) user.teacherId = '';
    user.updatedAt = now;
  }

  writeStore(store);
  return { ...user };
}

export async function setPassword(email, password, { nickname } = {}) {
  const store = readStore();
  const key = normalizeEmail(email);
  const user = store.users.find((u) => normalizeEmail(u.email) === key);
  if (!user) throw new Error('找不到使用者');

  if (nickname !== undefined) {
    const checked = validateNickname(nickname);
    if (!checked.ok) throw new Error(checked.error);
    if (!user.nickname) {
      assertStoredNicknameAvailable(checked.nickname, { email: key });
      user.nickname = checked.nickname;
    }
  }

  const firstTime = !user.nickname && !user.verifiedAt;
  if (firstTime && !user.nickname) {
    throw new Error('首次設定請填寫暱稱（顯示名稱）');
  }

  const hash = await bcrypt.hash(String(password), 10);
  const latest = readStore();
  const current = latest.users.find(u => normalizeEmail(u.email) === key);
  if (!current) throw new Error('Account not found');
  if (!current.nickname) {
    assertStoredNicknameAvailable(user.nickname, { email: key });
    current.nickname = user.nickname;
  }
  current.passwordHash = hash;
  current.passwordSetAt = new Date().toISOString();
  current.verifiedAt = current.verifiedAt || current.passwordSetAt;
  current.updatedAt = current.passwordSetAt;
  writeStore(latest);
  return publicUser(current);
}

/** 驗證碼登入完成：寫入暱稱（首次）並標記已驗證 */
export function completeOtpLogin(email) {
  const store = readStore();
  const key = normalizeEmail(email);
  const user = store.users.find((u) => normalizeEmail(u.email) === key);
  if (!user) throw new Error('找不到使用者');

  const now = new Date().toISOString();
  if (!user.nickname) {
    user.nickname = defaultNickname(key);
    user.nicknameCustomized = false;
  }

  user.verifiedAt = user.verifiedAt || now;
  user.lastLoginAt = now;
  user.updatedAt = now;
  writeStore(store);
  return publicUser(user);
}

export function updateNickname(email, nickname) {
  const checked = validateNickname(nickname);
  if (!checked.ok) throw new Error(checked.error);

  const store = readStore();
  const key = normalizeEmail(email);
  const user = store.users.find((u) => normalizeEmail(u.email) === key);
  if (!user) throw new Error('找不到使用者');

  assertStoredNicknameAvailable(checked.nickname, { email: key });

  user.nickname = checked.nickname;
  user.nicknameCustomized = true;
  user.updatedAt = new Date().toISOString();
  writeStore(store);
  return publicUser(user);
}

export async function verifyPassword(email, password) {
  const user = findUserByEmail(email);
  if (!user?.passwordHash) return null;
  const ok = await bcrypt.compare(String(password || ''), user.passwordHash);
  if (!ok) return null;
  const store = readStore();
  const key = normalizeEmail(email);
  const row = store.users.find((u) => normalizeEmail(u.email) === key);
  if (row) {
    row.lastLoginAt = new Date().toISOString();
    writeStore(store);
  }
  return publicUser(row || user);
}

export function hasPassword(email) {
  const user = findUserByEmail(email);
  return Boolean(user?.passwordHash);
}

/** 帳號就緒：已有暱稱（驗證碼登入為主；舊密碼帳號亦相容） */
export function isAccountReady(email) {
  const user = findUserByEmail(email);
  if (!user) return false;
  if (!String(user.nickname || '').trim()) return false;
  return Boolean(user.verifiedAt || user.passwordHash);
}

export function needsNicknameSetup(_email) {
  return false; // Display names are assigned from the verified email, never requested at sign-in.
}

export function listUsers() {
  return readStore().users.map(publicUser);
}

export function getUsersFilePath() {
  ensureStore();
  return usersStorePath();
}
