'use strict';

// PTZ presets — split out of src/api-routes.js; registered in order by createApiRoutes().
const { onvifCfgFor } = require('./helpers');

module.exports = function register(router, ctx) {
  const { axis, kenik, reolink, requireAdmin } = ctx;

  // ── PTZ presets ───────────────────────────────────────────
  // Shape varies genuinely by vendor (Reolink's CGI API has no documented
  // "save preset" call — presets are created on-camera via the Reolink app
  // and only listed/goto'd here; Axis and ONVIF support the full
  // list/save/goto/remove set), so each backend registers only the routes
  // it can actually back:
  //   GET    /api/<backend>/preset/:idx            → [{id, name}], `writable`
  //   POST   /api/<backend>/preset/:idx             {name?} → save current position
  //   POST   /api/<backend>/preset/:idx/:id/goto    → move to preset
  //   DELETE /api/<backend>/preset/:idx/:id         → remove preset
  function registerPresetRoutes(prefix, backend) {
    router.get(`/${prefix}/preset/:idx`, async (req, res) => {
      try { res.json({ success: true, data: await backend.list(req.params.idx), writable: !!backend.save }); }
      catch (err) { res.status(502).json({ success: false, error: err.message }); }
    });
    router.post(`/${prefix}/preset/:idx/:id/goto`, requireAdmin, async (req, res) => {
      try { await backend.goto(req.params.idx, req.params.id); res.json({ success: true }); }
      catch (err) { res.status(502).json({ success: false, error: err.message }); }
    });
    if (backend.save) {
      router.post(`/${prefix}/preset/:idx`, requireAdmin, async (req, res) => {
        try { res.json({ success: true, data: await backend.save(req.params.idx, (req.body || {}).name) }); }
        catch (err) { res.status(502).json({ success: false, error: err.message }); }
      });
    }
    if (backend.remove) {
      router.delete(`/${prefix}/preset/:idx/:id`, requireAdmin, async (req, res) => {
        try { await backend.remove(req.params.idx, req.params.id); res.json({ success: true }); }
        catch (err) { res.status(502).json({ success: false, error: err.message }); }
      });
    }
  }

  registerPresetRoutes('reolink', {
    list: (idx) => { if (!reolink) throw new Error('Reolink unavailable'); return reolink.listPresets(idx); },
    goto: (idx, id) => { if (!reolink) throw new Error('Reolink unavailable'); return reolink.gotoPreset(idx, id); },
  });
  registerPresetRoutes('kenik', {
    list:   (idx) => { if (!kenik) throw new Error('KENIK unavailable'); return kenik.listPresets(idx); },
    goto:   (idx, id) => { if (!kenik) throw new Error('KENIK unavailable'); return kenik.gotoPreset(idx, id); },
    save:   (idx, name) => { if (!kenik) throw new Error('KENIK unavailable'); return kenik.savePreset(idx, name); },
    remove: (idx, id) => { if (!kenik) throw new Error('KENIK unavailable'); return kenik.removePreset(idx, id); },
  });
  registerPresetRoutes('axis', {
    list:   (idx) => { if (!axis) throw new Error('Axis unavailable'); return axis.listPresets(idx); },
    goto:   (idx, id) => { if (!axis) throw new Error('Axis unavailable'); return axis.gotoPreset(idx, id); },
    save:   (idx, name) => { if (!axis) throw new Error('Axis unavailable'); return axis.savePreset(idx, name); },
    remove: (idx, id) => { if (!axis) throw new Error('Axis unavailable'); return axis.removePreset(idx, id); },
  });
  registerPresetRoutes('camera', {
    list:   (idx) => require('../onvif-ptz').listPresets(onvifCfgFor(idx)),
    goto:   (idx, id) => require('../onvif-ptz').gotoPreset(onvifCfgFor(idx), id),
    save:   (idx, name) => require('../onvif-ptz').setPreset(onvifCfgFor(idx), name),
    remove: (idx, id) => require('../onvif-ptz').removePreset(onvifCfgFor(idx), id),
  });
};
