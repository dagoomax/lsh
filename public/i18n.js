// i18n engine — must be the first script loaded on every page
(function () {
  const SUPPORTED = ['en', 'pl', 'fr', 'de', 'es', 'it', 'uk'];
  const LABELS    = { en: 'EN', pl: 'PL', fr: 'FR', de: 'DE', es: 'ES', it: 'IT', uk: 'UA' };
  let _t = {};
  let _lang = 'en';

  function getLang() {
    const stored = localStorage.getItem('lsh-lang');
    if (stored && SUPPORTED.includes(stored)) return stored;
    const browser = (navigator.language || 'en').slice(0, 2).toLowerCase();
    return SUPPORTED.includes(browser) ? browser : 'en';
  }

  function t(key, vars) {
    const parts = key.split('.');
    let val = _t;
    for (const k of parts) {
      val = val && val[k];
      if (val === undefined || val === null) return key;
    }
    if (typeof val !== 'string') return key;
    if (vars) return val.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : '{' + k + '}'));
    return val;
  }

  function applyDOM() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      el.innerHTML = t(el.dataset.i18nHtml);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      el.title = t(el.dataset.i18nTitle);
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach(function (el) {
      el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
    });
    document.querySelectorAll('.lang-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.lang === _lang);
    });
    document.documentElement.lang = _lang;
  }

  async function setLang(lang) {
    if (!SUPPORTED.includes(lang)) return;
    try {
      const res = await fetch('/i18n/' + lang + '.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      _t = await res.json();
      _lang = lang;
      localStorage.setItem('lsh-lang', lang);
      applyDOM();
    } catch (err) {
      console.warn('[i18n] Failed to load', lang, err.message);
    }
  }

  function injectSwitcher() {
    const themeBtn = document.querySelector('.theme-toggle');
    const header   = document.querySelector('header');
    if (!header) return;

    const wrap = document.createElement('div');
    wrap.className = 'lang-switcher';

    SUPPORTED.forEach(function (lang) {
      const btn = document.createElement('button');
      btn.className = 'lang-btn';
      btn.dataset.lang = lang;
      btn.textContent = LABELS[lang];
      btn.setAttribute('aria-label', 'Switch language to ' + lang.toUpperCase());
      btn.addEventListener('click', function () { setLang(lang); });
      wrap.appendChild(btn);
    });

    if (themeBtn) {
      themeBtn.parentNode.insertBefore(wrap, themeBtn);
    } else {
      header.appendChild(wrap);
    }
  }

  function injectAuthSwitcher() {
    // For login/setup pages that have no header nav
    const authCard = document.querySelector('.auth-card');
    if (!authCard) return;

    const wrap = document.createElement('div');
    wrap.className = 'lang-switcher lang-switcher--auth';

    SUPPORTED.forEach(function (lang) {
      const btn = document.createElement('button');
      btn.className = 'lang-btn';
      btn.dataset.lang = lang;
      btn.textContent = LABELS[lang];
      btn.setAttribute('aria-label', 'Switch language to ' + lang.toUpperCase());
      btn.addEventListener('click', function () { setLang(lang); });
      wrap.appendChild(btn);
    });

    authCard.prepend(wrap);
  }

  async function init() {
    if (document.querySelector('header')) {
      injectSwitcher();
    } else {
      injectAuthSwitcher();
    }
    await setLang(getLang());
  }

  // Expose globals
  window.I18N = { t: t, setLang: setLang, getLang: getLang, applyDOM: applyDOM };
  window.t = t;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
