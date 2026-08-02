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
const mobilenet = require('@tensorflow-models/mobilenet');
const cameraLog = require('./camera-log');
const platformStatus = require('./platform-status');
const { grabFrame } = require('./rtsp-snapshot');
const { getDb }     = require('./mongo');
const detectionBoxes = require('./detection-boxes');

const DETECTION_TTL_SECONDS = 7 * 24 * 3600; // auto-expire stored detection images after a week

// Second-opinion breed verification for COCO-SSD's 4 pet-ish classes.
// COCO-SSD only knows "this is a cat" (one of 80 coarse classes); MobileNet
// (trained on ImageNet's 1000 classes, ~120 of them dog breeds plus several
// cat/bird/misc.) gives a much more specific guess when run on just the
// cropped detection region — if that guess doesn't land anywhere near the
// expected animal type, the original COCO-SSD call was probably wrong.
// Keyword substring matching against MobileNet's class names, not exact
// index lookup — ImageNet's label text is inconsistent enough (commas,
// multiple synonyms per class) that this is the pragmatic way to bucket it,
// same approach used by most hobbyist detector+classifier pipelines.
const PET_CLASSES = new Set(['cat', 'dog', 'bird', 'horse']);
const BREED_KEYWORDS = {
  cat: ['cat', 'tabby', 'siamese', 'persian', 'egyptian'],
  dog: [
    'dog', 'terrier', 'retriever', 'spaniel', 'hound', 'shepherd', 'collie', 'setter', 'pointer',
    'mastiff', 'poodle', 'corgi', 'husky', 'malamute', 'chihuahua', 'pug', 'boxer', 'dachshund',
    'schnauzer', 'rottweiler', 'doberman', 'bulldog', 'labrador', 'beagle', 'whippet', 'greyhound',
    'basenji', 'akita', 'samoyed', 'newfoundland', 'papillon', 'pekinese', 'pomeranian', 'chow',
    'keeshond', 'affenpinscher', 'griffon', 'vizsla', 'weimaraner', 'kelpie', 'komondor', 'briard',
    'cardigan', 'basset', 'kuvasz', 'malinois', 'leonberg', 'eskimo dog', 'saint bernard',
  ],
  // ImageNet has dozens of species-specific bird classes rather than one
  // generic "bird" — this list covers the common ones, not all of them.
  bird: [
    'bird', 'jay', 'magpie', 'chickadee', 'robin', 'finch', 'sparrow', 'bunting', 'parrot',
    'cockatoo', 'macaw', 'lorikeet', 'toucan', 'hummingbird', 'owl', 'eagle', 'vulture', 'hawk',
    'kite', 'crane', 'heron', 'egret', 'stork', 'flamingo', 'pelican', 'swan', 'goose', 'duck',
    'drake', 'penguin', 'ostrich', 'peacock', 'quail', 'partridge', 'grouse', 'ptarmigan', 'coot',
    'bustard', 'oystercatcher', 'albatross', 'spoonbill', 'limpkin', 'bulbul', 'jacamar', 'hornbill',
    'coucal', 'lovebird', 'cockatiel',
  ],
  // ImageNet's coverage of actual horses is famously thin — "sorrel" is its
  // one horse-coat-color class, there's no generic "horse". Verification
  // for this class will rarely find a match; that's an ImageNet gap, not a
  // bug here. Documented in README rather than hidden.
  horse: ['horse', 'sorrel'],
};

function matchesBreed(cocoClass, mobilenetPredictions) {
  const keywords = BREED_KEYWORDS[cocoClass];
  if (!keywords) return null;
  for (const p of mobilenetPredictions) {
    const name = p.className.toLowerCase();
    if (keywords.some((k) => name.includes(k))) return p;
  }
  return null;
}

// Camera event log entries are pushed under objectDetection.cameras[].name,
// but the dashboard camera modal (Cameras.jsx) fetches/filters camera-log
// by config.cameras[].name — the same physical stream can legitimately be
// configured under two different display names (see homekit-bridge.js's
// motionSource for the identical situation with HKSV's motion trigger), so
// a detection needs pushing under both or it silently never shows up in
// the popup it's meant to appear in.
function cameraLogTargets(config, odCamName) {
  const targets = new Set([odCamName]);
  for (const cam of config.cameras || []) {
    if ((cam.motionSource || cam.name) === odCamName) targets.add(cam.name);
  }
  return [...targets];
}

// Per-class significance weight — not a physical weight estimate, just how
// much a class should count toward "something significant is happening":
// gates the aggregate any/detected signal that drives HKSV recording (see
// homekit-bridge.js's motionSource) and whether a class gets an
// auto-created Flow. Every class still gets its own device/sensor and
// event-log entries regardless of weight — this only affects what counts
// as noteworthy, not what gets detected. Default weight is 1 (counts);
// set a class to 0 in objectDetection.classWeights to detect but ignore it
// for those two purposes (e.g. "kite" or "frisbee" triggering a recording
// every time the wind picks up).
function weightOf(cfg, cls) {
  const w = cfg.classWeights?.[cls];
  return typeof w === 'number' ? w : 1;
}

function slugify(name) {
  return (name || 'camera').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'camera';
}

function rawToTensor({ width, height, data }) {
  // jpeg-js always decodes to RGBA; tf wants RGB (3 channels).
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i]; rgb[j + 1] = data[i + 1]; rgb[j + 2] = data[i + 2];
  }
  return tf.tensor3d(rgb, [height, width, 3]);
}

// Crops just a prediction's bbox out of the decoded frame for MobileNet
// verification — building a fresh small tensor straight from the raw
// pixel buffer rather than slicing the (already-disposed-by-then)
// full-frame detection tensor.
function cropToTensor(raw, bbox) {
  const [bx, by, bw, bh] = bbox;
  const x0 = Math.max(0, Math.floor(bx));
  const y0 = Math.max(0, Math.floor(by));
  const x1 = Math.min(raw.width, Math.ceil(bx + bw));
  const y1 = Math.min(raw.height, Math.ceil(by + bh));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const srcIdx = ((y0 + y) * raw.width + (x0 + x)) * 4;
      const dstIdx = (y * w + x) * 3;
      rgb[dstIdx] = raw.data[srcIdx]; rgb[dstIdx + 1] = raw.data[srcIdx + 1]; rgb[dstIdx + 2] = raw.data[srcIdx + 2];
    }
  }
  return tf.tensor3d(rgb, [h, w, 3]);
}

// Draws a plain rectangle outline (no library — jpeg-js only decodes/
// encodes, there's no drawing API) around each prediction's bbox, straight
// into the RGBA pixel buffer. bbox is [x, y, width, height] in pixels —
// see @tensorflow-models/coco-ssd's buildDetectedObjects.
function setPixel(data, imgWidth, x, y, rgba) {
  if (x < 0 || y < 0 || x >= imgWidth) return;
  const i = (y * imgWidth + x) * 4;
  if (i < 0 || i + 3 >= data.length) return;
  data[i] = rgba[0]; data[i + 1] = rgba[1]; data[i + 2] = rgba[2]; data[i + 3] = rgba[3];
}

function drawBoundingBoxes({ width, height, data }, predictions) {
  const THICKNESS = 3;
  const COLOR = [255, 40, 40, 255]; // opaque red
  for (const p of predictions) {
    const [bx, by, bw, bh] = p.bbox;
    const x0 = Math.max(0, Math.round(bx));
    const y0 = Math.max(0, Math.round(by));
    const x1 = Math.min(width - 1, Math.round(bx + bw));
    const y1 = Math.min(height - 1, Math.round(by + bh));
    for (let t = 0; t < THICKNESS; t++) {
      for (let x = x0; x <= x1; x++) {
        setPixel(data, width, x, y0 + t, COLOR);
        setPixel(data, width, x, y1 - t, COLOR);
      }
      for (let y = y0; y <= y1; y++) {
        setPixel(data, width, x0 + t, y, COLOR);
        setPixel(data, width, x1 - t, y, COLOR);
      }
    }
  }
}

class ObjectDetectionClient {
  constructor(config, store, sensorRegistry, automation) {
    this._config     = config;
    this._store       = store;
    this._registry     = sensorRegistry;
    this._automation   = automation;
    this._model        = null;
    this._petModel      = null;   // MobileNet — breed verification for pet classes only
    this._timer        = null;
    this._registered    = new Set();   // "<camSlug>/<class>" already registered as a device
    this._lastSeen      = new Map();   // "<camSlug>/<class>" → timestamp, for auto-clearing `detected`
    this._flowsMade      = new Set();   // "<camSlug>/<class>" already got an auto-generated flow
    this._streak         = new Map();   // "<camSlug>/<class>" → consecutive-poll count, for lingerClasses
    this._lingering       = new Set();   // "<camSlug>/<class>" currently flagged as lingering
    this._indexesEnsured  = false;
    this._anyActive       = new Set();   // camSlugs with >=1 class currently detected — HKSV motion trigger
  }

  async start() {
    const cfg = this._config.objectDetection;
    const cams = (cfg?.cameras || []).filter((c) => c?.url);
    if (!cams.length) return;

    await tf.setBackend('cpu');
    console.log('[ObjectDetection] Loading COCO-SSD model…');
    this._model = await cocoSsd.load();

    if (cfg.petVerification !== false) {
      console.log('[ObjectDetection] Loading MobileNet (pet breed verification)…');
      try {
        this._petModel = await mobilenet.load({ version: 2, alpha: 1.0 });
      } catch (err) {
        console.error(`[ObjectDetection] MobileNet failed to load, pet verification disabled: ${err.message}`);
      }
    }

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
        const raw    = jpeg.decode(buffer, { useTArray: true });
        const tensor = rawToTensor(raw);
        let predictions;
        try { predictions = await this._model.detect(tensor); }
        finally { tensor.dispose(); }
        anyOk = true;

        const rawKept = predictions.filter((p) => p.score >= minConfidence);
        if (this._petModel) {
          for (const p of rawKept) {
            if (PET_CLASSES.has(p.class)) p.petVerification = await this._verifyPet(raw, p);
          }
        }
        // requirePetVerification (off by default) drops pet-class
        // detections MobileNet's crop classification didn't back up —
        // opt-in, since it's a second model's opinion, not ground truth,
        // and could suppress a real detection MobileNet just got wrong.
        const kept = cfg.requirePetVerification === true
          ? rawKept.filter((p) => !PET_CLASSES.has(p.class) || p.petVerification?.verified)
          : rawKept;

        const seenThisPoll = new Set();
        for (const p of kept) {
          seenThisPoll.add(p.class);
          this._onDetected(camName, camSlug, p.class, p.score, p.petVerification);
        }
        this._updateLingerTracking(cfg, camName, camSlug, seenThisPoll);

        // Published every poll — including an empty array — so the
        // dashboard overlay clears itself the moment nothing's left in
        // frame instead of showing a stale box until the next detection.
        const boxItems = kept.map((p) => ({ class: p.class, score: p.score, bbox: p.bbox, petVerification: p.petVerification }));
        for (const name of cameraLogTargets(this._config, camName)) {
          detectionBoxes.set(name, boxItems, raw.width, raw.height);
        }

        if (kept.length && cfg.saveDetections !== false) {
          this._saveDetectionRecords(camName, raw, kept).catch((err) =>
            console.error(`[ObjectDetection] Mongo save failed for "${camName}": ${err.message}`));
        }
      } catch (err) {
        console.error(`[ObjectDetection] "${camName}" failed: ${err.message}`);
      }
    }));

    // Auto-clear `detected` for categories not seen in the last couple of polls.
    const now = Date.now();
    const touchedSlugs = new Set();
    for (const [regKey, ts] of this._lastSeen) {
      if (now - ts > clearAfterMs) {
        const deviceKey = `objectdetect/${regKey}`;
        this._store.update(`${deviceKey}/detected`, 0);
        this._lastSeen.delete(regKey);
        touchedSlugs.add(regKey.slice(0, regKey.lastIndexOf('/')));
      }
    }
    // A camSlug's "any" motion flag (HKSV trigger) only clears once none of
    // its *significant* (weight > 0) classes are still active — re-check
    // against what's left in _lastSeen rather than assuming the whole
    // camera went quiet. A lingering weight-0 class (e.g. "kite" set to 0)
    // must not keep this signal stuck on by itself.
    for (const camSlug of touchedSlugs) {
      const stillSignificant = [...this._lastSeen.keys()].some((k) =>
        k.startsWith(`${camSlug}/`) && weightOf(cfg, k.slice(k.lastIndexOf('/') + 1)) > 0);
      if (!stillSignificant && this._anyActive.has(camSlug)) {
        this._anyActive.delete(camSlug);
        this._store.update(`objectdetect/${camSlug}/any/detected`, 0);
      }
    }

    platformStatus.set('objectDetection', anyOk);
  }

  // Crops the prediction's bbox and runs it through MobileNet for a breed
  // guess; `verified` is true if any of MobileNet's top-3 guesses land in
  // the expected animal's breed-keyword bucket (see BREED_KEYWORDS). This
  // is a second model's opinion, not ground truth — MobileNet can miss on
  // a bad crop/angle same as COCO-SSD can, so a false `verified: false`
  // is expected sometimes, not necessarily proof the original call was wrong.
  async _verifyPet(raw, prediction) {
    const cropped = cropToTensor(raw, prediction.bbox);
    try {
      const results = await this._petModel.classify(cropped, 3);
      const match = matchesBreed(prediction.class, results);
      return {
        verified: !!match,
        breed: (match || results[0])?.className,
        breedProb: (match || results[0])?.probability,
      };
    } catch (err) {
      console.error(`[ObjectDetection] Pet verification failed: ${err.message}`);
      return null;
    } finally {
      cropped.dispose();
    }
  }

  _onDetected(camName, camSlug, cls, score, petVerification) {
    const regKey    = `${camSlug}/${cls}`;
    const deviceKey = `objectdetect/${regKey}`;
    const weight    = weightOf(this._config.objectDetection || {}, cls);

    if (!this._registered.has(regKey)) {
      this._registered.add(regKey);
      this._registry.registerDevice({
        key: deviceKey, type: 'objectdetect', instance: regKey,
        label: `${camName} — ${cls[0].toUpperCase()}${cls.slice(1)}`,
        icon: '🎯', color: 'blue',
        sensors: [{ path: 'detected', name: 'Detected', format: 'on-off', homekit: 'motion' }],
        homekit: ['motion'],
      });
      if (weight > 0) this._maybeCreateFlow(camName, deviceKey, regKey, cls);
    }

    this._store.update(`${deviceKey}/detected`, 1);
    this._lastSeen.set(regKey, Date.now());
    const breedNote = petVerification
      ? petVerification.verified
        ? ` — ${petVerification.breed} (${Math.round(petVerification.breedProb * 100)}%)`
        : ' — unverified breed match'
      : '';
    for (const name of cameraLogTargets(this._config, camName)) {
      cameraLog.push(name, 'object', `${cls} (${Math.round(score * 100)}%)${breedNote}`);
    }

    if (weight > 0 && !this._anyActive.has(camSlug)) {
      this._anyActive.add(camSlug);
      this._store.update(`objectdetect/${camSlug}/any/detected`, 1);
    }
  }

  // Persists one document per kept prediction to MongoDB, each carrying a
  // copy of the frame with every kept box outlined in red (drawn once for
  // the whole frame, so every doc from this poll shares the same annotated
  // image). No-ops silently if Mongo isn't configured/connected — matches
  // mongo.js's "gzip fallback, never crash" philosophy; this is a bonus
  // record, not the source of truth (the store/HomeKit sensors are).
  async _saveDetectionRecords(camName, raw, predictions) {
    const db = getDb();
    if (!db) return;

    let Binary;
    try {
      ({ Binary } = require('mongodb'));
    } catch {
      return;
    }

    await this._ensureDetectionIndexes(db);

    const annotated = { width: raw.width, height: raw.height, data: Uint8Array.from(raw.data) };
    drawBoundingBoxes(annotated, predictions);
    const jpegBuffer = jpeg.encode(annotated, 80).data;
    const image = new Binary(jpegBuffer);
    const ts = new Date();

    const docs = predictions.map((p) => ({
      camera: camName,
      class: p.class,
      score: p.score,
      bbox: { x: p.bbox[0], y: p.bbox[1], width: p.bbox[2], height: p.bbox[3] },
      ts,
      image,
      ...(p.petVerification ? { petVerification: p.petVerification } : {}),
    }));

    await db.collection('objectDetections').insertMany(docs);
  }

  async _ensureDetectionIndexes(db) {
    if (this._indexesEnsured) return;
    this._indexesEnsured = true;
    try {
      await db.collection('objectDetections').createIndex(
        { ts: 1 }, { expireAfterSeconds: DETECTION_TTL_SECONDS });
    } catch (err) {
      console.error(`[ObjectDetection] Failed to ensure Mongo TTL index: ${err.message}`);
    }
  }

  // Streak-based heuristic for classes configured in objectDetection.
  // lingerClasses (default just "cat"): real "cat poo" detection isn't
  // feasible with a general-purpose 80-class model (no such category
  // exists, and training a custom detector is a whole separate project),
  // so this approximates it — a cat present for several consecutive polls
  // (default 3, ~30-45s at the default 15s poll interval) gets flagged as
  // a possible litter event, as its own device/flow separate from the
  // plain "cat detected" one. Clears the moment the cat leaves frame.
  _updateLingerTracking(cfg, camName, camSlug, seenThisPoll) {
    const lingerClasses = cfg.lingerClasses || ['cat'];
    const threshold     = Math.max(cfg.lingerThreshold || 3, 2);

    for (const cls of lingerClasses) {
      const regKey = `${camSlug}/${cls}`;
      if (seenThisPoll.has(cls)) {
        const streak = (this._streak.get(regKey) || 0) + 1;
        this._streak.set(regKey, streak);
        if (streak >= threshold && !this._lingering.has(regKey)) {
          this._lingering.add(regKey);
          this._onLingerStart(camName, camSlug, cls);
        }
      } else if (this._streak.has(regKey)) {
        this._streak.delete(regKey);
        if (this._lingering.has(regKey)) {
          this._lingering.delete(regKey);
          this._onLingerEnd(camSlug, cls);
        }
      }
    }
  }

  _onLingerStart(camName, camSlug, cls) {
    const regKey    = `${camSlug}/${cls}-linger`;
    const deviceKey = `objectdetect/${regKey}`;
    const label     = `${cls[0].toUpperCase()}${cls.slice(1)} lingering`;

    if (!this._registered.has(regKey)) {
      this._registered.add(regKey);
      this._registry.registerDevice({
        key: deviceKey, type: 'objectdetect', instance: regKey,
        label: `${camName} — ${label} (possible litter event)`,
        icon: '⚠️', color: 'orange',
        sensors: [{ path: 'detected', name: 'Detected', format: 'on-off', homekit: 'motion' }],
        homekit: ['motion'],
      });
      this._createLingerFlow(camName, deviceKey, regKey, cls);
    }

    this._store.update(`${deviceKey}/detected`, 1);
    for (const name of cameraLogTargets(this._config, camName)) {
      cameraLog.push(name, 'object', `${cls} lingering — possible litter event`);
    }
    console.log(`[ObjectDetection] "${camName}" — ${cls} lingering (possible litter event)`);
  }

  _onLingerEnd(camSlug, cls) {
    this._store.update(`objectdetect/${camSlug}/${cls}-linger/detected`, 0);
  }

  _createLingerFlow(camName, deviceKey, regKey, cls) {
    if (this._flowsMade.has(regKey)) return;
    this._flowsMade.add(regKey);
    if (this._config.objectDetection?.autoCreateFlows === false) return;
    if (!this._automation) return;
    const triggerKey = `${deviceKey}/detected`;
    const already = (this._automation.flows || []).some((f) =>
      (f.nodes || []).some((n) => n.type === 'trigger' && n.config?.key === triggerKey));
    if (already) return;

    try {
      this._automation.saveFlow({
        name:    `Possible litter event — ${camName}`,
        enabled: true,
        nodes: [
          {
            id: 'trigger', type: 'trigger', x: 80, y: 80,
            config: { key: triggerKey, op: 'is', value: 1 },
            wires: [['notify']],
          },
          {
            id: 'notify', type: 'notify', x: 320, y: 80,
            config: { level: 'warning', message: `${cls[0].toUpperCase()}${cls.slice(1)} lingering at ${camName} — possible litter event` },
            wires: [[]],
          },
        ],
      });
      console.log(`[ObjectDetection] Auto-created linger flow for ${camName} — ${cls}`);
    } catch (err) {
      console.error(`[ObjectDetection] Failed to auto-create linger flow: ${err.message}`);
    }
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
module.exports.slugify = slugify;
