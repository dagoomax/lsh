'use strict';

// Local object detection (person/car/dog/... — the 80 COCO classes) for
// cameras that have no on-device AI of their own (contrast with
// reolink-client.js, which polls AI state the camera already computes).
// Grabs a snapshot every pollInterval seconds via rtsp-snapshot.js's ffmpeg
// frame-grab, runs it through TensorFlow.js's coco-ssd model, and mirrors
// Reolink's exact device/HomeKit pattern: one sub-device per camera+category,
// `detected` boolean sensor exposed as a HomeKit motion sensor.
//
// Pure-JS TensorFlow.js (CPU backend) on purpose, not @tensorflow/tfjs-node —
// the native backend needs Node ABI-matched prebuilt bindings per machine,
// which is a poor fit for LSH running across several different boxes.
// Slower per-inference (roughly 1s on a modern machine) but nothing to build
// or match, and periodic snapshot polling doesn't need real-time speed
// anyway. If tfjs/coco-ssd aren't installed, server.js's tryRequire skips
// this client with a warning instead of crashing.

const tf      = require('@tensorflow/tfjs');
require('@tensorflow/tfjs-backend-cpu');
const jpeg     = require('jpeg-js');
const cocoSsd  = require('@tensorflow-models/coco-ssd');
const cameraLog = require('./camera-log');
const platformStatus = require('./platform-status');
const { grabFrame } = require('./rtsp-snapshot');

function slugify(name) {
  return (name || 'camera').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'camera';
}

function jpegToTensor(buffer) {
  const { width, height, data } = jpeg.decode(buffer, { useTArray: true });
  // jpeg-js always decodes to RGBA; tf wants RGB (3 channels).
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i]; rgb[j + 1] = data[i + 1]; rgb[j + 2] = data[i + 2];
  }
  return tf.tensor3d(rgb, [height, width, 3]);
}

class ObjectDetectionClient {
  constructor(config, store, sensorRegistry, automation) {
    this._config     = config;
    this._store       = store;
    this._registry     = sensorRegistry;
    this._automation   = automation;
    this._model        = null;
    this._timer        = null;
    this._registered    = new Set();   // "<camSlug>/<class>" already registered as a device
    this._lastSeen      = new Map();   // "<camSlug>/<class>" → timestamp, for auto-clearing `detected`
    this._flowsMade      = new Set();   // "<camSlug>/<class>" already got an auto-generated flow
  }

  async start() {
    const cfg = this._config.objectDetection;
    const cams = (cfg?.cameras || []).filter((c) => c?.url);
    if (!cams.length) return;

    await tf.setBackend('cpu');
    console.log('[ObjectDetection] Loading COCO-SSD model…');
    this._model = await cocoSsd.load();
    console.log(`[ObjectDetection] Model ready — watching ${cams.length} camera(s)`);

    const ms = Math.max(cfg.pollInterval || 15, 5) * 1000;
    this._timer = setInterval(() => this._pollAll(cams), ms);
    this._pollAll(cams);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  async _pollAll(cams) {
    const cfg = this._config.objectDetection || {};
    const ffmpegPath   = this._config.ffmpegRtsp?.ffmpegPath || 'ffmpeg';
    const minConfidence = cfg.minConfidence ?? 0.5;
    const clearAfterMs  = Math.max(cfg.pollInterval || 15, 5) * 2 * 1000;

    let anyOk = false;
    await Promise.all(cams.map(async (cam) => {
      const camName = cam.name || 'Camera';
      const camSlug = slugify(camName);
      try {
        const buffer = await grabFrame(cam.url, ffmpegPath);
        const tensor = jpegToTensor(buffer);
        let predictions;
        try { predictions = await this._model.detect(tensor); }
        finally { tensor.dispose(); }
        anyOk = true;

        const seenThisPoll = new Set();
        for (const p of predictions) {
          if (p.score < minConfidence) continue;
          seenThisPoll.add(p.class);
          this._onDetected(camName, camSlug, p.class, p.score);
        }
      } catch (err) {
        console.error(`[ObjectDetection] "${camName}" failed: ${err.message}`);
      }
    }));

    // Auto-clear `detected` for categories not seen in the last couple of polls.
    const now = Date.now();
    for (const [regKey, ts] of this._lastSeen) {
      if (now - ts > clearAfterMs) {
        const deviceKey = `objectdetect/${regKey}`;
        this._store.update(`${deviceKey}/detected`, 0);
        this._lastSeen.delete(regKey);
      }
    }

    platformStatus.set('objectDetection', anyOk);
  }

  _onDetected(camName, camSlug, cls, score) {
    const regKey    = `${camSlug}/${cls}`;
    const deviceKey = `objectdetect/${regKey}`;

    if (!this._registered.has(regKey)) {
      this._registered.add(regKey);
      this._registry.registerDevice({
        key: deviceKey, type: 'objectdetect', instance: regKey,
        label: `${camName} — ${cls[0].toUpperCase()}${cls.slice(1)}`,
        icon: '🎯', color: 'blue',
        sensors: [{ path: 'detected', name: 'Detected', format: 'on-off', homekit: 'motion' }],
        homekit: ['motion'],
      });
      this._maybeCreateFlow(camName, deviceKey, regKey, cls);
    }

    this._store.update(`${deviceKey}/detected`, 1);
    this._lastSeen.set(regKey, Date.now());
    cameraLog.push(camName, 'object', `${cls} (${Math.round(score * 100)}%)`);
  }

  // First time a camera+category pair is ever seen, drop a starter Flow into
  // the automation engine — a trigger wired to a notify node, exactly like
  // Reolink's detections are meant to "drive different automations" (see
  // reolink-client.js). Left as a stub (notify only) since what to actually
  // *do* about "person detected at Wejście" is a decision the user should
  // make in the Flows editor, not one this client should guess at.
  _maybeCreateFlow(camName, deviceKey, regKey, cls) {
    if (this._flowsMade.has(regKey)) return;
    this._flowsMade.add(regKey);
    if (this._config.objectDetection?.autoCreateFlows === false) return;
    if (!this._automation) return;
    // _flowsMade is in-memory only, so it doesn't survive a restart — check
    // the persisted flow list too, or every restart re-creates a "first
    // time seen" duplicate for every category already discovered before.
    const triggerKey = `${deviceKey}/detected`;
    const already = (this._automation.flows || []).some((f) =>
      (f.nodes || []).some((n) => n.type === 'trigger' && n.config?.key === triggerKey));
    if (already) return;

    const triggerId = 'trigger';
    const notifyId  = 'notify';
    try {
      this._automation.saveFlow({
        name:    `${cls[0].toUpperCase()}${cls.slice(1)} detected — ${camName}`,
        enabled: true,
        nodes: [
          {
            id: triggerId, type: 'trigger', x: 80, y: 80,
            config: { key: `${deviceKey}/detected`, op: 'is', value: 1 },
            wires: [[notifyId]],
          },
          {
            id: notifyId, type: 'notify', x: 320, y: 80,
            config: { level: 'info', message: `${cls[0].toUpperCase()}${cls.slice(1)} detected — ${camName}` },
            wires: [[]],
          },
        ],
      });
      console.log(`[ObjectDetection] Auto-created flow for ${camName} — ${cls}`);
    } catch (err) {
      console.error(`[ObjectDetection] Failed to auto-create flow: ${err.message}`);
    }
  }
}

module.exports = ObjectDetectionClient;
