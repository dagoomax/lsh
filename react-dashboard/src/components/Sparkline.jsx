import { smoothPath } from '../historyChart'

// Generic axis-free trend sparkline (area fill + smoothed line + a glowing
// "now" dot) — shared by ThermostatPanel and WeatherDetails so the
// min/max-scaling math (deliberately NOT zero-anchored, unlike
// EnergyFlow.jsx's power sparklines — a temperature/pressure/etc. series is
// a tight band, forcing the baseline to 0 would flatten it to nothing)
// lives in one place.
export default function Sparkline({ points, width = 220, height = 44, color = '#4A9EFF', gradientId }) {
  if (points == null) {
    return <div className="sparkline-empty">…</div>
  }
  if (points.length < 2) {
    return <div className="sparkline-empty">—</div>
  }
  const vals = points.map((p) => p[1])
  let min = Math.min(...vals), max = Math.max(...vals)
  if (min === max) { min -= 1; max += 1 }
  const pad = (max - min) * 0.2
  min -= pad; max += pad
  const t0 = points[0][0], t1 = points[points.length - 1][0]
  const span = Math.max(1, t1 - t0)
  const padX = 4
  const xy = points.map(([t, v]) => [
    padX + ((t - t0) / span) * (width - padX * 2),
    4 + (1 - (v - min) / (max - min)) * (height - 8),
  ])
  const line = smoothPath(xy)
  const last = xy[xy.length - 1]
  const area = `${line} L ${last[0].toFixed(1)} ${height} L ${xy[0][0].toFixed(1)} ${height} Z`
  const gid = gradientId || `spark-${color.replace('#', '')}`
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="sparkline-svg">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} stroke="none" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="3.5" fill={color} style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
    </svg>
  )
}
