'use strict';

// Device manuals, kept in a private GitHub repo (default dagoomax/lsh-manuals)
// and downloaded on demand: the index (index.json) is fetched when the list is
// opened, a PDF only when someone opens it. Each PDF is checked against the
// SHA-256 in the index and cached in persist/manuals/ (override with
// LSH_MANUALS_DIR) — after that it's served locally, offline too.
//
// config.manuals = { repo = 'dagoomax/lsh-manuals', ref = 'main', githubToken }
// The token (fine-grained, Contents: read-only on that repo) falls back to
// config.modules.githubToken / GITHUB_TOKEN.

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const DIR = process.env.LSH_MANUALS_DIR || path.join(__dirname, '..', 'persist', 'manuals');
const INDEX_TTL_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 60 * 1000;

let indexCache = null; // { at, data }

function settings(config) {
  const m = config.manuals || {};
  return {
    repo: m.repo || 'dagoomax/lsh-manuals',
    ref: m.ref || 'main',
    token: m.githubToken || config.modules?.githubToken || process.env.GITHUB_TOKEN || null,
  };
}

function githubRaw(repo, ref, file, token) {
  const apiPath = `/repos/${repo}/contents/${file.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`;
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'LSH-manuals', Accept: 'application/vnd.github.raw+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const req = https.get({ host: 'api.github.com', path: apiPath, headers, timeout: TIMEOUT_MS }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        if (res.statusCode === 200) return resolve(body);
        const e = new Error(
          res.statusCode === 404 || res.statusCode === 401
            ? (token ? `GitHub ${res.statusCode}: the token can't read ${repo} (needs Contents: read on that repo)` : `${repo} is private — add a GitHub token in Settings → Device manuals`)
            : `GitHub ${res.statusCode} fetching ${file}`);
        e.status = res.statusCode; e.auth = res.statusCode === 404 || res.statusCode === 401;
        reject(e);
      });
    });
    req.on('timeout', () => req.destroy(new Error('GitHub request timed out')));
    req.on('error', reject);
  });
}

const indexFile = () => path.join(DIR, 'index.json');

async function index(config, { refresh = false } = {}) {
  if (!refresh && indexCache && Date.now() - indexCache.at < INDEX_TTL_MS) return indexCache.data;
  const s = settings(config);
  try {
    const data = JSON.parse((await githubRaw(s.repo, s.ref, 'index.json', s.token)).toString('utf8'));
    if (!Array.isArray(data.manuals)) throw new Error('index.json has no manuals list');
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(indexFile(), JSON.stringify(data));
    indexCache = { at: Date.now(), data };
    return data;
  } catch (err) {
    // Offline / no token: fall back to the last index we saw
    try {
      const data = JSON.parse(fs.readFileSync(indexFile(), 'utf8'));
      return { ...data, stale: err.message };
    } catch { throw err }
  }
}

// Cached file name: <id><extension of the file in the repo> (ids are [a-z0-9-])
const extOf = (m) => (path.extname(m.file || '').toLowerCase().match(/^\.(pdf|png|jpg|jpeg|webp)$/) ? path.extname(m.file).toLowerCase() : '.pdf');
const cachePath = (m) => path.join(DIR, `${m.id}${extOf(m)}`);
const safeId = (id) => /^[a-z0-9][a-z0-9-]{0,80}$/.test(String(id || ''));

function isCached(m) {
  try { return fs.statSync(cachePath(m)).size === m.bytes } catch { return false }
}

async function list(config, opts) {
  const data = await index(config, opts);
  return {
    repo: settings(config).repo,
    tokenConfigured: !!settings(config).token,
    stale: data.stale || null,
    updated: data.updated || null,
    manuals: data.manuals.filter((m) => safeId(m.id)).map((m) => ({ ...m, cached: isCached(m) })),
  };
}

const inflight = new Map();

// Path of the local PDF, downloading + verifying it first if needed.
async function get(config, id) {
  if (!safeId(id)) throw Object.assign(new Error('Unknown manual'), { status: 404 });
  const data = await index(config);
  const m = data.manuals.find((x) => x.id === id);
  if (!m) throw Object.assign(new Error('Unknown manual'), { status: 404 });
  const p = cachePath(m);
  if (isCached(m)) return { path: p, manual: m };
  if (inflight.has(id)) return inflight.get(id);
  const job = (async () => {
    const s = settings(config);
    const body = await githubRaw(s.repo, s.ref, m.file, s.token);
    const sha = crypto.createHash('sha256').update(body).digest('hex');
    if (m.sha256 && sha !== m.sha256) throw new Error(`Checksum mismatch for ${m.file} — not saved`);
    fs.mkdirSync(DIR, { recursive: true });
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, p);
    console.log(`[Manuals] Downloaded ${m.title} (${Math.round(body.length / 1024)} kB)`);
    return { path: p, manual: m };
  })().finally(() => inflight.delete(id));
  inflight.set(id, job);
  return job;
}

function remove(id) {
  if (!safeId(id)) return false;
  let removed = false;
  for (const ext of ['.pdf', '.png', '.jpg', '.jpeg', '.webp']) {
    try { fs.unlinkSync(path.join(DIR, `${id}${ext}`)); removed = true } catch {}
  }
  return removed;
}

const MIME = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const mimeOf = (m) => MIME[extOf(m)];

module.exports = { list, get, remove, index, settings, mimeOf, DIR };
