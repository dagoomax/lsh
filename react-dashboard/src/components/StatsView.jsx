import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
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
// CVD-validated on the dark surface (worst adjacent deutan ΔE 15.7, all ≥3:1)
const CLASS_ACCENT = { temp: '#d95926', power: '#9085e9', humid: '#199e70', other: '#3987e5' }

function StatCard({ label, value, unit, color }) {
  return (
    <div className="stat-card">
      <div style={{ position: 'absolute', top: -20, right: -20, width: 70, height: 70, borderRadius: '50%',
        background: `radial-gradient(circle, ${color}26, transparent 70%)` }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 7, height: 7, borderRadius: 2, background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text3)' }}>{label}</span>
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.3, letterSpacing: '-0.02em' }}>
        {value}<span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginLeft: 3 }}>{unit}</span>
      </div>
    </div>
  )
}

// Roborock live-map card — rendered server-side PNG, refreshable.
function RoborockMapCard({ duid, label }) {
  const [t, setT] = useState(Date.now())
  const [err, setErr] = useState(false)
  const src = `/api/roborock/${encodeURIComponent(duid)}/map.png?t=${t}`
  return (
    <div className="chart-card">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>🤖 {label}</span>
        <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>{gt('live_map', 'Live map')}</span>
        <button onClick={() => { setErr(false); setT(Date.now()) }} title={gt('refresh', 'Refresh')}
          style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>↻</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.25)',
        border: '1px solid var(--white-06)', borderRadius: 12, padding: 8, minHeight: 220 }}>
        {err
          ? <span style={{ color: 'var(--text3)', fontSize: 12.5 }}>{gt('map_unavailable', 'Map unavailable')}</span>
          : <img src={src} alt={`${label} map`} onError={() => setErr(true)}
              style={{ maxWidth: '100%', maxHeight: 360, imageRendering: 'pixelated', borderRadius: 8 }} />}
      </div>
    </div>
  )
}

// Fullscreen zoom popup for a single history chart.
function ChartZoomModal({ zoom, devices, onClose, onOpenDevice }) {
  useEffect(() => {
    if (!zoom) return
    const esc = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [zoom, onClose])

  // Look up live objects each render so the header value stays fresh
  const device = zoom ? devices.find(d => d.key === zoom.key) : null
  const sensor = device?.sensors?.find(s => s.path === zoom.path)
  const value  = device?.readings?.[zoom.path]?.value
  const accent = zoom ? CLASS_ACCENT[zoom.cls] : 'var(--accent-lt)'

  return (
    <AnimatePresence>
      {zoom && device && sensor && (
        <motion.div key="zoom-backdrop"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0, zIndex: 300,
            background: 'rgba(5,7,15,0.72)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
          }}>
          <motion.div key="zoom-card"
            initial={{ opacity: 0, scale: 0.9, y: 22 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 14 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            onClick={e => e.stopPropagation()}
            className="device-modal-glow"
            style={{
              position: 'relative', width: 'min(960px, 100%)', maxHeight: '90vh',
              display: 'flex', flexDirection: 'column',
              background: 'linear-gradient(160deg, #131a28 0%, #0c111c 100%)',
              border: '1px solid rgba(121,192,255,0.22)',
              borderRadius: 22, overflow: 'hidden', padding: '16px 20px 20px',
            }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: accent, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8, overflow: 'hidden' }}>
                <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {device.label}
                </span>
                <span style={{ fontSize: 12.5, color: 'var(--text3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {sensor.name || sensor.label || sensor.path}
                </span>
              </div>
              {typeof value === 'number' && (
                <span style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                  {Number.isInteger(value) ? value : value.toFixed(1)}{sensor.unit || ''}
                </span>
              )}
              <button onClick={() => { onClose(); onOpenDevice?.(device.key) }}
                title={gt('open_device', 'Open device')}
                style={{
                  padding: '5px 12px', borderRadius: 999, cursor: 'pointer', flexShrink: 0,
                  border: '1px solid rgba(121,192,255,0.4)', background: 'rgba(121,192,255,0.12)',
                  color: '#c9e3ff', fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap',
                }}>
                {gt('open_device', 'Open device')} →
              </button>
              <button onClick={onClose} style={{
                width: 30, height: 30, borderRadius: 10, border: '1px solid var(--white-10)', cursor: 'pointer',
                background: 'var(--white-05)', color: 'var(--text2)', fontSize: 13, flexShrink: 0,
              }}>✕</button>
            </div>
            <div style={{ overflowY: 'auto' }}>
              <Chart deviceKey={device.key} sensor={sensor} accent={accent}
                height={Math.max(260, Math.min(440, Math.round(window.innerHeight * 0.5)))} />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default function StatsView({ devices, energy, onOpen }) {
  const [filter, setFilter] = useState('all')
  const [origin, setOrigin] = useState('all') // device.type (platform) filter
  const [zoom, setZoom] = useState(null) // { key, path, cls }

  const roboMaps = useMemo(() => devices
    .filter(d => String(d.key).startsWith('roborock/'))
    .map(d => ({ duid: String(d.key).split('/')[1], label: d.label || d.name || d.key })), [devices])

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

  const shown = graphable
    .filter(g => (filter === 'all' || g.cls === filter) && (origin === 'all' || (g.device.type || 'unknown') === origin))
    .slice(0, 30)

  // Series count per origin (platform)
  const originCounts = {}
  for (const g of graphable) {
    const o = g.device.type || 'unknown'
    originCounts[o] = (originCounts[o] || 0) + 1
  }
  const origins = Object.keys(originCounts).sort()

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
            <button key={f.id} onClick={() => setFilter(f.id)}
              className="cat-pill" data-variant="soft" data-active={String(active)}>
              {f.label()} <span style={{ opacity: 0.6 }}>({counts[f.id] || counts.all})</span>
            </button>
          )
        })}
      </div>

      {/* Origin / platform filter */}
      {origins.length > 1 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text3)', marginRight: 2 }}>
            {gt('origin', 'Origin')}
          </span>
          <button onClick={() => setOrigin('all')}
            className="cat-pill" data-variant="soft" data-active={String(origin === 'all')}>
            {gt('filter_all', 'All')} <span style={{ opacity: 0.6 }}>({graphable.length})</span>
          </button>
          {origins.map(o => (
            <button key={o} onClick={() => setOrigin(o === origin ? 'all' : o)}
              className="cat-pill" data-variant="soft" data-active={String(origin === o)}
              style={{ textTransform: 'capitalize' }}>
              {o} <span style={{ opacity: 0.6 }}>({originCounts[o]})</span>
            </button>
          ))}
        </div>
      )}

      {/* Roborock live maps */}
      {filter === 'all' && (origin === 'all' || origin === 'roborock') && roboMaps.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {roboMaps.map(m => <RoborockMapCard key={m.duid} duid={m.duid} label={m.label} />)}
        </div>
      )}

      {/* Chart grid */}
      {shown.length === 0 && !(filter === 'all' && roboMaps.length) && (
        <div style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center', padding: 30 }}>
          <ChartIcon size={28} color="var(--text3)" />
          <div style={{ marginTop: 8 }}>{gt('empty', 'No numeric sensors reporting yet.')}</div>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {shown.map(({ device, sensor, value, cls }) => (
          <div key={`${device.key}/${sensor.path}`} className="chart-card"
            onClick={() => setZoom({ key: device.key, path: sensor.path, cls })}
            style={{ cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
              <span style={{ width: 7, height: 7, borderRadius: 2, background: CLASS_ACCENT[cls], flexShrink: 0, alignSelf: 'center' }} />
              <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {device.label}
              </span>
              <span style={{ fontSize: 11.5, color: 'var(--text3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {sensor.name || sensor.label || sensor.path}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 15, fontWeight: 800, color: 'var(--text)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                {Number.isInteger(value) ? value : value.toFixed(1)}{sensor.unit || ''}
              </span>
            </div>
            <Chart deviceKey={device.key} sensor={sensor} accent={CLASS_ACCENT[cls]} height={130} />
          </div>
        ))}
      </div>
      {graphable.length > 30 && filter === 'all' && origin === 'all' && (
        <div style={{ color: 'var(--text3)', fontSize: 11.5, textAlign: 'center' }}>
          {gt('showing', 'Showing first 30 of {n} series — use the filters to narrow down.', { n: graphable.length })}
        </div>
      )}

      <ChartZoomModal zoom={zoom} devices={devices} onClose={() => setZoom(null)} onOpenDevice={onOpen} />
    </div>
  )
}
