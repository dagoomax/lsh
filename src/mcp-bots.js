'use strict';

// MCP bots — one credential per AI client (Claude, Gemini, ChatGPT, …) for
// LSH's MCP server (/api/mcp), each with its own permissions.
//
// Why not plain API tokens: an LSH API token is an admin credential for the
// whole REST API (settings, users, config). A bot token works ONLY on
// /api/mcp and only within the bot's policy:
//   access      'read' (no write tools at all) | 'control'
//   rooms       device rooms the bot may see ([] = all)
//   devices     extra device keys it may see ([] with no rooms = all)
//   sensitive   false → locks, alarm panels, gates / garage / doors and the
//               doorbell stay read-only even for a 'control' bot (default)
// Plus per-bot rate limiting, an audit trail, and enable / disable / rotate.
//
// Credentials, all random 256-bit, stored only as SHA-256 hashes in
// persist/mcp-bots.json (0600):
//   lshb_…  static bearer token — Claude Code / Claude Desktop / Gemini CLI
//           (sent as `Authorization: Bearer …`), shown once at creation
//   lsha_…  OAuth access token (1 h) and lshr_… refresh token (30 days,
//           rotated on use) — for clients that only do OAuth (ChatGPT,
//           claude.ai connectors); issued after an LSH admin approves the
//           client and picks which bot it acts as (src/routes/mcp-oauth.js)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = process.env.LSH_MCP_BOTS || path.join(__dirname, '..', 'persist', 'mcp-bots.json');
const CLIENTS = { claude: 'Claude', gemini: 'Gemini', chatgpt: 'ChatGPT', other: 'Other' };
const ACCESS_TTL_MS = 60 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 10 * 60 * 1000;
const RATE_PER_MIN = 120;           // tool calls per bot per minute
const FAIL_MAX = 20, FAIL_WINDOW_MS = 10 * 60 * 1000; // bad credentials per IP
const AUDIT_MAX = 500;

const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const rand = (prefix) => `${prefix}${crypto.randomBytes(32).toString('base64url')}`;
const now = () => Date.now();

// ── Sensitive devices: never controllable unless the bot has sensitive: true ──
const SENSITIVE_TYPES = new Set(['satel', 'dsc', 'sip', 'tedee', 'yale', 'unifiaccess', 'unifi-access', 'nuki', 'alarm']);
const SENSITIVE_HK = ['lock-rw', 'door-rw'];
const SENSITIVE_SUBTYPES = new Set(['gate', 'wicket', 'lock', 'garage_door', 'alarm_zone']);
const SENSITIVE_PATH = /^(lock|unlock|arm|disarm|alarm|door|opendoor|open_door|gate|garage|wicket|siren)/i;

function isSensitiveDevice(d) {
  return SENSITIVE_TYPES.has(d.type) || (d.homekit || []).some((h) => SENSITIVE_HK.includes(h))
    || SENSITIVE_SUBTYPES.has(d.sinumType) || SENSITIVE_SUBTYPES.has(d.vcluType);
}
function isSensitiveSensor(d, s) { return isSensitiveDevice(d) || SENSITIVE_PATH.test(s.path || '') }

class McpBots {
  constructor(file = FILE) {
    this.file = file;
    this.data = null;
    this.rate = new Map();      // botId → [timestamps]
    this.fails = new Map();     // ip → [timestamps]
    this.auditLog = [];
    this.pendingSave = null;
  }

  // ── Storage ─────────────────────────────────────────────────────────────────
  _load() {
    if (this.data) return this.data;
    try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')) } catch { this.data = {} }
    this.data.bots ||= []; this.data.clients ||= []; this.data.grants ||= [];
    try { if ((fs.statSync(this.file).mode & 0o077) !== 0) fs.chmodSync(this.file, 0o600) } catch {}
    return this.data;
  }

  _save() {
    const d = this._load();
    const t = now();
    d.grants = d.grants.filter((g) => g.refreshExp > t || g.accessExp > t);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(d, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    try { fs.chmodSync(this.file, 0o600) } catch {}
  }

  // lastUsed changes on every call — write at most every 30 s
  _saveSoon() {
    if (this.pendingSave) return;
    this.pendingSave = setTimeout(() => { this.pendingSave = null; try { this._save() } catch {} }, 30000);
    this.pendingSave.unref?.();
  }

  _public(b) {
    const { tokenHash, ...rest } = b;
    return { ...rest, hasToken: !!tokenHash, oauthGrants: this._load().grants.filter((g) => g.botId === b.id && g.refreshExp > now()).length };
  }

  // ── Bots ────────────────────────────────────────────────────────────────────
  list() { return this._load().bots.map((b) => this._public(b)) }
  get(id) { return this._load().bots.find((b) => b.id === id) || null }

  _policy(input = {}, prev = {}) {
    const name = String(input.name ?? prev.name ?? '').trim().slice(0, 60);
    if (!name) throw new Error('Give the bot a name');
    const client = CLIENTS[input.client] ? input.client : (prev.client || 'other');
    const access = input.access === 'control' ? 'control' : input.access === 'read' ? 'read' : (prev.access || 'read');
    const list = (v, fallback) => (Array.isArray(v) ? [...new Set(v.map((x) => String(x).trim().slice(0, 120)).filter(Boolean))].slice(0, 500) : fallback || []);
    return {
      name, client, access,
      rooms: list(input.rooms, prev.rooms), devices: list(input.devices, prev.devices),
      sensitive: input.sensitive !== undefined ? input.sensitive === true : !!prev.sensitive,
      enabled: input.enabled !== undefined ? input.enabled !== false : prev.enabled !== false,
    };
  }

  create(input) {
    const d = this._load();
    if (d.bots.length >= 50) throw new Error('Too many bots (50) — remove unused ones first');
    const token = rand('lshb_');
    const bot = { id: crypto.randomBytes(8).toString('hex'), ...this._policy(input), tokenHash: sha(token), tokenHint: `${token.slice(0, 9)}…`, createdAt: new Date().toISOString(), lastUsedAt: null, lastIp: null };
    d.bots.push(bot);
    this._save();
    return { bot: this._public(bot), token };
  }

  update(id, input) {
    const b = this.get(id);
    if (!b) throw new Error('No such bot');
    Object.assign(b, this._policy(input, b));
    this._save();
    return this._public(b);
  }

  rotate(id) {
    const b = this.get(id);
    if (!b) throw new Error('No such bot');
    const token = rand('lshb_');
    b.tokenHash = sha(token); b.tokenHint = `${token.slice(0, 9)}…`;
    this._save();
    return { bot: this._public(b), token };
  }

  // Revokes the bot's static token AND every OAuth grant it has
  remove(id) {
    const d = this._load();
    if (!d.bots.some((b) => b.id === id)) throw new Error('No such bot');
    d.bots = d.bots.filter((b) => b.id !== id);
    d.grants = d.grants.filter((g) => g.botId !== id);
    this._save();
  }

  revokeOAuth(id) {
    const d = this._load();
    d.grants = d.grants.filter((g) => g.botId !== id);
    this._save();
  }

  // ── Authentication ──────────────────────────────────────────────────────────
  // Bearer value → bot (enabled) or null
  verify(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
    const d = this._load(), h = sha(token), t = now();
    let bot = null;
    if (token.startsWith('lshb_')) bot = d.bots.find((b) => b.tokenHash && crypto.timingSafeEqual(Buffer.from(b.tokenHash), Buffer.from(h))) || null;
    else if (token.startsWith('lsha_')) {
      const g = d.grants.find((x) => x.accessHash === h && x.accessExp > t);
      bot = g ? this.get(g.botId) : null;
    }
    return bot && bot.enabled !== false ? bot : null;
  }

  isBlocked(ip) {
    const t = now();
    const list = (this.fails.get(ip) || []).filter((x) => t - x < FAIL_WINDOW_MS);
    this.fails.set(ip, list);
    return list.length >= FAIL_MAX;
  }

  recordFailure(ip) {
    const list = (this.fails.get(ip) || []).filter((x) => now() - x < FAIL_WINDOW_MS);
    list.push(now());
    this.fails.set(ip, list);
    if (this.fails.size > 10000) this.fails.clear();
  }

  touch(bot, ip) {
    bot.lastUsedAt = new Date().toISOString(); bot.lastIp = ip || null;
    this._saveSoon();
  }

  // Throws when the bot made more than RATE_PER_MIN tool calls in the last minute
  hit(bot) {
    const t = now();
    const list = (this.rate.get(bot.id) || []).filter((x) => t - x < 60000);
    if (list.length >= RATE_PER_MIN) throw new Error(`Rate limit: ${RATE_PER_MIN} calls per minute for this bot`);
    list.push(t);
    this.rate.set(bot.id, list);
  }

  audit(entry) {
    this.auditLog.push({ at: new Date().toISOString(), ...entry });
    if (this.auditLog.length > AUDIT_MAX) this.auditLog.splice(0, this.auditLog.length - AUDIT_MAX);
  }

  recent(botId, limit = 100) {
    return this.auditLog.filter((e) => !botId || e.botId === botId).slice(-limit).reverse();
  }

  // ── Policy ──────────────────────────────────────────────────────────────────
  canSee(bot, device) {
    if (!device) return false;
    if (!bot.rooms.length && !bot.devices.length) return true;
    return bot.devices.includes(device.key) || (!!device.room && bot.rooms.includes(device.room));
  }

  // Why the bot may not write this sensor, or null if it may
  writeDenied(bot, device, sensorPath) {
    if (bot.access !== 'control') return 'This bot is read-only';
    if (!this.canSee(bot, device)) return 'Device not found';
    const s = (device.sensors || []).find((x) => x.path === sensorPath);
    if (!s || !s.controllable) return 'Sensor not controllable';
    if (!bot.sensitive && isSensitiveSensor(device, s)) return 'Locks, alarm, gates and doors are blocked for this bot (enable “sensitive devices” for it in LSH Settings)';
    return null;
  }

  // A device as this bot may see it — controllable flags reflect the policy
  viewDevice(bot, readings) {
    if (!readings) return null;
    const ok = (s) => !this.writeDenied(bot, readings, s.path);
    const sensors = (readings.sensors || []).map((s) => (s.controllable && !ok(s) ? { ...s, controllable: false, blocked: true } : s));
    const r = {};
    for (const [k, v] of Object.entries(readings.readings || {})) r[k] = v.controllable && !ok(v) ? { ...v, controllable: false, blocked: true } : v;
    const { _writeCapability, ...rest } = readings;
    return { ...rest, sensors, readings: r };
  }

  // ── OAuth 2.1 (authorization code + PKCE S256, public clients) ─────────────
  registerClient(meta = {}) {
    const d = this._load();
    const uris = Array.isArray(meta.redirect_uris) ? meta.redirect_uris.map(String) : [];
    if (!uris.length || uris.length > 10) throw new Error('redirect_uris must list 1–10 URIs');
    for (const u of uris) {
      let x; try { x = new URL(u) } catch { throw new Error(`Invalid redirect URI: ${u}`) }
      const loopback = x.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(x.hostname);
      if (x.protocol !== 'https:' && !loopback) throw new Error('redirect URIs must be https (or http on localhost)');
      if (x.hash) throw new Error('redirect URIs must not contain a fragment');
    }
    // Unapproved registrations are cheap to create — keep the newest 200
    if (d.clients.length >= 200) d.clients.splice(0, d.clients.length - 199);
    const c = {
      client_id: `lshc_${crypto.randomBytes(16).toString('base64url')}`,
      client_name: String(meta.client_name || 'MCP client').slice(0, 80),
      redirect_uris: uris,
      client_id_issued_at: Math.floor(now() / 1000),
    };
    d.clients.push(c);
    this._save();
    return c;
  }

  getClient(id) { return this._load().clients.find((c) => c.client_id === id) || null }

  createCode({ clientId, botId, redirectUri, codeChallenge, approvedBy }) {
    const d = this._load();
    if (!this.get(botId)) throw new Error('No such bot');
    const code = rand('lshcode_');
    d.codes = (d.codes || []).filter((c) => c.exp > now());
    d.codes.push({ hash: sha(code), clientId, botId, redirectUri, codeChallenge, approvedBy, exp: now() + CODE_TTL_MS });
    this._save();
    return code;
  }

  _issue(clientId, botId, grant) {
    const access = rand('lsha_'), refresh = rand('lshr_'), t = now();
    const g = grant || { id: crypto.randomBytes(8).toString('hex'), clientId, botId, createdAt: new Date().toISOString() };
    Object.assign(g, { accessHash: sha(access), accessExp: t + ACCESS_TTL_MS, refreshHash: sha(refresh), refreshExp: t + REFRESH_TTL_MS });
    if (!grant) this._load().grants.push(g);
    this._save();
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_MS / 1000, refresh_token: refresh, scope: 'mcp' };
  }

  exchangeCode({ code, clientId, redirectUri, codeVerifier }) {
    const d = this._load();
    const h = sha(code || '');
    const i = (d.codes || []).findIndex((c) => c.hash === h);
    if (i < 0) throw Object.assign(new Error('Unknown or used code'), { oauth: 'invalid_grant' });
    const c = d.codes[i];
    d.codes.splice(i, 1); // single use, even when the checks below fail
    this._save();
    if (c.exp < now()) throw Object.assign(new Error('Code expired'), { oauth: 'invalid_grant' });
    if (c.clientId !== clientId || c.redirectUri !== redirectUri) throw Object.assign(new Error('Code was issued to another client or redirect URI'), { oauth: 'invalid_grant' });
    const challenge = crypto.createHash('sha256').update(String(codeVerifier || '')).digest('base64url');
    if (!codeVerifier || challenge !== c.codeChallenge) throw Object.assign(new Error('PKCE verification failed'), { oauth: 'invalid_grant' });
    const bot = this.get(c.botId);
    if (!bot || bot.enabled === false) throw Object.assign(new Error('Bot no longer available'), { oauth: 'invalid_grant' });
    return this._issue(clientId, c.botId);
  }

  refresh({ refreshToken, clientId }) {
    const h = sha(refreshToken || '');
    const g = this._load().grants.find((x) => x.refreshHash === h);
    if (!g || g.refreshExp < now() || g.clientId !== clientId) throw Object.assign(new Error('Invalid refresh token'), { oauth: 'invalid_grant' });
    const bot = this.get(g.botId);
    if (!bot || bot.enabled === false) throw Object.assign(new Error('Bot no longer available'), { oauth: 'invalid_grant' });
    return this._issue(clientId, g.botId, g); // rotates both tokens
  }

  revokeToken(token) {
    const h = sha(token || '');
    const d = this._load();
    const before = d.grants.length;
    d.grants = d.grants.filter((g) => g.accessHash !== h && g.refreshHash !== h);
    if (d.grants.length !== before) this._save();
  }
}

module.exports = McpBots;
module.exports.CLIENTS = CLIENTS;
module.exports.isSensitiveSensor = isSensitiveSensor;
module.exports.isSensitiveDevice = isSensitiveDevice;
