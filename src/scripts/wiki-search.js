/**
 * Client-side wiki search for KCIS.
 * 未登入：只顯示預覽字卡；點擊／展開 → 登入。
 * 已登入提示（local token）：連到 /note（真正權限由 note 頁 requireLogin 把關）。
 * 一律不連舊的 /wiki/ 全文頁。
 */
import { t, getLocale } from './i18n.js';
import { gatedNoteHref, notePageHref } from './md-render.js';
import { hasSessionHint } from './auth-client.js';

export function createWikiSearch(initialIndex, options = {}) {
  let searchIndex = Array.isArray(initialIndex) ? initialIndex : [];
  /** 與 hasSessionHint 對齊；僅影響連結目標，不代表伺服器已驗證 */
  let authed = options.authed != null ? Boolean(options.authed) : hasSessionHint();

  const escapeHtml = (text) =>
    String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const matchesQuery = (page, query) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const haystack = [
      page.slug,
      page.title,
      page.description,
      page.teacher,
      page.subject,
      page.subjectEn,
      (page.keywords || []).join(' '),
      (page.keywordsEn || []).join(' '),
      (page.tags || []).join(' '),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  };

  const filterPages = (query) => {
    const q = query.trim();
    if (!q) return searchIndex;
    return searchIndex.filter((page) => matchesQuery(page, q));
  };

  const setIndex = (next) => {
    searchIndex = Array.isArray(next) ? next : [];
  };

  const setAuthed = (value) => {
    authed = Boolean(value);
  };

  const getBase = () => document.documentElement.dataset.base || '/';

  /** 唯一筆記目標：/note?... */
  const noteHrefFor = (page) => {
    const base = getBase();
    if (page.href && String(page.href).includes('/note?')) return page.href;
    const noteSlug =
      page.noteSlug ||
      String(page.slug || '')
        .split('/')
        .pop();
    return notePageHref({
      teacherId: page.teacherId || '',
      subjectId: page.subjectId || '',
      slug: noteSlug,
      base,
    });
  };

  const pageHref = (page) => {
    const note = noteHrefFor(page);
    // 有 token 提示或伺服器已確認登入 → note；否則 login?next=
    if (hasSessionHint() || authed) return note;
    return gatedNoteHref(note, getBase());
  };

  const subjectLabel = (page) =>
    getLocale() === 'en' ? page.subjectEn || page.subject : page.subject;

  const renderItem = (page) => {
    const subject = subjectLabel(page);
    const href = pageHref(page);
    const canExpand = hasSessionHint() || authed;
    const keywordsHtml = [
      page.teacher ? `<span class="tag-keyword">${escapeHtml(page.teacher)}</span>` : '',
      subject
        ? `<span class="tag-keyword" data-locale-text data-zh="${escapeHtml(page.subject)}" data-en="${escapeHtml(page.subjectEn || page.subject)}">${escapeHtml(subject)}</span>`
        : '',
      !canExpand
        ? `<span class="tag-badge text-[10px]">${escapeHtml(t('search.loginToRead') || '登入後閱讀')}</span>`
        : '',
    ].join('');

    const panelHtml = canExpand
      ? `<p class="text-sm text-kc-muted">${escapeHtml(t('search.openPage'))}</p>`
      : `<p class="text-sm text-kc-muted">${escapeHtml(t('search.loginToReadHint') || '請先登入後再閱讀全文。')}</p>`;

    return `
      <article class="wiki-item" data-slug="${escapeHtml(page.slug)}" data-requires-login="${canExpand ? '0' : '1'}">
        <div class="flex items-start gap-2 px-4 py-5 md:gap-3 md:px-6">
          <button
            type="button"
            class="wiki-expand mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[color:var(--kc-line)] bg-white/60 text-kc-blue transition hover:bg-white"
            aria-expanded="false"
            aria-controls="content-${escapeHtml(page.slug)}"
            aria-label="${escapeHtml(t('search.expand', { title: page.title }))}"
            data-login-gate="${canExpand ? '0' : '1'}"
          >
            <span class="wiki-chevron text-sm transition-transform">▸</span>
          </button>
          <div class="min-w-0 flex-1">
            <div class="mb-1 flex flex-wrap items-center gap-2">
              <time class="text-xs font-semibold text-kc-purple">${escapeHtml(page.date || '')}</time>
              ${keywordsHtml}
            </div>
            <a href="${escapeHtml(href)}" class="wiki-title-link block font-display text-lg font-bold text-kc-blue-deep transition hover:text-kc-purple md:text-xl">
              ${escapeHtml(page.title)}
            </a>
            <p class="mt-0.5 text-xs text-kc-muted/70">${escapeHtml(page.slug.split('/').pop() || page.slug)}</p>
            <p class="mt-1 line-clamp-2 text-sm text-kc-muted">${escapeHtml(page.description || '')}</p>
          </div>
        </div>
        <div id="content-${escapeHtml(page.slug)}" class="wiki-panel hidden border-t border-[color:var(--kc-line)] bg-white/40 px-4 pb-6 pt-2 md:px-6" hidden>
          <div class="wiki-content pl-11 md:pl-12">${panelHtml}</div>
          <div class="mt-6 pl-11 md:pl-12">
            <a href="${escapeHtml(href)}" class="text-sm font-semibold text-kc-blue hover:text-kc-purple">${escapeHtml(canExpand ? t('search.openPage') : t('nav.login') || '登入')}</a>
          </div>
        </div>
      </article>
    `;
  };

  const closeItem = (item) => {
    const panel = item.querySelector('.wiki-panel');
    const expandBtn = item.querySelector('.wiki-expand');
    const chevron = item.querySelector('.wiki-chevron');
    if (panel) {
      panel.hidden = true;
      panel.classList.add('hidden');
    }
    if (expandBtn) expandBtn.setAttribute('aria-expanded', 'false');
    if (chevron) chevron.style.transform = '';
  };

  const openItem = (item, scroll = true) => {
    const panel = item.querySelector('.wiki-panel');
    const expandBtn = item.querySelector('.wiki-expand');
    const chevron = item.querySelector('.wiki-chevron');
    if (!panel || !expandBtn) return;

    item.closest('[data-search-results]')?.querySelectorAll('.wiki-item').forEach((other) => {
      if (other !== item) closeItem(other);
    });

    panel.hidden = false;
    panel.classList.remove('hidden');
    expandBtn.setAttribute('aria-expanded', 'true');
    if (chevron) chevron.style.transform = 'rotate(90deg)';
    if (scroll) item.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const bindExpandHandlers = (container) => {
    container.querySelectorAll('.wiki-expand').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = btn.closest('.wiki-item');
        const slug = item?.getAttribute('data-slug') || '';
        const page = searchIndex.find((p) => p.slug === slug);
        const href = page ? pageHref(page) : gatedNoteHref(getBase() + 'search', getBase());

        // 未登入：展開＝去登入（與點標題同一規則）
        if (!hasSessionHint() && !authed) {
          window.location.href = href;
          return;
        }
        const panel = item?.querySelector('.wiki-panel');
        const isOpen = panel && !panel.hidden;
        if (isOpen) closeItem(item);
        else openItem(item);
      });
    });
  };

  const renderResults = ({ query, resultsEl, emptyEl, metaEl }) => {
    // 每次重繪前再讀一次 hint，避免登入／登出後連結過期
    authed = hasSessionHint() || authed;
    const q = query.trim();
    const results = filterPages(q);
    const canExpand = hasSessionHint() || authed;

    if (metaEl) {
      if (!q) {
        metaEl.textContent =
          results.length > 0
            ? t('search.metaAll', { n: results.length })
            : t('search.metaEmpty');
      } else {
        metaEl.textContent = results.length
          ? t('search.metaFound', { n: results.length, q })
          : t('search.metaNone', { q });
      }
      if (!canExpand && results.length > 0) {
        metaEl.textContent = `${metaEl.textContent} · ${t('search.loginToRead') || '登入後可閱讀全文'}`;
      }
    }

    if (results.length === 0) {
      resultsEl.classList.add('hidden');
      resultsEl.innerHTML = '';
      if (emptyEl) {
        emptyEl.textContent = q ? t('search.emptyQuery', { q }) : t('search.emptyAll');
        emptyEl.classList.remove('hidden');
      }
      return;
    }

    if (emptyEl) emptyEl.classList.add('hidden');
    resultsEl.innerHTML = results.map(renderItem).join('');
    resultsEl.classList.remove('hidden');
    bindExpandHandlers(resultsEl);
  };

  const getQueryFromUrl = () => new URLSearchParams(window.location.search).get('q') || '';

  const mount = ({ input, form, resultsEl, emptyEl, metaEl, syncUrl = false }) => {
    const runSearch = () => {
      const q = input?.value ?? '';
      if (syncUrl) {
        const url = new URL(window.location.href);
        if (q.trim()) url.searchParams.set('q', q.trim());
        else url.searchParams.delete('q');
        window.history.replaceState({}, '', url);
      }
      renderResults({ query: q, resultsEl, emptyEl, metaEl });
    };

    input?.addEventListener('input', runSearch);
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      runSearch();
    });

    return { runSearch, getQueryFromUrl };
  };

  return { mount, renderResults, getQueryFromUrl, filterPages, setIndex, setAuthed };
}
