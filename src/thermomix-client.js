'use strict';

const platformStatus = require('./platform-status');

// ── Thermomix / Cookidoo cloud integration ──────────────────────────────────
//
// The Thermomix (TM6/TM7) has no public local API. What it *does* have is the
// Cookidoo recipe platform, whose cookie-based OAuth2 flow has been
// reverse-engineered by the community (miaucl/cookidoo-api). We reproduce the
// same login and read a few useful figures — shopping-list size, this week's
// meal plan, the next planned recipe — and surface them as an LSH device.
//
// This is a best-effort, unofficial integration against an undocumented API,
// so every request is defensively parsed and every failure is downgraded to a
// warning (the platform badge goes red) rather than crashing the hub.

const CIAM_LOGIN_SRV_URL = 'https://ciam.prod.cookidoo.vorwerk-digital.com/login-srv/login';

// country_code → { language, url }. Confirmed from cookidoo-api's
// localization.json for pl/de/gb; the rest follow Cookidoo's stable
// per-country domains. Any country can be overridden with an explicit
// `baseUrl` + `language` in config.
const LOCALIZATIONS = {
  pl: { language: 'pl',    url: 'https://cookidoo.pl' },
  de: { language: 'de-DE', url: 'https://cookidoo.de' },
  at: { language: 'de-AT', url: 'https://cookidoo.at' },
  ch: { language: 'de-CH', url: 'https://cookidoo.ch' },
  gb: { language: 'en-GB', url: 'https://cookidoo.co.uk' },
  uk: { language: 'en-GB', url: 'https://cookidoo.co.uk' },
  fr: { language: 'fr-FR', url: 'https://cookidoo.fr' },
  it: { language: 'it-IT', url: 'https://cookidoo.it' },
  es: { language: 'es-ES', url: 'https://cookidoo.es' },
  pt: { language: 'pt-PT', url: 'https://cookidoo.pt' },
  nl: { language: 'nl-NL', url: 'https://cookidoo.nl' },
  us: { language: 'en-US', url: 'https://cookidoo.com' },
  au: { language: 'en-AU', url: 'https://cookidoo.com.au' },
};

const POLL_DEFAULT_S = 300;
const MAX_REDIRECTS  = 12;

class ThermomixClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;

    this._cookies = {};        // flat name → value jar shared across the flow
    this._base    = null;      // e.g. https://cookidoo.pl
    this._lang    = null;      // e.g. pl
    this._timer   = null;
    this._deviceKey = 'thermomix/tm';
  }

  async start() {
    const cfg = this._config.thermomix;
    if (!cfg?.email || !cfg?.password) return;

    const loc = LOCALIZATIONS[(cfg.country || '').toLowerCase()];
    this._base = (cfg.baseUrl || loc?.url || '').replace(/\/+$/, '');
    this._lang = cfg.language || loc?.language;
    if (!this._base || !this._lang) {
      console.error('[Thermomix] Unknown country — set config.thermomix.country (e.g. "pl") or an explicit baseUrl + language');
      return;
    }

    console.log('[Thermomix] Starting…');
    platformStatus.set('thermomix', false); // badge appears; goes green once polling succeeds

    this._registry.registerDevice({
      key:   this._deviceKey,
      label: cfg.name || 'Thermomix',
      type:  'thermomix',
      icon:  'chef',
      sensors: [
        { path: 'online',         name: 'Online',          type: 'boolean' },
        { path: 'shoppingItems',  name: 'Shopping items',  type: 'number' },
        { path: 'plannedRecipes', name: 'Planned recipes', type: 'number' },
        { path: 'nextRecipe',     name: 'Next recipe',     type: 'string' },
      ],
    });

    try {
      await this._login();
    } catch (err) {
      console.error(`[Thermomix] Login failed: ${err.message}`);
      this._store.set(`${this._deviceKey}/online`, false);
      platformStatus.set('thermomix', false);
    }

    await this._poll();
    const interval = (cfg.pollSeconds || POLL_DEFAULT_S) * 1000;
    this._timer = setInterval(() => this._poll().catch(() => {}), interval);
    console.log(`[Thermomix] Started — polling ${this._base} every ${interval / 1000}s`);
  }

  stop() {
    clearInterval(this._timer);
    this._timer = null;
  }

  // ── Cookie jar helpers ─────────────────────────────────────────────────────

  _storeSetCookies(res) {
    // Node 18.14+ exposes getSetCookie(); fall back to the combined header.
    let list = [];
    if (typeof res.headers.getSetCookie === 'function') list = res.headers.getSetCookie();
    else { const h = res.headers.get('set-cookie'); if (h) list = [h]; }
    for (const line of list) {
      const pair = line.split(';', 1)[0];
      const eq = pair.indexOf('=');
      if (eq > 0) this._cookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
    }
  }

  _cookieHeader() {
    return Object.entries(this._cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  // Follow redirects manually so Set-Cookie is captured at every hop and the
  // jar is replayed on the next — global fetch drops cookies across redirects.
  async _fetchFollow(url, opts = {}) {
    let current = url;
    for (let i = 0; i < MAX_REDIRECTS; i++) {
      const cookie = this._cookieHeader();
      const res = await fetch(current, {
        ...opts,
        redirect: 'manual',
        headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) },
      });
      this._storeSetCookies(res);
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) return res;
        current = new URL(loc, current).toString();
        opts = { headers: opts.headers }; // redirects become GET without the body
        continue;
      }
      return res;
    }
    throw new Error('too many redirects');
  }

  // ── Auth: reverse-engineered Cookidoo CIAM cookie flow ─────────────────────

  async _login() {
    const cfg = this._config.thermomix;
    this._cookies = {};

    // 1. Load the login form and pull the one-time requestId out of its HTML.
    const formRes = await this._fetchFollow(`${CIAM_LOGIN_SRV_URL}/profile/${this._lang}/login`, {
      headers: { accept: 'text/html', 'user-agent': 'LSH/1.0' },
    });
    const html = await formRes.text();
    const m = html.match(/name=["']requestId["']\s+value=["']([^"']+)["']/i)
           || html.match(/requestId["']?\s*[:=]\s*["']([^"']+)["']/i);
    if (!m) throw new Error('could not find requestId on login page');

    // 2. Post the credentials; the redirect chain drops the auth cookies.
    const body = new URLSearchParams({ requestId: m[1], username: cfg.email, password: cfg.password });
    await this._fetchFollow(CIAM_LOGIN_SRV_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html', 'user-agent': 'LSH/1.0' },
      body: body.toString(),
    });

    if (!this._cookies['_oauth2_proxy'] && !this._cookies['v-authenticated']) {
      throw new Error('authentication rejected (check email/password)');
    }
  }

  async _apiGet(path) {
    const res = await this._fetchFollow(`${this._base}/${path}`, {
      headers: { accept: 'application/json', 'user-agent': 'LSH/1.0' },
    });
    if (res.status === 401 || res.status === 403) { const e = new Error('unauthorized'); e.code = 401; throw e; }
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
    return res.json();
  }

  // ── Polling ────────────────────────────────────────────────────────────────

  async _poll() {
    try {
      const shopping = await this._apiGet(`shopping/${this._lang}`).catch(() => null);
      if (shopping == null && !this._cookies['_oauth2_proxy']) throw Object.assign(new Error('unauthorized'), { code: 401 });

      const today = new Date().toISOString().slice(0, 10);
      const week  = await this._apiGet(`planning/${this._lang}/api/my-week/${today}`).catch(() => null);

      const shoppingItems = countItems(shopping);
      const recipes = collectRecipeTitles(week);

      this._store.set(`${this._deviceKey}/online`, true);
      this._store.set(`${this._deviceKey}/shoppingItems`, shoppingItems);
      this._store.set(`${this._deviceKey}/plannedRecipes`, recipes.length);
      this._store.set(`${this._deviceKey}/nextRecipe`, recipes[0] || '—');
      platformStatus.set('thermomix', true);
    } catch (err) {
      if (err.code === 401) {
        // Cookies expired — re-auth once and let the next tick refetch.
        try { await this._login(); return; } catch (e) { err = e; }
      }
      console.warn(`[Thermomix] Poll failed: ${err.message}`);
      this._store.set(`${this._deviceKey}/online`, false);
      platformStatus.set('thermomix', false);
    }
  }
}

// ── Defensive JSON extraction (the shapes are undocumented) ──────────────────

// Count shopping-list entries across whatever arrays the payload carries
// (owned/unowned ingredients, additional items, recipe-derived items).
function countItems(data) {
  if (!data || typeof data !== 'object') return 0;
  let n = 0;
  for (const key of ['ingredients', 'items', 'additionalItems', 'ownedIngredients', 'recipes']) {
    if (Array.isArray(data[key])) n += data[key].length;
  }
  return n;
}

// Walk the my-week payload for anything that looks like a planned recipe and
// return its human title. Robust to the array living under various keys.
function collectRecipeTitles(data) {
  const out = [];
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const title = node.title || node.name || node.recipeTitle || (node.recipe && (node.recipe.title || node.recipe.name));
    if (typeof title === 'string' && title.trim()) out.push(title.trim());
    for (const v of Object.values(node)) if (v && typeof v === 'object') visit(v);
  };
  visit(data);
  // De-dup while keeping order.
  return [...new Set(out)];
}

ThermomixClient._test = { countItems, collectRecipeTitles, LOCALIZATIONS };

module.exports = ThermomixClient;
