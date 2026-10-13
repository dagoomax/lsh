'use strict';

// Spoken announcements on AirPlay speakers (HomePod, AirPlay 2 speakers).
//
// Text → speech (TTS) → chime + speech → src/airplay-client.js → speakers.
// What triggers one:
//   • Loxone (or anything) over HTTP — a Virtual Output that calls
//     GET /api/announce/say?text=…&token=… or one of the saved messages
//     (the `announce/lsh` device: every message is a command, so the regular
//     Loxone export /api/loxone/outputs.xml?type=announce builds the Virtual
//     Output; messages with {v} take Loxone's analog value)
//   • rules: "when <device value> turns on / changes / equals X, say …" — e.g.
//     a Loxone input or a Loxone alarm state mirrored in LSH
//   • the dashboard, flows (device command), POST /api/announce
//
// TTS engines: 'say' (macOS, offline), 'espeak' (espeak-ng, offline),
// 'google' (Google Translate voice, online), 'url' (your own TTS server,
// urlTemplate with {text} / {lang}); 'auto' = local voice for the language if
// there is one, else Google. Clips are cached in persist/tts-cache/.
//
// config.announce = {
//   enabled, speakers: [airplay speaker ids] (default target), volume (0–100),
//   chime = true, lang = 'en', engine = 'auto', voice, urlTemplate,
//   quietHours: { from: '22:00', to: '07:00' } (skipped then unless urgent),
//   messages: [{ id, label, text, speakers?, volume?, urgent?, min?, max? }],
//   rules:    [{ id, deviceKey, path, when: 'on'|'change'|'equals', value?, text, speakers?, urgent? }],
// }

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { execFile, spawnSync } = require('child_process');
const platformStatus = require('./platform-status');

const KEY = 'announce/lsh';
const CACHE_DIR = process.env.LSH_TTS_CACHE || path.join(__dirname, '..', 'persist', 'tts-cache');
const CACHE_MAX = 300;
const MAX_TEXT = 600;

const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: 60000, ...opts }, (err, stdout, stderr) => (err ? reject(new Error(`${cmd}: ${String(stderr || err.message).trim().split('\n').pop()}`)) : resolve(stdout)));
});
const has = (cmd) => { try { return spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd]).status === 0 } catch { return false } };

// Google's voice takes ≤ 200 characters per request: split on sentences, then words
function splitText(text, max = 190) {
  const out = [];
  for (const sentence of String(text).match(/[^.!?;:\n]+[.!?;:\n]*/g) || []) {
    let cur = '';
    for (const word of sentence.trim().split(/\s+/)) {
      if ((cur + ' ' + word).trim().length > max) { if (cur) out.push(cur); cur = word.slice(0, max) } else cur = (cur + ' ' + word).trim();
    }
    if (cur) out.push(cur);
  }
  return out.length ? out : [String(text).slice(0, max)];
}

// macOS voices: "Zosia               pl_PL    # Witaj…"
function parseSayVoices(listing) {
  return String(listing).split('\n').map((l) => l.match(/^(.*?)\s+([a-z]{2,3}_[A-Za-z0-9]{2,4})\s+#/)).filter(Boolean).map((m) => ({ name: m[1].trim(), locale: m[2] }));
}

function minutes(hhmm) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null }
function inQuietHours(q, now = new Date()) {
  const a = minutes(q?.from), b = minutes(q?.to);
  if (a == null || b == null || a === b) return false;
  const t = now.getHours() * 60 + now.getMinutes();
  return a < b ? t >= a && t < b : t >= a || t < b;
}

function fill(text, vars) {
  return String(text).replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(typeof vars[k] === 'number' ? Math.round(vars[k] * 10) / 10 : vars[k])));
}

class Announcer {
  // opts.player: { play(speakerId, file, { volume }) , getSpeakers() } — tests inject one
  // opts.synth: async (text, lang) → audio file path — tests inject one
  constructor(config, store, sensorRegistry, opts = {}) {
    this.config = config;
    this.cfg = config.announce || {};
    this.store = store;
    this.registry = sensorRegistry;
    this.player = opts.player || null;
    this.synthImpl = opts.synth || null;
    this.queues = new Map();  // speakerId → promise chain
    this.history = [];
    this.last = new Map();    // rule id → last value
    this.onStore = null;
    this.voices = null;
  }

  async start() {
    if (!this.player) {
      const AirplayClient = require('./airplay-client');
      this.player = new AirplayClient(this.config);
    }
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    this._register();
    this.onStore = ({ key, value }) => this._onChange(key, value);
    this.store.on('change', this.onStore);
    platformStatus.set('announce', this.player.getSpeakers().length > 0);
  }

  stop() {
    if (this.onStore) this.store.removeListener('change', this.onStore);
    platformStatus.set('announce', false);
  }

  // ── The LSH device: one command per saved message ─────────────────────────
  _register() {
    const sensors = [
      { path: 'speaking', label: 'Speaking', format: 'on-off' },
      { path: 'last', label: 'Last announcement', type: 'label' },
      ...(this.cfg.messages || []).filter((m) => m?.id && m.text).map((m) => (/\{v\}/.test(m.text)
        ? { path: `msg_${m.id}`, label: m.label || m.id, controllable: true, type: 'range', min: m.min ?? 0, max: m.max ?? 100, writeCmd: 'say', capabilityId: `msg:${m.id}` }
        : { path: `msg_${m.id}`, label: m.label || m.id, controllable: true, type: 'trigger', writeOn: 'say', writeOff: null, capabilityId: `msg:${m.id}` })),
    ];
    const write = (capId, command, args = []) => {
      const id = String(capId).replace(/^msg:/, '');
      const m = (this.cfg.messages || []).find((x) => x.id === id);
      if (!m) throw new Error(`No announcement "${id}"`);
      // Don't hold the caller (Loxone's HTTP request) for the whole speech
      const job = this.sayMessage(m, { v: args[0] });
      job.catch((err) => console.warn(`[Announce] ${id}: ${err.message}`));
      return this.waitForCommands ? job : true;
    };
    const existing = this.registry.getDevices?.().find((d) => d.key === KEY);
    if (existing) { existing.sensors = sensors; existing._writeCapability = write; return }
    this.registry.registerDevice({ key: KEY, label: 'Announcements', type: 'announce', icon: '📢', homekit: [], sensors, _writeCapability: write });
    this.store.update(`${KEY}/speaking`, 0);
  }

  sayMessage(m, vars = {}) {
    if (!m?.text) throw new Error('Empty announcement');
    return this.say(fill(m.text, vars), { speakers: m.speakers, volume: m.volume, urgent: m.urgent, source: `message:${m.id}` });
  }

  // ── Rules: announce when a value in LSH changes ───────────────────────────
  _onChange(key, value) {
    for (const r of this.cfg.rules || []) {
      if (!r?.deviceKey || !r.path || `${r.deviceKey}/${r.path}` !== key || !r.text) continue;
      const prev = this.last.get(r.id || key);
      this.last.set(r.id || key, value);
      const on = (v) => v === true || v === 1 || v === '1' || v === 'on' || (typeof v === 'number' && v > 0);
      let fire = false;
      if (r.when === 'change') fire = prev !== undefined && prev !== value;
      else if (r.when === 'equals') fire = String(value) === String(r.value) && String(prev) !== String(r.value);
      else fire = on(value) && !on(prev); // 'on' (default): rising edge
      if (!fire) continue;
      const dev = this.registry.getDevices?.().find((d) => d.key === r.deviceKey);
      const text = fill(r.text, { value, device: dev?.label || r.deviceKey, sensor: dev?.sensors?.find((s) => s.path === r.path)?.label || r.path });
      this.say(text, { speakers: r.speakers, urgent: r.urgent, source: `rule:${r.id || key}` }).catch((err) => console.warn(`[Announce] Rule ${r.id || key}: ${err.message}`));
    }
  }

  // ── Speak ─────────────────────────────────────────────────────────────────
  // Resolves when every speaker has finished (or failed); per-speaker results
  async say(text, { speakers, volume, chime, urgent, source = 'api' } = {}) {
    text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
    if (!text) throw new Error('Nothing to say');
    const all = this.player.getSpeakers();
    if (!all.length) throw new Error('No AirPlay speakers — add them in Settings → Media → AirPlay Speakers');
    const ids = (speakers?.length ? speakers : this.cfg.speakers?.length ? this.cfg.speakers : [all[0].id]).filter((id) => all.some((s) => s.id === id));
    if (!ids.length) throw new Error('None of the chosen speakers exist any more');
    const entry = { at: new Date().toISOString(), text, speakers: ids, source, status: 'queued', results: {} };
    this.history.unshift(entry); this.history.length = Math.min(this.history.length, 30);
    if (!urgent && inQuietHours(this.cfg.quietHours)) { entry.status = 'skipped (quiet hours)'; return entry }

    let file;
    try { file = await this.clip(text, chime ?? this.cfg.chime !== false) }
    catch (err) { entry.status = 'failed'; entry.error = err.message; throw err }
    this.store.update(`${KEY}/last`, text);
    const vol = volume ?? this.cfg.volume;
    entry.status = 'playing';
    this._speaking(+1);
    await Promise.all(ids.map((id) => this._enqueue(id, async () => {
      try { await this.player.play(id, file, vol != null ? { volume: Number(vol) } : {}); entry.results[id] = 'ok' }
      catch (err) { entry.results[id] = err.message; console.warn(`[Announce] ${id}: ${err.message}`) }
    })));
    this._speaking(-1);
    const failed = Object.values(entry.results).filter((r) => r !== 'ok');
    entry.status = failed.length === ids.length ? 'failed' : failed.length ? 'partly played' : 'played';
    if (failed.length === ids.length) { const e = new Error(failed[0]); e.entry = entry; throw e }
    return entry;
  }

  _speaking(d) {
    this.active = Math.max(0, (this.active || 0) + d);
    this.store.update(`${KEY}/speaking`, this.active ? 1 : 0);
  }

  // One announcement at a time per speaker; different speakers play together
  _enqueue(id, job) {
    const prev = this.queues.get(id) || Promise.resolve();
    const next = prev.then(job, job);
    this.queues.set(id, next.catch(() => {}));
    return next;
  }

  // ── TTS ───────────────────────────────────────────────────────────────────
  lang() { return String(this.cfg.lang || 'en').toLowerCase() }

  sayVoices() {
    if (this.voices) return this.voices;
    if (process.platform !== 'darwin' || !has('say')) return (this.voices = []);
    try { this.voices = parseSayVoices(spawnSync('say', ['-v', '?'], { encoding: 'utf8' }).stdout) } catch { this.voices = [] }
    return this.voices;
  }

  engine() {
    const e = this.cfg.engine || 'auto';
    if (e !== 'auto') return e;
    const lang = this.lang().slice(0, 2);
    if (this.sayVoices().some((v) => v.locale.startsWith(`${lang}_`))) return 'say';
    if (has('espeak-ng')) return 'espeak';
    return 'google';
  }

  engines() {
    return { say: this.sayVoices().length > 0, espeak: has('espeak-ng'), google: true, url: !!this.cfg.urlTemplate, ffmpeg: has('ffmpeg') };
  }

  // Chime + speech as one WAV, cached by its content
  async clip(text, chime = true) {
    const engine = this.engine();
    const h = crypto.createHash('sha1').update(JSON.stringify([engine, this.lang(), this.cfg.voice || '', this.cfg.urlTemplate || '', chime, text])).digest('hex').slice(0, 20);
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const out = path.join(CACHE_DIR, `${h}.wav`);
    if (fs.existsSync(out)) { const t = new Date(); fs.utimesSync(out, t, t); return out }
    const speech = this.synthImpl ? await this.synthImpl(text, this.lang()) : await this._synth(engine, text);
    try {
      const inputs = chime ? ['-f', 'lavfi', '-i', 'sine=frequency=1047:duration=0.16', '-f', 'lavfi', '-i', 'sine=frequency=784:duration=0.32', '-i', speech] : ['-i', speech];
      const n = chime ? 3 : 1;
      const fmt = [...Array(n)].map((_, i) => `[${i}:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${chime && i < 2 ? 0.35 : 1}${chime && i === 1 ? ',afade=t=out:st=0.12:d=0.2,apad=pad_dur=0.25' : ''}[a${i}]`).join(';');
      const tmp = `${out}.tmp.wav`;
      await run('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', `${fmt};${[...Array(n)].map((_, i) => `[a${i}]`).join('')}concat=n=${n}:v=0:a=1,apad=pad_dur=0.4[out]`, '-map', '[out]', '-ar', '44100', '-ac', '2', tmp]);
      fs.renameSync(tmp, out);
    } finally { if (!this.synthImpl) fs.rm(speech, () => {}) }
    this._trimCache();
    return out;
  }

  async _synth(engine, text) {
    const base = path.join(os.tmpdir(), `lsh-tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const lang = this.lang();
    if (engine === 'say') {
      const voice = this.cfg.voice || this.sayVoices().find((v) => v.locale.startsWith(`${lang.slice(0, 2)}_`))?.name;
      const file = `${base}.aiff`;
      await run('say', [...(voice ? ['-v', voice] : []), '-o', file, '--', text]);
      return file;
    }
    if (engine === 'espeak') {
      const file = `${base}.wav`;
      await run('espeak-ng', ['-v', this.cfg.voice || lang, '-w', file, '--', text]);
      return file;
    }
    if (engine === 'url') {
      if (!this.cfg.urlTemplate) throw new Error('Set the TTS URL template');
      const file = `${base}.audio`;
      fs.writeFileSync(file, await download(this.cfg.urlTemplate.replace('{lang}', encodeURIComponent(lang)).replace('{text}', encodeURIComponent(text))));
      return file;
    }
    // google: one request per ≤190-character piece, joined
    const parts = [];
    for (const piece of splitText(text)) {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(piece)}`;
      parts.push(await download(url));
    }
    const file = `${base}.mp3`;
    fs.writeFileSync(file, Buffer.concat(parts));
    return file;
  }

  _trimCache() {
    try {
      const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.wav')).map((f) => ({ f, t: fs.statSync(path.join(CACHE_DIR, f)).mtimeMs })).sort((a, b) => b.t - a.t);
      for (const { f } of files.slice(CACHE_MAX)) fs.rmSync(path.join(CACHE_DIR, f), { force: true });
    } catch {}
  }

  getStatus() {
    return {
      enabled: true, speakers: this.player.getSpeakers(), defaultSpeakers: this.cfg.speakers || [],
      engine: this.engine(), engines: this.engines(), lang: this.lang(),
      voices: this.sayVoices().filter((v) => v.locale.startsWith(`${this.lang().slice(0, 2)}_`)).map((v) => v.name),
      quiet: inQuietHours(this.cfg.quietHours), speaking: !!this.active, history: this.history,
    };
  }
}

function download(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (LSH announcements)' }, timeout: 15000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) { res.resume(); return resolve(download(new URL(res.headers.location, url).toString(), redirects - 1)) }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        if (res.statusCode !== 200 || body.length < 100) return reject(new Error(`TTS server answered HTTP ${res.statusCode}`));
        resolve(body);
      });
    });
    req.on('timeout', () => req.destroy(new Error('TTS server timed out')));
    req.on('error', reject);
  });
}

module.exports = Announcer;
Object.assign(module.exports, { splitText, parseSayVoices, inQuietHours, fill, KEY });
