'use strict';

const { spawn } = require('child_process');
const dgram    = require('dgram');
const fs       = require('fs');
const os       = require('os');
const path     = require('path');
const {
  CameraController,
  SRTPCryptoSuites,
  H264Profile,
  H264Level,
  StreamRequestTypes,
  AudioStreamingCodecType,
  AudioStreamingSamplerate,
} = require('hap-nodejs');
const { RTSPBackchannel } = require('./rtsp-backchannel');

// Per-camera, not a shared constant: twoWayAudio only applies to cameras
// that opt in (config.cameras[].twoWayAudio), and hap-nodejs reads it at
// CameraController construction time to decide whether to also add the
// Speaker service (see CameraController.js: `if (streamingOptions.audio.
// twoWayAudio) { this.speakerService = ... }`).
function buildStreamingOptions(twoWayAudio) {
  return {
    supportedCryptoSuites: [SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
    video: {
      resolutions: [
        [1920, 1080, 30],
        [1280,  720, 30],
        [ 640,  360, 30],
        [ 480,  270, 30],
        [ 320,  240, 15],
      ],
      codec: {
        profiles: [H264Profile.BASELINE, H264Profile.MAIN, H264Profile.HIGH],
        levels:   [H264Level.LEVEL3_1,   H264Level.LEVEL3_2, H264Level.LEVEL4_0],
      },
    },
    // Opus, not AAC-ELD — this ffmpeg build has libopus but not libfdk_aac
    // (AAC-ELD needs the latter; plain ffmpeg AAC doesn't support the ELD
    // profile HomeKit requires). hap-nodejs's own comment confirms iOS
    // currently only accepts these two codecs.
    audio: {
      twoWayAudio,
      codecs: [
        { type: AudioStreamingCodecType.OPUS, samplerate: [AudioStreamingSamplerate.KHZ_16, AudioStreamingSamplerate.KHZ_24] },
      ],
    },
  };
}

// Binds to an OS-assigned free UDP port, then releases it — the standard
// (small-race-window, community-accepted) technique ffmpeg-based HomeKit
// camera bridges use to learn a free port before ffmpeg itself binds it a
// moment later.
function getFreeUDPPort() {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    sock.once('error', reject);
    sock.bind(0, () => {
      const { port } = sock.address();
      sock.close(() => resolve(port));
    });
  });
}

class CameraDelegate {
  constructor(cam) {
    this.cam       = cam;
    this._sessions = new Map();
  }

  // ── Snapshot ──────────────────────────────────────────────

  async handleSnapshotRequest(_request, callback) {
    // Prefer a direct fetch function (used by UniFi Protect cameras)
    if (typeof this.cam.fetchSnapshot === 'function') {
      try {
        callback(undefined, await this.cam.fetchSnapshot());
      } catch (err) {
        console.error(`[HomeKit Cam] Snapshot failed (${this.cam.name}):`, err.message);
        callback(err);
      }
      return;
    }

    const url = this.cam.snapshotUrl;
    if (!url) {
      callback(new Error('No snapshot URL configured'));
      return;
    }
    try {
      const res = await fetch(`${url}?_=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      callback(undefined, Buffer.from(await res.arrayBuffer()));
    } catch (err) {
      console.error(`[HomeKit Cam] Snapshot failed (${this.cam.name}):`, err.message);
      callback(err);
    }
  }

  // ── Stream prepare ────────────────────────────────────────

  async prepareStream(request, callback) {
    const videoSSRC = CameraController.generateSynchronisationSource();
    const audioSSRC = CameraController.generateSynchronisationSource();

    // For two-way audio, the port we hand back below is where the
    // *controller* will actually send its own outgoing (microphone) SRTP
    // audio — echoing back request.audio.port (the controller's own port)
    // would be wrong here, unlike video/one-way audio where our own
    // receiving port is never used for anything. See
    // RTPStreamManagement.js's generateSetupEndpointResponse: the response
    // port becomes the ACCESSORY_ADDRESS's AUDIO_RTP_PORT sent to the
    // controller.
    let localAudioPort = request.audio.port;
    if (this.cam.twoWayAudio) {
      try {
        localAudioPort = await getFreeUDPPort();
      } catch (err) {
        console.error(`[HomeKit Cam] Could not allocate a local audio port (${this.cam.name}), falling back to one-way: ${err.message}`);
      }
    }

    this._sessions.set(request.sessionID, {
      targetAddress: request.targetAddress,
      videoPort:     request.video.port,
      videoSRTPKey:  Buffer.concat([request.video.srtp_key, request.video.srtp_salt]),
      videoSSRC,
      audioPort:     request.audio.port,
      audioSRTPKey:  Buffer.concat([request.audio.srtp_key, request.audio.srtp_salt]),
      audioSSRC,
      localAudioPort,
      ffmpeg:        null,
      backchannelRTSP:   null,
      backchannelFfmpeg: null,
      backchannelSdpFile: null,
    });

    // hap-nodejs calls this as (error, response) — a single-argument call
    // gets read as a truthy, message-less "error", so the whole prepare
    // request silently fails and _startStream never runs. See
    // RTPStreamManagement.js: `if (error || !response) { ... }`.
    callback(undefined, {
      video: { port: request.video.port, ssrc: videoSSRC, srtp_key: request.video.srtp_key, srtp_salt: request.video.srtp_salt },
      audio: { port: localAudioPort, ssrc: audioSSRC, srtp_key: request.audio.srtp_key, srtp_salt: request.audio.srtp_salt },
    });
  }

  // ── Stream start/reconfigure/stop ─────────────────────────

  handleStreamRequest(request, callback) {
    switch (request.type) {
      case StreamRequestTypes.START: {
        const session = this._sessions.get(request.sessionID);
        if (session) this._startStream(session, request.video, request.audio);
        callback();
        break;
      }
      case StreamRequestTypes.RECONFIGURE:
        callback();
        break;
      case StreamRequestTypes.STOP:
        this._stopStream(request.sessionID);
        callback();
        break;
      default:
        callback();
    }
  }

  // ── ffmpeg ────────────────────────────────────────────────

  _startStream(session, videoInfo, audioInfo) {
    if (!this.cam.url) {
      console.warn(`[HomeKit Cam] No RTSP URL for ${this.cam.name} — snapshot only`);
      return;
    }

    const { targetAddress, videoPort, videoSSRC, videoSRTPKey, audioPort, audioSSRC, audioSRTPKey } = session;
    const fps     = videoInfo?.fps          || 15;
    const bitrate = videoInfo?.max_bit_rate || 300;
    const width   = videoInfo?.width        || 1280;
    const height  = videoInfo?.height       || 720;

    // One ffmpeg process pulling the RTSP source once, with two independent
    // encode+output chains (-map picks which stream each one that follows
    // applies to) — rather than a second process re-pulling the same
    // source, which would double the load on it per viewing session.
    const args = [
      '-loglevel', 'error',
      '-rtsp_transport', 'tcp',
      '-i', this.cam.url,

      // ── video ──
      '-map', '0:v:0',
      // Scale to whatever resolution HomeKit actually negotiated — the
      // source camera's native resolution can exceed it (e.g. this stream
      // is 1920x1080), and encoding un-scaled at a fixed low H.264 level
      // silently fails: libx264 rejects the frame's macroblock count for
      // that level instead of erroring loudly.
      '-vf', `scale=${width}:${height}`,
      '-vcodec', 'libx264',
      '-profile:v', 'baseline',
      // 4.0 comfortably covers every resolution in STREAMING_OPTIONS
      // (up to 1920x1080), unlike the previous hardcoded 3.1.
      '-level:v', '4.0',
      '-b:v', `${bitrate}k`,
      '-bufsize', `${bitrate * 4}k`,
      '-maxrate', `${bitrate}k`,
      '-r', String(fps),
      '-g', String(fps * 2),
      '-pix_fmt', 'yuv420p',
      '-payload_type', '99',
      '-ssrc', String(videoSSRC),
      '-f', 'rtp',
      '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
      '-srtp_out_params', videoSRTPKey.toString('base64'),
      `srtp://${targetAddress}:${videoPort}?rtcpport=${videoPort}&pkt_size=1316`,
    ];

    // ── audio (only if the source has an audio track and negotiated OPUS —
    // the only codec STREAMING_OPTIONS declares) ──
    if (audioInfo?.codec === 'OPUS' && audioPort) {
      const audioBitrate = audioInfo.max_bit_rate || 24;
      args.push(
        '-map', '0:a:0?',
        '-acodec', 'libopus',
        '-ar', String((audioInfo.sample_rate || 24) * 1000),
        '-ac', '1',
        '-b:a', `${audioBitrate}k`,
        '-application', 'lowdelay',
        // 20ms is what virtually every HomeKit controller negotiates and
        // what every known working ffmpeg-based HomeKit camera bridge
        // hardcodes — safer than trusting audioInfo.packet_time exactly.
        '-frame_duration', '20',
        '-payload_type', String(audioInfo.pt),
        '-ssrc', String(audioSSRC),
        '-f', 'rtp',
        '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
        '-srtp_out_params', audioSRTPKey.toString('base64'),
        `srtp://${targetAddress}:${audioPort}?rtcpport=${audioPort}&pkt_size=188`,
      );
    }

    console.log(`[HomeKit Cam] Stream start: ${this.cam.name} → ${targetAddress}:${videoPort}${audioInfo?.codec === 'OPUS' ? ' (+audio)' : ''}`);
    const proc = spawn('ffmpeg', args);

    proc.stderr.on('data', (d) => {
      const msg = d.toString().trim();
      if (msg) console.error(`[HomeKit Cam] ffmpeg [${this.cam.name}]: ${msg}`);
    });
    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        console.error('[HomeKit Cam] ffmpeg not found — install ffmpeg for live streaming (snapshot still works)');
      } else {
        console.error(`[HomeKit Cam] ffmpeg error [${this.cam.name}]:`, err.message);
      }
    });
    proc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.warn(`[HomeKit Cam] ffmpeg exited [${this.cam.name}]: code ${code}`);
      }
    });

    session.ffmpeg = proc;

    if (this.cam.twoWayAudio && audioInfo?.codec === 'OPUS' && session.localAudioPort !== audioPort) {
      this._startBackchannel(session, audioInfo).catch((err) =>
        console.error(`[HomeKit Cam] Talk-back setup failed (${this.cam.name}): ${err.message}`));
    }
  }

  // ── Talk-back (two-way audio) ──────────────────────────────
  //
  // HomeKit's outgoing (microphone) audio arrives as SRTP/Opus on
  // session.localAudioPort. One ffmpeg process receives + decrypts + decodes
  // it (via a minimal SDP file describing that port/codec/crypto — ffmpeg's
  // RTSP input can't do this on its own, there's no live SRTP "input URL"
  // without first describing what's expected), transcodes to PCMU/8000
  // (matching tipc's backchannel SDP), and sends plain RTP straight to
  // tipc's backchannel port. A tiny RTSP client (rtsp-backchannel.js) does
  // nothing but the SETUP handshake needed to learn that port and keep the
  // session alive — see its header comment for the exact wire protocol.
  async _startBackchannel(session, audioInfo) {
    const host = new URL(this.cam.url).hostname;
    const rtsp = new RTSPBackchannel(this.cam.url, session.localAudioPort);
    const serverPort = await rtsp.connect();
    session.backchannelRTSP = rtsp;

    const sdp = [
      'v=0',
      'o=- 0 0 IN IP4 127.0.0.1',
      's=HomeKit Talk',
      'c=IN IP4 0.0.0.0',
      't=0 0',
      `m=audio ${session.localAudioPort} RTP/SAVP ${audioInfo.pt}`,
      `a=rtpmap:${audioInfo.pt} opus/48000/2`,
      `a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${session.audioSRTPKey.toString('base64')}`,
      '',
    ].join('\r\n');
    const tempSdp = path.join(os.tmpdir(), `homekit-talk-${session.audioSSRC}-${Date.now()}.sdp`);
    fs.writeFileSync(tempSdp, sdp);
    session.backchannelSdpFile = tempSdp;

    const args = [
      '-loglevel', 'error',
      '-protocol_whitelist', 'file,udp,rtp,crypto',
      '-f', 'sdp',
      '-i', tempSdp,
      '-acodec', 'pcm_mulaw',
      '-ar', '8000',
      '-ac', '1',
      '-f', 'rtp',
      `rtp://${host}:${serverPort}`,
    ];

    console.log(`[HomeKit Cam] Talk-back start: ${this.cam.name} (local:${session.localAudioPort} → tipc:${serverPort})`);
    const proc = spawn('ffmpeg', args);
    proc.stderr.on('data', (d) => {
      const msg = d.toString().trim();
      if (msg) console.error(`[HomeKit Cam] talk-back ffmpeg [${this.cam.name}]: ${msg}`);
    });
    proc.on('error', (err) => console.error(`[HomeKit Cam] talk-back ffmpeg error [${this.cam.name}]:`, err.message));
    session.backchannelFfmpeg = proc;
  }

  _stopStream(sessionID) {
    const session = this._sessions.get(sessionID);
    if (session?.ffmpeg) {
      session.ffmpeg.kill('SIGTERM');
      session.ffmpeg = null;
    }
    if (session?.backchannelFfmpeg) {
      session.backchannelFfmpeg.kill('SIGTERM');
      session.backchannelFfmpeg = null;
    }
    if (session?.backchannelRTSP) {
      session.backchannelRTSP.close();
      session.backchannelRTSP = null;
    }
    if (session?.backchannelSdpFile) {
      fs.unlink(session.backchannelSdpFile, () => {});
      session.backchannelSdpFile = null;
    }
    this._sessions.delete(sessionID);
  }

  forwardCloseConnection(sessionID) {
    this._stopStream(sessionID);
  }
}

module.exports = { CameraDelegate, buildStreamingOptions };
