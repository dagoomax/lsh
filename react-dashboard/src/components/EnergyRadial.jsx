import { SunIcon, PylonIcon, BatteryCellIcon } from './Icons'
import { gt } from '../i18n'

// Compact corner energy widget for the Wall Dashboard — same animated-dash
// technique as the full Energy tab's FlowDiagram (components/EnergyFlow.jsx),
// just redrawn as a small 3-node widget (Solar / Grid / Battery — the only
// readings LSH actually has; no Gas/Water integration exists) instead of that
// tab's full 4-node hub diagram.
const fmtKw = v => v == null || isNaN(v) ? '—' : `${(Math.abs(v) / 1000).toFixed(1)} kW`
const flowDur = w => `${Math.max(0.45, Math.min(2.8, 900 / Math.max(60, Math.abs(w)))).toFixed(2)}s`

function Node({ x, y, icon: Icon, label, color, value }) {
  return (
    <g>
      <circle cx={x} cy={y} r="26" fill="rgba(20,22,26,0.75)" stroke={color} strokeWidth="2"
        style={{ filter: `drop-shadow(0 0 6px ${color})` }} />
      <g transform={`translate(${x - 11}, ${y - 15})`}><Icon color={color} size={22} /></g>
      <text x={x} y={y + 20} textAnchor="middle" fontSize="10" fontWeight="700" fill={color}>{value}</text>
      <text x={x} y={y - 34} textAnchor="middle" fontSize="10" fontWeight="600" fill="rgba(255,255,255,0.6)">{label}</text>
    </g>
  )
}

function Line({ d, color, watts }) {
  const active = Math.abs(watts ?? 0) > 5
  return (
    <g>
      <path d={d} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="2" />
      {active && (
        <path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round"
          strokeDasharray="5 13" style={{ animation: 'eflow-dash 1s linear infinite', animationDuration: flowDur(watts), filter: `drop-shadow(0 0 4px ${color})` }} />
      )}
    </g>
  )
}

export default function EnergyRadial({ energy }) {
  const solarW = energy?.solar?.power
  const gridW  = energy?.grid?.power
  const battW  = energy?.battery?.power
  const exporting = (gridW ?? 0) < 0
  const hub = { x: 46, y: 78 }

  return (
    <svg viewBox="0 0 150 150" className="wall-energy-svg">
      <Line d={`M ${hub.x} ${hub.y} L 112 34`}  color="var(--orange)"    watts={solarW} />
      <Line d={`M ${hub.x} ${hub.y} L 112 122`} color="var(--pink,#db61a2)" watts={battW} />
      <Node x={hub.x} y={hub.y} icon={PylonIcon} label={gt('e_net', 'Net')} color="var(--accent-lt)"
        value={`${exporting ? '↗' : '↙'} ${fmtKw(gridW)}`} />
      <Node x={112} y={34}  icon={SunIcon}         label={gt('e_solar', 'Solar')}   color="var(--orange)" value={fmtKw(solarW)} />
      <Node x={112} y={122} icon={BatteryCellIcon} label={gt('e_battery', 'Battery')} color="var(--pink,#db61a2)" value={fmtKw(battW)} />
    </svg>
  )
}
