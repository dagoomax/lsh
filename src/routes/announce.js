'use strict';

// Announcements on AirPlay speakers (HomePod…) — settings, speak, preview,
// and the Loxone-friendly GET. Module: src/announcer.js.
const fs = require('fs');
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');

const ID = /^[a-z0-9][a-z0-9_-]{0,40}$/;

module.exports = function register(router, ctx) {
  const { clients, requireAdmin, store, sensorRegistry } = ctx;
  const an = () => clients.announce;
  const live = (res) => { const c = an(); if (!c) { res.status(409).json({ success: false, error: 'Announcements are off — turn them on in Settings → Media → Announcements' }); return null } return c };
  const speakersOf = (q) => (Array.isArray(q) ? q : String(q || '').split(',')).map((x) => String(x).trim()).filter(Boolean);
  const speak = async (res, fn) => {
    try { res.json({ success: true, data: await fn() }) }
    catch (err) { res.status(err.entry ? 502 : 400).json({ success: false, error: err.message, data: err.entry || null }) }
  };

  router.get('/announce/status', (req, res) => {
    const c = an();
    res.json({ success: true, data: c ? c.getStatus() : { enabled: false } });
  });

  // Dashboard / flows / scripts
  router.post('/announce', (req, res) => {
    const c = live(res); if (!c) return;
    const b = req.body || {};
    speak(res, () => c.say(b.text, { speakers: speakersOf(b.speakers), volume: b.volume, chime: b.chime, urgent: !!b.urgent, source: 'api' }));
  });

  // Loxone Virtual Output: /api/announce/say?text=…&speakers=kitchen,living&volume=50&token=…
  // Answers at once (Loxone doesn't wait for the speech to finish).
  router.get('/announce/say', (req, res) => {
    const c = live(res); if (!c) return;
    const q = req.query;
    if (!String(q.text || '').trim()) return res.status(400).json({ success: false, error: 'text= is empty' });
    c.say(q.text, { speakers: speakersOf(q.speakers), volume: q.volume != null ? Number(q.volume) : undefined, urgent: q.urgent === '1', source: 'http' })
      .catch((err) => console.warn(`[Announce] ${err.message}`));
    res.json({ success: true });
  });

  // A saved message; v= fills {v} (Loxone sends <v>)
  router.get('/announce/message/:id', (req, res) => {
    const c = live(res); if (!c) return;
    const m = (c.cfg.messages || []).find((x) => x.id === req.params.id);
    if (!m) return res.status(404).json({ success: false, error: 'No such announcement' });
    c.sayMessage(m, { v: req.query.v != null ? Number(req.query.v) : undefined }).catch((err) => console.warn(`[Announce] ${err.message}`));
    res.json({ success: true });
  });

  // Hear it in the browser before sending it to the speakers
  router.get('/announce/preview', async (req, res) => {
    const c = live(res); if (!c) return;
    try {
      const file = await c.clip(String(req.query.text || '').slice(0, 600), req.query.chime !== '0');
      res.type('audio/wav').set('Cache-Control', 'no-store');
      fs.createReadStream(file).pipe(res);
    } catch (err) { res.status(400).json({ success: false, error: err.message }) }
  });

  router.get('/settings/announce', requireAdmin, (req, res) => {
    const a = readConfigFile().announce || {};
    res.json({ success: true, data: {
      enabled: !!a.enabled, speakers: a.speakers || [], volume: a.volume ?? 50, chime: a.chime !== false, lang: a.lang || 'en',
      engine: a.engine || 'auto', voice: a.voice || '', urlTemplate: a.urlTemplate || '', quietHours: a.quietHours || { from: '', to: '' },
      messages: a.messages || [], rules: a.rules || [],
    } });
  });

  router.post('/settings/announce', requireAdmin, async (req, res) => {
    const b = req.body || {};
    const errors = [];
    const messages = (Array.isArray(b.messages) ? b.messages : []).filter((m) => m && (m.id || m.text)).map((m) => ({
      id: String(m.id || '').trim().toLowerCase(), label: String(m.label || '').trim() || undefined, text: String(m.text || '').trim(),
      speakers: speakersOf(m.speakers), volume: m.volume === '' || m.volume == null ? undefined : Number(m.volume), urgent: !!m.urgent,
    }));
    messages.forEach((m, i) => { if (!ID.test(m.id)) errors.push(`Message ${i + 1}: id must be lowercase letters, digits, - or _`); if (!m.text) errors.push(`Message ${m.id || i + 1}: no text`) });
    if (new Set(messages.map((m) => m.id)).size !== messages.length) errors.push('Message ids must be unique');
    const rules = (Array.isArray(b.rules) ? b.rules : []).filter((r) => r && (r.deviceKey || r.text)).map((r, i) => ({
      id: String(r.id || `r${i + 1}`), deviceKey: String(r.deviceKey || ''), path: String(r.path || ''),
      when: ['on', 'change', 'equals'].includes(r.when) ? r.when : 'on', value: r.when === 'equals' ? String(r.value ?? '') : undefined,
      text: String(r.text || '').trim(), speakers: speakersOf(r.speakers), urgent: !!r.urgent,
    }));
    rules.forEach((r, i) => { if (!r.deviceKey || !r.path || !r.text) errors.push(`Rule ${i + 1}: pick a device value and the text to say`) });
    const engine = ['auto', 'say', 'espeak', 'google', 'url'].includes(b.engine) ? b.engine : 'auto';
    if (engine === 'url' && !/^https?:\/\/.*\{text\}/.test(String(b.urlTemplate || ''))) errors.push('TTS URL template must be http(s) and contain {text}');
    const q = b.quietHours || {};
    if ((q.from || q.to) && !(/^\d{1,2}:\d{2}$/.test(q.from) && /^\d{1,2}:\d{2}$/.test(q.to))) errors.push('Quiet hours: both times as HH:MM');
    if (errors.length) return res.status(400).json({ success: false, error: errors.join(' · ') });

    const cur = readConfigFile();
    const announce = {
      enabled: !!b.enabled, speakers: speakersOf(b.speakers), volume: Math.max(0, Math.min(100, Number(b.volume) || 50)), chime: b.chime !== false,
      lang: String(b.lang || 'en').trim().toLowerCase().slice(0, 10), engine, voice: String(b.voice || '').trim() || undefined,
      urlTemplate: String(b.urlTemplate || '').trim() || undefined, quietHours: q.from && q.to ? { from: q.from, to: q.to } : undefined,
      messages, rules,
    };
    writeConfigFile({ ...cur, announce });
    try {
      an()?.stop();
      delete clients.announce;
      if (announce.enabled) {
        const Announcer = require('../announcer');
        const c = new Announcer({ ...cur, announce }, store, sensorRegistry);
        await c.start();
        clients.announce = c;
      }
      res.json({ success: true, message: 'Saved' });
    } catch (err) { res.json({ success: true, message: `Saved; restart LSH to apply (${err.message})` }) }
  });
};
