/**
 * 暱稱規則：中文、英文字母、數字、底線 _、半形句點 .
 * 長度 2～20
 * 所有帳號暱稱不可重複（大小寫與全半形視為相同）
 */
import { normalizeEmail } from './domain.js';

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 20;
export const NICKNAME_PATTERN = /^[\p{Script=Han}A-Za-z0-9_.]+$/u;

export const NICKNAME_HINT_ZH =
  '僅允許中文、英文、數字、( _  . )；長度限制2至20個字元。';
export const NICKNAME_HINT_EN =
  'Only Chinese, English letters, digits, _ and . are allowed; length 2–20 characters.';

export const NICKNAME_TAKEN_ZH = '此暱稱已被使用，請換一個。';
export const NICKNAME_TAKEN_EN = 'This display name is already taken.';

export function normalizeNicknameKey(nickname) {
  return String(nickname || '')
    .trim()
    .normalize('NFKC')
    .toLowerCase();
}

export function validateNickname(raw) {
  const nickname = String(raw || '').trim().normalize('NFKC');
  if (!nickname) {
    return { ok: false, error: 'Please enter a display name', nickname: '' };
  }
  if (Array.from(nickname).length < NICKNAME_MIN || Array.from(nickname).length > NICKNAME_MAX) {
    return {
      ok: false,
      error: NICKNAME_HINT_EN,
      nickname,
    };
  }
  if (!NICKNAME_PATTERN.test(nickname)) {
    return {
      ok: false,
      error: NICKNAME_HINT_EN,
      nickname,
    };
  }
  return { ok: true, nickname, error: null };
}

/**
 * 所有帳號共用暱稱，修改時排除自己的信箱。
 */
export function findNicknameConflict(users, nickname, excludeEmail = '') {
  const key = normalizeNicknameKey(nickname);
  if (!key) return null;
  const self = normalizeEmail(excludeEmail);
  return (
    (users || []).find((u) => {
      if (self && normalizeEmail(u.email) === self) return false;
      return normalizeNicknameKey(u.nickname) === key;
    }) || null
  );
}

export function assertNicknameAvailable(users, nickname, excludeEmail = '') {
  const clash = findNicknameConflict(users, nickname, excludeEmail);
  if (clash) {
    throw Object.assign(new Error(NICKNAME_TAKEN_EN), { code: 'nickname_taken' });
  }
}
