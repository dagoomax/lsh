'use strict';

// Visual PTZ waypoints (src/ptz-waypoints.js). :cam is the camera's slug
// (as /api/cameras gives it in `waypoints`) or its index in config.cameras.
//
//   GET    /camera/waypoints/:cam               waypoints, and whether one is being gone to
//   POST   /camera/waypoints/:cam { name }      save the current view (admin)
//   PATCH  /camera/waypoints/:cam/:id { name }  rename (admin)
//   DELETE /camera/waypoints/:cam/:id           remove (admin)
//   POST   /camera/waypoints/:cam/:id/goto      go there; answers when it's done or gave up (admin)
//   GET    /camera/waypoints/:cam/:id.jpg       the saved view

module.exports = function register(router, ctx) {
  const { clients, requireAdmin } = ctx;
  const wp = () => {
    if (!clients.waypoints) throw Object.assign(new Error('No camera with pan/tilt has waypoints'), { status: 404 });
    return clients.waypoints;
  };
  const handle = (fn) => async (req, res) => {
    try { await fn(req, res); }
    catch (err) { res.status(err.status || (/No such|no waypoints/i.test(err.message) ? 404 : /Already/.test(err.message) ? 409 : 400)).json({ success: false, error: err.message }); }
  };

  router.get('/camera/waypoints/:cam', handle((req, res) => {
    const c = wp().camera(req.params.cam);
    res.json({ success: true, data: { camera: c.name, slug: c.slug, moving: wp().busy.has(c.slug), waypoints: wp().list(c.slug) } });
  }));
  router.get('/camera/waypoints/:cam/:id.jpg', handle((req, res) => {
    const c = wp().camera(req.params.cam);
    const f = wp().image(c.slug, req.params.id);
    if (!f) return res.status(404).end();
    res.set('Cache-Control', 'private, max-age=3600');
    res.sendFile(f);
  }));
  router.post('/camera/waypoints/:cam', requireAdmin, handle(async (req, res) => {
    res.json({ success: true, data: await wp().save(req.params.cam, req.body?.name) });
  }));
  router.patch('/camera/waypoints/:cam/:id', requireAdmin, handle((req, res) => {
    res.json({ success: true, data: wp().rename(req.params.cam, req.params.id, req.body?.name) });
  }));
  router.delete('/camera/waypoints/:cam/:id', requireAdmin, handle((req, res) => {
    wp().remove(req.params.cam, req.params.id);
    res.json({ success: true });
  }));
  router.post('/camera/waypoints/:cam/:id/goto', requireAdmin, handle(async (req, res) => {
    req.setTimeout?.(300000);
    const r = await wp().goto(req.params.cam, req.params.id);
    res.json({ success: r.ok, data: r, ...(r.ok ? {} : { error: r.message }) });
  }));
};
