'use strict';

// Camera recordings (src/camera-recorder.js).
//
//   GET    /recordings                         cameras that record, with settings and state
//   GET    /recordings/:cam                    days with clips, newest first
//   GET    /recordings/:cam/:day               that day's clips, newest first
//   GET    /recordings/:cam/:day/:file         a clip (<id>.mp4, ranges supported) or its thumbnail (<id>.jpg)
//   DELETE /recordings/:cam/:day/:id           delete a clip (admin)
//   POST   /recordings/:cam/record { seconds } record now for `seconds` (default 30, admin)

module.exports = function register(router, ctx) {
  const { clients, requireAdmin } = ctx;
  const rec = () => clients.recorder;
  const guard = (fn) => (req, res) => {
    if (!rec()) return res.status(404).json({ success: false, error: 'No camera records — set "record" on a camera in config.json' });
    try { fn(req, res); } catch (err) { res.status(400).json({ success: false, error: err.message }); }
  };

  router.get('/recordings', guard((req, res) => res.json({ success: true, data: rec().cameras() })));
  router.get('/recordings/:cam', guard((req, res) => res.json({ success: true, data: rec().days(req.params.cam) })));
  router.get('/recordings/:cam/:day', guard((req, res) => res.json({ success: true, data: rec().clips(req.params.cam, req.params.day) })));
  router.get('/recordings/:cam/:day/:file', guard((req, res) => {
    const f = rec().file(req.params.cam, req.params.day, req.params.file);
    if (!f) return res.status(404).json({ success: false, error: 'No such clip' });
    res.set('Cache-Control', 'private, max-age=60');
    res.sendFile(f);
  }));
  router.delete('/recordings/:cam/:day/:id', requireAdmin, guard((req, res) => {
    rec().remove(req.params.cam, req.params.day, req.params.id);
    res.json({ success: true });
  }));
  router.post('/recordings/:cam/record', requireAdmin, guard((req, res) => {
    const seconds = Math.min(600, Math.max(5, Number(req.body?.seconds) || 30));
    const clip = rec().trigger(req.params.cam, 'manual', seconds);
    res.json({ success: true, data: { start: clip.start, seconds } });
  }));
};
