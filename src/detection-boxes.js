'use strict';

// Latest per-camera object-detection bounding boxes, broadcast to the
// dashboard so the camera modal can overlay them on the live view. Mirrors
// camera-log.js's singleton-EventEmitter shape exactly — same pattern, just
// "latest snapshot per camera" instead of an append-only ring buffer, since
// boxes are meant to be replaced wholesale on every poll (including with an
// empty array once nothing's detected anymore), not accumulated.

const { EventEmitter } = require('events');

class DetectionBoxes extends EventEmitter {
  constructor() {
    super();
    this._latest = new Map(); // camera display name -> entry
  }

  // items: [{ class, score, bbox: [x, y, w, h] }] in pixel coords of a
  // imgWidth x imgHeight frame — the client scales to whatever size it's
  // actually rendering the video/snapshot at.
  set(camera, items, imgWidth, imgHeight) {
    const entry = { camera, items, imgWidth, imgHeight, ts: Date.now() };
    this._latest.set(camera, entry);
    this.emit('update', entry);
    return entry;
  }

  get(camera) {
    return this._latest.get(camera) || { camera, items: [], imgWidth: 0, imgHeight: 0, ts: 0 };
  }
}

module.exports = new DetectionBoxes();
