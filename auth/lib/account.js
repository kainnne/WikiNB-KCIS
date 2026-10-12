/**
 * 帳號角色推斷（2026-07-22 新規）：
 * - 名單明確 admin／teacher／student → 照名單
 * - EXTRA_TEACHER_EMAILS（如 chaos60649）→ teacher（若未標 admin）
 * - 學校信箱 s/j + 恰好五碼數字前綴 → student，其餘 → teacher（可事後在 roster 改成 teacher）
 * - teacherId 永遠來自信箱 local-part（改暱稱不改資料夾）
 */
import {
  getExtraTeacherEmails,
  isAllowedSchoolEmail,
  normalizeEmail,
} from './domain.js';

export function slugifyTeacherId(email) {
  const local = normalizeEmail(email).split('@')[0] || 'teacher';
  return (
    local
      .replace(/[^a-z0-9_-]/gi, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'teacher'
  );
}

/** 依名單與例外規則決定有效角色 */
export function resolveAccountRole(rosterEntry, email) {
  const key = normalizeEmail(email);
  const explicit = rosterEntry?.role;
  if (key === 'kainnne@kcis.com.tw') return 'admin';
  if (key === 'chaos60649@gmail.com') return 'teacher';
  if (key === 'st101031616@gmail.com') return 'student';
  if (explicit === 'admin') return 'teacher';
  if (explicit === 'teacher') return 'teacher';
  if (explicit === 'student') return 'student';
  if (getExtraTeacherEmails().includes(key)) return 'teacher';
  if (isAllowedSchoolEmail(key)) return /^[sj]\d{5}(?!\d)/i.test(key.split('@')[0]) ? 'student' : 'teacher';
  return explicit || 'student';
}

export function resolveTeacherId(rosterEntry, email, role) {
  if (rosterEntry?.teacherId) return rosterEntry.teacherId;
  if (role === 'teacher' || role === 'admin') {
    return slugifyTeacherId(email);
  }
  return '';
}

/**
 * 合併名單與網域規則。
 * rawRoster 可為 null：允許的網域／例外信箱仍可開通為學生（或例外老師）。
 */
export function effectiveRosterEntry(rawRoster, email) {
  const key = normalizeEmail(email);
  if (!key) return null;
  const role = resolveAccountRole(rawRoster, key);
  const teacherId = resolveTeacherId(rawRoster, key, role);
  return {
    email: key,
    name: rawRoster?.name || key.split('@')[0] || key,
    nickname: rawRoster?.nickname || '',
    note: rawRoster?.note || '',
    ...rawRoster,
    email: key,
    role,
    teacherId,
  };
}

export function requiresNicknameOnSetup(_role, purpose = 'setup') {
  return false; // Email OTP sign-in assigns a default display name.
}

export function isTeacherRole(role) {
  return role === 'teacher' || role === 'admin';
}

export function accountKeywords(user) {
  const nickname = String(user?.nickname || user?.name || '').trim();
  return [nickname, user?.role === 'student' ? '學生' : '教職員'].filter(Boolean);
}
