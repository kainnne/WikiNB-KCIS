import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { signToken } from "../src/security.mjs";

// worker.mjs pulls in mail.mjs, which imports cloudflare:sockets; stub it so the module loads under Node.
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) {
  if (s === "cloudflare:sockets") return { url: "data:text/javascript,export const connect = () => { throw new Error('no sockets in tests'); };", shortCircuit: true };
  return n(s, c);
}`));
const { authenticated } = await import("../src/worker.mjs");

// Phones (Safari) block the API's cross-site cookie, so the page sends a Bearer token. A stale cookie left in the
// browser must not override a fresh token, and a stale stored token must not override a valid cookie.
const SECRET = "test-only-session-secret-that-is-long-enough-0123456789";
const env = (liveSids) => ({
  SESSION_SECRET: SECRET,
  ALLOWED_EMAIL_DOMAINS: "kcis.com.tw",
  DB: { prepare(sql) { return { bind(...v) { this.v = v; return this; }, async first() {
    if (sql.includes("FROM sessions")) return liveSids.includes(this.v[0]) ? { email: "teacher@kcis.com.tw" } : null;
    if (sql.includes("FROM users")) return { data: JSON.stringify({ email: "teacher@kcis.com.tw", verifiedAt: "2026-11-01" }) };
    return null;
  } }; } },
});
const token = (sid) => signToken({ email: "teacher@kcis.com.tw", sub: "teacher@kcis.com.tw", authType: "email-otp", sid }, SECRET, 7 * 86400);
const request = (headers) => new Request("https://api.example/api/auth/shared-session", { headers });

test("a fresh bearer token wins over a stale cookie", async () => {
  const fresh = await token("new"), stale = await token("old");
  const result = await authenticated(request({ Authorization: "Bearer " + fresh, Cookie: "wikinb_kcis_session=" + stale }), env(["new"]));
  assert.equal(result.sid, "new");
});

test("a valid cookie still works when the stored bearer token is stale", async () => {
  const stale = await token("old"), fresh = await token("new");
  const result = await authenticated(request({ Authorization: "Bearer " + stale, Cookie: "wikinb_kcis_session=" + fresh }), env(["new"]));
  assert.equal(result.sid, "new");
});

test("garbage in both places is rejected", async () => {
  await assert.rejects(authenticated(request({ Authorization: "Bearer x.y.z", Cookie: "wikinb_kcis_session=a.b.c" }), env(["new"])));
});
