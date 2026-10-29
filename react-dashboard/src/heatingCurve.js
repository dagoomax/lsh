// Same formula as src/heating-curve-client.js (Viessmann's heating curve):
// DAR = outdoor − room, flow = room + shift − slope · DAR · (1.4347 +
// 0.021·DAR + 247.9e-6·DAR²), clamped to min/max flow. Drawn without the
// room correction, which only moves the current point.
export function flowTemperature(outdoor, { room, slope, shift, minFlow, maxFlow }) {
  const dar = outdoor - room
  const flow = room + shift - slope * dar * (1.4347 + 0.021 * dar + 247.9e-6 * dar * dar)
  return Math.min(maxFlow, Math.max(minFlow, flow))
}

const num = (v, d) => (v === '' || v == null || !Number.isFinite(Number(v)) ? d : Number(v))
export const curveParams = (c) => ({
  room: num(c.room, 20), slope: num(c.slope, 1.4), shift: num(c.shift, 0),
  minFlow: num(c.minFlow, 20), maxFlow: num(c.maxFlow, 75),
})
