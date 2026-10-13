import { t } from './i18n.js';

// Moving the same reader preserves its content, nested details and scroll position.
// A native modal supplies focus trapping and Escape without changing the page.
export function createReaderControls(reader, toggle, { beforeExpand } = {}) {
  let modal = null, placeholder = null, previousFocus = null, parentScroll = [];
  const titleButton = reader.querySelector('.wiki-title-link');
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
    if (titleButton) titleButton.disabled = false;
    modal = null;
    current.remove();
    if (scroller) scroller.scrollTop = scrollTop;
    document.documentElement.classList.remove('wiki-fs-active');
    parentScroll.forEach(({element,top,left}) => element.scrollTo({top,left,behavior:'instant'}));
    updateLabel();
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  };
  const expand = () => {
    if (modal || beforeExpand?.() === false) return;
    const scroller = reader.querySelector('.wiki-reader-body');
    const scrollTop = scroller?.scrollTop || 0;
    parentScroll = [];
    for (let element = reader.parentElement; element; element = element.parentElement) parentScroll.push({element,top:element.scrollTop,left:element.scrollLeft});
    previousFocus = document.activeElement;
    placeholder = document.createComment('reader position');
    reader.before(placeholder);
    modal = document.createElement('dialog');
    modal.className = 'wiki-reader-modal';
    modal.setAttribute('aria-label', reader.querySelector('h1,h2,.wiki-title-link')?.textContent || 'WikiNB');
    modal.append(reader);
    reader.classList.add('is-fullscreen');
    if (titleButton) titleButton.disabled = true;
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
      url.hash = '';
      const textarea = document.createElement('textarea'), focus = document.activeElement;
      textarea.value = url.href;
      textarea.setAttribute('readonly', '');
      textarea.style.cssText = 'position:fixed;left:-9999px;top:0';
      (button.closest('dialog') || document.body).append(textarea);
      textarea.select();
      let copied = false;
      try { copied = document.execCommand('copy'); } finally { textarea.remove(); focus?.focus({preventScroll:true}); }
      if (!copied) await navigator.clipboard.writeText(url.href);
      const label = button.querySelector('.wiki-copy-label');
      label.textContent = 'copied';
      setTimeout(() => { label.textContent = 'copy'; }, 1400);
    } catch { button.title = t('reader.copyFailed'); }
  });
}
