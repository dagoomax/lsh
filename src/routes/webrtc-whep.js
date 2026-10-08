'use strict';

// WebRTC WHEP proxy — split out of src/api-routes.js; registered in order by createApiRoutes().

module.exports = function register(router) {
  // ── WebRTC WHEP proxy ──────────────────────────────────────────────────
  // Proxies the WHEP SDP offer to avoid CORS and allow self-signed TLS on
  // local media servers (go2rtc, mediamtx, Frigate, etc.).

  router.post('/webrtc/offer', (req, res) => {
    const { url, sdp } = req.body;
    if (!url || !sdp) return res.status(400).json({ error: 'url and sdp required' });

    let parsed;
    try { parsed = new URL(url); } catch { return res.status(400).json({ error: 'invalid url' }); }

    const isHttps = parsed.protocol === 'https:';
    const lib     = isHttps ? require('https') : require('http');
    const body    = Buffer.from(sdp, 'utf8');

    const proxyReq = lib.request({
      hostname:           parsed.hostname,
      port:               parsed.port || (isHttps ? 443 : 80),
      path:               parsed.pathname + parsed.search,
      method:             'POST',
      headers:            { 'Content-Type': 'application/sdp', 'Content-Length': body.length },
      rejectUnauthorized: false,
      timeout:            10000,
    }, proxyRes => {
      const chunks = [];
      proxyRes.on('data', c => chunks.push(c));
      proxyRes.on('end', () => {
        const answer = Buffer.concat(chunks).toString('utf8');
        if (proxyRes.statusCode >= 200 && proxyRes.statusCode < 300) {
          res.json({ sdp: answer });
        } else {
          res.status(502).json({ error: `WHEP server returned ${proxyRes.statusCode}` });
        }
      });
    });

    proxyReq.on('error',   err => res.status(502).json({ error: err.message }));
    proxyReq.on('timeout', ()  => { proxyReq.destroy(); res.status(504).json({ error: 'WHEP timeout' }); });
    proxyReq.write(body);
    proxyReq.end();
  });
};
