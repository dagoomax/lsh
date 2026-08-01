'use strict';

// Minimal RTSP client for exactly one thing: setting up a camera's
// "backchannel" (client-to-server) audio track and finding out what UDP
// port the server wants that audio sent to. Not a general RTSP client —
// tipc's server (pkg/rtsp/protocol.go) ties webrtcBridge creation to
// whichever request establishes the stream, and reuses the same
// CameraStream (and its webrtcBridge) across connections keyed by
// camera+resolution, so this can run as its own independent connection
// alongside the video/audio one ffmpeg holds — no need to interleave with
// that stream's own RTSP session.
//
// Wire protocol, matching tipc's handleSetup/handlePlay:
//   OPTIONS <baseUrl>            — triggers findCamera()/stream creation
//   SETUP <baseUrl>/audio        — throwaway, unused: RTPForwarder.
//                                  SetupUDPBackchannel requires the session
//                                  to already be registered via AddUDPClient,
//                                  which only happens on a video/audio
//                                  SETUP (forwarder.go) — a backchannel-only
//                                  session doesn't satisfy it on its own.
//                                  Points at a port nobody listens on; tipc
//                                  just sends into the void, harmlessly.
//   SETUP <baseUrl>/backchannel  — Transport: RTP/AVP;unicast;client_port=P-P+1
//                                  response Transport carries server_port=X-Y
//   PLAY <baseUrl>               — formality; SETUP alone already activates
//                                  forwarding server-side (OnBackchannelAudio
//                                  fires as soon as packets arrive)
//   OPTIONS (Session: ...)       — keepalive, tipc's SETUP grants ;timeout=60

const net = require('net');

const KEEPALIVE_MS = 25_000; // well under the server's 60s Session timeout

class RTSPBackchannel {
  constructor(rtspUrl, localRtpPort) {
    const u = new URL(rtspUrl);
    this._host = u.hostname;
    this._port = Number(u.port) || 554;
    this._baseUrl = rtspUrl;
    this._localRtpPort = localRtpPort;
    this._cseq = 1;
    this._session = null;
    this._socket = null;
    this._buf = '';
    this._pending = null; // {resolve, reject} for the in-flight request
    this._keepaliveTimer = null;
  }

  // Resolves with the server's backchannel RTP port once SETUP + PLAY succeed.
  async connect() {
    await new Promise((resolve, reject) => {
      this._socket = net.createConnection({ host: this._host, port: this._port }, resolve);
      this._socket.once('error', reject);
    });
    this._socket.setEncoding('utf8');
    this._socket.on('data', (d) => this._onData(d));
    this._socket.on('error', () => {}); // surfaced via the pending request's rejection instead
    this._socket.on('close', () => this._stopKeepalive());

    await this._request('OPTIONS', this._baseUrl);

    // Throwaway audio SETUP — see the wire-protocol note above. Port is
    // never bound/listened on; tipc sending into it is harmless.
    await this._request('SETUP', `${this._baseUrl}/audio`, {
      Transport: `RTP/AVP;unicast;client_port=${this._localRtpPort + 2}-${this._localRtpPort + 3}`,
    });

    const setupRes = await this._request('SETUP', `${this._baseUrl}/backchannel`, {
      Transport: `RTP/AVP;unicast;client_port=${this._localRtpPort}-${this._localRtpPort + 1}`,
    });
    this._session = (setupRes.headers['session'] || '').split(';')[0].trim();
    if (!this._session) throw new Error('SETUP response had no Session header');

    const transport = setupRes.headers['transport'] || '';
    const m = transport.match(/server_port=(\d+)-(\d+)/);
    if (!m) throw new Error(`SETUP response had no server_port (transport: "${transport}")`);
    const serverRtpPort = Number(m[1]);

    await this._request('PLAY', this._baseUrl, { Session: this._session });

    this._keepaliveTimer = setInterval(() => {
      this._request('OPTIONS', this._baseUrl, { Session: this._session }).catch(() => {});
    }, KEEPALIVE_MS);

    return serverRtpPort;
  }

  close() {
    this._stopKeepalive();
    if (this._session) {
      this._request('TEARDOWN', this._baseUrl, { Session: this._session }).catch(() => {});
    }
    this._socket?.destroy();
    this._socket = null;
  }

  _stopKeepalive() {
    if (this._keepaliveTimer) clearInterval(this._keepaliveTimer);
    this._keepaliveTimer = null;
  }

  _request(method, url, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
      const cseq = this._cseq++;
      const headers = { CSeq: String(cseq), ...extraHeaders };
      const lines = [`${method} ${url} RTSP/1.0`, ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`), '', ''];
      this._pending = { resolve, reject };
      this._socket.write(lines.join('\r\n'));
    });
  }

  _onData(chunk) {
    this._buf += chunk;
    const end = this._buf.indexOf('\r\n\r\n');
    if (end === -1) return;

    const head = this._buf.slice(0, end);
    this._buf = this._buf.slice(end + 4); // any response body (none of ours have one) stays unparsed — fine, unused

    const lines = head.split('\r\n');
    const statusMatch = lines[0].match(/^RTSP\/1\.0 (\d+) (.*)$/);
    const headers = {};
    for (const line of lines.slice(1)) {
      const i = line.indexOf(':');
      if (i === -1) continue;
      headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }

    const pending = this._pending;
    this._pending = null;
    if (!pending) return;

    const status = statusMatch ? Number(statusMatch[1]) : 0;
    if (status >= 200 && status < 300) {
      pending.resolve({ status, headers });
    } else {
      pending.reject(new Error(`RTSP ${status || '?'}: ${statusMatch?.[2] || 'malformed response'}`));
    }
  }
}

module.exports = { RTSPBackchannel };
