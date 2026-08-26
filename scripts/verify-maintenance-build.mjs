import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import maintenance from '../config/maintenance.json' with { type: 'json' };

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

async function collectHtml(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await collectHtml(path));
    else if (entry.name.endsWith('.html')) paths.push(path);
  }
  return paths;
}

const htmlFiles = await collectHtml(fileURLToPath(new URL('../dist', import.meta.url)));
assert.ok(htmlFiles.length > 0, '找不到建置後的 HTML');

if (!maintenance.enabled) {
  console.log(`Maintenance mode disabled: ${htmlFiles.length} HTML file(s) left unchanged.`);
  process.exit(0);
}

const maintenanceHtml = `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <meta name="theme-color" content="#f7f9ff">
    <meta property="og:title" content="${escapeHtml(maintenance.title)}">
    <meta property="og:description" content="${escapeHtml(maintenance.message)}">
    <meta property="og:type" content="website">
    <meta property="og:image" content="https://kainnne.com/brand/kainnne-mark.png">
    <meta property="og:image:width" content="1254">
    <meta property="og:image:height" content="1254">
    <meta property="og:image:alt" content="Kainnne flowing ribbon K brand mark">
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="${escapeHtml(maintenance.title)}">
    <meta name="twitter:description" content="${escapeHtml(maintenance.message)}">
    <meta name="twitter:image" content="https://kainnne.com/brand/kainnne-mark.png">
    <link rel="icon" type="image/png" href="https://kainnne.com/brand/kainnne-mark.png">
    <link rel="apple-touch-icon" href="https://kainnne.com/brand/kainnne-mark.png">
    <title>${escapeHtml(maintenance.title)}</title>
    <style>
      :root{color-scheme:light;font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif}
      *{box-sizing:border-box}
      body{margin:0;min-height:100vh;min-height:100svh;display:grid;place-items:center;padding:24px;color:#20365d;background:radial-gradient(circle at 15% 18%,#dfe9ff 0,transparent 34%),radial-gradient(circle at 86% 14%,#eadfff 0,transparent 36%),radial-gradient(circle at 72% 86%,#e1f4ff 0,transparent 32%),#f7f9ff}
      main{width:min(100%,640px);padding:clamp(32px,7vw,64px);text-align:center;border:1px solid rgba(255,255,255,.94);border-radius:32px;background:rgba(255,255,255,.82);box-shadow:0 24px 70px rgba(54,77,126,.14)}
      .mark{display:grid;place-items:center;width:64px;height:64px;margin:0 auto 24px;border-radius:22px;color:#fff;font-size:26px;font-weight:800;background:linear-gradient(135deg,#4f7ec8,#8f6bb8);box-shadow:0 14px 32px rgba(85,96,174,.28)}
      .status{margin:0 0 12px;color:#6b6f91;font-size:13px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}
      h1{margin:0;color:#1b4f9c;font-size:clamp(30px,7vw,48px);line-height:1.18;letter-spacing:-.035em}
      .message{margin:18px auto 0;max-width:440px;color:#52627d;font-size:clamp(16px,3vw,19px);line-height:1.8}
      .message span{display:block;margin-top:7px;color:#7b8498;font-size:13px}
      a{display:inline-flex;align-items:center;justify-content:center;margin-top:30px;padding:12px 20px;border-radius:999px;color:#fff;font-weight:800;text-decoration:none;background:linear-gradient(115deg,#3769b5,#7d59a8);box-shadow:0 10px 24px rgba(71,84,155,.22)}
      a:focus-visible{outline:3px solid rgba(79,126,200,.35);outline-offset:4px}
    </style>
  </head>
  <body data-maintenance-mode="active">
    <main role="status" aria-live="polite">
      <div class="mark" aria-hidden="true">W</div>
      <p class="status">KCIS · WikiNB</p>
      <h1>${escapeHtml(maintenance.title)}</h1>
      <p class="message">${escapeHtml(maintenance.message)}<span lang="en">${escapeHtml(maintenance.secondaryMessage)}</span></p>
      <a href="${escapeHtml(maintenance.homeUrl)}">返回 KCIS 首頁</a>
    </main>
  </body>
</html>`;

await Promise.all(htmlFiles.map((htmlFile) => writeFile(htmlFile, maintenanceHtml)));

for (const htmlFile of htmlFiles) {
  const html = await readFile(htmlFile, 'utf8');
  assert.match(html, /data-maintenance-mode="active"/);
  assert.match(html, /WikiNB 功能暫停中/);
  assert.match(html, /https:\/\/kainnne\.com\/brand\/kainnne-mark\.png/);
  assert.doesNotMatch(html, /id="auth-config"|cdn\.jsdelivr\.net|<_?script/i);
}

console.log(`Maintenance build verified: ${htmlFiles.length} HTML file(s).`);
