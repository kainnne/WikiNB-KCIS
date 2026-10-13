import { t } from './i18n.js';

// Moving the same reader preserves its content, nested details and scroll position.
// A native modal supplies focus trapping and Escape without changing the page.
export function createReaderControls(reader, toggle, { beforeExpand } = {}) {
  let modal = null, placeholder = null, previousFocus = null;
  const updateLabel = () => {
    const label = t(modal ? 'reader.restore' : 'reader.maximize');
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
    toggle.setAttribute('aria-pressed', String(Boolean(modal)));
    toggle.querySelector('.wiki-fs-icon').textContent = modal ? '❐' : '⛶';
  };
  const restore = () => {
    if (!modal) return;
    const current = modal;
    const scroller = reader.querySelector('.wiki-reader-body');
    const scrollTop = scroller?.scrollTop || 0;
    placeholder.replaceWith(reader);
    reader.classList.remove('is-fullscreen');
    modal = null;
    current.remove();
    if (scroller) scroller.scrollTop = scrollTop;
    document.documentElement.classList.remove('wiki-fs-active');
    updateLabel();
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  };
  const expand = () => {
    if (modal || beforeExpand?.() === false) return;
    const scroller = reader.querySelector('.wiki-reader-body');
    const scrollTop = scroller?.scrollTop || 0;
    previousFocus = document.activeElement;
    placeholder = document.createComment('reader position');
    reader.before(placeholder);
    modal = document.createElement('dialog');
    modal.className = 'wiki-reader-modal';
    modal.setAttribute('aria-label', reader.querySelector('h1,h2,.wiki-title-link')?.textContent || 'WikiNB');
    modal.append(reader);
    reader.classList.add('is-fullscreen');
    document.body.append(modal);
    modal.addEventListener('cancel', event => { event.preventDefault(); restore(); });
    modal.addEventListener('close', restore);
    document.documentElement.classList.add('wiki-fs-active');
    updateLabel();
    modal.showModal();
    toggle.focus({ preventScroll: true });
    if (scroller) scroller.scrollTop = scrollTop;
  };
  const click = () => modal ? restore() : expand();
  toggle.addEventListener('click', click);
  document.addEventListener('wikinb:locale-change', updateLabel);
  updateLabel();
  return {
    expand, restore,
    destroy() {
      restore();
      toggle.removeEventListener('click', click);
      document.removeEventListener('wikinb:locale-change', updateLabel);
    },
  };
}

export function bindReaderCopy(button, getHref) {
  button.addEventListener('click', async () => {
    try {
      const url = new URL(getHref(), location.origin);
      url.searchParams.delete('fs');
      await navigator.clipboard.writeText(url.href);
      const label = button.querySelector('.wiki-copy-label');
      label.textContent = 'copied';
      setTimeout(() => { label.textContent = 'copy'; }, 1400);
    } catch { button.title = t('reader.copyFailed'); }
  });
}
