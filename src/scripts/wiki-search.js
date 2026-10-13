import { t, getLocale } from './i18n.js';
import { gatedNoteHref, notePageHref, markdownToHtml } from './md-render.js';
import { hasSessionHint, readWikiFile } from './auth-client.js';
import { readSchoolDocuments, resolveDocumentAssets } from './shared-documents.js';
import { createReaderControls, bindReaderCopy } from './reader-controls.js';

export function createWikiSearch(initialIndex, options = {}) {
  let searchIndex = Array.isArray(initialIndex) ? initialIndex : [];
  let authed = options.authed != null ? Boolean(options.authed) : hasSessionHint();
  let pendingStatus = '', revision = 0, readers = [];
  const expandedDirs = new Set(), contentCache = new Map();
  const escapeHtml = text => String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const domId = value => 'wiki-' + Array.from(String(value), ch => ch.codePointAt(0).toString(16)).join('-');
  const getBase = () => document.documentElement.dataset.base || '/';
  const canRead = () => authed;
  const matchesQuery = (page, query) => [page.slug.startsWith('documents/') ? '' : page.slug, page.title, page.displayFilename, page.description, page.teacher, page.subject, page.subjectEn, page.categoryZh, ...(page.keywords || []), ...(page.tags || [])].join(' ').toLowerCase().includes(query.trim().toLowerCase());
  const filterPages = query => searchIndex.filter(page => matchesQuery(page, query));
  const clearReaders = () => { readers.forEach(reader => reader.destroy()); readers = []; };
  const setIndex = next => { revision++; clearReaders(); contentCache.clear(); searchIndex = Array.isArray(next) ? next : []; };
  const setAuthed = value => {
    authed = Boolean(value);
    if (!authed) { revision++; clearReaders(); contentCache.clear(); }
  };
  const setStatus = value => { pendingStatus = String(value || ''); };
  const noteHrefFor = page => page.href && String(page.href).includes('/note?') ? page.href : notePageHref({teacherId: page.teacherId || '', subjectId: page.subjectId || '', slug: page.noteSlug || page.slug.split('/').pop(), base: getBase()});
  const pageHref = page => canRead() ? noteHrefFor(page) : gatedNoteHref(noteHrefFor(page), getBase());
  const keywordLabel = word => word === '教職員' ? t('account.staff') : word === '學生' ? t('account.student') : word;

  const renderItem = page => {
    const id = domId(page.slug), href = pageHref(page);
    const tags = [...new Set(page.keywords?.length ? page.keywords : [page.teacher, getLocale() === 'en' ? page.subjectEn || page.subject : page.subject].filter(Boolean))].slice(0, 3);
    return `<article class="wiki-item" data-slug="${escapeHtml(page.slug)}">
      <div class="wiki-item-header">
        <button type="button" class="wiki-expand" aria-expanded="false" aria-controls="${id}" aria-label="${escapeHtml(t('search.expand', {title: page.title}))}"><span class="wiki-chevron" aria-hidden="true">▸</span></button>
        <div class="wiki-item-summary">
          <div class="wiki-item-tags">${tags.map(word => `<span class="tag-keyword">${escapeHtml(keywordLabel(word))}</span>`).join('')}</div>
          <button type="button" class="wiki-title-link">${escapeHtml(page.title)}</button>
          ${page.description ? `<p class="wiki-description">${escapeHtml(page.description)}</p>` : ''}
        </div>
        <div class="wiki-card-actions">
          <button type="button" class="wiki-fs-btn wiki-copy-btn" data-copy-href="${escapeHtml(href)}" aria-label="${escapeHtml(t('reader.copy'))}" title="${escapeHtml(t('reader.copy'))}"><span class="wiki-copy-label">copy</span></button>
          <button type="button" class="wiki-fs-btn wiki-maximize" aria-label="${escapeHtml(t('reader.maximize'))}"><span class="wiki-fs-icon" aria-hidden="true">⛶</span></button>
        </div>
      </div>
      <div id="${id}" class="wiki-panel wiki-reader-body" hidden><div class="wiki-content"></div></div>
    </article>`;
  };

  // The two upload groups and their four existing categories reflect the Drive layout.
  const renderTree = (pages, searching) => {
    const groups = new Map();
    for (const page of pages) {
      const role = page.role || 'teachers', category = page.category || page.subjectId || 'academic';
      if (!groups.has(role)) groups.set(role, new Map());
      if (!groups.get(role).has(category)) groups.get(role).set(category, []);
      groups.get(role).get(category).push(page);
    }
    const folder = (path, label, count, contents) => {
      const open = searching || expandedDirs.has(path), id = domId(path);
      return `<div class="wiki-node" data-dir="${escapeHtml(path)}"><button type="button" class="folder-row" data-dir-toggle="${escapeHtml(path)}" aria-expanded="${open}" aria-controls="${id}"><span class="folder-chevron${open ? ' is-open' : ''}" aria-hidden="true">▸</span><span class="folder-name">${escapeHtml(label)}</span><span class="folder-count">${escapeHtml(t('search.folderCount', {n: count}))}</span></button><div id="${id}" class="folder-children" ${open ? '' : 'hidden'}>${contents}</div></div>`;
    };
    return ['teachers', 'students', ...[...groups.keys()].filter(role => !['teachers', 'students'].includes(role))].filter(role => groups.has(role)).map(role => {
      const categories = groups.get(role), total = [...categories.values()].reduce((n, items) => n + items.length, 0);
      const ordered = ['academic', 'extracurricular', 'ai-resolved', 'ai-articles', ...[...categories.keys()].filter(category => !['academic', 'extracurricular', 'ai-resolved', 'ai-articles'].includes(category))];
      const children = ordered.filter(category => categories.has(category)).map(category => {
        const items = categories.get(category), first = items[0];
        const label = getLocale() === 'zh-TW' ? first.categoryZh || first.subject : first.subjectEn || first.subject;
        return folder(role + '/' + category, label || category, items.length, items.map(renderItem).join(''));
      }).join('');
      return folder(role, t(role === 'students' ? 'library.students' : 'library.teachers'), total, children);
    }).join('');
  };

  function closeItem(item) {
    const panel = item.querySelector('.wiki-panel');
    panel.hidden = true;
    item.querySelector('.wiki-expand').setAttribute('aria-expanded', 'false');
    item.querySelector('.wiki-chevron').classList.remove('is-open');
  }
  async function loadContent(item, page) {
    const content = item.querySelector('.wiki-content');
    if (content.dataset.loaded === 'true' || content.dataset.loading === 'true') return;
    const generation = revision;
    content.dataset.loading = 'true';
    content.setAttribute('aria-busy', 'true');
    content.textContent = t('reader.loading');
    try {
      let request = contentCache.get(page.slug);
      if (!request) {
        request = page.slug.startsWith('documents/') ? readSchoolDocuments('/files/' + encodeURIComponent(page.slug.slice('documents/'.length))) : readWikiFile({teacherId: page.teacherId, subjectId: page.subjectId, slug: page.noteSlug || page.slug.split('/').pop()});
        contentCache.set(page.slug, request);
        request.catch(() => { if (contentCache.get(page.slug) === request) contentCache.delete(page.slug); });
      }
      const data = await request;
      if (generation !== revision || !canRead() || !item.isConnected) return;
      content.innerHTML = markdownToHtml(data.markdown ?? data.content ?? '', {base: getBase(), linkifyWiki: !page.slug.startsWith('documents/')});
      resolveDocumentAssets(content);
      content.dataset.loaded = 'true';
    } catch (error) {
      if (generation !== revision || !canRead() || !item.isConnected) return;
      content.replaceChildren();
      const message = document.createElement('p');
      message.setAttribute('role', 'status');
      message.textContent = [401, 403].includes(error.status) ? t('note.loginRequired') : t('reader.failed');
      const retry = document.createElement('button');
      retry.type = 'button'; retry.className = 'kc-btn-ghost'; retry.textContent = t('reader.retry');
      retry.onclick = () => { if ([401, 403].includes(error.status)) location.href = gatedNoteHref(noteHrefFor(page), getBase()); else void loadContent(item, page); };
      content.append(message, retry);
    } finally {
      delete content.dataset.loading;
      content.setAttribute('aria-busy', 'false');
    }
  }
  function openItem(item, page, scroll = true) {
    if (!canRead()) { location.href = pageHref(page); return false; }
    const panel = item.querySelector('.wiki-panel');
    item.closest('[data-search-results]')?.querySelectorAll('.wiki-item').forEach(other => { if (other !== item) closeItem(other); });
    panel.hidden = false;
    item.querySelector('.wiki-expand').setAttribute('aria-expanded', 'true');
    item.querySelector('.wiki-chevron').classList.add('is-open');
    void loadContent(item, page);
    if (scroll) item.scrollIntoView({behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest'});
    return true;
  }
  function bindHandlers(container) {
    container.querySelectorAll('.wiki-item').forEach(item => {
      const page = searchIndex.find(candidate => candidate.slug === item.dataset.slug);
      const toggle = () => item.querySelector('.wiki-panel').hidden ? openItem(item, page) : closeItem(item);
      item.querySelector('.wiki-expand').onclick = toggle;
      item.querySelector('.wiki-title-link').onclick = toggle;
      const maximize = item.querySelector('.wiki-maximize');
      const reader = createReaderControls(item, maximize, { beforeExpand: () => openItem(item, page, false) });
      readers.push(reader);
      bindReaderCopy(item.querySelector('.wiki-copy-btn'), () => noteHrefFor(page));
    });
    container.querySelectorAll('[data-dir-toggle]').forEach(button => {
      button.onclick = () => {
        const children = button.nextElementSibling, open = children.hidden;
        children.hidden = !open; button.setAttribute('aria-expanded', String(open));
        button.querySelector('.folder-chevron').classList.toggle('is-open', open);
        open ? expandedDirs.add(button.dataset.dirToggle) : expandedDirs.delete(button.dataset.dirToggle);
      };
    });
  }
  const renderResults = ({query, resultsEl, emptyEl, metaEl}) => {
    clearReaders();
    if (pendingStatus) { if (metaEl) metaEl.textContent = pendingStatus; resultsEl.classList.add('hidden'); emptyEl?.classList.add('hidden'); return; }
    const q = query.trim(), results = filterPages(q);
    if (metaEl) metaEl.textContent = q ? (results.length ? t('search.metaFound', {n: results.length, q}) : t('search.metaNone', {q})) : (results.length ? t('search.metaAll', {n: results.length}) : t('search.metaEmpty'));
    resultsEl.replaceChildren();
    resultsEl.classList.toggle('hidden', !results.length);
    if (emptyEl) { emptyEl.textContent = q ? t('search.emptyQuery', {q}) : t('search.emptyAll'); emptyEl.classList.toggle('hidden', Boolean(results.length)); }
    if (!results.length) return;
    resultsEl.classList.add('wiki-tree');
    resultsEl.innerHTML = renderTree(results, Boolean(q));
    bindHandlers(resultsEl);
  };
  const getQueryFromUrl = () => new URLSearchParams(location.search).get('q') || '';
  const mount = ({input, form, resultsEl, emptyEl, metaEl, syncUrl = false}) => {
    const runSearch = () => {
      const q = input?.value ?? '';
      if (syncUrl) { const url = new URL(location.href); q.trim() ? url.searchParams.set('q', q.trim()) : url.searchParams.delete('q'); history.replaceState(history.state, '', url); }
      renderResults({query: q, resultsEl, emptyEl, metaEl});
    };
    input?.addEventListener('input', runSearch);
    form?.addEventListener('submit', event => { event.preventDefault(); runSearch(); });
    return {runSearch, getQueryFromUrl};
  };
  return {mount, renderResults, getQueryFromUrl, filterPages, setIndex, setAuthed, setStatus};
}
