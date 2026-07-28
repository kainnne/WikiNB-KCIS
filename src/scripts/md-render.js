/**
 * Client-side Markdown → HTML（GFM + KaTeX）
 * 特別處理 Gemini 常見輸出：bmatrix 用 `\ ` 當換列、$$ 多行矩陣等
 */
import { marked } from 'marked';
import katex from 'katex';

marked.setOptions({ breaks: true, gfm: true });

const KATEX_OPTS = {
  throwOnError: false,
  strict: 'ignore',
};

/** Gemini 常在矩陣裡寫 `2 \ 3` 而非 `2 \\ 3` */
function fixMatrixRowBreaks(tex) {
  return String(tex).replace(
    /\\begin\{([bpvBPV]?matrix)\}([\s\S]*?)\\end\{\1matrix\}/g,
    (_m, kind, body) => {
      // 單獨的 `\ ` / `\`+空白 → 換列；保留 \alpha、\times、\cdot 等指令
      const fixed = String(body).replace(/\\(?![a-zA-Z\\])/g, '\\\\');
      return `\\begin{${kind}matrix}${fixed}\\end{${kind}matrix}`;
    },
  );
}

function normalizeLatex(tex) {
  let s = fixMatrixRowBreaks(String(tex || '').trim());
  // 偶發：全形＄、或多餘空白
  s = s.replace(/\uFF04/g, '$');
  return s;
}

function renderKatex(tex, displayMode) {
  try {
    return katex.renderToString(normalizeLatex(tex), {
      ...KATEX_OPTS,
      displayMode: Boolean(displayMode),
    });
  } catch {
    const escaped = String(tex)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return displayMode
      ? `<pre class="katex-error">${escaped}</pre>`
      : `<code class="katex-error">${escaped}</code>`;
  }
}

/**
 * 先抽出程式碼區塊，再處理數學，避免 $ 在 code 內被誤傷
 */
function renderMathInMarkdown(md) {
  const segments = String(md || '').split(/(```[\s\S]*?```|`[^`\n]+`)/g);
  return segments
    .map((segment, index) => {
      if (index % 2 === 1) return segment;
      let text = segment;

      // \[ ... \] display
      text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_m, tex) => renderKatex(tex, true));
      // $$ ... $$ display（允許內部換行）
      text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex) => renderKatex(tex, true));
      // \( ... \) inline
      text = text.replace(/\\\(([\s\S]+?)\\\)/g, (_m, tex) => renderKatex(tex, false));
      // $ ... $ inline：允許矩陣環境跨「視覺上一行」；避免匹配空或純空白
      text = text.replace(/\$((?:\\\$|[^$])+?)\$/g, (_m, tex) => {
        if (!String(tex).trim()) return _m;
        // 避免 $$ 殘片
        if (tex.startsWith('$') || tex.endsWith('$')) return _m;
        return renderKatex(tex, false);
      });

      return text;
    })
    .join('');
}

function linkifyWikiLinks(html, base) {
  const b = base.endsWith('/') ? base : `${base}/`;
  return html.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, rawSlug, label) => {
    const full = String(rawSlug || '')
      .trim()
      .replace(/\.md$/i, '');
    const parts = full.split('/').filter(Boolean);
    let href = `${b}wiki/${full}`;
    if (parts[0] === 'teachers' && parts.length >= 4) {
      const teacherId = parts[1];
      const subjectId = parts[2];
      const slug = parts.slice(3).join('/');
      href = `${b}note?teacherId=${encodeURIComponent(teacherId)}&subjectId=${encodeURIComponent(subjectId)}&slug=${encodeURIComponent(slug)}`;
    } else if (parts.length === 1) {
      href = `${b}wiki/${full}`;
    }
    const text = (label || parts[parts.length - 1] || full).replace(/-/g, ' ');
    return `<a href="${href}" class="wiki-link">${text.trim()}</a>`;
  });
}

/**
 * @param {string} markdown
 * @param {{ base?: string, linkifyWiki?: boolean }} [opts]
 */
export function markdownToHtml(markdown, { base = '/WikiNB-KCIS/', linkifyWiki = true } = {}) {
  const body = String(markdown || '');
  const stripped = body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const withMath = renderMathInMarkdown(stripped);
  let html = String(marked.parse(withMath, { async: false }));
  if (linkifyWiki) html = linkifyWikiLinks(html, base);
  return html;
}

export function notePageHref({ teacherId, subjectId, slug, base }) {
  const b =
    base ||
    (typeof document !== 'undefined' ? document.documentElement.dataset.base : null) ||
    '/WikiNB-KCIS/';
  const root = b.endsWith('/') ? b : `${b}/`;
  const qs = new URLSearchParams({
    teacherId: String(teacherId || ''),
    subjectId: String(subjectId || ''),
    slug: String(slug || ''),
  });
  return `${root}note?${qs.toString()}`;
}

/** 登入頁＋可選 next（同源相對路徑） */
export function loginHrefWithNext(nextPath, base) {
  const b =
    base ||
    (typeof document !== 'undefined' ? document.documentElement.dataset.base : null) ||
    '/WikiNB-KCIS/';
  const root = b.endsWith('/') ? b : `${b}/`;
  if (!nextPath) return `${root}login`;
  const qs = new URLSearchParams({ next: nextPath });
  return `${root}login?${qs.toString()}`;
}
