import { SignJWT, jwtVerify } from 'jose';

const COOKIE_NAME = 'wikinb_kcis_session';

function secretKey() {
  const raw = process.env.SESSION_SECRET;
  if (!raw || raw.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters');
  return new TextEncoder().encode(raw);
}

export function getSessionCookieName() {
  return COOKIE_NAME;
}

export async function createSessionToken(user, { expiresIn = '7d' } = {}) {
  return new SignJWT({
    sub: user.email || `student:${user.studentAccountId || ''}`,
    email: user.email || '',
    name: user.name,
    nickname: user.nickname || '',
    department: user.department || (user.role==='student'?'學生':'教職員'),
    updatedAt:user.updatedAt||'',
    role: user.role,
    teacherId: user.teacherId || '',
    teacherIds: Array.isArray(user.teacherIds) ? user.teacherIds : [],
    authType: user.authType || 'email-otp',
    studentAccountId: user.studentAccountId || '',
    studentNumber: user.studentNumber || '',
    picture: user.picture || '',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secretKey());
}

export async function verifySessionToken(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return {
      email: String(payload.email || payload.sub || ''),
      name: String(payload.name || ''),
      nickname: String(payload.nickname || ''),
      department:String(payload.department||''),
      updatedAt:String(payload.updatedAt||''),
      role: String(payload.role || 'student'),
      teacherId: String(payload.teacherId || ''),
      teacherIds: Array.isArray(payload.teacherIds)
        ? payload.teacherIds.map((value) => String(value || '')).filter(Boolean)
        : [],
      authType: String(payload.authType || 'email-otp'),
      studentAccountId: String(payload.studentAccountId || ''),
      studentNumber: String(payload.studentNumber || ''),
      picture: String(payload.picture || ''),
    };
  } catch {
    return null;
  }
}

export function sessionCookieOptions({ maxAgeMs = 7 * 24 * 60 * 60 * 1000 } = {}) {
  // Pages（https）→ 主機 Auth（https tunnel）需 SameSite=None; Secure
  const authHttps = String(process.env.AUTH_BASE_URL || '').startsWith('https');
  const crossSite =
    String(process.env.COOKIE_SAMESITE || '').toLowerCase() === 'none' || authHttps;
  return {
    httpOnly: true,
    sameSite: crossSite ? 'none' : 'lax',
    secure: crossSite || authHttps,
    path: '/',
    maxAge: maxAgeMs,
  };
}

/** 登出時須與 setCookie 使用相同屬性，瀏覽器才會清除跨站 cookie */
export function clearSessionCookieOptions() {
  const { maxAge, ...rest } = sessionCookieOptions({ maxAgeMs: 0 });
  return rest;
}
