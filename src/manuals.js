'use strict';

// Device manuals, kept in a private GitHub repo (default dagoomax/lsh-manuals)
// and downloaded on demand: the index (index.json) is fetched when the list is
// opened, a PDF only when someone opens it. Each PDF is checked against the
// SHA-256 in the index and cached in persist/manuals/ (override with
// LSH_MANUALS_DIR) — after that it's served locally, offline too.
//
// Access, either of:
//   • a read-only deploy key (SSH) — persist/manuals-deploy-key, or
//     config.manuals.sshKey. Files come over git: a blobless bare clone in
//     persist/manuals/.repo; each file's blob is fetched only when read.
//   • a token: config.manuals.githubToken (fine-grained, Contents: read-only
//     on that repo), falling back to config.modules.githubToken / GITHUB_TOKEN.
//
// config.manuals = { repo = 'dagoomax/lsh-manuals', ref = 'main', githubToken, sshKey }

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFile } = require('child_process');

const DIR = process.env.LSH_MANUALS_DIR || path.join(__dirname, '..', 'persist', 'manuals');
const INDEX_TTL_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 60 * 1000;

let indexCache = null; // { at, data }

const DEFAULT_KEY = process.env.LSH_MANUALS_KEY || path.join(__dirname, '..', 'persist', 'manuals-deploy-key');

function settings(config) {
  const m = config.manuals || {};
  const sshKey = m.sshKey || (fs.existsSync(DEFAULT_KEY) ? DEFAULT_KEY : null);
  return {
    repo: m.repo || 'dagoomax/lsh-manuals',
    ref: m.ref || 'main',
    token: m.githubToken || config.modules?.githubToken || process.env.GITHUB_TOKEN || null,
    sshKey,
  };
}

// ── git over SSH (deploy key) ──────────────────────────────────────────────
const gitDir = () => path.join(DIR, '.repo');

function git(args, key, { buffer = false } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0',
      GIT_SSH_COMMAND: `ssh -i "${key}" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20` };
    execFile('git', args, { env, timeout: TIMEOUT_MS, maxBuffer: 128 * 1024 * 1024, encoding: buffer ? 'buffer' : 'utf8' }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout);
      const msg = String(stderr || err.message);
      const e = new Error(/Permission denied|publickey|Repository not found|not appear to be a git/.test(msg)
        ? 'The deploy key isn’t accepted for the manuals repository — re-register it (see Settings → Device manuals).'
        : `git: ${msg.trim().split('\n').pop()}`);
      e.auth = /Permission denied|publickey|Repository not found/.test(msg);
      reject(e);
    });
  });
}

let fetchedAt = 0;
async function gitRaw(repo, ref, file, key, { refresh = false } = {}) {
  const dir = gitDir();
  const url = `git@github.com:${repo}.git`;
  if (!fs.existsSync(path.join(dir, 'HEAD'))) {
    fs.mkdirSync(DIR, { recursive: true });
    await git(['clone', '--bare', '--filter=blob:none', '--depth', '1', '--branch', ref, url, dir], key);
    fetchedAt = Date.now();
  } else if (refresh || Date.now() - fetchedAt > INDEX_TTL_MS) {
    await git(['--git-dir', dir, 'fetch', '--depth', '1', '--filter=blob:none', 'origin', `+refs/heads/${ref}:refs/heads/${ref}`], key);
    fetchedAt = Date.now();
  }
  // The blob is fetched from GitHub here, on first read
  return git(['--git-dir', dir, 'show', `refs/heads/${ref}:${file}`], key, { buffer: true });
}

// One file from the repo, over whichever access is configured
function fetchFile(s, file, opts) {
  return s.sshKey ? gitRaw(s.repo, s.ref, file, s.sshKey, opts) : githubRaw(s.repo, s.ref, file, s.token);
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
    const data = JSON.parse((await fetchFile(s, 'index.json', { refresh })).toString('utf8'));
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
    tokenConfigured: !!(settings(config).token || settings(config).sshKey),
    access: settings(config).sshKey ? 'deploy-key' : settings(config).token ? 'token' : null,
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
    const body = await fetchFile(s, m.file);
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
