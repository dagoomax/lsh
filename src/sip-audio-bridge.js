'use strict';

/**
 * Bridges real audio for a single sip-server.js call, via ffmpeg — this repo
 * has no server-side WebRTC/DTLS-SRTP stack, so a low-latency WebRTC gateway
 * isn't realistic to build here; ffmpeg subprocess bridging (already the
 * pattern used elsewhere in this codebase, e.g. ffmpeg-rtsp.js) is the
 * pragmatic tradeoff. Expect noticeably higher latency than a phone call —
 * fine for "can I hear/talk to whoever's at the door", not for anything
 * time-sensitive.
 *
 * Two independent ffmpeg processes, one per direction:
 *   - "listen": reads PCMU RTP arriving on our local UDP port (described via
 *     a throwaway SDP file, since ffmpeg needs one to parse raw RTP input)
 *     and re-encodes it to a live MP3 stream served over ffmpeg's own HTTP
 *     listen socket. api-routes.js proxies that to the browser as a plain
 *     <audio> source.
 *   - "talk": reads WebM/Opus chunks written to stdin (fed live from the
 *     browser's MediaRecorder via POST /api/sip/talk) and re-encodes to PCMU
 *     RTP sent straight at the caller's SDP-advertised address.
 *
 * NOT YET VALIDATED against real SIP door-station hardware — built from
 * protocol/ffmpeg knowledge, not a live test. If audio doesn't come through
 * cleanly, the WebM→ffmpeg stdin chunking (talk direction) is the most
 * likely culprit — MediaRecorder's timeslice chunks aren't always cleanly
 * appendable depending on browser/codec, and may need a different bridging
 * approach (e.g. spawning a fresh short-lived ffmpeg per chunk instead of a
 * persistent stdin pipe).
 */

const { spawn } = require('child_process');
const fs        = require('fs');
const os        = require('os');
const path      = require('path');

class SipAudioBridge {
  constructor(ffmpegPath = 'ffmpeg') {
    this._ffmpegPath   = ffmpegPath;
    this._listenProc   = null;
    this._talkProc     = null;
    this._sdpFile      = null;
    this._listenPort   = null;
    this._httpPort     = null;
  }

  /**
   * @param {number} localRtpPort  UDP port we've bound for incoming RTP (caller → us)
   * @param {number} httpPort      local port ffmpeg serves the browser-facing MP3 stream on
   * @param {string} remoteHost    caller's RTP host, from their SDP offer
   * @param {number} remotePort    caller's RTP port, from their SDP offer
   */
  start(localRtpPort, httpPort, remoteHost, remotePort) {
    this._listenPort = localRtpPort;
    this._httpPort   = httpPort;

    this._sdpFile = path.join(os.tmpdir(), `sip-listen-${Date.now()}.sdp`);
    fs.writeFileSync(this._sdpFile, [
      'v=0',
      'o=- 0 0 IN IP4 127.0.0.1',
      's=-',
      'c=IN IP4 127.0.0.1',
      't=0 0',
      `m=audio ${localRtpPort} RTP/AVP 0`,
      'a=rtpmap:0 PCMU/8000',
      '',
    ].join('\r\n'));

    // Listen direction: RTP in (via SDP file) → live MP3 over HTTP.
    this._listenProc = spawn(this._ffmpegPath, [
      '-loglevel', 'error',
      '-protocol_whitelist', 'file,udp,rtp',
      '-i', this._sdpFile,
      '-f', 'mp3',
      '-listen', '1',
      `http://127.0.0.1:${httpPort}/`,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    this._listenProc.stderr.on('data', (d) => console.error(`[SIP Audio] listen: ${d}`.trim()));
    this._listenProc.on('exit', (code) => {
      if (code && code !== 255) console.error(`[SIP Audio] listen ffmpeg exited (${code})`);
      this._listenProc = null;
    });

    // Talk direction: WebM/Opus chunks on stdin → PCMU RTP out to the caller.
    this._talkProc = spawn(this._ffmpegPath, [
      '-loglevel', 'error',
      '-f', 'webm',
      '-i', 'pipe:0',
      '-acodec', 'pcm_mulaw',
      '-ar', '8000',
      '-ac', '1',
      '-f', 'rtp',
      `rtp://${remoteHost}:${remotePort}`,
    ], { stdio: ['pipe', 'ignore', 'pipe'] });
    this._talkProc.stderr.on('data', (d) => console.error(`[SIP Audio] talk: ${d}`.trim()));
    this._talkProc.stdin.on('error', () => {}); // browser stopped talking mid-chunk — harmless
    this._talkProc.on('exit', (code) => {
      if (code && code !== 255) console.error(`[SIP Audio] talk ffmpeg exited (${code})`);
      this._talkProc = null;
    });

    console.log(`[SIP Audio] Bridge started — listen :${httpPort}, talk → ${remoteHost}:${remotePort}`);
  }

  /** Feed a chunk of the browser's live MediaRecorder capture to the talk stream. */
  writeTalkChunk(buffer) {
    if (this._talkProc?.stdin.writable) this._talkProc.stdin.write(buffer);
  }

  /** Local port the browser should fetch the live listen stream from, or null if not running. */
  get httpPort() {
    return this._listenProc ? this._httpPort : null;
  }

  stop() {
    if (this._listenProc) { try { this._listenProc.kill(); } catch { /* already gone */ } this._listenProc = null; }
    if (this._talkProc)   { try { this._talkProc.stdin.end(); this._talkProc.kill(); } catch { /* already gone */ } this._talkProc = null; }
    if (this._sdpFile) { try { fs.unlinkSync(this._sdpFile); } catch { /* already gone */ } this._sdpFile = null; }
  }
}

module.exports = SipAudioBridge;
