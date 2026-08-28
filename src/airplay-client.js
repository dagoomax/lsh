'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const { start: startAirplaySender } = require('@lox-audioserver/node-airplay-sender');
const { Bonjour } = require('bonjour-service');

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

class AirplayClient {
  constructor(config) {
    this._speakers = (config.airplay?.speakers || []).filter((s) => s && s.id && s.host);
  }

  getSpeakers() {
    return this._speakers.map(({ id, name, host }) => ({ id, name: name || id, host }));
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
        const h = (service.referer?.address
          || (service.addresses || []).find((a) => !a.includes(':'))
          || (service.addresses || [])[0]
          || ''
        ).replace(/^::ffff:/, '');
        if (h !== host) return;
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
  async play(speakerId, filePath) {
    const speaker = this._find(speakerId);
    if (!fs.existsSync(filePath)) throw new Error(`Audio file not found: ${filePath}`);

    // Fail fast, before ever touching the network for real: a device that
    // requires real (PIN/password) pairing will never accept the transient
    // pairing this library always attempts (it has no persistent identity
    // store, so even a one-time PIN flow couldn't survive to the next
    // play() call anyway) — rather than let that hang or surface as a
    // misleading generic "pair_failed", say so plainly up front.
    if (speaker.airplay2 !== false) {
      const flags = await this._lookupFlags(speaker.host);
      if (flags !== null) {
        const needsRealPairing = (flags & FLAG_PASSWORD_REQUIRED)
          || (flags & FLAG_PIN_REQUIRED)
          || (flags & FLAG_ONE_TIME_PAIRING_REQUIRED);
        if (needsRealPairing) {
          throw new Error(
            `"${speaker.name}" requires one-time device pairing (PIN/password) that LSH doesn't support for `
            + `automated playback — common on Apple TV/HomePod. Try a non-Apple AirPlay 2 speaker instead.`
          );
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

    return new Promise((resolve, reject) => {
      let settled = false;
      let weRequestedStop = false; // distinguishes our own wind-down from the receiver dropping the session

      const finish = (err) => {
        if (settled) return;
        settled = true;
        try { ffmpeg.kill('SIGKILL'); } catch { /* already gone */ }
        weRequestedStop = true;
        try { sender.stop(); } catch { /* already stopped */ }
        err ? reject(err) : resolve();
      };

      const ffmpeg = spawn('ffmpeg', [
        '-i', filePath,
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
        volume: speaker.volume ?? 60,
      }, (event) => {
        if (event.event === 'error') { finish(new Error(event.message)); return; }
        // The receiver (or the network) ending the session on its own —
        // "connection_refused", a dropped pairing, etc. — means playback
        // never actually reached the speaker, even though ffmpeg finished
        // decoding cleanly; only treat session-ended as success when *we*
        // triggered it via finish() below (see weRequestedStop).
        if (event.event === 'session-ended' && !weRequestedStop) {
          finish(new Error(`AirPlay session ended unexpectedly: ${event.message || event.detail?.reason || 'unknown reason'}`));
        }
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
