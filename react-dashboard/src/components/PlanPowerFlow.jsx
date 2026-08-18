import { useEffect, useState } from 'react'
import { gt } from '../i18n'

// Animated power-flow overlay for the Home Plan board: glowing lines from a
// fixed "panel" anchor out to every device currently drawing power, each
// tagged with its live wattage and a lit-up device icon — reuses the exact
// .eflow-track/.eflow-flow visual language from the whole-house Energy tab
// (components/EnergyFlow.jsx) so the two features read as one system.
const flowDur = w => `${Math.max(0.45, Math.min(2.8, 900 / Math.max(60, Math.abs(w)))).toFixed(2)}s`
const fmtW = w => (w >= 1000 ? `${(w / 1000).toFixed(2)}kW` : `${Math.round(w)}W`)

function useTariff() {
  const [tariff, setTariff] = useState(null)
  useEffect(() => {
    let alive = true
    const load = () => fetch('/api/tariff', { credentials: 'same-origin' })
      .then(r => r.json()).then(d => { if (alive && d.success) setTariff(d.data) }).catch(() => {})
    load()
    const iv = setInterval(load, 60000) // windows change by the minute
    return () => { alive = false; clearInterval(iv) }
  }, [])
  return tariff
}

export default function PlanPowerFlow({ devices, panel, totalW, solarW, U }) {
  const px = panel.x * U, py = panel.y * U
  const tariff = useTariff()

  return (
    <div className="plan-power-layer">
      <svg className="plan-power-svg" width="100%" height="100%" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        {devices.map(d => {
          const dx = d.x * U, dy = d.y * U
          const path = `M ${px} ${py} L ${dx} ${dy}`
          return (
            <g key={d.key}>
              <path className="eflow-track" d={path} />
              <path className="eflow-flow" d={path} stroke="#4A9EFF"
                style={{ '--fc': '#4A9EFF', animationDuration: flowDur(d.watts) }} />
            </g>
          )
        })}
      </svg>

      <div className="plan-power-pos" style={{ left: px, top: py }}>
        <div className="plan-bill">
          <div className="plan-power-panel" title={gt('smart_panel', 'Smart panel')}>⚡</div>
        </div>
      </div>
      <div className="plan-power-pos" style={{ left: px, top: py - 46 }}>
        <div className="plan-bill">
          <div className="plan-power-summary">
            <span>{gt('total_consumption', 'Total consumption')}: {fmtW(totalW)}</span>
            {solarW != null && <span>{gt('e_solar', 'Solar')}: {fmtW(solarW)}</span>}
            {tariff?.current && (
              <span>{gt('tariff_current', 'Current tariff')}: {tariff.current.label} {tariff.currency}{tariff.current.price}/kWh</span>
            )}
            {tariff?.next && (
              <span>{gt('tariff_next', 'Next')}: {tariff.next.label} {tariff.currency}{tariff.next.price}/kWh ({gt('starts', 'starts')} {tariff.next.start})</span>
            )}
          </div>
        </div>
      </div>

      {devices.map(d => {
        const Icon = d.icon
        return (
          <div key={d.key} className="plan-power-pos" style={{ left: d.x * U, top: d.y * U - 40 }}>
            <div className="plan-bill">
              <div className="plan-power-chip">
                <span className="plan-power-chip-icon">
                  {d.customIcon && !d.customIcon.startsWith('svg:')
                    ? d.customIcon
                    : Icon && <Icon size={13} color="#4A9EFF" />}
                </span>
                {d.label} {fmtW(d.watts)}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
