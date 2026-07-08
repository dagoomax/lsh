# Multi-language (i18n)

‹ [Home](Home) · [Configuration](Configuration) · [REST API](REST-API) ›

## Multi-language (i18n)

The dashboard supports **English, Polish, French, and German**. Language is stored in `localStorage` (`lsh-lang`) and falls back to the browser's preferred language.

### How it works

- `public/i18n.js` — client-side engine loaded as the first script on every page
- `public/i18n/{en,pl,fr,de}.json` — translation files (served without auth so login/setup pages translate too)
- DOM elements are annotated with `data-i18n="key"` attributes; `applyDOM()` replaces `textContent` after the JSON loads
- Additional attributes: `data-i18n-placeholder`, `data-i18n-title`, `data-i18n-html`, `data-i18n-aria-label`
- A language switcher (EN / PL / FR / DE buttons) is injected into the header on every page

### Adding a new language

1. Copy `public/i18n/en.json` → `public/i18n/xx.json`
2. Translate all values
3. Add `'xx'` to the `SUPPORTED` array and `LABELS` object in `public/i18n.js`

---
