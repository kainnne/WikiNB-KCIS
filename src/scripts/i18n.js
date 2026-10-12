import en from '../locales/en.json';
import zh from '../locales/zh-TW.json';
const localeKey = 'kcis:interface-language';
let locale = 'en';
try { if (localStorage.getItem(localeKey) === 'zh-TW') locale = 'zh-TW'; } catch {}
export function getLocale() { return locale; }
export function t(key, vars = {}) {
  let text = (locale === 'zh-TW' ? zh[key] : en[key]) ?? en[key] ?? key;
  for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, String(value));
  return text;
}
export function applyI18n(root = document) {
  document.documentElement.lang = locale;
  document.documentElement.dataset.locale = locale;
  for (const [selector, attribute, target] of [
    ['[data-i18n]','data-i18n','text'],
    ['[data-i18n-placeholder]','data-i18n-placeholder','placeholder'],
    ['[data-i18n-title]','data-i18n-title','title'],
    ['[data-i18n-aria]','data-i18n-aria','aria-label'],
  ]) root.querySelectorAll(selector).forEach(element => {
    // The AI conversation has its own language selection; document content stays intact.
    if (element.closest('.codex-page') || element.hasAttribute('data-i18n-n') || element.hasAttribute('data-i18n-date')) return;
    const value = t(element.getAttribute(attribute));
    if (target === 'text') element.textContent = value;
    else element.setAttribute(target, value);
  });
  root.querySelectorAll('[data-locale-text]').forEach(element => {
    if (!element.closest('.codex-page')) element.textContent = element.getAttribute(locale === 'en' ? 'data-en' : 'data-zh') || element.textContent;
  });
}
export function setLocale(value) {
  const next = value === 'zh-TW' ? 'zh-TW' : 'en';
  if (next === locale) return;
  locale = next;
  try { localStorage.setItem(localeKey, locale); } catch {}
  applyI18n();
  document.dispatchEvent(new CustomEvent('wikinb:locale-change', {detail:{locale}}));
}
export function toggleLocale() { setLocale(locale === 'en' ? 'zh-TW' : 'en'); }
export function mountI18n() { applyI18n(); }
export function uiError(error, fallback = t('account.failed')) {
  const message = String(error?.message || '');
  return message && (locale === 'zh-TW' || !/[\p{Script=Han}]/u.test(message)) ? message : fallback;
}
