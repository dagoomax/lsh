// Shared history-series helpers — used by DeviceModal's full Chart and by
// EnergyFlow's compact trend sparklines, so the downsample/smoothing math
// (and its edge cases) lives in exactly one place.

export async function fetchHistory(path) {
  try {
    const r = await fetch(`/api/history/${path}`, { credentials: 'same-origin' })
    const j = await r.json()
    return downsample(j.points || [], 400)
  } catch { return [] }
}

// Cap retained history: charts can't show more points than pixels anyway.
// Stride-sample, keeping the last point so the "now" value is always exact.
export function downsample(pts, max) {
  if (pts.length <= max) return pts
  const stride = pts.length / max
  const out = []
  for (let i = 0; i < max - 1; i++) out.push(pts[Math.floor(i * stride)])
  out.push(pts[pts.length - 1])
  return out
}

// Catmull-Rom → bezier smoothing for a silky line
export function smoothPath(pts) {
  if (pts.length < 2) return ''
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)]
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`
  }
  return d
}
