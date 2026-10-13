import { Buffer } from "node:buffer";
const utf8 = new TextEncoder();
export const canonical = (value) =>
  String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase();
export function allowedEmail(email, env) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254)
    return false;
  return (
    (env.ALLOWED_EMAIL_DOMAINS || "kcis.com.tw,kcis.ntpc.edu.tw")
      .split(",")
      .includes(email.split("@")[1]) ||
    (env.EXTRA_ALLOWED_EMAILS ?? "chaos60649@gmail.com,st101031616@gmail.com")
      .split(",")
      .includes(email)
  );
}
export function roleFor(email) {
  return email === "kainnne@kcis.com.tw"
    ? "admin"
    : email === "st101031616@gmail.com" ||
        /^[sj]\d{5}(?!\d)/.test(email.split("@")[0])
      ? "student"
      : "teacher";
}
export function checkProfile(nickname, department) {
  const name = String(nickname || "")
      .normalize("NFKC")
      .trim(),
    dept = String(department || "").trim();
  if (
    name.length < 2 ||
    name.length > 20 ||
    !/^[\p{Script=Han}A-Za-z0-9_.]+$/u.test(name)
  )
    throw Object.assign(
      Error(
        "Use 2–20 Chinese characters, letters, numbers, underscores or periods.",
      ),
      { status: 400 },
    );
  if (!dept || dept.length > 40 || /[\r\n\x00-\x1f]/.test(dept))
    throw Object.assign(Error("Enter a department of up to 40 characters."), {
      status: 400,
    });
  return { nickname: name, department: dept };
}
export async function hash(value) {
  return Buffer.from(
    await crypto.subtle.digest("SHA-256", utf8.encode(value)),
  ).toString("hex");
}
async function hmac(secret, usage) {
  if (!secret || secret.length < 32)
    throw Object.assign(Error("Sign-in service is not configured."), {
      status: 503,
    });
  return crypto.subtle.importKey(
    "raw",
    utf8.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}
export async function signToken(payload, secret, ttl = 900) {
  const now = Math.floor(Date.now() / 1000),
    head = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ),
    body = Buffer.from(
      JSON.stringify({ ...payload, iat: now, exp: now + ttl }),
    ).toString("base64url"),
    signature = await crypto.subtle.sign(
      "HMAC",
      await hmac(secret, "sign"),
      utf8.encode(head + "." + body),
    );
  return head + "." + body + "." + Buffer.from(signature).toString("base64url");
}
export async function verifyToken(token, secret) {
  try {
    if (!token || token.length > 8192) return null;
    const [head, body, sig, ...extra] = token.split(".");
    if (
      extra.length ||
      !sig ||
      JSON.parse(Buffer.from(head, "base64url")).alg !== "HS256"
    )
      return null;
    if (
      !(await crypto.subtle.verify(
        "HMAC",
        await hmac(secret, "verify"),
        Buffer.from(sig, "base64url"),
        utf8.encode(head + "." + body),
      ))
    )
      return null;
    const user = JSON.parse(Buffer.from(body, "base64url"));
    if (
      !Number.isInteger(user.exp) ||
      user.exp <= Date.now() / 1000 ||
      (user.nbf && user.nbf > Date.now() / 1000) ||
      user.authType !== "email-otp"
    )
      return null;
    return user;
  } catch {
    return null;
  }
}
export function publicUser(user) {
  const { passwordHash, passwordSetAt, ...safe } = user;
  return {
    ...safe,
    name: user.nickname || user.name,
    authType: "email-otp",
    keywords: [user.nickname, user.department],
  };
}
export function publicDocument(row) {
  const {
    ownerEmail,
    ownerSubject,
    accountKeywords,
    profileUpdatedAt,
    ...safe
  } = JSON.parse(row.metadata);
  return safe;
}
