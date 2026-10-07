'use strict';

// One JPEG frame off an RTSP stream via ffmpeg — shared by any camera source
// that only exposes RTSP (no vendor snapshot API), e.g. manual `cameras`
// entries and KENIK channels.

const { spawn } = require('child_process');

// Cloud-relayed streams (e.g. tuya-ipc-terminal, which opens a fresh WebRTC
// session per RTSP client) take ~11 s to deliver a first frame, so 12 s was
// timing out whenever a few grabs overlapped.
const SNAP_TIMEOUT = 25000;

// One ffmpeg per URL at a time: the dashboard, HomeKit and object detection
// often ask for the same camera at once — share the in-flight grab instead of
// opening N parallel upstream sessions.
const inFlight = new Map();

function grabFrame(rtspUrl, ffmpegPath = 'ffmpeg') {
  const key = `${ffmpegPath}\n${rtspUrl}`;
  if (inFlight.has(key)) return inFlight.get(key);
  const p = spawnGrab(rtspUrl, ffmpegPath).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

function spawnGrab(rtspUrl, ffmpegPath) {
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
