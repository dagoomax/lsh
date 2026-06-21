'use strict';

/**
 * SIP doorbell intercom — lightweight SIP user-agent server built on the `sip`
 * package. A VoIP doorbell/intercom (Grandstream, Doorbird, 2N, Akuvox, …) is
 * pointed at this host:port and dials an extension; the incoming INVITE is
 * surfaced to the dashboard as a "ring" so the browser can pop a call panel
 * showing the door camera and an open-door button.
 *
 * This is signalling-only: it answers/declines the SIP dialog and (optionally)
 * pulses a door-strike relay. Two-way RTP audio is intentionally out of scope.
 *
 * Emits:
 *   'call' → state object (see getState) whenever the call state changes.
 */

const { EventEmitter } = require('events');
const os   = require('os');
const sip  = require('sip');
const platformStatus = require('./platform-status');

function localIPv4() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return '127.0.0.1';
}

// Minimal SDP advertising no usable media — enough to satisfy the UAC that the
// call was answered without us having to handle RTP.
function inactiveSdp(ip) {
  return [
    'v=0',
    `o=lsh ${Date.now()} ${Date.now()} IN IP4 ${ip}`,
    's=LSH Intercom',
    `c=IN IP4 ${ip}`,
    't=0 0',
    'm=audio 0 RTP/AVP 0',
    'a=inactive',
    '',
  ].join('\r\n');
}

function callerOf(rq) {
  const from = rq.headers.from || {};
  if (from.name) return String(from.name).replace(/^"|"$/g, '');
  try {
    const u = sip.parseUri(from.uri);
    if (u && u.user) return u.user;
  } catch { /* ignore */ }
  return from.uri || 'Unknown';
}

class SipServer extends EventEmitter {
  constructor(config, { onOpenDoor } = {}) {
    super();
    this._cfg        = config.sip || {};
    this._onOpenDoor = onOpenDoor;
    this._started    = false;
    this._ip         = localIPv4();
    this._call       = null;      // active dialog, see _onInvite
    this._lastState  = 'idle';    // idle | ringing | in-call | ended
  }

  start() {
    if (!this._cfg.enabled) return;
    const port = parseInt(this._cfg.port || 5060);
    try {
      sip.start({ port, logger: { error: (e) => console.error('[SIP]', e && e.message ? e.message : e) } },
        (rq) => this._onRequest(rq));
      this._started = true;
      platformStatus.set('sip', true);
      console.log(`[SIP] Doorbell server listening on ${this._ip}:${port} (UDP/TCP)`);
    } catch (err) {
      platformStatus.set('sip', false);
      console.error(`[SIP] Start failed: ${err.message}`);
    }
  }

  stop() {
    if (this._started) {
      try { sip.stop(); } catch { /* ignore */ }
    }
    this._started = false;
    platformStatus.set('sip', false);
  }

  // ── State broadcast ──────────────────────────────────────────────────

  getState() {
    const c = this._call;
    return {
      active:      this._lastState === 'ringing' || this._lastState === 'in-call',
      state:       this._lastState,
      caller:      c ? c.caller : null,
      callId:      c ? c.callId : null,
      since:       c ? c.since  : null,
      cameraName:  this._cfg.cameraName || '',
      canOpenDoor: this._cfg.doorRelay != null && this._onOpenDoor != null,
    };
  }

  _emitState(state) {
    this._lastState = state;
    this.emit('call', this.getState());
  }

  // ── Request dispatch ─────────────────────────────────────────────────

  _onRequest(rq) {
    switch (rq.method) {
      case 'INVITE':  return this._onInvite(rq);
      case 'ACK':     return this._onAck(rq);
      case 'BYE':     return this._onBye(rq);
      case 'CANCEL':  return this._onCancel(rq);
      case 'OPTIONS': return sip.send(sip.makeResponse(rq, 200, 'OK'));
      default:        return sip.send(sip.makeResponse(rq, 405, 'Method Not Allowed'));
    }
  }

  _onInvite(rq) {
    const caller = callerOf(rq);

    // Optional caller allow-list (match SIP user, case-insensitive substring)
    const allow = (this._cfg.allowFrom || '').trim().toLowerCase();
    if (allow && !caller.toLowerCase().includes(allow)) {
      console.log(`[SIP] Rejecting call from ${caller} (not in allowFrom "${this._cfg.allowFrom}")`);
      return sip.send(sip.makeResponse(rq, 403, 'Forbidden'));
    }

    // Busy if another call is already in progress
    if (this._call) {
      return sip.send(sip.makeResponse(rq, 486, 'Busy Here'));
    }

    const localTag = sip.generateBranch().slice(0, 12);
    const contact  = (rq.headers.contact && rq.headers.contact[0]) || rq.headers.from;
    this._call = {
      invite:       rq,
      caller,
      callId:       rq.headers['call-id'],
      since:        Date.now(),
      localTag,
      remoteTarget: contact.uri,
      localSeq:     1,
      answered:     false,
    };

    console.log(`[SIP] Incoming call from ${caller} (call-id ${this._call.callId})`);
    sip.send(sip.makeResponse(rq, 180, 'Ringing'));
    this._emitState('ringing');

    if (this._cfg.autoAnswer) this.answer();
  }

  _onAck() {
    if (this._call && this._call.answered) {
      this._emitState('in-call');
      console.log('[SIP] Call connected (ACK received)');
    }
  }

  _onBye(rq) {
    sip.send(sip.makeResponse(rq, 200, 'OK'));
    if (this._call) {
      console.log(`[SIP] Remote hung up (${this._call.caller})`);
      this._end();
    }
  }

  _onCancel(rq) {
    sip.send(sip.makeResponse(rq, 200, 'OK'));
    if (this._call && !this._call.answered) {
      // The matching INVITE must be answered 487
      sip.send(sip.makeResponse(this._call.invite, 487, 'Request Terminated'));
      console.log(`[SIP] Caller cancelled (${this._call.caller})`);
      this._end();
    }
  }

  _end() {
    this._emitState('ended');
    this._call = null;
    // Settle back to idle shortly after so the UI can show "ended" briefly
    setTimeout(() => {
      if (!this._call) this._emitState('idle');
    }, 1500);
  }

  // ── Actions invoked from the API / dashboard ─────────────────────────

  answer() {
    if (!this._call || this._call.answered) return false;
    const rs = sip.makeResponse(this._call.invite, 200, 'OK');
    rs.headers.to.params = rs.headers.to.params || {};
    rs.headers.to.params.tag = this._call.localTag;
    rs.headers.contact = [{ uri: `sip:lsh@${this._ip}:${this._cfg.port || 5060}` }];
    rs.headers['content-type'] = 'application/sdp';
    rs.content = inactiveSdp(this._ip);
    sip.send(rs);
    this._call.answered = true;
    console.log(`[SIP] Answered call from ${this._call.caller}`);
    this._emitState('in-call');
    return true;
  }

  reject() {
    if (!this._call) return false;
    if (this._call.answered) return this.hangup();
    sip.send(sip.makeResponse(this._call.invite, 486, 'Busy Here'));
    console.log(`[SIP] Declined call from ${this._call.caller}`);
    this._end();
    return true;
  }

  hangup() {
    if (!this._call) return false;
    if (!this._call.answered) return this.reject();

    const dlg = this._call;
    const bye = {
      method: 'BYE',
      uri:    dlg.remoteTarget,
      headers: {
        to:        dlg.invite.headers.from,
        from:      { ...dlg.invite.headers.to, params: { tag: dlg.localTag } },
        'call-id': dlg.callId,
        cseq:      { method: 'BYE', seq: ++dlg.localSeq },
        via:       [],
      },
    };
    try { sip.send(bye); } catch (err) { console.error(`[SIP] BYE failed: ${err.message}`); }
    console.log(`[SIP] Hung up call with ${dlg.caller}`);
    this._end();
    return true;
  }

  async openDoor() {
    if (typeof this._onOpenDoor !== 'function') {
      throw new Error('No door relay configured');
    }
    await this._onOpenDoor();
    console.log('[SIP] Door opened');
    return true;
  }
}

module.exports = SipServer;
