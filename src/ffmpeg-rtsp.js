const { spawn, execSync } = require('child_process');

class FFmpegRTSP {
  constructor(config) {
    this._cameras    = (config.cameras || []).filter(c => c.url);
    this._basePort   = config.ffmpegRtsp?.basePort   || 8554;
    this._ffmpegPath = config.ffmpegRtsp?.ffmpegPath || 'ffmpeg';
    this._streams    = new Map(); // camName → { port, slug, proc, stopped }
  }

  start() {
    if (!this._cameras.length) {
      console.log('[FFmpegRTSP] No cameras with RTSP URLs — skipping');
      return;
    }
    try {
      execSync(`"${this._ffmpegPath}" -version`, { stdio: 'ignore' });
    } catch {
      console.error('[FFmpegRTSP] ffmpeg not found — install ffmpeg or set ffmpegRtsp.ffmpegPath in config');
      return;
    }

    this._cameras.forEach((cam, i) => {
      const port = this._basePort + i;
      const slug = (cam.name || `cam${i}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `cam${i}`;
      const info = { port, slug, proc: null, stopped: false };
      this._streams.set(cam.name, info);
      this._spawn(cam, info);
    });

    console.log(`[FFmpegRTSP] ${this._cameras.length} stream(s) listening from port ${this._basePort}`);
  }

  _spawn(cam, info) {
    if (info.stopped) return;

    const listenUrl = `rtsp://0.0.0.0:${info.port}/${info.slug}`;
    const args = [
      '-hide_banner', '-loglevel', 'warning',
      '-rtsp_transport', 'tcp',
      '-i', cam.url,
      '-c:v', 'copy', '-c:a', 'copy',
      '-f', 'rtsp',
      '-rtsp_transport', 'tcp',
      '-rtsp_flags', 'listen',
      listenUrl,
    ];

    const proc = spawn(this._ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    info.proc = proc;

    proc.stderr.on('data', d => {
      const msg = d.toString().trim();
      if (msg) console.log(`[FFmpegRTSP:${cam.name}] ${msg}`);
    });

    proc.on('exit', () => {
      info.proc = null;
      if (!info.stopped) setTimeout(() => this._spawn(cam, info), 2000);
    });
  }

  getStreams() {
    return this._cameras.map((cam, i) => {
      const info = this._streams.get(cam.name) || {};
      return {
        name:   cam.name,
        slug:   info.slug || '',
        port:   info.port || this._basePort + i,
        source: cam.url,
        active: !!info.proc,
      };
    });
  }

  stop() {
    for (const info of this._streams.values()) {
      info.stopped = true;
      info.proc?.kill('SIGTERM');
    }
    this._streams.clear();
  }
}

module.exports = FFmpegRTSP;
