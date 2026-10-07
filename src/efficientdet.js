'use strict';

/*
 * EfficientDet-Lite0…4 object detection (Google's TF2 SavedModels from
 * TF Hub, now served via Kaggle) behind the same detect() contract as
 * @tensorflow-models/coco-ssd — [{ bbox: [x, y, w, h], class, score }] —
 * so object-detection.js can treat both model families the same way.
 *
 * Needs the native @tensorflow/tfjs-node backend (tf.node.loadSavedModel
 * runs the real TensorFlow runtime); the pure-JS backend can't load a
 * SavedModel, so object-detection.js only offers these when it's present.
 *
 * Same 80 COCO classes as coco-ssd (class ids 1–90, mapped through
 * coco-ssd's own CLASSES table so names match exactly). Measured on an AMD
 * GX-215JJ, 1352×900 frame: lite0 ~0.3 s, lite1 ~0.5 s, lite2 ~0.8 s,
 * lite3 ~1.4 s, lite4 ~2.4 s (coco-ssd mobilenet_v2: ~0.7 s). Scores run
 * lower than coco-ssd's for the same object — fewer weak false positives.
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const { spawn } = require('child_process');

const MODELS_DIR = path.join(__dirname, '..', 'persist', 'models');

const EFFICIENTDET_MODELS = [0, 1, 2, 3, 4].map((n) => ({
  id: `efficientdet_lite${n}`,
  variant: n,
  url: `https://www.kaggle.com/api/v1/models/tensorflow/efficientdet/tensorflow2/lite${n}-detection/1/download`,
}));

const isEfficientDet = (id) => EFFICIENTDET_MODELS.some((m) => m.id === id);

// GET with redirects (Kaggle → signed GCS URL), streamed straight into tar.
function downloadAndExtract(url, destDir, hops = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'LSH' }, timeout: 60000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (hops > 5) return reject(new Error('Too many redirects'));
        return resolve(downloadAndExtract(new URL(res.headers.location, url).toString(), destDir, hops + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`Download HTTP ${res.statusCode}`)); }
      const tar = spawn('tar', ['xz', '-C', destDir], { stdio: ['pipe', 'ignore', 'pipe'] });
      let err = '';
      tar.stderr.on('data', (d) => { err += d; });
      tar.on('error', reject);
      tar.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`tar exited ${code}: ${err.trim()}`))));
      res.pipe(tar.stdin);
    }).on('error', reject).on('timeout', function onTimeout() { this.destroy(new Error('Download timeout')); });
  });
}

async function ensureDownloaded(model) {
  const dir = path.join(MODELS_DIR, model.id);
  if (fs.existsSync(path.join(dir, 'saved_model.pb'))) return dir;
  const tmp = `${dir}.partial`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  console.log(`[ObjectDetection] Downloading ${model.id}…`);
  try {
    await downloadAndExtract(model.url, tmp);
    if (!fs.existsSync(path.join(tmp, 'saved_model.pb'))) throw new Error('archive has no saved_model.pb');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(tmp, dir);
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
  return dir;
}

async function load(id) {
  const model = EFFICIENTDET_MODELS.find((m) => m.id === id);
  if (!model) throw new Error(`Unknown EfficientDet model '${id}'`);
  const tf = require('@tensorflow/tfjs-node');
  const { CLASSES } = require('@tensorflow-models/coco-ssd/dist/classes');
  const dir = await ensureDownloaded(model);
  const saved = await tf.node.loadSavedModel(dir, ['serve'], 'serving_default');

  return {
    // image: int32/uint8 tensor3d [h, w, 3] (what rawToTensor builds).
    async detect(image, maxResults = 20, minScore = 0.2) {
      const input = tf.tidy(() => image.expandDims(0).toInt());
      let out;
      try { out = saved.predict({ images: input }); }
      finally { input.dispose(); }
      try {
        // output_0 boxes [1,100,4] = [ymin, xmin, ymax, xmax] in pixels,
        // output_1 scores [1,100], output_2 COCO class ids [1,100].
        const [boxes, scores, classes] = await Promise.all([
          out.output_0.array(), out.output_1.array(), out.output_2.array(),
        ]);
        const result = [];
        for (let i = 0; i < scores[0].length && result.length < maxResults; i++) {
          const score = scores[0][i];
          if (score < minScore) continue;
          const name = CLASSES[Math.round(classes[0][i])]?.displayName;
          if (!name) continue;
          const [y1, x1, y2, x2] = boxes[0][i];
          result.push({ bbox: [x1, y1, x2 - x1, y2 - y1], class: name, score });
        }
        return result;
      } finally {
        tf.dispose(Object.values(out));
      }
    },
  };
}

module.exports = { EFFICIENTDET_MODELS, isEfficientDet, load };
