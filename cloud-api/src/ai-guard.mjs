// Basic protection for every KCIS AI service that uses the shared OpenAI key.
// - per person: too many tokens in one hour -> that person is paused until the next day
// - whole service: too many tokens in one hour -> the AI is paused for everyone until an admin resumes it
// - every trip sends one alert mail to the administrator (AI_ALERT_EMAIL) and shows on /admin/ai
// Thresholds are env vars so they can be tuned without code changes.

const limits = (env) => ({
  userHour: Number(env.AI_USER_HOUR_TOKENS || 120000),
  siteHour: Number(env.AI_SITE_HOUR_TOKENS || 600000),
});
const hourAgo = () => new Date(Date.now() - 3600000).toISOString();

export async function guardCheck(env, who) {
  const now = Date.now();
  const rows = (await env.DB.prepare("SELECT key,value,until FROM ai_state WHERE key='paused' OR key=?").bind("block:" + (who || "-")).all()).results || [];
  const paused = rows.find((r) => r.key === "paused");
  if (paused) return { paused: JSON.parse(paused.value || "{}") };
  const block = rows.find((r) => r.key.startsWith("block:") && r.until > now);
  if (block) return { blocked: JSON.parse(block.value || "{}") };
  return {};
}

export async function alert(env, key, subject, text) {
  // one mail per reason per hour
  const tag = "alert:" + key + ":" + new Date().toISOString().slice(0, 13);
  const fresh = await env.DB.prepare("INSERT OR IGNORE INTO ai_state(key,value,until) VALUES(?,?,?)").bind(tag, "", Date.now() + 2 * 3600000).run();
  if (!fresh.meta?.changes || !env.AI_ALERT_EMAIL) return;
  try { const { sendMail } = await import("./mail.mjs"); await sendMail(env, env.AI_ALERT_EMAIL, "[KCIS AI 警示] " + subject, text + "\n\n後台：https://kcis-school-api.chaos60649.workers.dev/admin/ai"); } catch { /* the admin page still shows it */ }
}

// After each answer: compare the last hour's tokens with the thresholds.
export async function guardAfter(env, who, service) {
  const L = limits(env), since = hourAgo();
  const site = (await env.DB.prepare("SELECT COALESCE(SUM(input+output),0) n, COUNT(*) c FROM ai_logs WHERE time>=?").bind(since).first()) || { n: 0, c: 0 };
  if (site.n > L.siteHour) {
    const info = { reason: "site_hour", tokens: site.n, requests: site.c, limit: L.siteHour, at: new Date().toISOString(), service };
    await env.DB.prepare("INSERT INTO ai_state(key,value,until) VALUES('paused',?,0) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(info)).run();
    await alert(env, "site", "全站 AI 已自動暫停", `過去一小時全站用了 ${site.n.toLocaleString()} token（${site.c} 次），超過上限 ${L.siteHour.toLocaleString()}。\nAI 功能已對所有人暫停，請到後台查看紀錄後按「恢復」。`);
    return;
  }
  if (!who) return;
  const user = (await env.DB.prepare("SELECT COALESCE(SUM(input+output),0) n, COUNT(*) c FROM ai_logs WHERE who=? AND time>=?").bind(who, since).first()) || { n: 0, c: 0 };
  if (user.n > L.userHour) {
    const info = { reason: "user_hour", tokens: user.n, requests: user.c, limit: L.userHour, at: new Date().toISOString(), service };
    await env.DB.prepare("INSERT INTO ai_state(key,value,until) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,until=excluded.until")
      .bind("block:" + who, JSON.stringify(info), Date.now() + 24 * 3600000).run();
    await alert(env, "user-" + who, "單一使用者用量異常，已暫停該使用者", `使用者 ${who}（匿名代碼）過去一小時用了 ${user.n.toLocaleString()} token（${user.c} 次），超過上限 ${L.userHour.toLocaleString()}。\n只暫停這位使用者 24 小時，其他人不受影響。`);
  }
}

/* ---------- admin page ---------- */
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function page(body) {
  return new Response(`<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>KCIS AI 用量</title>
<style>body{margin:0;min-height:100vh;font:15px/1.6 system-ui,"PingFang TC",sans-serif;color:#2e0f38;background:linear-gradient(142deg,#ffe3ee,#f1e6ff 55%,#f7f0ff)}main{width:min(100% - 2rem,64rem);margin:6vh auto;padding:1.6rem;border:1px solid #fff;border-radius:1.6rem;background:rgba(255,255,255,.62)}h1{margin:0 0 1rem;font-size:1.5rem}h2{margin:1.6rem 0 .5rem;font-size:1.1rem}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:.45rem .3rem;border-bottom:1px solid rgba(82,36,67,.12);text-align:left}td.n{text-align:right;font-variant-numeric:tabular-nums}input,button{font:inherit;min-height:2.6rem;border-radius:.8rem;border:1px solid #e7c6d6;padding:0 1rem}button{background:#ffc9dc;color:#6b1d45;font-weight:700;cursor:pointer}form{display:flex;gap:.5rem;flex-wrap:wrap}input{flex:1}.warn{padding:.8rem 1rem;border-radius:1rem;background:#ffe0ea;color:#8a1f52;font-weight:700}.ok{color:#007a80;font-weight:700}</style></head><body><main>${body}</main></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" } });
}
const login = (msg = "") => page(`<h1>KCIS AI 用量</h1>${msg ? `<p class="warn">${esc(msg)}</p>` : ""}<form method="post" action="/admin/ai"><input type="password" name="key" placeholder="後台密鑰" required autocomplete="off"><input name="trace" placeholder="追溯碼（選填）KCIS-XXXXXX" autocomplete="off"><button>查看</button></form>`);

async function same(a, b) {
  const e = new TextEncoder(), [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", e.encode(a)), crypto.subtle.digest("SHA-256", e.encode(b))]);
  const ua = new Uint8Array(x), ub = new Uint8Array(y); let d = 0; for (let i = 0; i < ua.length; i++) d |= ua[i] ^ ub[i]; return d === 0;
}

export async function adminPage(request, env) {
  if (request.method === "GET") return login();
  const form = await request.formData().catch(() => null);
  const key = String(form?.get("key") || "");
  if (!env.AI_ADMIN_KEY || !(await same(key, env.AI_ADMIN_KEY))) return login("密鑰不正確");
  const action = String(form.get("action") || ""), target = String(form.get("who") || "");
  if (action === "resume") await env.DB.prepare("DELETE FROM ai_state WHERE key='paused'").run();
  if (action === "unblock" && /^[0-9a-f]{16}$/.test(target)) await env.DB.prepare("DELETE FROM ai_state WHERE key=?").bind("block:" + target).run();
  const trace = String(form.get("trace") || "").trim().toUpperCase();
  const q = (sql, ...a) => env.DB.prepare(sql).bind(...a).all().then((r) => r.results || []);
  const since7 = new Date(Date.now() - 7 * 86400000).toISOString();
  const [state, days, hour, users, recent, found] = await Promise.all([
    q("SELECT key,value,until FROM ai_state WHERE key='paused' OR (key LIKE 'block:%' AND until>?)", Date.now()),
    q("SELECT substr(time,1,10) d, COUNT(*) c, SUM(input) i, SUM(output) o, SUM(cached) k, SUM(status<>'ok') e FROM ai_logs WHERE time>=? GROUP BY d ORDER BY d DESC", since7),
    q("SELECT COUNT(*) c, COALESCE(SUM(input+output),0) n FROM ai_logs WHERE time>=?", hourAgo()),
    q("SELECT who, role, COUNT(*) c, SUM(input+output) n FROM ai_logs WHERE time>=? AND who<>'' GROUP BY who ORDER BY n DESC LIMIT 10", since7),
    q("SELECT * FROM ai_logs ORDER BY time DESC LIMIT 30"),
    /^KCIS-[A-Z0-9]{6}$/.test(trace) ? q("SELECT * FROM ai_logs WHERE trace=?", trace) : Promise.resolve([]),
  ]);
  const L = limits(env), paused = state.find((s) => s.key === "paused"), blocks = state.filter((s) => s.key.startsWith("block:"));
  const keep = `<input type="hidden" name="key" value="${esc(key)}">`;
  const logRow = (r) => `<tr><td>${esc(r.trace)}</td><td>${esc(r.time.slice(5, 16).replace("T", " "))}</td><td>${esc(r.role)} ${esc(r.who.slice(0, 7))}</td><td>${esc(r.model)}</td><td class="n">${r.input}</td><td class="n">${r.output}</td><td class="n">${(r.ms / 1000).toFixed(1)}s</td><td>${esc(r.status)} ${esc(r.detail)}</td></tr>`;
  const logHead = "<thead><tr><th>追溯碼</th><th>時間 UTC</th><th>使用者</th><th>模型</th><th>輸入</th><th>輸出</th><th>耗時</th><th>狀態</th></tr></thead>";
  return page(`<h1>KCIS AI 用量</h1>
${paused ? `<p class="warn">AI 已暫停：${esc(JSON.parse(paused.value).reason)}，一小時 ${Number(JSON.parse(paused.value).tokens).toLocaleString()} token。</p><form method="post" action="/admin/ai">${keep}<input type="hidden" name="action" value="resume"><button>恢復 AI 功能</button></form>` : `<p class="ok">運作中。過去一小時 ${hour[0]?.c ?? 0} 次、${Number(hour[0]?.n ?? 0).toLocaleString()} token（全站上限 ${L.siteHour.toLocaleString()}，每人 ${L.userHour.toLocaleString()}）。</p>`}
${trace ? (found[0] ? `<h2>追溯碼 ${esc(trace)}</h2><table>${logHead}<tbody>${found.map(logRow).join("")}</tbody></table>` : `<p class="warn">找不到 ${esc(trace)}</p>`) : ""}
${blocks.length ? `<h2>暫停中的使用者</h2><table><tbody>${blocks.map((b) => { const v = JSON.parse(b.value); const w = b.key.slice(6); return `<tr><td>${esc(w)}</td><td>${Number(v.tokens).toLocaleString()} token / ${v.requests} 次</td><td><form method="post" action="/admin/ai">${keep}<input type="hidden" name="action" value="unblock"><input type="hidden" name="who" value="${esc(w)}"><button>解除</button></form></td></tr>`; }).join("")}</tbody></table>` : ""}
<h2>近 7 天</h2><table><thead><tr><th>日期</th><th>次數</th><th>輸入</th><th>其中快取</th><th>輸出</th><th>錯誤</th></tr></thead><tbody>${days.map((d) => `<tr><td>${d.d}</td><td class="n">${d.c}</td><td class="n">${Number(d.i).toLocaleString()}</td><td class="n">${Number(d.k).toLocaleString()}</td><td class="n">${Number(d.o).toLocaleString()}</td><td class="n">${d.e}</td></tr>`).join("")}</tbody></table>
<h2>用量最多的使用者（匿名，近 7 天）</h2><table><thead><tr><th>代碼</th><th>身分</th><th>次數</th><th>token</th></tr></thead><tbody>${users.map((u) => `<tr><td>${esc(u.who)}</td><td>${esc(u.role)}</td><td class="n">${u.c}</td><td class="n">${Number(u.n).toLocaleString()}</td></tr>`).join("")}</tbody></table>
<h2>最近 30 次</h2><table>${logHead}<tbody>${recent.map(logRow).join("")}</tbody></table>
<form method="post" action="/admin/ai" style="margin-top:1rem">${keep}<input name="trace" placeholder="查詢追溯碼 KCIS-XXXXXX"><button>查詢</button></form>`);
}
