'use strict';

// The music hub's full-screen "now playing" on an Apple TV: a station that plays
// on an Apple TV is sent as video instead of plain AirPlay audio, so the TV
// shows what the dashboard shows in full screen — the cover on its blurred
// colours, station and song, a clock, and the spectrum bars along the bottom,
// moving with the music.
//
//   ffmpeg   decodes the stream once and renders both: the audio (AAC, with the
//            equalizer) and the picture (showfreqs → bars in the station's hue,
//            over a background made from the cover), as live HLS
//   HLS      served by a small HTTP server of its own on a random port, under a
//            random token per session — the Apple TV can't sign in to LSH, and
//            this way it works the same behind LSH's HTTPS / login
//   AirPlay  the TV is told to play that URL: pair-verify with the identity LSH
//            saved when the TV was paired (airplay-pairing.js), the encrypted
//            control channel, POST /play — as an iPhone sends a video
//
// Text (station, song) is drawn with ffmpeg's drawtext, when the ffmpeg build has
// it (libfreetype) and a font is found; without it the picture is the cover and
// the bars. A song change rewrites the text files ffmpeg re-reads; a new cover
// rewrites the background image it re-reads.

const net = require('net');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const bplist = require('bplist-creator');
const bparse = require('bplist-parser');

const W = 1280, H = 720, FPS = 25;
const BAND = Math.round(H * 0.38); // the visualizer band, as the dashboard's (38vh)
const BARS = 96;
const ART = 340, ART_X = 150, ART_Y = Math.round((H - H * 0.2 - ART) / 2); // .mfull-main: centred, 20vh padding below
const TEXT_X = ART_X + ART + 60;

// ── Apple TV control channel (AirPlay 2, HAP-encrypted) ──────────────────────
const hkdf = (ikm, salt, info) => Buffer.from(crypto.hkdfSync('sha512', ikm, Buffer.from(salt), Buffer.from(info), 32));
const edKey = (seed) => crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
const x25519Pub = (raw) => crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), raw]), format: 'der', type: 'spki' });
const tlv = (pairs) => Buffer.concat(pairs.flatMap(([t, v]) => {
  const out = [];
  for (let i = 0; i === 0 || i < v.length; i += 255) { const c = v.subarray(i, i + 255); out.push(Buffer.from([t, c.length]), c) }
  return out;
}));
function untlv(buf) {
  const r = {};
  for (let i = 0; i + 1 < buf.length; i += 2 + buf[i + 1]) r[buf[i]] = Buffer.concat([r[buf[i]] || Buffer.alloc(0), buf.subarray(i + 2, i + 2 + buf[i + 1])]);
  return r;
}
const labelNonce = (s) => Buffer.concat([Buffer.alloc(4), Buffer.from(s)]);
const counterNonce = (n) => { const b = Buffer.alloc(12); b.writeBigUInt64LE(BigInt(n), 4); return b };
function seal(key, nonce, data, aad) {
  const c = crypto.createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
  if (aad) c.setAAD(aad);
  return Buffer.concat([c.update(data), c.final(), c.getAuthTag()]);
}
function open(key, nonce, data, aad) {
  const d = crypto.createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
  if (aad) d.setAAD(aad);
  d.setAuthTag(data.subarray(-16));
  return Buffer.concat([d.update(data.subarray(0, -16)), d.final()]);
}

class TvLink {
  constructor(host, port, creds) {
    Object.assign(this, { host, port, creds });
    this.keys = null; this.wn = 0; this.rn = 0; this.cseq = 0;
    this.raw = Buffer.alloc(0); this.plain = Buffer.alloc(0);
    this.queue = []; // requests waiting for their response, in order
    this.sessionId = crypto.randomUUID().toUpperCase();
    this.onClose = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const sock = net.connect(this.port, this.host);
      this.sock = sock;
      sock.setTimeout(10000, () => sock.destroy(new Error('No answer from the Apple TV')));
      sock.once('connect', () => { sock.setTimeout(0); resolve() });
      sock.on('error', (err) => { reject(err); this._fail(err) });
      sock.on('close', () => { this._fail(new Error('Connection closed')); this.onClose?.() });
      sock.on('data', (d) => this._data(d));
    });
  }

  _data(d) {
    if (!this.keys) this.plain = Buffer.concat([this.plain, d]);
    else {
      this.raw = Buffer.concat([this.raw, d]);
      while (this.raw.length >= 2) {
        const n = this.raw.readUInt16LE(0);
        if (this.raw.length < 2 + n + 16) break;
        try { this.plain = Buffer.concat([this.plain, open(this.keys.read, counterNonce(this.rn++), this.raw.subarray(2, 2 + n + 16), this.raw.subarray(0, 2))]) }
        catch { this.sock.destroy(new Error('Couldn’t decrypt the Apple TV’s answer')); return }
        this.raw = this.raw.subarray(2 + n + 16);
      }
    }
    for (;;) {
      const i = this.plain.indexOf('\r\n\r\n');
      if (i < 0) return;
      const head = this.plain.subarray(0, i).toString();
      const len = Number(/content-length:\s*(\d+)/i.exec(head)?.[1] || 0);
      if (this.plain.length < i + 4 + len) return;
      const body = this.plain.subarray(i + 4, i + 4 + len);
      this.plain = this.plain.subarray(i + 4 + len);
      this.queue.shift()?.resolve({ status: Number(head.split(' ')[1]), body });
    }
  }

  _fail(err) { for (const q of this.queue.splice(0)) q.reject(err) }

  request(method, uri, headers = {}, body = Buffer.alloc(0), proto = 'RTSP/1.0') {
    if (!this.sock || this.sock.destroyed) return Promise.reject(new Error('Not connected'));
    const h = { CSeq: ++this.cseq, 'User-Agent': 'AirPlay/550.10', ...headers, 'Content-Length': body.length };
    const msg = Buffer.concat([Buffer.from(`${method} ${uri} ${proto}\r\n${Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`), body]);
    if (!this.keys) this.sock.write(msg);
    else {
      for (let o = 0; o < msg.length; o += 1024) {
        const c = msg.subarray(o, o + 1024), aad = Buffer.alloc(2);
        aad.writeUInt16LE(c.length);
        this.sock.write(Buffer.concat([aad, seal(this.keys.write, counterNonce(this.wn++), c, aad)]));
      }
    }
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${method} ${uri}: no answer`)), 10000);
      this.queue.push({ resolve: (r) => { clearTimeout(t); resolve(r) }, reject: (e) => { clearTimeout(t); reject(e) } });
    });
  }

  // HomeKit pair-verify with the saved identity → the control channel's keys
  async verify() {
    const c = this.creds;
    const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
    const mine = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
    const hk = { 'Content-Type': 'application/octet-stream', 'X-Apple-HKP': 3 };
    const r1 = await this.request('POST', '/pair-verify', hk, tlv([[6, Buffer.from([1])], [3, mine]]));
    const m2 = untlv(r1.body);
    if (r1.status !== 200 || !m2[3] || !m2[5]) throw new Error(`pair-verify refused (${r1.status})`);
    const shared = crypto.diffieHellman({ privateKey, publicKey: x25519Pub(m2[3]) });
    const key = hkdf(shared, 'Pair-Verify-Encrypt-Salt', 'Pair-Verify-Encrypt-Info');
    try { open(key, labelNonce('PV-Msg02'), m2[5]) } catch { throw new Error('pair-verify: the Apple TV’s answer doesn’t check out') }
    const sig = crypto.sign(null, Buffer.concat([mine, Buffer.from(c.pairingId), m2[3]]), edKey(Buffer.from(c.privateKey, 'hex')));
    const r2 = await this.request('POST', '/pair-verify', hk, tlv([[6, Buffer.from([3])], [5, seal(key, labelNonce('PV-Msg03'), tlv([[1, Buffer.from(c.pairingId)], [10, sig]]))]]));
    if (r2.status !== 200 || untlv(r2.body)[7]) throw new Error('The Apple TV didn’t accept LSH’s pairing — pair it again in Settings → Media → AirPlay Speakers');
    this.keys = { write: hkdf(shared, 'Control-Salt', 'Control-Write-Encryption-Key'), read: hkdf(shared, 'Control-Salt', 'Control-Read-Encryption-Key') };
  }

  // a remote-control session (as an iPhone opens before sending a video), then /play
  async play(url) {
    const uri = `rtsp://${this.localAddress}/${this.sessionId}`;
    const r = await this.request('SETUP', uri, { 'Content-Type': 'application/x-apple-binary-plist' }, bplist({
      isRemoteControlOnly: true, timingProtocol: 'None', sessionUUID: this.sessionId, name: 'LSH',
      deviceID: 'AA:BB:CC:00:15:50', macAddress: 'AA:BB:CC:00:15:50', model: 'iPhone10,6', osName: 'iPhone OS', osVersion: '14.2', osBuildVersion: '18B92', sourceVersion: '550.10',
    }));
    let eventPort = 0;
    try { eventPort = bparse.parseBuffer(r.body)[0]?.eventPort || 0 } catch { /* none */ }
    // the TV sends playback events there; keeping it open is all it asks
    if (eventPort) { this.events = net.connect(eventPort, this.host); this.events.on('error', () => {}) }
    await this.request('RECORD', uri);
    const res = await this.request('POST', '/play', { 'X-Apple-Session-ID': this.sessionId, 'X-Apple-Stream-ID': 1, 'Content-Type': 'application/x-apple-binary-plist' }, bplist({
      'Content-Location': url, 'Start-Position-Seconds': 0, uuid: crypto.randomUUID().toUpperCase(), streamType: 1, mediaType: 'file',
      volume: 1, rate: 1, playbackRestrictions: 0, referenceRestrictions: 3, mightSupportStorePastisKeys: true,
      secureConnectionMs: 22, infoMs: 122, connectMs: 18, authMs: 0, bonjourMs: 0, postAuthMs: 0,
      SenderMACAddress: 'AA:BB:CC:00:15:50', model: 'iPhone10,6', clientProcName: 'LSH', osBuildVersion: '18B92',
    }), 'HTTP/1.1');
    if (res.status !== 200) throw new Error(`The Apple TV refused the video (${res.status})`);
    // keep-alive, as AirPlay 2 senders do; a dead connection ends the session
    this.alive = setInterval(() => this.request('POST', '/feedback').catch(() => {}), 2000);
    this.alive.unref?.();
  }

  // AirPlay volume: −30 dB … 0 dB, −144 = silent
  setVolume(v) {
    const db = v <= 0 ? -144 : -30 + (30 * Math.min(100, v)) / 100;
    return this.request('SET_PARAMETER', `rtsp://${this.localAddress}/${this.sessionId}`, { 'Content-Type': 'text/parameters' }, Buffer.from(`volume: ${db.toFixed(6)}\r\n`));
  }

  get localAddress() { return String(this.sock?.localAddress || '').replace(/^::ffff:/, '') }

  async close() {
    clearInterval(this.alive);
    this.onClose = null;
    if (this.sock && !this.sock.destroyed) {
      await this.request('POST', '/stop', { 'X-Apple-Session-ID': this.sessionId }, Buffer.alloc(0), 'HTTP/1.1').catch(() => {});
      this.sock.destroy();
    }
    this.events?.destroy();
  }
}

// ── HLS server: one, on a random port, while any session runs ────────────────
const dirs = new Map(); // token → directory
let server = null, serverPort = 0;
async function serve(token, dir) {
  dirs.set(token, dir);
  if (!server) {
    server = http.createServer((req, res) => {
      const m = /^\/([0-9a-f]{32})\/([\w.-]+\.(m3u8|ts))$/.exec(req.url.split('?')[0]);
      const d = m && dirs.get(m[1]);
      if (!d) { res.writeHead(404).end(); return }
      fs.readFile(path.join(d, m[2]), (err, buf) => {
        if (err) { res.writeHead(404).end(); return }
        res.writeHead(200, { 'Content-Type': m[3] === 'm3u8' ? 'application/vnd.apple.mpegurl' : 'video/mp2t', 'Cache-Control': 'no-cache', 'Content-Length': buf.length }).end(buf);
      });
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, () => { serverPort = server.address().port; resolve() }) });
  }
  return serverPort;
}
function unserve(token) {
  dirs.delete(token);
  if (!dirs.size && server) { server.close(); server = null }
}

// ── What this ffmpeg can draw ─────────────────────────────────────────────────
let drawtext = null;
function hasDrawtext() {
  if (drawtext === null) {
    try { drawtext = / drawtext /.test(execFileSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) } catch { drawtext = false }
  }
  return drawtext;
}
const FONTS = [
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'],
  ['/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'],
  ['/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf'],
];
function fonts(custom) {
  if (custom?.bold && custom?.regular) return custom;
  const f = FONTS.find(([b, r]) => fs.existsSync(b) && fs.existsSync(r));
  return f ? { bold: f[0], regular: f[1] } : null;
}

// ── Pictures ──────────────────────────────────────────────────────────────────
// the station's hue, as the dashboard picks it (MusicHub.jsx hueOf)
function hueOf(s) { let h = 0; for (const ch of String(s || '')) h = (h * 31 + ch.codePointAt(0)) % 360; return h }
// hsl → 0xRRGGBB
function hsl(h, s, l) {
  s /= 100; l /= 100;
  const f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)))) };
  return `0x${[f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

function ffmpegOnce(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d });
    const t = setTimeout(() => p.kill('SIGKILL'), 15000);
    p.on('error', (e) => { clearTimeout(t); reject(e) });
    p.on('close', (code) => { clearTimeout(t); code === 0 ? resolve() : reject(new Error(err.trim().split('\n').pop() || `ffmpeg exited ${code}`)) });
  });
}

// the still part: the cover blurred over the screen, the cover itself with
// rounded corners (or a dark screen in the station's colour, without one) →
// written next to the file ffmpeg reads, then moved over it
async function background(file, cover, hue) {
  const tmp = `${file}.new.jpg`;
  const R = 22;
  const round = `format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(min(X,W-1-X),${R})*lt(min(Y,H-1-Y),${R}),if(lte(hypot(${R}-min(X,W-1-X),${R}-min(Y,H-1-Y)),${R}),255,0),255)'`;
  if (cover) {
    const src = `${file}.cover.jpg`;
    fs.writeFileSync(src, cover);
    await ffmpegOnce(['-i', src, '-filter_complex',
      `[0]split[a][b];[a]scale=${W}:${W},crop=${W}:${H},gblur=sigma=80,eq=brightness=-0.3:saturation=1.4,vignette=angle=PI/3.2[bg];`
      + `[b]scale=${ART}:${ART}:flags=lanczos,${round}[art];[bg][art]overlay=${ART_X}:${ART_Y},format=yuvj420p`,
      '-frames:v', '1', '-q:v', '3', tmp]);
    fs.rmSync(src, { force: true });
  } else {
    await ffmpegOnce(['-f', 'lavfi', '-i', `color=c=0x07070a:s=${W}x${H}`, '-f', 'lavfi', '-i', `color=c=0x1c1c22:s=${ART}x${ART}`, '-filter_complex',
      `[0]drawbox=c=${hsl(hue, 75, 20)}@0.35:t=fill,vignette=angle=PI/3[bg];[1]${round}[art];[bg][art]overlay=${ART_X}:${ART_Y},format=yuvj420p`,
      '-frames:v', '1', '-q:v', '3', tmp]);
  }
  fs.renameSync(tmp, file);
}

// one line of text that fits, for drawtext — files are re-read each second,
// replaced whole so ffmpeg never reads half of one
function writeText(file, text) {
  fs.writeFileSync(`${file}.new`, text);
  fs.renameSync(`${file}.new`, file);
}
const fit = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

// ── A session: render + serve + play ──────────────────────────────────────────
// opts: { host, port, creds, source (stream URL or file), title, where, eq (ffmpeg
// filter string or ''), volume, fonts?, onEnd(err) }
async function start(opts) {
  const token = crypto.randomBytes(16).toString('hex');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsh-tv-'));
  const files = { bg: path.join(dir, 'bg.jpg'), where: path.join(dir, 'where.txt'), title: path.join(dir, 'title.txt'), sub: path.join(dir, 'sub.txt') };
  const hue = hueOf(opts.title);
  const font = hasDrawtext() ? fonts(opts.fonts) : null;
  let ffmpeg = null, link = null, ended = false;
  const state = { meta: null, coverKey: null };

  const end = (err) => {
    if (ended) return;
    ended = true;
    try { ffmpeg?.kill('SIGKILL') } catch { /* gone */ }
    link?.close().catch(() => {});
    unserve(token);
    fs.rm(dir, { recursive: true, force: true }, () => {});
    opts.onEnd?.(err || null);
  };

  const setText = (meta) => {
    const m = meta || {};
    const song = m.artist && m.title && m.album ? m.title : '';
    writeText(files.where, fit(opts.where || '', 48).toUpperCase());
    writeText(files.title, fit(song || m.album || m.title || opts.title || '', 30));
    writeText(files.sub, fit(song ? [m.artist, m.album].filter(Boolean).join(' · ') : '', 52));
  };

  try {
    await background(files.bg, null, hue);
    setText(null);
    const port = await serve(token, dir);

    // the picture: bars from the spectrum (24 kHz → up to 12 kHz, like the dashboard's),
    // BARS wide then stretched, cut into bars by a comb, coloured by a gradient
    // through the station's hue, over the background; text and clock on top
    const isUrl = /^https?:\/\//i.test(opts.source);
    const grad = `color=c=black:s=${W}x${BAND}:d=0.04,format=rgb24,geq=r='${gradExpr(hue, 0)}':g='${gradExpr(hue, 8)}':b='${gradExpr(hue, 4)}',loop=loop=-1:size=1,fps=${FPS}`;
    const comb = `color=c=black:s=${W}x${BAND}:d=0.04,format=gray,geq=lum='if(lt(mod(X\\,${W / BARS * 2})\\,${W / BARS * 2 - 4})\\,217\\,0)',loop=loop=-1:size=1,fps=${FPS}`;
    const text = font ? [
      `drawtext=fontfile='${font.regular}':text='%{localtime\\:%R}':fontsize=30:fontcolor=white@0.8:x=40:y=34`,
      `drawtext=fontfile='${font.bold}':textfile='${files.where}':reload=${FPS}:fontsize=20:fontcolor=${hsl(hue, 75, 62)}:x=${TEXT_X}:y=${ART_Y + 70}`,
      `drawtext=fontfile='${font.bold}':textfile='${files.title}':reload=${FPS}:fontsize=54:fontcolor=white:x=${TEXT_X}:y=${ART_Y + 108}:shadowcolor=black@0.5:shadowy=2`,
      `drawtext=fontfile='${font.regular}':textfile='${files.sub}':reload=${FPS}:fontsize=28:fontcolor=white@0.72:x=${TEXT_X}:y=${ART_Y + 186}`,
    ].join(',') : 'null';
    const graph = [
      `[0:a]${opts.eq ? `${opts.eq},` : ''}aresample=44100,asplit=2[aout][av]`,
      // log levels drawn twice as tall, the top half kept: −60…0 dB, so the bars move like the dashboard's
      `[av]aresample=24000,showfreqs=s=${BARS / 2}x${BAND * 2}:mode=bar:ascale=log:fscale=log:win_size=1024:averaging=2:colors=white,fps=${FPS},format=gray,crop=${BARS / 2}:${BAND}:0:0,scale=${W}:${BAND}:flags=neighbor[spec]`,
      `${comb}[comb]`, `[spec][comb]blend=all_mode=multiply[mask]`,
      `${grad}[grad]`, `[grad][mask]alphamerge[bars]`,
      `[1:v]fps=${FPS},scale=${W}:${H},format=yuv420p[bg]`,
      `[bg][bars]overlay=0:${H - BAND}:shortest=0,${text},format=yuv420p[vout]`,
    ].join(';');
    ffmpeg = spawn('ffmpeg', [
      '-loglevel', 'error',
      ...(isUrl ? ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5'] : ['-re']), '-i', opts.source,
      '-re', '-loop', '1', '-framerate', '1', '-f', 'image2', '-i', files.bg,
      '-filter_complex', graph, '-map', '[vout]', '-map', '[aout]',
      '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
      '-g', String(FPS * 2), '-keyint_min', String(FPS * 2), '-sc_threshold', '0', '-b:v', '2500k', '-maxrate', '3000k', '-bufsize', '3000k',
      '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2',
      '-f', 'hls', '-hls_time', '2', '-hls_list_size', '6', '-hls_flags', 'delete_segments+independent_segments+omit_endlist',
      path.join(dir, 'index.m3u8'),
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    ffmpeg.stderr.on('data', (d) => console.warn(`[AirPlay TV] ffmpeg: ${d.toString().trim()}`));
    ffmpeg.on('error', (err) => end(new Error(`ffmpeg failed to start: ${err.message}`)));
    ffmpeg.on('close', (code) => end(code && !ended ? new Error(`ffmpeg exited with code ${code}`) : null));

    // the TV starts at the live edge: wait for a few segments first
    await waitFor(() => ended || /(#EXTINF[\s\S]*){3}/.test(readOr(path.join(dir, 'index.m3u8'))), 25000, 'The video didn’t start (no stream?)');
    if (ended) throw new Error('The video stopped before it started');

    link = new TvLink(opts.host, opts.port || 7000, opts.creds);
    await link.connect();
    link.onClose = () => end(new Error('The Apple TV closed the connection'));
    await link.verify();
    await link.play(`http://${link.localAddress}:${port}/${token}/index.m3u8`);
    if (opts.volume != null) link.setVolume(opts.volume).catch(() => {});
  } catch (err) {
    end(err);
    throw err;
  }

  return {
    stop: () => end(),
    setVolume: (v) => link?.setVolume(v).catch(() => {}),
    // new song → the text; new cover → the background
    setMeta: (meta) => {
      if (ended) return;
      state.meta = meta;
      try { setText(meta) } catch { /* ending */ }
      const key = meta?.cover?.data ? crypto.createHash('sha1').update(meta.cover.data).digest('hex') : null;
      if (key && key !== state.coverKey) {
        state.coverKey = key;
        background(files.bg, meta.cover.data, hue).catch((err) => console.warn(`[AirPlay TV] cover: ${err.message}`));
      }
    },
  };
}

// a channel of the bar gradient: the dashboard's hsla(hue + x/W·70, 75%, 60%), per pixel
function gradExpr(hue, n) {
  const h = `(${hue}+X/W*70)`;
  // hsl → rgb channel n (0 r, 8 g, 4 b), s .75, l .6: a = .75·min(.6, .4) = .3
  return `255*(0.6-0.3*max(-1\\,min(min(mod(${n}+${h}/30\\,12)-3\\,9-mod(${n}+${h}/30\\,12))\\,1)))`;
}

function readOr(file) { try { return fs.readFileSync(file, 'utf8') } catch { return '' } }
function waitFor(test, ms, msg) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (test()) { clearInterval(iv); resolve() } else if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error(msg)) }
    }, 300);
  });
}

// Is this receiver an Apple TV? (GET /info — unencrypted, a plist with `model`)
const models = new Map(); // host → model
async function model(host, port = 7000) {
  if (models.has(host)) return models.get(host);
  try {
    const res = await fetch(`http://${host}:${port}/info`, { signal: AbortSignal.timeout(3000) });
    const m = bparse.parseBuffer(Buffer.from(await res.arrayBuffer()))[0]?.model || null;
    models.set(host, m);
    return m;
  } catch { return null }
}
const isAppleTv = async (host, port) => /^AppleTV/i.test((await model(host, port)) || '');

module.exports = { start, isAppleTv, hasDrawtext, hueOf };
