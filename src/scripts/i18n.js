import en from '../locales/en.json';
// KCIS WikiNB has one interface language. Document text is never translated here.
export function getLocale() { return 'en'; }
export function t(key, vars = {}) {
  let text = en[key] ?? key;
  for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, String(value));
  return text;
}
export function applyI18n(root = document) {
  document.documentElement.lang = 'en';
  document.documentElement.dataset.locale = 'en';
  for (const [selector, attribute, target] of [
    ['[data-i18n]','data-i18n','text'],
    ['[data-i18n-placeholder]','data-i18n-placeholder','placeholder'],
    ['[data-i18n-title]','data-i18n-title','title'],
    ['[data-i18n-aria]','data-i18n-aria','aria-label'],
  ]) root.querySelectorAll(selector).forEach(element => {
    if (element.hasAttribute('data-i18n-n') || element.hasAttribute('data-i18n-date')) return;
    const value = t(element.getAttribute(attribute));
    if (target === 'text') element.textContent = value;
    else element.setAttribute(target, value);
  });
  root.querySelectorAll('[data-locale-text]').forEach(element => {
    element.textContent = element.getAttribute('data-en') || element.textContent;
  });
}
export function setLocale() { applyI18n(); }
export function toggleLocale() { applyI18n(); }
export function mountI18n() { applyI18n(); }
export function uiError(error, fallback = 'Unable to complete the request. Please try again.') {
  const message = String(error?.message || '');
  return message && !/[\p{Script=Han}]/u.test(message) ? message : fallback;
}
