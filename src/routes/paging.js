'use strict';

// Room-to-room paging (intercom) — split out of src/api-routes.js; registered in order by createApiRoutes().
const { Router, raw } = require('express');
const pagingMessages = require('../paging-messages');

module.exports = function register(router, ctx) {
  const { pagingManager } = ctx;

  // ── Room-to-room paging (intercom) ────────────────────────────────────
  // The live audio channel itself runs over Socket.IO (see src/websocket.js
  // and src/paging.js) — these REST routes are for status and for starting/
  // ending a page from outside a paging-aware browser session, e.g. a Flow
  // editor `http` node, a bearer-token API client, or curl.
  router.get('/paging/rooms', (req, res) => {
    res.json({ success: true, data: pagingManager ? pagingManager.getRoomsStatus() : [] });
  });

  router.post('/paging/start', (req, res) => {
    if (!pagingManager) return res.status(503).json({ success: false, error: 'Paging not enabled' });
    const { from, to } = req.body || {};
    try {
      res.json({ success: true, data: pagingManager.startPage(from, to) });
    } catch (err) {
      res.status(409).json({ success: false, error: err.message });
    }
  });

  router.post('/paging/:pageId/end', (req, res) => {
    if (!pagingManager) return res.status(503).json({ success: false, error: 'Paging not enabled' });
    res.json({ success: pagingManager.endPage(req.params.pageId, 'ended-via-api') });
  });

  // Voice messages — the "leave a message" counterpart to the live channel
  // above, for when the target room isn't online (startPage() requires both
  // sides connected) or the sender just prefers an async note. `from`/`to`
  // travel as query params since the request body is the raw audio blob.
  router.post('/paging/message', raw({ type: '*/*', limit: '5mb' }), (req, res) => {
    if (!pagingManager) return res.status(503).json({ success: false, error: 'Paging not enabled' });
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ success: false, error: 'from and to are required' });
    if (!pagingManager.roomExists(from) || !pagingManager.roomExists(to)) {
      return res.status(400).json({ success: false, error: 'Unknown paging room' });
    }
    if (!req.body?.length) return res.status(400).json({ success: false, error: 'Empty recording' });
    const message = pagingMessages.add({ from, to, buffer: req.body, mimeType: req.get('content-type') });
    pagingManager.notifyRoom(to, 'paging:message', { id: message.id, from, to, at: message.at });
    console.log(`[Paging] Voice message ${from} → ${to} (${message.id}, ${req.body.length}b)`);
    res.json({ success: true, data: { id: message.id, at: message.at } });
  });

  router.get('/paging/messages', (req, res) => {
    if (!pagingManager) return res.status(503).json({ success: false, error: 'Paging not enabled' });
    const room = req.query.room;
    if (!room) return res.status(400).json({ success: false, error: 'room is required' });
    res.json({ success: true, data: pagingMessages.getFor(room) });
  });

  router.get('/paging/message/:id/audio', (req, res) => {
    const message = pagingMessages.get(req.params.id);
    const file = pagingMessages.audioFile(req.params.id);
    if (!message || !file) return res.status(404).json({ success: false, error: 'Message not found' });
    res.setHeader('Content-Type', message.mimeType || 'audio/webm');
    res.sendFile(file);
  });

  router.delete('/paging/message/:id', (req, res) => {
    res.json({ success: pagingMessages.remove(req.params.id) });
  });

  // Voice messages disappear 24h after being left unless kept — this exempts
  // (or re-exposes) one to/from that expiry.
  router.post('/paging/message/:id/keep', (req, res) => {
    const kept = req.body?.keep !== false; // default true — the common case is "keep this one"
    const item = pagingMessages.setKept(req.params.id, kept);
    if (!item) return res.status(404).json({ success: false, error: 'Message not found' });
    res.json({ success: true, data: { id: item.id, kept: item.kept } });
  });
};
