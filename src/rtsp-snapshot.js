'use strict';

// One JPEG frame off an RTSP stream via ffmpeg — shared by any camera source
// that only exposes RTSP (no vendor snapshot API), e.g. manual `cameras`
// entries and KENIK channels.

const { spawn } = require('child_process');

const SNAP_TIMEOUT = 12000;

function grabFrame(rtspUrl, ffmpegPath = 'ffmpeg') {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-rtsp_transport', 'tcp', '-i', rtspUrl,
      '-frames:v', '1', '-q:v', '4', '-f', 'image2', 'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'ignore'] });

    const chunks = [];
    const timer  = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('ffmpeg timeout')); }, SNAP_TIMEOUT);
    proc.stdout.on('data', (c) => chunks.push(c));
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      const buffer = Buffer.concat(chunks);
      if (code === 0 && buffer.length) resolve(buffer);
      else reject(new Error(`ffmpeg exited ${code}, ${buffer.length} bytes`));
    });
  });
}

module.exports = { grabFrame };
