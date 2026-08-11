// Shared history-series helpers — used by DeviceModal's full Chart and by
// EnergyFlow's compact trend sparklines, so the downsample/smoothing math
// (and its edge cases) lives in exactly one place.
import { useEffect, useState } from 'react'

// Poll a history series on an interval, with unmount-safe cleanup. Both
// DeviceModal's Chart and EnergyFlow's sparklines need "fetch now, then
// refresh every N ms, discard results if unmounted" — this is that shape,
// so a cleanup-race fix only ever needs to be made once.
export function useHistoryPoints(path, intervalMs = 30000, hours = null) {
  const [points, setPoints] = useState(null)
  useEffect(() => {
    let alive = true
    setPoints(null)
    const load = () => fetchHistory(path, hours).then(p => { if (alive) setPoints(p) })
    load()
    const iv = setInterval(load, intervalMs)
    return () => { alive = false; clearInterval(iv) }
  }, [path, intervalMs, hours])
  return points
}

// hours: optional — beyond the in-memory ~6h window, the server only serves
// this from Mongo (see src/data-store.js:getHistoryRange) if it's configured;
// omit it (or leave <= 6) to keep the cheap in-memory-only fast path.
export async function fetchHistory(path, hours = null) {
  try {
    const q = hours ? `?hours=${hours}` : ''
    const r = await fetch(`/api/history/${path}${q}`, { credentials: 'same-origin' })
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
