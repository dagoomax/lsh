import { useMemo, useState } from 'react'
import { gt } from '../i18n'
import { useHistoryPoints } from '../historyChart'

/**
 * Microcontroller index — estimated number of embedded microcontrollers on the
 * network, from the devices marked permanent. microcontroller-index-client.js
 * registers one `system/microcontrollers` device (type 'mcu-index') with total /
 * devices / breakdown (JSON string) sensors; this card shows the current total,
 * a step-line history of it and the per-type split.
 */

const read = (dev, path) => dev.readings?.[path]?.value

// Hours > 6 are served from Mongo (see historyChart.js), so those ranges stay
// empty when it isn't configured.
const RANGES = [
  { label: '1h', h: 1 },
  { label: '6h', h: 6 },
  { label: '24h', h: 24 },
  { label: '7d', h: 168 },
]

// Counts are integers that change in jumps, so draw a step line, not a curve.
function StepChart({ points }) {
  const W = 320, H = 96, padL = 26, padB = 14
  if (!points || points.length < 2) {
    return <div className="mcu-chart-empty">{points == null ? '…' : gt('mcu.no_history', 'No history yet')}</div>
  }
  const t0 = points[0][0], t1 = points.at(-1)[0]
  const vals = points.map(p => p[1])
  const vMax = Math.max(1, ...vals)
  const vMin = Math.min(0, ...vals)
  const X = t => padL + ((t - t0) / Math.max(1, t1 - t0)) * (W - padL - 4)
  const Y = v => 4 + (1 - (v - vMin) / (vMax - vMin)) * (H - padB - 8)
  let d = `M ${X(points[0][0]).toFixed(1)} ${Y(points[0][1]).toFixed(1)}`
  for (let i = 1; i < points.length; i++) {
    d += ` L ${X(points[i][0]).toFixed(1)} ${Y(points[i - 1][1]).toFixed(1)} L ${X(points[i][0]).toFixed(1)} ${Y(points[i][1]).toFixed(1)}`
  }
  const last = points.at(-1)
  const area = `${d} L ${X(last[0]).toFixed(1)} ${H - padB} L ${padL} ${H - padB} Z`
  const fmtT = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return (
    <svg className="mcu-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="mcu-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent, #4da3ff)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--accent, #4da3ff)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[vMin, vMax].map(v => (
        <g key={v}>
          <line x1={padL} x2={W - 4} y1={Y(v)} y2={Y(v)} stroke="var(--white-10)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <text x={padL - 4} y={Y(v) + 3} textAnchor="end" fontSize="9" fill="var(--text3)" fontFamily="system-ui">{Math.round(v)}</text>
        </g>
      ))}
      <path d={area} fill="url(#mcu-fill)" />
      <path d={d} fill="none" stroke="var(--accent, #4da3ff)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <circle cx={X(last[0])} cy={Y(last[1])} r="3" fill="var(--accent, #4da3ff)" />
      <text x={padL} y={H - 2} fontSize="9" fill="var(--text3)" fontFamily="system-ui">{fmtT(t0)}</text>
      <text x={W - 4} y={H - 2} textAnchor="end" fontSize="9" fill="var(--text3)" fontFamily="system-ui">{fmtT(t1)}</text>
    </svg>
  )
}

export default function MicrocontrollerIndex({ devices }) {
  const dev = useMemo(
    () => (devices || []).find(d => d.type === 'mcu-index' || d.key === 'system/microcontrollers'),
    [devices],
  )
  const [rangeH, setRangeH] = useState(6)
  const history = useHistoryPoints(dev ? `${dev.key}/total` : null, 30000, rangeH > 6 ? rangeH : null)

  const rows = useMemo(() => {
    if (!dev) return []
    let b = {}
    try { b = JSON.parse(read(dev, 'breakdown') || '{}') } catch { /* leave empty */ }
    return Object.entries(b).map(([type, v]) => ({ type, ...v })).sort((a, c) => c.mcus - a.mcus)
  }, [dev])

  if (!dev) return null

  const total = read(dev, 'total')
  const count = read(dev, 'devices')
  const max = Math.max(1, ...rows.map(r => r.mcus))
  // 1h shows only the tail of the in-memory window
  const since = Date.now() - rangeH * 3600 * 1000
  const shown = history && rangeH <= 6 ? history.filter(p => p[0] >= since) : history

  return (
    <div className="card mcu-card">
      <div className="mcu-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="mcu-title">{dev.label || gt('mcu.title', 'Microcontroller index')}</div>
          <div className="mcu-sub">
            {count != null ? `${count} ${gt('mcu.permanent', 'permanent devices')}` : gt('mcu.hint', 'Mark devices as permanent to count them')}
          </div>
        </div>
        <div className="mcu-total">{total ?? '—'}</div>
      </div>

      <div className="mcu-ranges">
        {RANGES.map(r => (
          <button key={r.label} className={r.h === rangeH ? 'on' : ''} onClick={() => setRangeH(r.h)}>{r.label}</button>
        ))}
      </div>
      <StepChart points={shown} />

      {rows.length > 0 && (
        <div className="mcu-rows">
          {rows.map(r => (
            <div key={r.type} className="mcu-row">
              <span className="mcu-row-name">{r.type}</span>
              <span className="mcu-row-bar"><i style={{ width: `${(r.mcus / max) * 100}%` }} /></span>
              <span className="mcu-row-val">{r.mcus}<small> / {r.devices}</small></span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
