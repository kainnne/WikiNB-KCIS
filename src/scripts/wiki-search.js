/**
 * Client-side wiki search for KCIS (teacher + subject keywords).
 * UI strings follow locale; note title/body stay as authored (no auto-translate).
 *
 * 未登入：只顯示預覽字卡；標題／展開／開啟一律導向登入。
 */
import { t, getLocale } from './i18n.js';
import { loginHrefWithNext } from './md-render.js';

export function createWikiSearch(initialIndex, options = {}) {
  let searchIndex = Array.isArray(initialIndex) ? initialIndex : [];
  let authed = Boolean(options.authed);

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
      // 未登入不拿內文當搜尋（避免暗示可讀全文）；有 description／title 即可
      authed ? page.bodyText : '',
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

  const loginHrefFor = (page) => {
    const base = getBase();
    const target = pageHrefAuthed(page);
    // next 存相對站內路徑
    try {
      const u = new URL(target, window.location.origin);
      return loginHrefWithNext(`${u.pathname}${u.search}`, base);
    } catch {
      return loginHrefWithNext(`${base}search`, base);
    }
  };

  const pageHrefAuthed = (page) => {
    const base = getBase();
    if (page.href) return page.href;
    if (page.live && page.teacherId && page.subjectId && (page.noteSlug || page.slug)) {
      const noteSlug =
        page.noteSlug ||
        String(page.slug || '')
          .split('/')
          .pop();
      const qs = new URLSearchParams({
        teacherId: page.teacherId,
        subjectId: page.subjectId,
        slug: noteSlug,
      });
      return `${base}note?${qs.toString()}`;
    }
    return `${base}wiki/${page.slug}`;
  };

  const pageHref = (page) => (authed ? pageHrefAuthed(page) : loginHrefFor(page));

  const subjectLabel = (page) =>
    getLocale() === 'en' ? page.subjectEn || page.subject : page.subject;

  const renderItem = (page) => {
    const subject = subjectLabel(page);
    const href = pageHref(page);
    const keywordsHtml = [
      page.teacher
        ? `<span class="tag-keyword">${escapeHtml(page.teacher)}</span>`
        : '',
      subject
        ? `<span class="tag-keyword" data-locale-text data-zh="${escapeHtml(page.subject)}" data-en="${escapeHtml(page.subjectEn || page.subject)}">${escapeHtml(subject)}</span>`
        : '',
      page.live && authed ? `<span class="tag-badge text-[10px]">live</span>` : '',
      !authed
        ? `<span class="tag-badge text-[10px]">${escapeHtml(t('search.loginToRead') || '登入後閱讀')}</span>`
        : '',
    ].join('');

    const expandDisabled = !authed;
    const panelHtml = authed
      ? page.html ||
        `<p class="text-sm text-kc-muted">${escapeHtml(t('search.openPage'))}</p>`
      : `<p class="text-sm text-kc-muted">${escapeHtml(t('search.loginToReadHint') || '請先登入後再展開全文。點標題即可前往登入。')}</p>`;

    return `
      <article class="wiki-item" data-slug="${escapeHtml(page.slug)}" data-requires-login="${authed ? '0' : '1'}">
        <div class="flex items-start gap-2 px-4 py-5 md:gap-3 md:px-6">
          <button
            type="button"
            class="wiki-expand mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[color:var(--kc-line)] bg-white/60 text-kc-blue transition hover:bg-white"
            aria-expanded="false"
            aria-controls="content-${escapeHtml(page.slug)}"
            aria-label="${escapeHtml(t('search.expand', { title: page.title }))}"
            data-login-gate="${expandDisabled ? '1' : '0'}"
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
            <a href="${escapeHtml(href)}" class="text-sm font-semibold text-kc-blue hover:text-kc-purple">${escapeHtml(authed ? t('search.openPage') : t('nav.login') || '登入')}</a>
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
        if (btn.getAttribute('data-login-gate') === '1' || !authed) {
          const item = btn.closest('.wiki-item');
          const slug = item?.getAttribute('data-slug') || '';
          const page = searchIndex.find((p) => p.slug === slug);
          window.location.href = page ? loginHrefFor(page) : loginHrefWithNext(getBase() + 'search', getBase());
          return;
        }
        const item = btn.closest('.wiki-item');
        const panel = item?.querySelector('.wiki-panel');
        const isOpen = panel && !panel.hidden;
        if (isOpen) closeItem(item);
        else openItem(item);
      });
    });
  };

  const renderResults = ({ query, resultsEl, emptyEl, metaEl }) => {
    const q = query.trim();
    const results = filterPages(q);

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
      if (!authed && results.length > 0) {
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
