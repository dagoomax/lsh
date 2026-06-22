'use strict';
const fs     = require('fs');
const path   = require('path');
const http   = require('http');
const https  = require('https');
const crypto = require('crypto');

let acmeLib = null;
try { acmeLib = require('acme-client'); } catch { /* acme-client not installed */ }

// Shared challenge store (populated during cert acquisition)
const challenges = new Map();

/**
 * Check remaining days on a PEM cert file. Returns Infinity if not readable.
 */
function certDaysLeft(certPath) {
  try {
    const pem  = fs.readFileSync(certPath);
    const x509 = new crypto.X509Certificate(pem);
    return (new Date(x509.validTo) - Date.now()) / 86400000;
  } catch { return Infinity; }
}

/**
 * Obtain or renew a Let's Encrypt certificate via HTTP-01 challenge.
 * Returns { cert, key } strings, or null on failure.
 *
 * Temporarily listens on port 80 for the ACME challenge then closes that server.
 * After this function returns, the caller should start a redirect server on port 80.
 */
async function acquireCert(config) {
  if (!acmeLib) {
    console.error('[ACME] acme-client not installed — run: npm install acme-client');
    return null;
  }

  const le       = config?.server?.letsEncrypt;
  const certsDir = path.resolve(le.certsDir || './certs');
  const certPath = path.join(certsDir, 'cert.pem');
  const keyPath  = path.join(certsDir, 'key.pem');

  const daysLeft = certDaysLeft(certPath);
  if (daysLeft > 30 && fs.existsSync(keyPath)) {
    console.log(`[ACME] Certificate valid for ${Math.floor(daysLeft)} more days`);
    return {
      cert: fs.readFileSync(certPath, 'utf8'),
      key:  fs.readFileSync(keyPath,  'utf8'),
    };
  }

  if (daysLeft <= 30 && daysLeft > 0) {
    console.log(`[ACME] Certificate expiring in ${Math.floor(daysLeft)} days — renewing`);
  } else {
    console.log('[ACME] Obtaining new certificate for ' + le.domain);
  }

  // Temporary port-80 server to serve ACME HTTP-01 challenges
  const challengeServer = http.createServer((req, res) => {
    if (req.url?.startsWith('/.well-known/acme-challenge/')) {
      const token    = req.url.split('/').pop();
      const response = challenges.get(token);
      if (response) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end(response);
      }
    }
    res.writeHead(200).end('OK');
  });

  await new Promise((resolve, reject) => {
    challengeServer.listen(80, (err) => {
      if (err) { reject(err); } else {
        console.log('[ACME] Temporary HTTP server on :80 for challenge');
        resolve();
      }
    });
  });

  try {
    const accountKey = await acmeLib.crypto.createPrivateKey();
    const client     = new acmeLib.Client({
      directoryUrl: le.staging
        ? acmeLib.directory.letsencrypt.staging
        : acmeLib.directory.letsencrypt.production,
      accountKey,
    });

    const [domainKey, csr] = await acmeLib.crypto.createCsr({ commonName: le.domain });

    const certPem = await client.auto({
      csr,
      email:                 le.email,
      termsOfServiceAgreed:  true,
      challengePriority:     ['http-01'],
      challengeCreateFn: async (_authz, challenge, keyAuth) => {
        challenges.set(challenge.token, keyAuth);
      },
      challengeRemoveFn: async (_authz, challenge) => {
        challenges.delete(challenge.token);
      },
    });

    fs.mkdirSync(certsDir, { recursive: true });
    const keyPem = domainKey.toString();
    fs.writeFileSync(certPath, certPem);
    fs.writeFileSync(keyPath,  keyPem);
    console.log(`[ACME] Certificate saved to ${certsDir}`);
    return { cert: certPem, key: keyPem };
  } finally {
    challengeServer.close();
  }
}

/**
 * Start a permanent redirect server on port 80 (HTTP → HTTPS).
 * Also handles ACME renewal challenges via the shared challenges Map.
 */
function startRedirectServer(httpsPort) {
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/.well-known/acme-challenge/')) {
      const token    = req.url.split('/').pop();
      const response = challenges.get(token);
      if (response) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end(response);
      }
    }
    const host = (req.headers.host || '').split(':')[0];
    const dest = httpsPort === 443
      ? `https://${host}${req.url}`
      : `https://${host}:${httpsPort}${req.url}`;
    res.writeHead(301, { Location: dest }).end();
  });
  server.listen(80, () => console.log('[ACME] HTTP redirect on :80'));
  return server;
}

/**
 * Schedule daily cert renewal check.
 * When renewal succeeds, calls onRenew({ cert, key }) so the caller
 * can update the HTTPS server's secure context.
 */
function scheduleRenewal(config, onRenew) {
  setInterval(async () => {
    const le       = config?.server?.letsEncrypt;
    const certsDir = path.resolve(le?.certsDir || './certs');
    const daysLeft = certDaysLeft(path.join(certsDir, 'cert.pem'));
    if (daysLeft > 30) return;
    console.log(`[ACME] Cert expiring in ${Math.floor(daysLeft)} days — triggering renewal`);
    try {
      const certs = await acquireCert(config);
      if (certs && onRenew) onRenew(certs);
    } catch (err) {
      console.error('[ACME] Renewal failed:', err.message);
    }
  }, 24 * 60 * 60 * 1000);
}

/**
 * Build an HTTPS server from cert + key file paths in config.
 * Returns null if not configured or files missing.
 */
function createHttpsServerFromConfig(app, config) {
  const cfg      = config?.server?.https;
  if (!cfg?.enabled) return null;
  const certFile = cfg.certFile ? path.resolve(cfg.certFile) : null;
  const keyFile  = cfg.keyFile  ? path.resolve(cfg.keyFile)  : null;
  if (!certFile || !keyFile) {
    console.warn('[HTTPS] certFile and keyFile must be set when server.https.enabled = true');
    return null;
  }
  if (!fs.existsSync(certFile) || !fs.existsSync(keyFile)) {
    console.warn(`[HTTPS] Cert or key file not found: ${certFile} / ${keyFile}`);
    return null;
  }
  try {
    return https.createServer({ cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) }, app);
  } catch (err) {
    console.warn(`[HTTPS] Failed to create HTTPS server: ${err.message}`);
    return null;
  }
}

module.exports = { acquireCert, startRedirectServer, scheduleRenewal, createHttpsServerFromConfig };
