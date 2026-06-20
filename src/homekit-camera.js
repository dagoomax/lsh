'use strict';

const { spawn } = require('child_process');
const {
  CameraController,
  SRTPCryptoSuites,
  H264Profile,
  H264Level,
  StreamRequestTypes,
} = require('hap-nodejs');

const STREAMING_OPTIONS = {
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
};

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

  prepareStream(request, callback) {
    const videoSSRC = CameraController.generateSynchronisationSource();
    const audioSSRC = CameraController.generateSynchronisationSource();

    this._sessions.set(request.sessionID, {
      targetAddress: request.targetAddress,
      videoPort:     request.video.port,
      videoSRTPKey:  Buffer.concat([request.video.srtp_key, request.video.srtp_salt]),
      videoSSRC,
      audioPort:     request.audio.port,
      audioSRTPKey:  Buffer.concat([request.audio.srtp_key, request.audio.srtp_salt]),
      audioSSRC,
      ffmpeg:        null,
    });

    callback({
      video: { port: request.video.port, ssrc: videoSSRC, srtp_key: request.video.srtp_key, srtp_salt: request.video.srtp_salt },
      audio: { port: request.audio.port, ssrc: audioSSRC, srtp_key: request.audio.srtp_key, srtp_salt: request.audio.srtp_salt },
    });
  }

  // ── Stream start/reconfigure/stop ─────────────────────────

  handleStreamRequest(request, callback) {
    switch (request.type) {
      case StreamRequestTypes.START: {
        const session = this._sessions.get(request.sessionID);
        if (session) this._startStream(session, request.video);
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

  _startStream(session, videoInfo) {
    if (!this.cam.url) {
      console.warn(`[HomeKit Cam] No RTSP URL for ${this.cam.name} — snapshot only`);
      return;
    }

    const { targetAddress, videoPort, videoSSRC, videoSRTPKey } = session;
    const fps     = videoInfo?.fps          || 15;
    const bitrate = videoInfo?.max_bit_rate || 300;

    const args = [
      '-loglevel', 'error',
      '-rtsp_transport', 'tcp',
      '-i', this.cam.url,
      '-an',
      '-vcodec', 'libx264',
      '-profile:v', 'baseline',
      '-level:v', '3.1',
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

    console.log(`[HomeKit Cam] Stream start: ${this.cam.name} → ${targetAddress}:${videoPort}`);
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
  }

  _stopStream(sessionID) {
    const session = this._sessions.get(sessionID);
    if (session?.ffmpeg) {
      session.ffmpeg.kill('SIGTERM');
      session.ffmpeg = null;
    }
    this._sessions.delete(sessionID);
  }

  forwardCloseConnection(sessionID) {
    this._stopStream(sessionID);
  }
}

module.exports = { CameraDelegate, STREAMING_OPTIONS };
