import { useRef, useState } from 'react'
import { getGroup } from './DeviceList'
import { gt } from '../i18n'
import { useHistoryPoints } from '../historyChart'
import { useHvacAnalytics } from '../hvacAnalytics'
import Sparkline from './Sparkline'

// A device counts as a "thermostat" here if it's got a controllable range
// sensor that looks like a temperature setpoint — works across whichever
// platform reports it (MC6, Homey, SmartThings, LG ThinQ, Vera, Domatiq, …)
// rather than hardcoding one integration.
const isSetpoint = (s) => s.controllable && s.type === 'range' && /temp|setpoint/i.test(s.path)

// Compass-bearing angles (0° = top, clockwise) — the dial is a 270° sweep
// with a 90° gap at the bottom, min at the bottom-left end, max at the
// bottom-right end, same visual language as a real room thermostat.
const START = -135, SWEEP = 270
const rad = (deg) => (deg * Math.PI) / 180
const pointOn = (deg, r, cx, cy) => [cx + r * Math.sin(rad(deg)), cy - r * Math.cos(rad(deg))]
const angleFromCenter = (dx, dy) => (Math.atan2(dx, -dy) * 180) / Math.PI

function valueToAngle(v, min, max) {
  const pct = Math.min(1, Math.max(0, (v - min) / (max - min)))
  return START + pct * SWEEP
}
function angleToValue(deg, min, max) {
  const a = deg > 135 ? 135 : deg < -135 ? -135 : deg // clamp the bottom gap to nearest end
  const pct = (a - START) / SWEEP
  return min + pct * (max - min)
}

const SIZE = 210, RADIUS = 88, CENTER = SIZE / 2

function ThermoGraph({ deviceKey }) {
  const points = useHistoryPoints(`${deviceKey}/temperature`, 60000, 6)
  return (
    <div className="wall-thermo-graph">
      <div className="wall-thermo-graph-head">
        <span>{gt('temperature', 'Temperature')}</span>
        <span className="wall-thermo-graph-range">{gt('trend_6h', 'Last 6h')}</span>
      </div>
      {points != null && points.length < 2
        ? <div className="wall-thermo-graph-empty">{gt('collecting', 'Collecting data — check back in a few minutes')}</div>
        : <Sparkline points={points} height={56} color="#f0883e" gradientId="thermo-spark-fill" />}
    </div>
  )
}

function HvacStats({ deviceKey }) {
  const stats = useHvacAnalytics(deviceKey, 'temperature', 6)
  if (!stats) return null

  const items = [
    { label: gt('hvac_cycles', 'Cycles (6h)'), value: stats.cycles },
    { label: gt('hvac_avg_cycle', 'Avg cycle'), value: stats.avgCycleMinutes != null ? `${stats.avgCycleMinutes.toFixed(0)}m` : '—' },
    { label: gt('hvac_hysteresis', 'Hysteresis'), value: stats.hysteresis != null ? `±${stats.hysteresis.toFixed(2)}°` : '—' },
    { label: gt('hvac_swing', 'Swing'), value: (stats.swingMin != null && stats.swingMax != null) ? `${stats.swingMin.toFixed(1)}–${stats.swingMax.toFixed(1)}°` : '—' },
  ]

  return (
    <div className="wall-hvac-stats">
      <div className="wall-hvac-stats-head">{gt('hvac_analytics', 'HVAC Analytics')}</div>
      <div className="wall-hvac-stats-grid">
        {items.map((it) => (
          <div key={it.label} className="wall-hvac-stat">
            <div className="wall-hvac-stat-value">{it.value}</div>
            <div className="wall-hvac-stat-label">{it.label}</div>
          </div>
        ))}
      </div>
      {stats.cycles === 0 &&
        <div className="wall-hvac-stats-empty">{gt('hvac_no_cycles', 'No cycling detected in the last 6h — temperature has been steady')}</div>}
    </div>
  )
}

function ThermoDial({ device, sensor, onCommand }) {
  const svgRef = useRef(null)
  const dragging = useRef(false)
  const [local, setLocal] = useState(null)
  const r = device.readings || {}
  const min = sensor.min ?? 5, max = sensor.max ?? 35
  const step = sensor.step || 0.5
  const value = local ?? r[sensor.path]?.value ?? min
  const current = r.temperature?.value

  const angle = valueToAngle(value, min, max)
  const [tx, ty] = pointOn(START, RADIUS, CENTER, CENTER)
  const [ex, ey] = pointOn(START + SWEEP, RADIUS, CENTER, CENTER)
  const [hx, hy] = pointOn(angle, RADIUS, CENTER, CENTER)
  const trackPath = `M ${tx} ${ty} A ${RADIUS} ${RADIUS} 0 1 1 ${ex} ${ey}`
  const progressLarge = angle - START > 180 ? 1 : 0
  const progressPath = `M ${tx} ${ty} A ${RADIUS} ${RADIUS} 0 ${progressLarge} 1 ${hx} ${hy}`

  const valueFromEvent = (e) => {
    const rect = svgRef.current.getBoundingClientRect()
    const scale = SIZE / rect.width
    const dx = (e.clientX - rect.left) * scale - CENTER
    const dy = (e.clientY - rect.top) * scale - CENTER
    const deg = angleFromCenter(dx, dy)
    const raw = angleToValue(deg, min, max)
    return Math.round(raw / step) * step
  }

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = true
    setLocal(+valueFromEvent(e).toFixed(2))
  }
  const onPointerMove = (e) => {
    if (!dragging.current) return
    setLocal(+valueFromEvent(e).toFixed(2))
  }
  const onPointerUp = () => {
    if (!dragging.current) return
    dragging.current = false
    if (local != null) onCommand(device.key, sensor.path, local)
  }

  return (
    <div className="wall-thermo-dial-wrap">
      <svg ref={svgRef} viewBox={`0 0 ${SIZE} ${SIZE}`} className="wall-thermo-dial"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <path d={trackPath} className="wall-thermo-dial-track" />
        <path d={progressPath} className="wall-thermo-dial-progress" />
        <circle cx={hx} cy={hy} r="13" className="wall-thermo-dial-handle" />
        <foreignObject x={CENTER - 60} y={CENTER - 34} width="120" height="68">
          <div className="wall-thermo-dial-center">
            <div className="wall-thermo-dial-value">{value.toFixed(1)}°</div>
            {typeof current === 'number' && <div className="wall-thermo-dial-current">now {current.toFixed(1)}°</div>}
          </div>
        </foreignObject>
      </svg>
      <div className="wall-thermo-dial-label">{device.label}</div>
      <ThermoGraph deviceKey={device.key} />
      <HvacStats deviceKey={device.key} />
    </div>
  )
}

export default function ThermostatPanel({ devices, onCommand }) {
  const thermostats = (devices || []).filter((d) => getGroup(d) === 'Climate' && (d.sensors || []).some(isSetpoint))
  if (!thermostats.length) return null

  return (
    <div className="wall-thermo">
      <div className="wall-thermo-title">{gt('thermostat', 'Thermostat')}</div>
      {thermostats.map((d) => (
        <ThermoDial key={d.key} device={d} sensor={d.sensors.find(isSetpoint)} onCommand={onCommand} />
      ))}
    </div>
  )
}
