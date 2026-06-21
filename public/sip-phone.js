'use strict';

/**
 * SipPhone — thin JsSIP wrapper for LSH dashboard.
 * Registered as window.sipPhone after the script loads.
 *
 * Events (CustomEvent on the instance):
 *   registered | unregistered | registrationFailed { detail: {cause} }
 *   incoming   { detail: {name, uri} }
 *   calling    { detail: {uri} }
 *   connected
 *   tick       { detail: {seconds} }
 *   muteChanged { detail: {muted} }
 *   ended
 */
class SipPhone extends EventTarget {
  constructor() {
    super();
    this._ua      = null;
    this._session = null;
    this._timer   = null;
    this._seconds = 0;
    this._muted   = false;
    this.registered = false;
    this.state      = 'idle'; // idle | incoming | calling | active
    this.config     = null;
  }

  start(cfg) {
    if (!cfg?.wsUrl || !cfg?.username) return;
    if (typeof JsSIP === 'undefined') {
      console.error('[SIP] JsSIP not loaded');
      return;
    }

    this.config = cfg;

    // Suppress verbose debug output
    try { JsSIP.debug.disable('JsSIP:*'); } catch (_) { /* ignore */ }

    const socket = new JsSIP.WebSocketInterface(cfg.wsUrl);

    // Parse username — accept bare "101" or "101@domain" or full "sip:101@domain"
    let user = (cfg.username || '').replace(/^sip:/i, '');
    if (user.includes('@')) user = user.split('@')[0];

    const domain = cfg.domain || (() => {
      try { return new URL(cfg.wsUrl.replace(/^wss?/, 'http')).hostname; } catch { return cfg.wsUrl; }
    })();

    this._ua = new JsSIP.UA({
      sockets:      [socket],
      uri:          `sip:${user}@${domain}`,
      password:     cfg.password || '',
      display_name: cfg.displayName || 'LSH Dashboard',
      register:     true,
    });

    this._ua.on('registered',         ()  => { this.registered = true;  this._emit('registered'); });
    this._ua.on('unregistered',       ()  => { this.registered = false; this._emit('unregistered'); });
    this._ua.on('registrationFailed', (e) => { this.registered = false; this._emit('registrationFailed', { cause: e.cause }); });

    this._ua.on('newRTCSession', (data) => {
      // Reject if already busy
      if (this._session) { data.session.terminate({ status_code: 486 }); return; }

      this._session = data.session;
      this._bindSessionEvents(this._session);

      if (data.originator === 'remote') {
        this.state = 'incoming';
        this._emit('incoming', {
          name: data.session.remote_identity?.display_name || '',
          uri:  data.session.remote_identity?.uri?.toString() || '',
        });
      }
      // outbound sessions emit 'calling' from call()
    });

    this._ua.start();
    console.log('[SIP] Starting — ws:', cfg.wsUrl, 'uri: sip:' + user + '@' + domain);
  }

  stop() {
    this._onEnded();
    if (this._ua) { try { this._ua.stop(); } catch (_) {} this._ua = null; }
    this.registered = false;
    console.log('[SIP] Stopped');
  }

  answer() {
    if (!this._session || this.state !== 'incoming') return;
    this._session.answer({ mediaConstraints: { audio: true, video: false } });
  }

  reject() {
    if (!this._session) return;
    try { this._session.terminate({ status_code: 486 }); } catch (_) {}
  }

  hangup() {
    if (!this._session) return;
    try { this._session.terminate(); } catch (_) {}
  }

  call(target) {
    if (!this._ua || !this.registered) return;
    const domain = this.config?.domain || (() => {
      try { return new URL(this.config.wsUrl.replace(/^wss?/, 'http')).hostname; } catch { return ''; }
    })();
    let uri = target.replace(/^sip:/i, '');
    if (!uri.includes('@') && domain) uri = `${uri}@${domain}`;
    uri = `sip:${uri}`;

    const session = this._ua.call(uri, {
      mediaConstraints: { audio: true, video: false },
      pcConfig: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
    });

    if (!session) return;
    this._session = session;
    this._bindSessionEvents(this._session);
    this.state = 'calling';
    this._emit('calling', { uri });
  }

  sendDtmf(tone) {
    if (!this._session || this.state !== 'active') return;
    try { this._session.sendDTMF(tone); } catch (e) { console.warn('[SIP] DTMF:', e.message); }
  }

  toggleMute() {
    if (!this._session) return false;
    this._muted = !this._muted;
    if (this._muted) this._session.mute({ audio: true });
    else             this._session.unmute({ audio: true });
    this._emit('muteChanged', { muted: this._muted });
    return this._muted;
  }

  // ── Private ────────────────────────────────────────────────

  _bindSessionEvents(s) {
    s.on('ended',     () => this._onEnded());
    s.on('failed',    () => this._onEnded());
    s.on('confirmed', () => this._onConnected());
    s.on('peerconnection', (e) => {
      e.peerconnection.addEventListener('track', (evt) => {
        const audio = document.getElementById('sip-audio');
        if (audio && evt.streams[0]) audio.srcObject = evt.streams[0];
      });
    });
  }

  _onConnected() {
    this.state    = 'active';
    this._seconds = 0;
    this._timer   = setInterval(() => {
      this._seconds++;
      this._emit('tick', { seconds: this._seconds });
    }, 1000);
    this._emit('connected');
  }

  _onEnded() {
    clearInterval(this._timer);
    this._timer   = null;
    this._session = null;
    this._muted   = false;
    this.state    = 'idle';
    const audio = document.getElementById('sip-audio');
    if (audio) { try { audio.srcObject = null; } catch (_) {} }
    this._emit('ended');
  }

  _emit(event, detail = {}) {
    this.dispatchEvent(new CustomEvent(event, { detail }));
  }
}

// Ringtone generator via Web Audio API
class Ringtone {
  constructor() { this._ctx = null; this._running = false; }

  start() {
    if (this._running) return;
    this._running = true;
    this._ring();
  }

  _ring() {
    if (!this._running) return;
    try {
      this._ctx = new AudioContext();
      const dur  = 0.4;
      const gap  = 0.15;
      // Two beeps
      [440, 0, 480].forEach((hz, i) => {
        if (!hz) return;
        const osc  = this._ctx.createOscillator();
        const gain = this._ctx.createGain();
        osc.connect(gain);
        gain.connect(this._ctx.destination);
        osc.frequency.value = hz;
        gain.gain.setValueAtTime(0.08, this._ctx.currentTime + i * (dur + gap));
        gain.gain.setValueAtTime(0,    this._ctx.currentTime + i * (dur + gap) + dur);
        osc.start(this._ctx.currentTime + i * (dur + gap));
        osc.stop(this._ctx.currentTime  + i * (dur + gap) + dur);
      });
      // Repeat after 3 s
      const total = 3 * (dur + gap);
      setTimeout(() => { if (this._ctx) { this._ctx.close().catch(() => {}); this._ctx = null; } this._ring(); }, total * 1000);
    } catch (_) {}
  }

  stop() {
    this._running = false;
    if (this._ctx) { try { this._ctx.close(); } catch (_) {} this._ctx = null; }
  }
}

window.sipPhone  = new SipPhone();
window._ringtone = new Ringtone();
