/**
 * 登入允許網域／例外信箱
 * - 預設：@kcis.com.tw、@kcis.ntpc.edu.tw
 * - 例外：EXTRA_ALLOWED_EMAILS（例如 chaos60649@gmail.com）
 */
export function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

/** 主要網域（相容舊設定） */
export function getAllowedDomain() {
  return getAllowedDomains()[0] || 'kcis.com.tw';
}

/** 逗號分隔多網域：ALLOWED_EMAIL_DOMAINS 優先，否則 ALLOWED_EMAIL_DOMAIN */
export function getAllowedDomains() {
  const multi = String(process.env.ALLOWED_EMAIL_DOMAINS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
  if (multi.length) return multi;
  const single = String(process.env.ALLOWED_EMAIL_DOMAIN || 'kcis.com.tw,kcis.ntpc.edu.tw')
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
  return single.length ? single : ['kcis.com.tw', 'kcis.ntpc.edu.tw'];
}

/** 逗號分隔的額外允許信箱（測試用 Gmail 等） */
export function getExtraAllowedEmails() {
  return String(process.env.EXTRA_ALLOWED_EMAILS ?? 'chaos60649@gmail.com,st101031616@gmail.com')
    .split(',')
    .map((s) => normalizeEmail(s))
    .filter(Boolean);
}

/** 明確視為老師／管理員的例外信箱（未寫進 roster 時） */
export function getExtraTeacherEmails() {
  return String(
    process.env.EXTRA_TEACHER_EMAILS || '',
  )
    .split(',')
    .map((s) => normalizeEmail(s))
    .filter(Boolean);
}

export function isAllowedSchoolEmail(email) {
  const normalized = normalizeEmail(email);
  if (!/^[^@\s]+@[^@\s]+$/.test(normalized)) return false;
  return getAllowedDomains().some((domain) => normalized.endsWith(`@${domain}`));
}

export function isExtraAllowedEmail(email) {
  return getExtraAllowedEmails().includes(normalizeEmail(email));
}

/** 是否允許登入（學校網域或例外清單） */
export function isAllowedLoginEmail(email) {
  return isAllowedSchoolEmail(email) || isExtraAllowedEmail(email);
}

export function rejectReasonForEmail(email) {
  const domains = getAllowedDomains().map((d) => `@${d}`).join(' / ');
  if (!email) return `Please use ${domains} or an approved test email`;
  if (!isAllowedLoginEmail(email)) {
    return `Only ${domains} and approved test emails may sign in.`;
  }
  return null;
}
