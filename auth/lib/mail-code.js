import crypto from 'node:crypto';
import dns from 'node:dns';
import nodemailer from 'nodemailer';

// 熱點／部分網路 IPv6 不通時，Node 預設 dual-stack 會讓 smtp.gmail.com 連線失敗。
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  /* Node < 17 */
}

const pending = new Map(); // email -> { code, expiresAt, purpose }
const CODE_TTL_MS = 10 * 60 * 1000;

function createSmtpTransport(timeouts = {}) {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    requireTLS: Number(process.env.SMTP_PORT || 587) !== 465,
    family: 4,
    connectionTimeout: timeouts.connectionTimeout ?? 12000,
    greetingTimeout: timeouts.greetingTimeout ?? 12000,
    socketTimeout: timeouts.socketTimeout ?? 20000,
    auth: {
      user: process.env.SMTP_USER?.trim(),
      pass: smtpPass(),
    },
    tls: {
      servername: process.env.SMTP_HOST || 'smtp.gmail.com',
    },
  });
}

export function createLoginCode(email, purpose = 'setup') {
  for(const [key,row] of pending)if(row.expiresAt<Date.now())pending.delete(key);
  const code = String(crypto.randomInt(100000, 1000000));
  const key = String(email).trim().toLowerCase();
  pending.set(key, { code, purpose, failures:0, expiresAt: Date.now() + CODE_TTL_MS });
  return { code, expiresIn: CODE_TTL_MS / 1000 };
}

function readPendingCode(email, code, purpose) {
  const key = String(email).trim().toLowerCase();
  const row = pending.get(key);
  if (!row || row.expiresAt < Date.now()) {
    pending.delete(key);
    return { ok: false, error: '驗證碼已過期，請重新寄送' };
  }
  if (purpose && row.purpose !== purpose) {
    return { ok: false, error: '驗證碼用途不符，請重新寄送' };
  }
  if(row.failures>=5)return {ok:false,error:'嘗試次數過多，請重新寄送驗證碼'};
  if (String(code).trim() !== row.code) {
    row.failures+=1;
    return { ok: false, error: '驗證碼錯誤' };
  }
  return { ok: true, purpose: row.purpose, key };
}

export function checkLoginCode(email, code, purpose) {
  const result = readPendingCode(email, code, purpose);
  if (!result.ok) return result;
  return { ok: true, purpose: result.purpose };
}

export function verifyLoginCode(email, code, purpose) {
  const result = readPendingCode(email, code, purpose);
  if (!result.ok) return result;
  pending.delete(result.key);
  return { ok: true, purpose: result.purpose };
}

function smtpPass() {
  return String(process.env.SMTP_PASS || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\s/g, '');
}

function smtpConfigured() {
  return Boolean(process.env.SMTP_USER?.trim() && smtpPass());
}

function allowDevLog() {
  return process.env.NODE_ENV !== 'production' && process.env.DEV_LOG_CODE === 'true';
}

function logCodeToTerminal(email, code, tag = 'DEV') {
  console.log(`\n📧 [${tag}] 驗證碼:`, code);
  console.log('   收件:', email, '\n');
}

function smtpFailureMessage(err) {
  const detail = err?.response || err?.message || String(err);
  console.error('sendCodeEmail SMTP error:', detail);
  if (/535|534|invalid login|authentication failed/i.test(String(detail))) {
    return '寄信失敗：SMTP 登入憑證不正確或已失效。請更新後台寄信設定。';
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(String(detail))) {
    return '寄信失敗：無法解析寄信伺服器。';
  }
  if (/ETIMEDOUT|ECONNREFUSED|ESOCKET|timeout/i.test(String(detail))) {
    return '寄信失敗：無法連接寄信伺服器。';
  }
  return '寄信失敗。請確認後台 SMTP 設定。';
}

/**
 * SMTP_FROM 是寄件地址，SMTP_USER／PASS 是登入憑證；交接時由接手者重新設定。
 * DEV_LOG_CODE=true：同時把碼印在終端機；SMTP 失敗時才退回「只看終端機」。
 */
export async function sendCodeEmail(email, code) {
  const subject = `康橋 AI Tools 驗證碼：${code}`;
  const text = [
    '康橋 AI Tools 登入驗證',
    '',
    `你的驗證碼是：${code}`,
    '',
    '10 分鐘內有效。若不是你本人操作，請忽略此信。',

  ].join('\n');

  if (allowDevLog()) {
    logCodeToTerminal(email, code, smtpConfigured() ? 'DEV+SMTP' : 'DEV');
  }

  if (!smtpConfigured()) {
    if (allowDevLog()) {
      return {
        dev: true,
        fallback: true,
        message: '未設定 SMTP。驗證碼已顯示於 Auth 終端機（請看 npm run auth 視窗）。',
      };
    }
    throw new Error(
      '尚未設定 SMTP。請在後台設定 SMTP 帳號與應用程式密碼。',
    );
  }

  const transporter = createSmtpTransport({
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 30000,
  });

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: email,
      subject,
      text,
    });
    console.log('📧 SMTP 寄信成功 →', email);
    return {
      dev: false,
      message: `驗證碼已寄至 ${email}。`,
    };
  } catch (err) {
    const message = smtpFailureMessage(err);
    if (allowDevLog()) {
      logCodeToTerminal(email, code, 'FALLBACK');
      return {
        dev: true,
        fallback: true,
        message: `${message} 本機後備：驗證碼已顯示於 Auth 終端機。`,
      };
    }
    throw new Error(message);
  }
}
