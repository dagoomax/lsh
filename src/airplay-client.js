'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const { start: startAirplaySender } = require('@lox-audioserver/node-airplay-sender');
const { Bonjour } = require('bonjour-service');
const pairing = require('./airplay-pairing');

/**
 * Sends prerecorded audio (any format ffmpeg can decode — the paging voice
 * messages' webm/opus recordings, an uploaded mp3, a downloaded URL) to a
 * configured AirPlay speaker. Speakers are a fixed, manually-configured list
 * (config.airplay.speakers: [{id, name, host, port, airplay2, volume}]) —
 * same "config-driven, not auto-discovered" choice as paging.rooms and
 * cameras. discover() below is a one-shot mDNS scan used only to help fill
 * out that list from the Settings UI; the list itself stays static so
 * playback never depends on discovery succeeding at runtime.
 *
 * ffmpeg decodes the source into raw 16-bit/44.1kHz/stereo PCM (already a
 * system dependency here — see ffmpeg-rtsp.js for camera streaming) and
 * pipes it straight into @lox-audioserver/node-airplay-sender's RAOP/
 * AirPlay 1+2 client. No native AirPlay bindings, no intermediate file.
 */
// AirPlay 2 status-flags bit positions (from the receiver's mDNS `flags`/`sf`
// TXT record) that mean "this device won't accept transient/PIN-less
// pairing" — mirrors the bit offsets @lox-audioserver/node-airplay-sender
// itself checks internally (deviceAirtunes.js), so our pre-check agrees with
// what the library would decide anyway. Common on Apple TV/HomePod, which
// treat AirPlay senders like HomeKit accessories; most third-party AirPlay 2
// speakers don't set any of these.
const FLAG_PASSWORD_REQUIRED = 1 << 7;
const FLAG_PIN_REQUIRED = 1 << 3;
const FLAG_ONE_TIME_PAIRING_REQUIRED = 1 << 9;

// Equalizer (the dashboard's 5 bands, dB) as an ffmpeg audio filter
const EQ_BANDS = [60, 230, 910, 3600, 14000];
function eqFilter(gains) {
  if (!Array.isArray(gains) || gains.length !== EQ_BANDS.length) return [];
  const g = gains.map((x) => Math.max(-12, Math.min(12, Number(x) || 0)));
  if (g.every((x) => x === 0)) return [];
  return ['-af', g.map((gain, i) => `equalizer=f=${EQ_BANDS[i]}:t=o:w=${i === 0 || i === 4 ? 2 : 1.4}:g=${gain}`).join(',')];
}

class AirplayClient {
  constructor(config) {
    this._speakers = (config.airplay?.speakers || []).filter((s) => s && s.id && s.host);
    this._pairings = new Map(); // speakerId → pairing in progress
    this._sessions = new Map(); // speakerId → what's playing: { title, since, volume, stop(), setVolume() }
  }

  // ── Now playing (dashboard media player) ──────────────────────────────
  nowPlaying(speakerId) {
    const s = this._sessions.get(speakerId);
    return s ? { title: s.title, url: s.url, since: s.since, volume: s.volume, muted: !!s.muted } : null;
  }

  stop(speakerId) {
    this._sessions.get(speakerId)?.stop();
  }

  setVolume(speakerId, volume) {
    const s = this._sessions.get(speakerId);
    if (!s) throw new Error('Nothing is playing on this speaker');
    s.volume = Math.max(0, Math.min(100, Math.round(volume)));
    s.muted = false;
    s.setVolume(s.volume);
  }

  // AirPlay has no mute of its own: volume 0, and back to the level before
  setMuted(speakerId, muted) {
    const s = this._sessions.get(speakerId);
    if (!s) throw new Error('Nothing is playing on this speaker');
    s.muted = !!muted;
    s.setVolume(muted ? 0 : s.volume);
  }

  getSpeakers() {
    return this._speakers.map(({ id, name, host, password }) => ({ id, name: name || id, host, paired: !!pairing.get(id), hasPassword: !!password, playing: this.nowPlaying(id) }));
  }

  // What the speaker asks for, from its mDNS flags (null = unknown)
  async access(speakerId) {
    const speaker = this._find(speakerId);
    const flags = await this._lookupFlags(speaker.host, 2500);
    if (flags === null) return { known: false };
    return {
      known: true, flags,
      pin: !!(flags & FLAG_PIN_REQUIRED) || !!(flags & FLAG_ONE_TIME_PAIRING_REQUIRED),
      password: !!(flags & FLAG_PASSWORD_REQUIRED),
      paired: !!pairing.get(speakerId), hasPassword: !!speaker.password,
    };
  }

  _find(id) {
    const speaker = this._speakers.find((s) => s.id === id);
    if (!speaker) throw new Error(`Unknown AirPlay speaker "${id}"`);
    return speaker;
  }

  /**
   * One-shot mDNS lookup of a single host's advertised flags (`flags=` from
   * _airplay._tcp, or `sf=` from _raop._tcp — receivers set either). Returns
   * null on timeout/no answer, which callers treat as "unknown, proceed" —
   * never a reason to block playback outright.
   */
  _lookupFlags(host, timeoutMs = 1500) {
    return new Promise((resolve) => {
      let bonjour;
      try {
        bonjour = new Bonjour(undefined, () => { /* swallow async socket errors */ });
      } catch {
        resolve(null);
        return;
      }
      let settled = false;
      const finish = (flags) => {
        if (settled) return;
        settled = true;
        browsers.forEach((b) => { try { b.stop(); } catch { /* already stopped */ } });
        try { bonjour.destroy(); } catch { /* already destroyed */ }
        resolve(flags);
      };
      const onFound = (service) => {
        // Match against every address this announcement carries (referer +
        // the full A/AAAA set), not just the first one — a multi-homed
        // receiver (e.g. a Mac with two active NICs) can advertise from one
        // interface while the configured host points at another address
        // that's still genuinely reachable on it.
        const addrs = [service.referer?.address, ...(service.addresses || [])]
          .filter(Boolean)
          .map((a) => a.replace(/^::ffff:/, ''));
        if (!addrs.includes(host)) return;
        const raw = service.txt?.flags ?? service.txt?.sf;
        if (raw === undefined) return;
        // No radix: receivers advertise these hex-prefixed ("0x18644"), and
        // parseInt auto-detects that prefix — same approach the sender
        // library itself uses when it parses these same fields.
        const parsed = parseInt(raw);
        if (!Number.isNaN(parsed)) finish(parsed);
      };
      const browsers = [
        bonjour.find({ type: 'airplay' }, onFound),
        bonjour.find({ type: 'raop' }, onFound),
      ];
      setTimeout(() => finish(null), timeoutMs);
    });
  }

  /**
   * Play a local audio file (any format ffmpeg reads) out to one configured
   * speaker. Resolves once playback has finished (or the session ended).
   */
  // source: a local audio file, or an http(s) URL (a stream or internet radio — read
  // in real time). opts: { volume, title }. Starting something on a speaker stops
  // what was playing there; the promise settles when playback ends or is stopped.
  async play(speakerId, filePath, opts = {}) {
    const speaker = this._find(speakerId);
    const isUrl = /^https?:\/\//i.test(String(filePath));
    if (!isUrl && !fs.existsSync(filePath)) throw new Error(`Audio file not found: ${filePath}`);
    this.stop(speakerId);

    // Apple TV / HomePod may ask for a PIN (on-screen code) or an AirPlay
    // password instead of accepting anyone. A PIN device works once it has
    // been paired in Settings (the pairing is remembered — airplay-pairing.js);
    // a password device needs its password on the speaker. Say so up front
    // instead of letting it surface as a vague "pair_failed".
    let txt = [];
    if (speaker.airplay2 !== false) {
      const flags = await this._lookupFlags(speaker.host);
      if (flags !== null) {
        const needsPin = (flags & FLAG_PIN_REQUIRED) || (flags & FLAG_ONE_TIME_PAIRING_REQUIRED);
        const needsPassword = flags & FLAG_PASSWORD_REQUIRED;
        if (needsPin || needsPassword) {
          if (needsPin && !pairing.get(speakerId) && !speaker.password) {
            throw new Error(`"${speaker.name}" asks for a PIN — pair it once in Settings → Media → AirPlay Speakers (Pair), `
              + `or allow access without one: Home app → Home Settings → Speakers & TV → Allow Speaker & TV Access → "Everyone".`);
          }
          if (needsPassword && !speaker.password && !pairing.get(speakerId)) {
            throw new Error(`"${speaker.name}" requires an AirPlay password — enter it for this speaker in Settings → Media → AirPlay Speakers.`);
          }
          // The library decides how to authenticate from the advertised flags
          txt = [`sf=0x${flags.toString(16)}`];
        }
      }
    }

    // Failure detection (e.g. connection_refused) takes the underlying
    // library ~2.2s to surface — measured against a real refused port, not
    // documented — so the "did this actually reach the speaker" window has
    // to be judged from when the connection was *opened*, not from when
    // ffmpeg (which decodes independently of the network) finishes. A short
    // voice message can finish decoding in well under 200ms, which used to
    // let a same-tick finish() race ahead of and mask a real connection
    // failure. MIN_SESSION_MS gives the failure signal room to arrive first.
    const MIN_SESSION_MS = 3500;
    const startedAt = Date.now();

    if (txt.length) pairing.install();
    const session = txt.length ? pairing.attach(speaker.host, speakerId) : null;

    return new Promise((resolve, reject) => {
      let settled = false;
      let weRequestedStop = false; // distinguishes our own wind-down from the receiver dropping the session

      const token = Symbol('session');
      const finish = (err) => {
        if (settled) return;
        settled = true;
        if (this._sessions.get(speakerId)?.token === token) this._sessions.delete(speakerId);
        if (session) pairing.detach(speaker.host);
        if (err && session?.resumed && !session.verified) {
          err = new Error(`${err.message} — "${speaker.name}" didn't accept LSH's saved pairing (removed on the device?). Pair it again in Settings → Media → AirPlay Speakers.`);
        }
        try { ffmpeg.kill('SIGKILL'); } catch { /* already gone */ }
        weRequestedStop = true;
        try { sender.stop(); } catch { /* already stopped */ }
        err ? reject(err) : resolve();
      };

      const ffmpeg = spawn('ffmpeg', [
        // a stream is read at its own pace and reconnected if the connection drops
        ...(isUrl ? ['-re', '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5'] : []),
        '-i', filePath,
        ...eqFilter(opts.eq),
        '-f', 's16le', '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2',
        '-loglevel', 'error', 'pipe:1',
      ]);
      ffmpeg.on('error', (err) => finish(new Error(`ffmpeg failed to start: ${err.message}`)));
      ffmpeg.stderr.on('data', (d) => console.warn(`[AirPlay] ffmpeg: ${d.toString().trim()}`));

      const sender = startAirplaySender({
        host: speaker.host,
        port: speaker.port || 5000,
        airplay2: speaker.airplay2 !== false,
        name: speaker.senderName || 'LSH',
        volume: opts.volume ?? speaker.volume ?? 60,
        txt,
      }, (event) => {
        if (event.event === 'error') { finish(new Error(event.message)); return; }
        if (event.event === 'device' && event.message === 'need_password') {
          if (speaker.password) sender.setPasscode(speaker.password);
          else finish(new Error(`"${speaker.name}" asks for a PIN — pair it in Settings → Media → AirPlay Speakers.`));
          return;
        }
        if (event.event === 'device' && event.message === 'pair_failed') {
          finish(new Error(speaker.password ? `"${speaker.name}" rejected the AirPlay password` : `Pairing with "${speaker.name}" failed`));
          return;
        }
        // The receiver (or the network) ending the session on its own —
        // "connection_refused", a dropped pairing, etc. — means playback
        // never actually reached the speaker, even though ffmpeg finished
        // decoding cleanly; only treat session-ended as success when *we*
        // triggered it via finish() below (see weRequestedStop).
        if (event.event === 'session-ended' && !weRequestedStop) {
          finish(new Error(`AirPlay session ended unexpectedly: ${event.message || event.detail?.reason || 'unknown reason'}`));
        }
      });

      this._sessions.set(speakerId, {
        token, title: opts.title || (isUrl ? filePath : 'Audio'), url: isUrl ? filePath : null, since: Date.now(), volume: opts.volume ?? speaker.volume ?? 60,
        stop: () => finish(), setVolume: (v) => { try { sender.setVolume(v) } catch { /* session ending */ } },
      });

      ffmpeg.stdout.on('data', (chunk) => {
        try { sender.sendPcm(chunk); } catch { /* sender already stopped */ }
      });
      ffmpeg.on('close', (code) => {
        if (code && !settled) { finish(new Error(`ffmpeg exited with code ${code}`)); return; }
        // Wait out whatever's left of MIN_SESSION_MS (so a delayed
        // connection_refused/session-ended still arrives and gets treated
        // as a real failure above) plus a small drain margin for
        // already-buffered audio, before we deliberately end the session.
        const remaining = Math.max(0, MIN_SESSION_MS - (Date.now() - startedAt));
        setTimeout(() => finish(), remaining + 500);
      });
    });
  }

  // ── Pairing with a PIN (Apple TV) or AirPlay password ──────────────────
  // startPairing → the Apple TV shows a 4-digit code → submitPin(code). The
  // identity LSH used is saved, so later playback needs no PIN. A speaker
  // with an AirPlay password pairs straight away with that password.
  async startPairing(speakerId) {
    const speaker = this._find(speakerId);
    this.cancelPairing(speakerId);
    pairing.install();
    pairing.remove(speakerId); // pairing again starts from scratch
    const flags = await this._lookupFlags(speaker.host, 2500);
    const state = { phase: 'connecting', speakerId, waiters: [] };
    this._pairings.set(speakerId, state);
    const settle = (phase, error) => {
      if (['paired', 'failed'].includes(state.phase)) return;
      state.phase = phase; state.error = error || null;
      clearTimeout(state.timer);
      if (phase === 'paired' || phase === 'failed') {
        try { state.sender?.stop() } catch {}
        pairing.detach(speaker.host);
        this._pairings.delete(speakerId);
      }
      for (const w of state.waiters.splice(0)) w();
    };
    pairing.attach(speaker.host, speakerId, { onSaved: () => setTimeout(() => settle('paired'), 300) });
    state.sender = startAirplaySender({
      host: speaker.host, port: speaker.port || 5000, airplay2: true, name: speaker.senderName || 'LSH', volume: 0,
      txt: [`sf=0x${((flags ?? 0) | FLAG_ONE_TIME_PAIRING_REQUIRED).toString(16)}`],
    }, (event) => {
      if (event.event === 'device' && event.message === 'need_password') {
        if (speaker.password) { state.phase = 'verifying'; state.sender.setPasscode(speaker.password) }
        else settle('pin');
      } else if (event.event === 'device' && event.message === 'pair_failed') settle('failed', state.phase === 'verifying' ? 'Wrong PIN or password' : 'The speaker refused pairing');
      else if (event.event === 'error') settle('failed', event.message);
      else if (event.event === 'session-ended' && state.phase !== 'paired') settle('failed', `The speaker ended the session (${event.message || 'no reason'})`);
    });
    state.timer = setTimeout(() => settle('failed', 'No answer from the speaker'), 20000);
    await this._waitPairing(state, ['pin', 'paired', 'failed']);
    return this.pairingStatus(speakerId, state);
  }

  async submitPin(speakerId, pin) {
    const state = this._pairings.get(speakerId);
    if (!state || state.phase !== 'pin') throw new Error('No PIN is being asked for — press Pair first');
    if (!/^\d{4,8}$/.test(String(pin))) throw new Error('Enter the code shown on the TV (4 digits)');
    state.phase = 'verifying';
    clearTimeout(state.timer);
    state.timer = setTimeout(() => { state.phase = 'pin-timeout'; this._failPairing(speakerId, 'No answer after the PIN') }, 20000);
    state.sender.setPasscode(String(pin));
    await this._waitPairing(state, ['paired', 'failed']);
    return this.pairingStatus(speakerId, state);
  }

  _failPairing(speakerId, error) {
    const state = this._pairings.get(speakerId);
    if (!state) return;
    try { state.sender?.stop() } catch {}
    state.phase = 'failed'; state.error = error;
    pairing.detach(this._find(speakerId).host);
    this._pairings.delete(speakerId);
    for (const w of state.waiters.splice(0)) w();
  }

  cancelPairing(speakerId) {
    if (this._pairings.has(speakerId)) this._failPairing(speakerId, 'Cancelled');
  }

  _waitPairing(state, phases) {
    return new Promise((resolve) => {
      const check = () => (phases.includes(state.phase) ? resolve() : state.waiters.push(check));
      check();
    });
  }

  pairingStatus(speakerId, state = this._pairings.get(speakerId)) {
    const saved = pairing.get(speakerId);
    return { phase: state?.phase || (saved ? 'paired' : 'idle'), error: state?.error || null, paired: !!saved, pairedAt: saved?.pairedAt || null };
  }

  unpair(speakerId) {
    this._find(speakerId);
    return pairing.remove(speakerId);
  }

  /**
   * One-shot mDNS scan for AirPlay receivers on the local network. Merges
   * `_raop._tcp` (the actual RAOP audio port, advertised by both AirPlay 1
   * and AirPlay 2 devices) with `_airplay._tcp` (AirPlay 2 devices only,
   * name without the "<hex-id>@" prefix RAOP uses, and — per the sender
   * library's own example — often the port that should actually be dialed
   * for AirPlay 2) by host, so callers get one clean entry per speaker.
   * Never rejects: on any mDNS failure (no multicast route, sandboxed
   * network, …) resolves to [] so a broken scan can't break the page.
   *
   * Static and config-independent on purpose: server.js only builds an
   * AirplayClient instance when config.airplay.enabled is true, but
   * discovery is what a user runs from Settings *before* they have any
   * speakers configured (chicken-and-egg otherwise) — so it must work
   * whether or not the feature is enabled yet.
   */
  static discover(timeoutMs = 4000) {
    return new Promise((resolve) => {
      let bonjour;
      try {
        bonjour = new Bonjour(undefined, () => { /* swallow async socket errors */ });
      } catch {
        resolve([]);
        return;
      }

      const byHost = new Map();
      const mergeEntry = (service, isAirplay2) => {
        const host = (service.referer?.address
          || (service.addresses || []).find((a) => !a.includes(':'))
          || (service.addresses || [])[0]
          || ''
        ).replace(/^::ffff:/, '');
        if (!host) return;

        const rawName = String(service.name || host);
        const name = rawName.includes('@') ? rawName.split('@').slice(1).join('@') : rawName;
        const existing = byHost.get(host) || {};
        byHost.set(host, {
          name: (isAirplay2 && name) ? name : (existing.name || name || host),
          host,
          port: (isAirplay2 ? service.port : existing.port) || service.port || 5000,
          airplay2: existing.airplay2 || isAirplay2,
          model: existing.model || service.txt?.model || service.txt?.am || null,
        });
      };

      const browsers = [
        bonjour.find({ type: 'raop' }, (s) => mergeEntry(s, false)),
        bonjour.find({ type: 'airplay' }, (s) => mergeEntry(s, true)),
      ];

      setTimeout(() => {
        browsers.forEach((b) => { try { b.stop(); } catch { /* already stopped */ } });
        try { bonjour.destroy(); } catch { /* already destroyed */ }
        resolve([...byHost.values()].sort((a, b) => a.name.localeCompare(b.name)));
      }, timeoutMs);
    });
  }
}

module.exports = AirplayClient;
module.exports.eqFilter = eqFilter;
