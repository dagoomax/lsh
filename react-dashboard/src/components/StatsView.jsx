import { useMemo, useState } from 'react'
import { Chart } from './DeviceModal'
import { ChartIcon } from './Icons'
import { gt } from '../i18n'

// ── Graphs & Statistics tab — cross-device history charts + summary stats ──

const FILTERS = [
  { id: 'all',   label: () => gt('filter_all', 'All') },
  { id: 'temp',  label: () => '🌡 ' + gt('filter_temp', 'Temperature') },
  { id: 'power', label: () => '⚡ ' + gt('filter_power', 'Power & Energy') },
  { id: 'humid', label: () => '💧 ' + gt('filter_humid', 'Humidity') },
  { id: 'other', label: () => '📈 ' + gt('filter_other', 'Other') },
]

function classify(sensor) {
  const u = (sensor.unit || '').toLowerCase()
  if (u.includes('°') || sensor.homekit === 'temperature') return 'temp'
  if (['w', 'kw', 'kwh', 'wh', 'v', 'a', 'va'].includes(u)) return 'power'
  if (u === '%' && /humid|rh/i.test(sensor.name || sensor.path)) return 'humid'
  if (u === '%' && /soc|battery|level/i.test(sensor.name || sensor.path)) return 'power'
  return 'other'
}

const CLASS_ORDER = { temp: 0, power: 1, humid: 2, other: 3 }
const CLASS_ACCENT = { temp: '#f0883e', power: '#d29922', humid: '#39d353', other: '#79c0ff' }

function StatCard({ label, value, unit, color }) {
  return (
    <div style={{
      flex: '1 1 120px', minWidth: 120, padding: '12px 16px',
      background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14,
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: -20, right: -20, width: 70, height: 70, borderRadius: '50%',
        background: `radial-gradient(circle, ${color}22, transparent 70%)` }} />
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text3)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1.3 }}>
        {value}<span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginLeft: 3 }}>{unit}</span>
      </div>
    </div>
  )
}

export default function StatsView({ devices, energy, onOpen }) {
  const [filter, setFilter] = useState('all')

  // Every sensor with a live numeric value is graphable
  const graphable = useMemo(() => {
    const out = []
    for (const d of devices) {
      for (const s of d.sensors || []) {
        const v = d.readings?.[s.path]?.value
        if (typeof v !== 'number') continue
        if (s.hidden) continue
        out.push({ device: d, sensor: s, value: v, cls: classify(s) })
      }
    }
    out.sort((a, b) => (CLASS_ORDER[a.cls] - CLASS_ORDER[b.cls]) || a.device.label.localeCompare(b.device.label))
    return out
  }, [devices])

  const shown = (filter === 'all' ? graphable : graphable.filter(g => g.cls === filter)).slice(0, 30)

  // Summary stats
  const temps = graphable.filter(g => g.cls === 'temp').map(g => g.value)
  const avgTemp = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null
  const onCount = devices.filter(d => (d.sensors || []).some(s => {
    const v = d.readings?.[s.path]?.value
    return s.controllable && (v === 1 || v === true || v === 'on')
  })).length
  const soc = energy?.battery?.soc
  const solar = energy?.solar?.power

  const counts = { all: graphable.length }
  for (const g of graphable) counts[g.cls] = (counts[g.cls] || 0) + 1

  return (
    <div style={{ padding: '8px 0 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Summary stat cards */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <StatCard label={gt('devices', 'Devices')} value={devices.length} unit="" color="#79c0ff" />
        <StatCard label={gt('active', 'Active now')} value={onCount} unit="on" color="#d29922" />
        <StatCard label={gt('series', 'Tracked series')} value={graphable.length} unit="" color="#bc8cff" />
        {avgTemp != null && <StatCard label={gt('avg_temp', 'Avg temperature')} value={avgTemp.toFixed(1)} unit="°C" color="#f0883e" />}
        {soc != null && <StatCard label={gt('battery', 'Battery')} value={Math.round(soc)} unit="%" color="#3fb950" />}
        {solar != null && <StatCard label={gt('solar', 'Solar')} value={Math.round(solar)} unit="W" color="#f0c000" />}
      </div>

      {/* Type filter */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {FILTERS.filter(f => f.id === 'all' || counts[f.id]).map(f => {
          const active = filter === f.id
          return (
            <button key={f.id} onClick={() => setFilter(f.id)} style={{
              padding: '5px 13px', borderRadius: 999, border: `1px solid ${active ? 'rgba(121,192,255,0.45)' : 'var(--border)'}`,
              background: active ? 'rgba(121,192,255,0.14)' : 'var(--card)',
              color: active ? '#c9e3ff' : 'var(--text2)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>
              {f.label()} <span style={{ opacity: 0.6 }}>({counts[f.id] || counts.all})</span>
            </button>
          )
        })}
      </div>

      {/* Chart grid */}
      {shown.length === 0 && (
        <div style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center', padding: 30 }}>
          <ChartIcon size={28} color="var(--text3)" />
          <div style={{ marginTop: 8 }}>{gt('empty', 'No numeric sensors reporting yet.')}</div>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {shown.map(({ device, sensor, value, cls }) => (
          <div key={`${device.key}/${sensor.path}`} style={{
            background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '12px 14px',
          }}>
            <div onClick={() => onOpen?.(device.key)} style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
              <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {device.label}
              </span>
              <span style={{ fontSize: 11.5, color: 'var(--text3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {sensor.name || sensor.label || sensor.path}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 15, fontWeight: 800, color: CLASS_ACCENT[cls], fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                {Number.isInteger(value) ? value : value.toFixed(1)}{sensor.unit || ''}
              </span>
            </div>
            <Chart deviceKey={device.key} sensor={sensor} accent={CLASS_ACCENT[cls]} height={130} />
          </div>
        ))}
      </div>
      {graphable.length > 30 && filter === 'all' && (
        <div style={{ color: 'var(--text3)', fontSize: 11.5, textAlign: 'center' }}>
          {gt('showing', 'Showing first 30 of {n} series — use the filters to narrow down.', { n: graphable.length })}
        </div>
      )}
    </div>
  )
}
