import { useEffect, useMemo, useState } from 'react'

// Turning-point (zig-zag) detection on a temperature history series — the
// actual peak-to-trough swing of the temperature curve *is* the control
// loop's hysteresis band. Deriving it this way (rather than from a
// platform-reported on/off sensor) is deliberate: most integrations don't
// expose an "actively heating" signal at all, and the ones that do (e.g.
// MC6's `onoff`) report whether the unit is powered, not whether it's
// mid-cycle — not reliable enough to count cycles from. The temperature
// series itself is universal across every thermostat-reporting platform.
//
// minDelta filters sensor jitter: a swing has to move at least this far
// before it counts as a real turn, not noise.
export function findTurningPoints(points, minDelta) {
  if (!points || points.length < 3) return []
  const turns = []
  let extIdx = 0
  let dir = 0 // 0 = undetermined, 1 = rising, -1 = falling
  for (let i = 1; i < points.length; i++) {
    if (dir === 0) {
      const dv = points[i][1] - points[extIdx][1]
      if (Math.abs(dv) >= minDelta) { dir = dv > 0 ? 1 : -1; extIdx = i }
      continue
    }
    if (dir === 1) {
      if (points[i][1] >= points[extIdx][1]) extIdx = i
      else if (points[extIdx][1] - points[i][1] >= minDelta) {
        turns.push({ t: points[extIdx][0], v: points[extIdx][1], kind: 'peak' })
        dir = -1; extIdx = i
      }
    } else {
      if (points[i][1] <= points[extIdx][1]) extIdx = i
      else if (points[i][1] - points[extIdx][1] >= minDelta) {
        turns.push({ t: points[extIdx][0], v: points[extIdx][1], kind: 'trough' })
        dir = 1; extIdx = i
      }
    }
  }
  return turns
}

// windowMs should be the series' actual observed span (last-first timestamp),
// not the requested history range — a freshly restarted server won't have
// data going back the full window yet, and using the nominal range would
// understate the runtime/cycle-rate stats.
export function computeHvacAnalytics(tempPoints, windowMs, minDelta = 0.15) {
  if (!tempPoints || tempPoints.length < 3 || !windowMs) return null
  const turns = findTurningPoints(tempPoints, minDelta)
  const vals = tempPoints.map((p) => p[1])
  const swingMin = +Math.min(...vals).toFixed(1)
  const swingMax = +Math.max(...vals).toFixed(1)
  if (turns.length < 2) return { cycles: 0, hysteresis: null, avgCycleMinutes: null, swingMin, swingMax }

  const amplitudes = []
  for (let i = 1; i < turns.length; i++) amplitudes.push(Math.abs(turns[i].v - turns[i - 1].v))
  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length

  const troughs = turns.filter((t) => t.kind === 'trough').length
  const peaks = turns.filter((t) => t.kind === 'peak').length
  const cycles = Math.min(peaks, troughs) // a full cycle needs one of each

  return {
    cycles,
    hysteresis: +avg(amplitudes).toFixed(2),
    avgCycleMinutes: cycles ? +((windowMs / cycles) / 60000).toFixed(1) : null,
    swingMin,
    swingMax,
  }
}

// Deliberately bypasses historyChart.js's fetchHistory/downsample — that
// caps series at 400 points for chart rendering, but the in-memory ring
// buffer alone can hold ~700 points over 6h, and stride-sampling down to
// 400 risks skipping the exact sample that marks a short cycle's peak or
// trough. Analytics needs the full-resolution series; a chart doesn't.
async function fetchRawHistory(path, hours) {
  try {
    const q = hours ? `?hours=${hours}` : ''
    const r = await fetch(`/api/history/${path}${q}`, { credentials: 'same-origin' })
    const j = await r.json()
    return j.points || []
  } catch { return [] }
}

export function useHvacAnalytics(deviceKey, tempPath = 'temperature', hours = 6, intervalMs = 60000) {
  const [points, setPoints] = useState(null)
  useEffect(() => {
    let alive = true
    setPoints(null)
    const load = () => fetchRawHistory(`${deviceKey}/${tempPath}`, hours).then((p) => { if (alive) setPoints(p) })
    load()
    const iv = setInterval(load, intervalMs)
    return () => { alive = false; clearInterval(iv) }
  }, [deviceKey, tempPath, hours, intervalMs])

  return useMemo(() => {
    if (points == null) return null // still loading
    if (points.length < 3) return { cycles: 0, hysteresis: null, avgCycleMinutes: null, swingMin: null, swingMax: null }
    const windowMs = points[points.length - 1][0] - points[0][0]
    return computeHvacAnalytics(points, windowMs)
  }, [points])
}
