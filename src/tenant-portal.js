'use strict';

// Guest portal for short-term rentals (Airbnb, Booking.com, VRBO).
//
// Every stay the rental modules know about (store key <listing>/reservations,
// published by src/airbnb-client.js and its Booking/VRBO variants) gets:
//
//   - a guest link, /guest/<token> — no login. From check-in (minus
//     earlyHours) to check-out (plus lateHours) the guest sees Wi-Fi, the door
//     PIN, house rules and controls only the devices the host picked for the
//     property; before that only the welcome and dates, after it nothing.
//   - a door PIN — the guest's phone last 4 digits (Airbnb shares them) or a
//     code derived for the stay — valid in the same window. Published on the
//     property's device (tenant/<slug>: active, doorPin, guest) for flows and
//     locks, and checkable by a keypad: POST /api/tenant/check-pin.
//   - with property.lock set to a Nuki or Tedee lock (its device key), the
//     PIN as a time-limited keypad code on that lock: the wanted codes are
//     published at tenant/<slug>/codes and the lock module creates / deletes
//     them (src/lock-codes.js). The PIN then follows the lock's rules — Nuki:
//     6 digits 1-9, not starting with 12; Tedee: 5-8 digits.
//
// Tokens and derived PINs are HMACs of the stay (listing, start, end) with a
// secret in persist/tenant-secret.json — nothing per stay is stored, and
// "Reset all links" (a new secret) revokes every link at once. If a guest
// changes their dates the stay — and so its link and derived PIN — changes.
//
// config.tenant = {
//   enabled: true, publicUrl: 'https://lsh.example.com',
//   properties: [{ name, listing: 'airbnb/mieszkanie', devices: ['shelly/…'], lock: 'nuki/123',
//                  wifi: { ssid, password }, info, rules,
//                  pin: { mode: 'phone4' | 'random', digits: 4 },
//                  earlyHours: 0, lateHours: 1 }] }

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { readConfigCached } = require('./config-file-cache');

const SECRET_FILE = path.join(__dirname, '..', 'persist', 'tenant-secret.json');
const HOUR = 3600_000;
const RATE_PER_MIN = 60;

const slug = (s) => String(s || '').toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

function propertyIds(props) {
  const seen = new Set();
  return props.map((p, i) => {
    let id = slug(p.name) || `property-${i + 1}`;
    while (seen.has(id)) id = `${id}-${i + 1}`;
    seen.add(id);
    return id;
  });
}

// What PINs a property's lock accepts
const ANY = '0123456789';
function pinRule(prop) {
  const type = String(prop.lock || '').split('/')[0];
  if (type === 'nuki') return { min: 6, max: 6, alphabet: '123456789', ok: (p) => /^[1-9]{6}$/.test(p) && !p.startsWith('12') };
  if (type === 'tedee') return { min: 5, max: 8, alphabet: ANY, ok: (p) => /^\d{5,8}$/.test(p) };
  return { min: 4, max: 8, alphabet: ANY, ok: () => true };
}

class TenantPortal {
  constructor(store, sensorRegistry, { secretFile = SECRET_FILE, readConfig = readConfigCached } = {}) {
    this.store = store;
    this.registry = sensorRegistry;
    this._secretFile = secretFile;
    this._readConfig = readConfig;
    this._secret = null;
    this._timer = null;
    this._registered = new Set();
    this._rate = new Map(); // token → [count, windowStart]
    this._lastVisit = new Map(); // property id → ISO
    this._codeKeys = new Set();  // properties that published lock codes
  }

  get config() { return this._readConfig().tenant || {}; }

  properties() {
    const cfg = this.config;
    if (!cfg.enabled) return [];
    const props = (cfg.properties || []).filter((p) => p?.listing);
    const ids = propertyIds(props);
    return props.map((p, i) => ({ ...p, id: ids[i], key: `tenant/${ids[i]}` }));
  }

  // ── Secret, tokens, PINs ────────────────────────────────────────────────

  secret() {
    if (this._secret) return this._secret;
    try { this._secret = JSON.parse(fs.readFileSync(this._secretFile, 'utf8')).secret; } catch { /* first run */ }
    if (!this._secret) this.resetSecret();
    return this._secret;
  }

  resetSecret() {
    this._secret = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(path.dirname(this._secretFile), { recursive: true });
    fs.writeFileSync(this._secretFile, JSON.stringify({ secret: this._secret, created: new Date().toISOString() }), { mode: 0o600 });
  }

  _mac(what) { return crypto.createHmac('sha256', this.secret()).update(what).digest(); }

  tokenFor(prop, stay) {
    return this._mac(`link|${prop.listing}|${stay.start}|${stay.end}`).toString('base64url').slice(0, 22);
  }

  pinFor(prop, stay) {
    const rule = pinRule(prop);
    const mode = prop.pin?.mode || 'phone4';
    const digits = Math.min(rule.max, Math.max(rule.min, Number(prop.pin?.digits) || 4));
    const phone = stay.phone4 || '';
    if (mode === 'phone4' && /^\d{4}$/.test(phone) && rule.min <= 4 && rule.ok(phone)) return phone;
    const bytes = this._mac(`pin|${prop.listing}|${stay.start}|${stay.end}`);
    for (let shift = 0; shift < bytes.length - digits; shift++) {
      let pin = '';
      for (let i = 0; i < digits; i++) pin += rule.alphabet[bytes[shift + i] % rule.alphabet.length];
      if (rule.ok(pin)) return pin;
    }
    return rule.alphabet[1].repeat(digits); // unreachable in practice
  }

  // Short id of a stay's code on a lock — part of the code's name there, so
  // a changed stay or PIN is a new code and the old one gets removed
  codeId(prop, stay, pin) {
    return BigInt('0x' + this._mac(`code|${prop.listing}|${stay.start}|${stay.end}|${pin}`).subarray(0, 6).toString('hex'))
      .toString(36).padStart(6, '0').slice(-6);
  }

  // ── Stays ───────────────────────────────────────────────────────────────

  // The property's stays (current + upcoming), each with its window, link and PIN
  stays(prop, now = Date.now()) {
    const list = this.store.get(`${prop.listing}/reservations`);
    if (!Array.isArray(list)) return [];
    const early = Math.max(0, Number(prop.earlyHours ?? 0)) * HOUR;
    const late = Math.max(0, Number(prop.lateHours ?? 1)) * HOUR;
    return list.map((s) => {
      const from = Date.parse(s.start) - early;
      const to = Date.parse(s.end) + late;
      return {
        ...s,
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
        status: now < from ? 'upcoming' : now <= to ? 'active' : 'ended',
        token: this.tokenFor(prop, s),
        pin: this.pinFor(prop, s),
        guest: [s.name, s.code, s.phone4 && `…${s.phone4}`].filter(Boolean).join(' · '),
      };
    });
  }

  find(token) {
    if (typeof token !== 'string' || !/^[\w-]{22}$/.test(token)) return null;
    const want = Buffer.from(token);
    for (const prop of this.properties()) {
      for (const stay of this.stays(prop)) {
        const got = Buffer.from(stay.token);
        if (got.length === want.length && crypto.timingSafeEqual(got, want)) return { prop, stay };
      }
    }
    return null;
  }

  // A keypad / flow asks whether a PIN opens a property right now
  checkPin(pin, propertyId) {
    const p = String(pin ?? '').trim();
    if (!/^\d{4,8}$/.test(p)) return { valid: false };
    for (const prop of this.properties()) {
      if (propertyId && prop.id !== propertyId && prop.key !== propertyId) continue;
      const stay = this.stays(prop).find((s) => s.status === 'active' && s.pin === p);
      if (stay) return { valid: true, property: prop.id, guest: stay.guest, until: stay.to };
    }
    return { valid: false };
  }

  // ── Devices for flows ───────────────────────────────────────────────────

  start() {
    clearInterval(this._timer);
    this._timer = setInterval(() => this.publish(), 30_000);
    this._timer.unref?.();
    this.publish();
  }

  stop() { clearInterval(this._timer); this._timer = null; }

  publish() {
    const seen = new Set();
    for (const prop of this.properties()) {
      seen.add(prop.key);
      if (!this._registered.has(prop.key)) {
        this._registered.add(prop.key);
        this.registry.registerDevice({
          key: prop.key, label: `${prop.name || prop.id} · PIN`, type: 'tenant', icon: '🔑',
          sensors: [
            { path: 'active', name: 'Guest access active', type: 'boolean' },
            { path: 'doorPin', name: 'Door PIN', type: 'label' },
            { path: 'guest', name: 'Guest', type: 'label' },
            { path: 'lastVisit', name: 'Guest portal opened', type: 'label' },
            { path: 'lockCodes', name: 'Lock codes', type: 'label' },
          ],
        });
      }
      const cur = this.stays(prop).find((s) => s.status === 'active');
      this._set(`${prop.key}/active`, !!cur);
      this._set(`${prop.key}/doorPin`, cur ? cur.pin : '');
      this._set(`${prop.key}/guest`, cur ? cur.guest || '—' : '');
      this._set(`${prop.key}/lastVisit`, this._lastVisit.get(prop.id) || '');
      this._publishCodes(prop);
    }
    // a property removed or the portal switched off: its lock codes go too
    for (const key of this._codeKeys) {
      if (seen.has(key)) continue;
      const old = this.store.get(`${key}/codes`);
      if (old?.codes?.length) this.store.set(`${key}/codes`, { lock: old.lock, codes: [] });
    }
  }

  // Wanted keypad codes for the property's lock — the lock module syncs them
  _publishCodes(prop) {
    const key = `${prop.key}/codes`;
    const old = this.store.get(key);
    if (!prop.lock) {
      if (old?.codes?.length) this.store.set(key, { lock: old.lock, codes: [] });
      return;
    }
    this._codeKeys.add(prop.key);
    const codes = this.stays(prop).filter((s) => s.status !== 'ended').map((s) => {
      const id = this.codeId(prop, s, s.pin);
      let name = `LSH-${id} ${s.guest || prop.name || ''}`.trim();
      while (Buffer.byteLength(name) > 32) name = name.slice(0, -1); // Tedee: 32 bytes, Nuki: 32 chars
      return { id, name, pin: s.pin, from: s.from, to: s.to };
    });
    const value = { lock: prop.lock, codes };
    if (JSON.stringify(old) !== JSON.stringify(value)) this.store.set(key, value);
  }

  _set(key, value) { if (this.store.get(key) !== value) this.store.set(key, value); }

  // ── Guest view ──────────────────────────────────────────────────────────

  view(prop, stay, lang) {
    const active = stay.status === 'active';
    const devices = active ? (prop.devices || []).map((k) => this.registry.getDeviceReadings(k)).filter(Boolean).map((d) => ({
      key: d.key, label: d.label, icon: d.customIcon || d.icon, room: d.room,
      sensors: (d.sensors || []).filter((s) => !s.hidden && s.type !== 'object').map((s) => ({
        path: s.path, name: s.name, type: s.type, unit: s.unit, min: s.min, max: s.max,
        controllable: !!s.controllable, value: d.readings?.[s.path]?.value ?? null,
      })),
    })) : [];
    return {
      lang,
      property: prop.name || prop.id,
      status: stay.status,
      start: stay.start, end: stay.end, from: stay.from, to: stay.to,
      guest: stay.name || null,
      info: prop.info || '', rules: prop.rules || '',
      wifi: active && prop.wifi?.ssid ? { ssid: prop.wifi.ssid, password: prop.wifi.password || '' } : null,
      pin: active ? stay.pin : null,
      devices,
    };
  }

  _rateOk(token) {
    const now = Date.now();
    const r = this._rate.get(token);
    if (!r || now - r[1] > 60_000) { this._rate.set(token, [1, now]); return true; }
    r[0]++;
    return r[0] <= RATE_PER_MIN;
  }

  router() {
    const r = express.Router();
    r.use(express.json({ limit: '4kb' }));
    r.use((req, res, next) => {
      res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow', 'X-Frame-Options': 'DENY' });
      next();
    });
    const lookup = (req, res) => {
      if (!this.config.enabled) { res.status(404).json({ success: false, error: 'not found' }); return null; }
      const hit = this.find(req.params.token);
      if (!hit) { res.status(404).json({ success: false, error: 'not found' }); return null; }
      return hit;
    };

    r.get('/:token/state', (req, res) => {
      const hit = lookup(req, res);
      if (!hit) return;
      if (hit.stay.status === 'active') {
        this._lastVisit.set(hit.prop.id, new Date().toISOString());
      }
      res.json({ success: true, data: this.view(hit.prop, hit.stay, pickLang(req)) });
    });

    r.post('/:token/command', async (req, res) => {
      const hit = lookup(req, res);
      if (!hit) return;
      if (!this._rateOk(req.params.token)) return res.status(429).json({ success: false, error: 'Too many requests' });
      if (hit.stay.status !== 'active') return res.status(403).json({ success: false, error: 'Your stay is not active' });
      const { device, sensor, value } = req.body || {};
      if (!(hit.prop.devices || []).includes(device)) return res.status(403).json({ success: false, error: 'Not allowed' });
      const d = this.registry.devices.get(device);
      const s = d?.sensors?.find((x) => x.path === sensor);
      if (!s?.controllable) return res.status(403).json({ success: false, error: 'Not allowed' });
      try {
        await this.registry.sendCommand(device, sensor, value);
        console.log(`[Tenant] ${hit.prop.name || hit.prop.id}: guest set ${device} ${sensor} → ${JSON.stringify(value)}`);
        res.json({ success: true });
      } catch (err) {
        res.status(400).json({ success: false, error: err.message });
      }
    });

    r.get('/:token', (req, res) => {
      if (!this.config.enabled || !this.find(req.params.token)) {
        return res.status(404).type('html').send(page(pickLang(req), true));
      }
      res.type('html').send(page(pickLang(req), false));
    });
    return r;
  }
}

// ── Guest page ───────────────────────────────────────────────────────────

const LANGS = ['en', 'pl', 'de', 'fr', 'es', 'it', 'uk'];
function pickLang(req) {
  const q = String(req.query?.lang || '').slice(0, 2);
  if (LANGS.includes(q)) return q;
  for (const part of String(req.headers['accept-language'] || '').split(',')) {
    const l = part.trim().slice(0, 2).toLowerCase();
    if (LANGS.includes(l)) return l;
  }
  return 'en';
}

const T = {
  en: { welcome: 'Welcome', checkin: 'Check-in', checkout: 'Check-out', wifi: 'Wi-Fi', network: 'Network', password: 'Password', copy: 'Copy', copied: 'Copied', pin: 'Door code', rules: 'House rules', info: 'Information', controls: 'Your apartment', on: 'On', off: 'Off', upcoming: 'Your stay hasn’t started yet. The door code, Wi-Fi and controls appear here from', ended: 'Your stay has ended. Thank you for visiting!', invalid: 'This link is not valid or has expired.', error: 'Couldn’t change it — try again.', validUntil: 'Valid until' },
  pl: { welcome: 'Witaj', checkin: 'Zameldowanie', checkout: 'Wymeldowanie', wifi: 'Wi-Fi', network: 'Sieć', password: 'Hasło', copy: 'Kopiuj', copied: 'Skopiowano', pin: 'Kod do drzwi', rules: 'Zasady domu', info: 'Informacje', controls: 'Twoje mieszkanie', on: 'Wł.', off: 'Wył.', upcoming: 'Pobyt jeszcze się nie zaczął. Kod do drzwi, Wi-Fi i sterowanie pojawią się tu od', ended: 'Pobyt się zakończył. Dziękujemy za wizytę!', invalid: 'Ten link jest nieprawidłowy albo wygasł.', error: 'Nie udało się zmienić — spróbuj ponownie.', validUntil: 'Ważny do' },
  de: { welcome: 'Willkommen', checkin: 'Check-in', checkout: 'Check-out', wifi: 'WLAN', network: 'Netzwerk', password: 'Passwort', copy: 'Kopieren', copied: 'Kopiert', pin: 'Türcode', rules: 'Hausregeln', info: 'Informationen', controls: 'Deine Unterkunft', on: 'An', off: 'Aus', upcoming: 'Dein Aufenthalt hat noch nicht begonnen. Türcode, WLAN und Steuerung erscheinen hier ab', ended: 'Dein Aufenthalt ist beendet. Danke für deinen Besuch!', invalid: 'Dieser Link ist ungültig oder abgelaufen.', error: 'Konnte nicht geändert werden — bitte erneut versuchen.', validUntil: 'Gültig bis' },
  fr: { welcome: 'Bienvenue', checkin: 'Arrivée', checkout: 'Départ', wifi: 'Wi-Fi', network: 'Réseau', password: 'Mot de passe', copy: 'Copier', copied: 'Copié', pin: 'Code de la porte', rules: 'Règlement intérieur', info: 'Informations', controls: 'Votre logement', on: 'Allumé', off: 'Éteint', upcoming: 'Votre séjour n’a pas encore commencé. Le code, le Wi-Fi et les commandes apparaîtront ici à partir du', ended: 'Votre séjour est terminé. Merci de votre visite !', invalid: 'Ce lien n’est pas valide ou a expiré.', error: 'Impossible de modifier — réessayez.', validUntil: 'Valable jusqu’au' },
  es: { welcome: 'Bienvenido', checkin: 'Entrada', checkout: 'Salida', wifi: 'Wi-Fi', network: 'Red', password: 'Contraseña', copy: 'Copiar', copied: 'Copiado', pin: 'Código de la puerta', rules: 'Normas de la casa', info: 'Información', controls: 'Tu alojamiento', on: 'Encendido', off: 'Apagado', upcoming: 'Tu estancia aún no ha empezado. El código, el Wi-Fi y los controles aparecerán aquí desde', ended: 'Tu estancia ha terminado. ¡Gracias por tu visita!', invalid: 'Este enlace no es válido o ha caducado.', error: 'No se pudo cambiar — inténtalo de nuevo.', validUntil: 'Válido hasta' },
  it: { welcome: 'Benvenuto', checkin: 'Check-in', checkout: 'Check-out', wifi: 'Wi-Fi', network: 'Rete', password: 'Password', copy: 'Copia', copied: 'Copiato', pin: 'Codice della porta', rules: 'Regole della casa', info: 'Informazioni', controls: 'Il tuo alloggio', on: 'Acceso', off: 'Spento', upcoming: 'Il soggiorno non è ancora iniziato. Codice, Wi-Fi e comandi appariranno qui dal', ended: 'Il soggiorno è terminato. Grazie della visita!', invalid: 'Questo link non è valido o è scaduto.', error: 'Impossibile modificare — riprova.', validUntil: 'Valido fino al' },
  uk: { welcome: 'Вітаємо', checkin: 'Заїзд', checkout: 'Виїзд', wifi: 'Wi-Fi', network: 'Мережа', password: 'Пароль', copy: 'Копіювати', copied: 'Скопійовано', pin: 'Код дверей', rules: 'Правила будинку', info: 'Інформація', controls: 'Ваше житло', on: 'Увімк.', off: 'Вимк.', upcoming: 'Проживання ще не почалося. Код дверей, Wi-Fi і керування з’являться тут від', ended: 'Проживання завершено. Дякуємо за візит!', invalid: 'Посилання недійсне або термін його дії минув.', error: 'Не вдалося змінити — спробуйте ще раз.', validUntil: 'Дійсний до' },
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page(lang, invalid) {
  const t = T[lang] || T.en;
  return `<!doctype html>
<html lang="${lang}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">
<title>${esc(t.welcome)}</title>
<style>
:root{color-scheme:light dark;--bg:#f2f2f7;--card:#fff;--fg:#1c1c1e;--muted:#6e6e73;--line:#e5e5ea;--accent:#0a84ff;--on:#34c759}
@media (prefers-color-scheme:dark){:root{--bg:#000;--card:#1c1c1e;--fg:#f2f2f7;--muted:#98989f;--line:#2c2c2e}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:640px;margin:0 auto;padding:24px 16px calc(32px + env(safe-area-inset-bottom))}
h1{font-size:28px;margin:8px 0 4px}h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:24px 4px 8px;font-weight:600}
.sub{color:var(--muted);margin:0 0 8px}.card{background:var(--card);border-radius:16px;padding:14px 16px;margin-bottom:10px}
.row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:32px}.row+.row{border-top:1px solid var(--line);padding-top:10px;margin-top:10px}
.k{color:var(--muted)}.v{font-weight:600;text-align:right;word-break:break-all}
.pin{font-size:40px;font-weight:700;letter-spacing:.2em;text-align:center;font-variant-numeric:tabular-nums;padding:6px 0}
.small{font-size:13px;color:var(--muted);text-align:center}
button.copy{border:0;background:transparent;color:var(--accent);font:inherit;font-size:14px;cursor:pointer;padding:4px 0 4px 8px}
.txt{white-space:pre-wrap}.dev{display:flex;align-items:center;gap:12px}.dev .ic{font-size:22px;width:28px;text-align:center}
.dev .n{flex:1;min-width:0}.dev .n b{display:block;font-weight:600}.dev .n span{color:var(--muted);font-size:13px}
.sw{position:relative;width:51px;height:31px;flex:none;border-radius:31px;background:var(--line);border:0;cursor:pointer;transition:background .2s}
.sw::after{content:"";position:absolute;top:2px;left:2px;width:27px;height:27px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .2s}
.sw[aria-checked=true]{background:var(--on)}.sw[aria-checked=true]::after{transform:translateX(20px)}
input[type=range]{width:100%;accent-color:var(--accent);margin:10px 0 2px}
.msg{text-align:center;color:var(--muted);padding:48px 8px}.err{color:#ff453a;font-size:13px;text-align:center;min-height:18px}
</style></head><body><main id="app">${invalid ? `<p class="msg">${esc(t.invalid)}</p>` : ''}</main>
${invalid ? '' : `<script>
const T=${JSON.stringify(t)};const base=location.pathname.replace(/\\/$/,'');const L=${JSON.stringify(lang)};
const el=(h)=>{const d=document.createElement('div');d.innerHTML=h;return d.firstElementChild};
const e=(s)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(iso)=>new Date(iso).toLocaleString(L,{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
let busy=0,err='';
async function cmd(device,sensor,value){busy++;err='';try{const r=await fetch(base+'/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device,sensor,value})});if(!r.ok)throw 0}catch{err=T.error}busy--;setTimeout(load,600)}
function copy(btn,text){navigator.clipboard?.writeText(text).then(()=>{btn.textContent=T.copied;setTimeout(()=>btn.textContent=T.copy,1500)})}
function render(s){const a=document.getElementById('app');let h='';
h+='<h1>'+e(T.welcome+(s.guest?', '+s.guest.split(' ')[0]:''))+'</h1><p class="sub">'+e(s.property)+'</p>';
h+='<div class="card"><div class="row"><span class="k">'+e(T.checkin)+'</span><span class="v">'+e(fmt(s.start))+'</span></div><div class="row"><span class="k">'+e(T.checkout)+'</span><span class="v">'+e(fmt(s.end))+'</span></div></div>';
if(s.status==='upcoming')h+='<p class="msg">'+e(T.upcoming)+' '+e(fmt(s.from))+'.</p>';
if(s.status==='ended')h+='<p class="msg">'+e(T.ended)+'</p>';
if(s.pin)h+='<h2>'+e(T.pin)+'</h2><div class="card"><div class="pin">'+e(s.pin)+'</div><div class="small">'+e(T.validUntil)+' '+e(fmt(s.to))+'</div></div>';
if(s.wifi)h+='<h2>'+e(T.wifi)+'</h2><div class="card"><div class="row"><span class="k">'+e(T.network)+'</span><span class="v">'+e(s.wifi.ssid)+'</span></div>'+(s.wifi.password?'<div class="row"><span class="k">'+e(T.password)+'</span><span class="v">'+e(s.wifi.password)+' <button class="copy" data-copy="'+e(s.wifi.password)+'">'+e(T.copy)+'</button></span></div>':'')+'</div>';
if(s.devices.length){h+='<h2>'+e(T.controls)+'</h2><div class="err">'+e(err)+'</div>';for(const d of s.devices){h+='<div class="card">';const ctl=d.sensors.filter(x=>x.controllable);const ro=d.sensors.filter(x=>!x.controllable&&x.value!==null&&['number','boolean','label','value','string'].includes(x.type)).slice(0,3);
const sw=ctl.find(x=>x.type==='toggle');const lv=ctl.find(x=>x.type==='range');
h+='<div class="dev"><span class="ic">'+e(d.icon||'•')+'</span><span class="n"><b>'+e(d.label)+'</b><span>'+e(ro.map(x=>(typeof x.value==='number'?Math.round(x.value*10)/10:x.value===true?T.on:x.value===false?T.off:x.value)+(x.unit?' '+x.unit:'')).join(' · '))+'</span></span>';
if(sw){const on=sw.value===1||sw.value===true||sw.value==='on';h+='<button class="sw" role="switch" aria-label="'+e(d.label)+'" aria-checked="'+on+'" data-d="'+e(d.key)+'" data-s="'+e(sw.path)+'" data-v="'+(!on)+'"></button>'}
h+='</div>';
for(const r of ctl.filter(x=>x.type==='range')){const min=r.min??0,max=r.max??100;h+='<div class="row" style="border:0;margin:0;padding:0;display:block"><span class="k" style="font-size:13px">'+e(r.name)+': '+e(r.value??'—')+(r.unit?' '+e(r.unit):'')+'</span><input type="range" min="'+min+'" max="'+max+'" step="'+(max-min>40?1:0.5)+'" value="'+e(r.value??min)+'" data-d="'+e(d.key)+'" data-s="'+e(r.path)+'"></div>'}
h+='</div>'}}
if(s.info)h+='<h2>'+e(T.info)+'</h2><div class="card txt">'+e(s.info)+'</div>';
if(s.rules)h+='<h2>'+e(T.rules)+'</h2><div class="card txt">'+e(s.rules)+'</div>';
a.innerHTML=h;
a.querySelectorAll('.sw').forEach(b=>b.onclick=()=>{b.setAttribute('aria-checked',b.dataset.v);cmd(b.dataset.d,b.dataset.s,b.dataset.v==='true')});
a.querySelectorAll('input[type=range]').forEach(i=>i.onchange=()=>cmd(i.dataset.d,i.dataset.s,Number(i.value)));
a.querySelectorAll('.copy').forEach(b=>b.onclick=()=>copy(b,b.dataset.copy))}
async function load(){if(busy||document.activeElement?.type==='range')return;try{const r=await fetch(base+'/state');if(r.status===404){document.getElementById('app').innerHTML='<p class="msg">'+e(T.invalid)+'</p>';return}const j=await r.json();if(j.success)render(j.data)}catch{}}
load();setInterval(()=>{if(!document.hidden)load()},10000);
</script>`}
</body></html>`;
}

module.exports = TenantPortal;
module.exports.propertyIds = propertyIds;
module.exports.pinRule = pinRule;
