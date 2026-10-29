import { useEffect, useState } from 'react'
import { SettingsCard, ListEditor, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { gt, tr } from '../../../i18n'

// Same formula as src/heating-curve-client.js (Viessmann's heating curve).
function flowTemperature(outdoor, { room, slope, shift, minFlow, maxFlow }) {
  const dar = outdoor - room
  const flow = room + shift - slope * dar * (1.4347 + 0.021 * dar + 247.9e-6 * dar * dar)
  return Math.min(maxFlow, Math.max(minFlow, flow))
}

const num = (v, d) => (v === '' || v == null || !Number.isFinite(Number(v)) ? d : Number(v))
const params = (c) => ({
  room: num(c.room, 20), slope: num(c.slope, 1.4), shift: num(c.shift, 0),
  minFlow: num(c.minFlow, 20), maxFlow: num(c.maxFlow, 75),
})

const COLORS = ['var(--orange)', 'var(--blue)', 'var(--green)', 'var(--red)', 'var(--teal)', 'var(--yellow)']
const randomId = () => Math.random().toString(36).slice(2, 10)

// Outdoor −20…+20 °C across, flow 20…80 °C up.
function CurveChart({ curves }) {
  const W = 360, H = 200, L = 34, B = 24, T = 8, R = 8
  const x = (o) => L + ((o + 20) / 40) * (W - L - R)
  const y = (f) => T + (1 - (f - 20) / 60) * (H - T - B)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: 520, display: 'block', margin: '4px 0 12px' }}
      role="img" aria-label={tr('Heating curve preview')}>
      {[20, 30, 40, 50, 60, 70, 80].map((f) => (
        <g key={f}>
          <line x1={L} x2={W - R} y1={y(f)} y2={y(f)} stroke="var(--border)" strokeWidth="1"/>
          <text x={L - 6} y={y(f) + 4} textAnchor="end" fontSize="10" fill="var(--text2)">{f}°</text>
        </g>
      ))}
      {[-20, -10, 0, 10, 20].map((o) => (
        <text key={o} x={x(o)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--text2)">{o}°</text>
      ))}
      {curves.map((c, i) => {
        const p = params(c)
        const pts = []
        for (let o = -20; o <= 20; o += 1) pts.push(`${x(o).toFixed(1)},${y(flowTemperature(o, p)).toFixed(1)}`)
        return <polyline key={c.id || i} points={pts.join(' ')} fill="none" stroke={COLORS[i % COLORS.length]}
          strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
      })}
    </svg>
  )
}

export default function HeatingCurveSection({ config, reload }) {
  const [curves, setCurves] = useState(() => (config.heatingCurves?.curves || []).map((c) => ({
    ...c, target: c.targetDevice && c.targetPath ? `${c.targetDevice}|${c.targetPath}` : '',
  })))
  const [targets, setTargets] = useState([])
  const save = useSettingsSave('/api/settings/heating-curves')

  // Any controllable number setpoint can take the curve's result.
  useEffect(() => {
    fetch('/api/devices', { credentials: 'include' }).then((r) => r.json()).then((d) => {
      const opts = []
      for (const dev of d.data || []) {
        if (dev.key.startsWith('heatingcurve/')) continue
        for (const s of dev.sensors || []) {
          if (s.controllable && s.type === 'range' && s.unit !== '%') {
            opts.push({ value: `${dev.key}|${s.path}`, label: `${dev.label} — ${s.name || s.path}`, raw: true })
          }
        }
      }
      opts.sort((a, b) => a.label.localeCompare(b.label))
      setTargets(opts)
    }).catch(() => {})
  }, [])

  const fields = [
    { key: 'name', label: 'Name', placeholder: 'e.g. Underfloor heating' },
    { key: 'slope', label: 'Slope', placeholder: '1.4', default: '1.4' },
    { key: 'shift', label: 'Shift (K)', placeholder: '0', default: '0' },
    { key: 'room', label: 'Room °C', placeholder: '20', default: '20' },
    { key: 'minFlow', label: 'Min flow °C', placeholder: '20', default: '20' },
    { key: 'maxFlow', label: 'Max flow °C', placeholder: '75', default: '75' },
    { key: 'outdoorKey', label: 'Outdoor temperature key', placeholder: 'openweather/weather/temperature' },
    { key: 'target', label: 'Write flow temperature to', type: 'select', default: '',
      options: [{ value: '', label: '— none (value only) —' }, ...targets] },
  ]

  const onSave = () => save.save(curves.filter((c) => c.name).map(({ target, ...c }) => {
    const [targetDevice = '', targetPath = ''] = (target || '').split('|')
    return { ...c, id: c.id || randomId(), targetDevice, targetPath }
  })).then(reload)

  return (
    <SettingsCard title="Heating Curves" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Weather-compensated flow temperature: the colder it is outside, the warmer the water sent to the radiators or floor. Each curve becomes a device with its computed flow temperature (for flows, Loxone, the API) and can write it straight to a boiler or heat-pump setpoint. Slope, shift and room temperature can also be changed live on the device.">
      {curves.length > 0 && <CurveChart curves={curves}/>}
      <ListEditor rows={curves} onChange={setCurves} fields={fields} addLabel="+ Add Heating Curve"/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} onClick={onSave}>{tr('Save Heating Curves')}</Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}
