'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { glbToBoxes } = require('../src/glb-boxes');

// A GLB with only its JSON chunk — glbToBoxes reads bounds from the accessors, never the geometry
const glb = (json) => {
  let body = Buffer.from(JSON.stringify(json));
  body = Buffer.concat([body, Buffer.alloc((4 - (body.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + body.length, 8);
  head.writeUInt32LE(body.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([head, body]);
};
const unit = { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5], count: 24 };
const model = glb({
  scene: 0, scenes: [{ nodes: [0] }],
  nodes: [
    { name: 'home', children: [1, 2, 3, 4] },
    { name: 'slab', mesh: 0, translation: [0, 0.1, 0], scale: [10, 0.2, 6] },
    { name: 'wall_n', mesh: 1, translation: [0, 1.5, -2.9], scale: [10, 2.6, 0.2] },
    { name: 'door.leaf', mesh: 2, translation: [2, 1.2, 0], rotation: [0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8)], scale: [1, 2, 0.04] },
    { name: 'lighting__light_hall', mesh: 3, translation: [1, 2.7, 1], scale: [0.2, 0.1, 0.2] },
  ],
  meshes: [0, 1, 2, 3].map((m) => ({ primitives: [{ attributes: { POSITION: m === 3 ? 1 : 0 }, material: m }] })),
  accessors: [unit, { ...unit, count: 64 }],
  materials: [
    { name: 'slab', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } },
    { name: 'plaster_12', pbrMetallicRoughness: { baseColorFactor: [0, 0, 0, 1] } },
    { name: 'glass', pbrMetallicRoughness: { baseColorFactor: [0.5, 0.5, 0.5, 0.3] } },
    { name: 'bulb' },
  ],
});

test('glb-boxes: footprint, height, yaw, colour and material of each part', () => {
  const r = glbToBoxes(model);
  assert.deepEqual([r.w, r.d, r.h], [10, 6, 2.8]);
  const by = Object.fromEntries(r.boxes.map((b) => [b.n, b]));
  assert.deepEqual(by.slab, { n: 'slab', x: 5, y: 3, w: 10, d: 6, z: 0, h: 0.2, c: '#ffffff', m: 'slab' });
  // origin is the north-west corner on the ground; the model's Z runs down the board
  assert.deepEqual(by.wall_n, { n: 'wall_n', x: 5, y: 0.1, w: 10, d: 0.2, z: 0.2, h: 2.6, c: '#000000', m: 'plaster' });
  assert.equal(by.door_leaf.r, 135);            // a turned leaf keeps its own footprint
  assert.equal(by.door_leaf.w, 1); assert.equal(by.door_leaf.d, 0.04);
  assert.equal(by.door_leaf.o, 0.3);
  assert.equal(by.door_leaf.c, '#bcbcbc');       // linear 0.5 → sRGB
  assert.equal(by.lighting__light_hall.round, 1); // more than a box, square footprint
  assert.equal(by.lighting__light_hall.m, 'bulb');
});

test('glb-boxes: alignment scale applies, a non-GLB buffer is rejected', () => {
  const r = glbToBoxes(model, { scale: 2 });
  assert.deepEqual([r.w, r.d], [20, 12]);
  assert.throws(() => glbToBoxes(Buffer.from('o cube\nv 0 0 0\n'.repeat(4))), /Not a GLB/);
});
