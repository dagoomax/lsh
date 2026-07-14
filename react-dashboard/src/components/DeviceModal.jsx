import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { resolveIcon, MyIcon } from './Icons'
import { gt } from '../i18n'

// ── Advanced device popup: full controls + history graphs ──────────────────
// Design language: glow blobs, gradient border (CSS mask), gradient title,
// spring entrance — matches the LSH login/setup redesign.

const RANGES = [
  { label: '1h', h: 1 },
  { label: '6h', h: 6 },
  { label: 'All', h: 0 },
]

async function fetchHistory(deviceKey, path) {
  try {
    const r = await fetch(`/api/history/${deviceKey}/${path}`, { credentials: 'same-origin' })
    const j = await r.json()
    return j.points || []
  } catch { return [] }
}

// Catmull-Rom → bezier smoothing for a silky line
function smoothPath(pts) {
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

export function Chart({ deviceKey, sensor, accent = '#79c0ff', height = 190 }) {
  const [points, setPoints] = useState(null)
  const [rangeH, setRangeH] = useState(6)
  const [hover, setHover] = useState(null) // index into view.pts
  const wrapRef = useRef(null)
  const [w, setW] = useState(560)
  const H = height, padL = 42, padR = 14, padT = 14, padB = 24
  const uid = useMemo(() => `${deviceKey}/${sensor.path}`.replace(/[^a-zA-Z0-9]/g, '_'), [deviceKey, sensor.path])

  useEffect(() => {
    let alive = true
    setPoints(null)
    fetchHistory(deviceKey, sensor.path).then(p => { if (alive) setPoints(p) })
    const iv = setInterval(() => fetchHistory(deviceKey, sensor.path).then(p => { if (alive) setPoints(p) }), 30000)
    return () => { alive = false; clearInterval(iv) }
  }, [deviceKey, sensor.path])

  useEffect(() => {
    const ro = new ResizeObserver(e => setW(Math.max(320, e[0].contentRect.width)))
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  const view = useMemo(() => {
    if (!points) return null
    const cutoff = rangeH ? Date.now() - rangeH * 3600_000 : 0
    const pts = points.filter(p => p[0] >= cutoff)
    if (pts.length < 2) return { pts: [] }

    let vMin = Infinity, vMax = -Infinity, sum = 0
    for (const [, v] of pts) { if (v < vMin) vMin = v; if (v > vMax) vMax = v; sum += v }
    const realMin = vMin, realMax = vMax, avg = sum / pts.length
    if (vMin === vMax) { vMin -= 1; vMax += 1 }
    const pad = (vMax - vMin) * 0.1; vMin -= pad; vMax += pad

    const t0 = pts[0][0], t1 = pts[pts.length - 1][0]
    const X = t => padL + ((t - t0) / Math.max(1, t1 - t0)) * (w - padL - padR)
    const Y = v => padT + (1 - (v - vMin) / (vMax - vMin)) * (H - padT - padB)
    const xy = pts.map(([t, v]) => [X(t), Y(v)])

    const grid = [0, 1, 2, 3, 4].map(i => {
      const v = vMin + ((vMax - vMin) * i) / 4
      return { y: Y(v), label: v.toFixed(Math.abs(vMax - vMin) < 10 ? 1 : 0) }
    })
    const fmtT = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const times = [{ x: X(t0), l: fmtT(t0) }, { x: X((t0 + t1) / 2), l: fmtT((t0 + t1) / 2) }, { x: X(t1), l: fmtT(t1) }]

    return { pts, xy, grid, times, realMin, realMax, avg, last: xy[xy.length - 1] }
  }, [points, rangeH, w])

  const u = sensor.unit || ''

  return (
    <div ref={wrapRef}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        {RANGES.map(r => (
          <button key={r.label} onClick={() => setRangeH(r.h)} style={{
            background: rangeH === r.h ? 'rgba(121,192,255,0.15)' : 'rgba(255,255,255,0.04)',
            color: rangeH === r.h ? accent : 'var(--muted, #8b949e)',
            border: `1px solid ${rangeH === r.h ? 'rgba(121,192,255,0.4)' : 'rgba(255,255,255,0.08)'}`,
            borderRadius: 8, padding: '3px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
          }}>{r.label}</button>
        ))}
        {view?.pts.length > 1 && (
          <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--muted, #8b949e)', fontVariantNumeric: 'tabular-nums' }}>
            min {view.realMin.toFixed(1)}{u} · avg {view.avg.toFixed(1)}{u} · max {view.realMax.toFixed(1)}{u}
          </span>
        )}
      </div>

      <div style={{ position: 'relative', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, overflow: 'hidden' }}>
        {view === null && <div style={{ height: H, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted,#8b949e)', fontSize: 12 }}>Loading…</div>}
        {view !== null && view.pts.length < 2 && (
          <div style={{ height: H, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted,#8b949e)', fontSize: 12 }}>
            {gt('collecting', 'Collecting data — check back in a few minutes')}
          </div>
        )}
        {view !== null && view.pts.length > 1 && (
          <svg width={w} height={H} style={{ display: 'block', touchAction: 'pan-y' }}
            onPointerMove={e => {
              const x = e.clientX - e.currentTarget.getBoundingClientRect().left
              let best = 0, bestD = Infinity
              for (let i = 0; i < view.xy.length; i++) {
                const d = Math.abs(view.xy[i][0] - x)
                if (d < bestD) { bestD = d; best = i }
              }
              setHover(best)
            }}
            onPointerLeave={() => setHover(null)}>
            <defs>
              <linearGradient id={`fill_${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accent} stopOpacity="0.35" />
                <stop offset="100%" stopColor={accent} stopOpacity="0" />
              </linearGradient>
            </defs>
            {view.grid.map((g, i) => (
              <g key={i}>
                <line x1={padL} x2={w - padR} y1={g.y} y2={g.y} stroke="rgba(255,255,255,0.05)" />
                <text x={padL - 8} y={g.y + 3} textAnchor="end" fontSize="9.5" fill="#8b949e" fontFamily="system-ui">{g.label}</text>
              </g>
            ))}
            {view.times.map((t, i) => (
              <text key={i} x={t.x} y={H - 8} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} fontSize="9.5" fill="#8b949e" fontFamily="system-ui">{t.l}</text>
            ))}
            <path d={`${smoothPath(view.xy)} L ${view.xy[view.xy.length - 1][0]} ${H - padB} L ${view.xy[0][0]} ${H - padB} Z`} fill={`url(#fill_${uid})`} />
            <path d={smoothPath(view.xy)} fill="none" stroke={accent} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {hover == null && (
              <circle cx={view.last[0]} cy={view.last[1]} r="4" fill={accent}>
                <animate attributeName="opacity" values="1;0.35;1" dur="2s" repeatCount="indefinite" />
              </circle>
            )}
            {hover != null && view.xy[hover] && (
              <g pointerEvents="none">
                <line x1={view.xy[hover][0]} x2={view.xy[hover][0]} y1={padT} y2={H - padB}
                  stroke="rgba(255,255,255,0.18)" strokeDasharray="3 3" />
                <circle cx={view.xy[hover][0]} cy={view.xy[hover][1]} r="4.5"
                  fill={accent} stroke="rgba(0,0,0,0.55)" strokeWidth="2" />
              </g>
            )}
          </svg>
        )}
        {view !== null && hover != null && view.pts[hover] && (
          <div style={{
            position: 'absolute', top: 8, pointerEvents: 'none',
            left: Math.min(Math.max(view.xy[hover][0] - 52, 4), w - 112),
            background: 'rgba(13,17,26,0.92)', border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 8, padding: '4px 9px', backdropFilter: 'blur(6px)',
            boxShadow: '0 4px 14px rgba(0,0,0,0.45)', whiteSpace: 'nowrap',
          }}>
            <span style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--text,#e9eef5)' }}>
              {Number(view.pts[hover][1]).toFixed(1)}{u}
            </span>
            <span style={{ fontSize: 10.5, color: 'var(--text3,#647084)', marginLeft: 6, fontVariantNumeric: 'tabular-nums' }}>
              {new Date(view.pts[hover][0]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Controls ────────────────────────────────────────────────────────────────

function BigToggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} style={{
      width: 52, height: 30, borderRadius: 999, border: 'none', cursor: 'pointer', position: 'relative',
      background: on ? 'linear-gradient(135deg,#3fb950,#58a6ff)' : 'rgba(255,255,255,0.1)',
      boxShadow: on ? '0 0 16px rgba(88,166,255,0.45)' : 'inset 0 1px 3px rgba(0,0,0,0.4)',
      transition: 'all .25s ease', flexShrink: 0,
    }}>
      <span style={{
        position: 'absolute', top: 3, left: on ? 25 : 3, width: 24, height: 24, borderRadius: '50%',
        background: '#fff', boxShadow: '0 2px 6px rgba(0,0,0,0.35)', transition: 'left .25s cubic-bezier(.34,1.56,.64,1)',
      }} />
    </button>
  )
}

function RangeControl({ sensor, value, onCommit, accent }) {
  const [local, setLocal] = useState(value ?? sensor.min ?? 0)
  const tRef = useRef(null)
  useEffect(() => { setLocal(value ?? sensor.min ?? 0) }, [value])
  const min = sensor.min ?? 0, max = sensor.max ?? 100
  const pct = ((local - min) / Math.max(1, max - min)) * 100
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
      <input type="range" min={min} max={max} step={sensor.step || 1} value={local}
        onChange={e => {
          const v = Number(e.target.value); setLocal(v)
          clearTimeout(tRef.current); tRef.current = setTimeout(() => onCommit(v), 350)
        }}
        style={{
          flex: 1, height: 6, borderRadius: 3, appearance: 'none', WebkitAppearance: 'none', cursor: 'pointer', outline: 'none',
          background: `linear-gradient(90deg, #3fb950 0%, ${accent} ${pct}%, rgba(255,255,255,0.09) ${pct}%)`,
        }} />
      <span style={{ fontSize: 14, fontWeight: 700, minWidth: 58, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: accent }}>
        {local}{sensor.unit || ''}
      </span>
    </div>
  )
}

// ── Modal ───────────────────────────────────────────────────────────────────

// Live map view for Roborock devices.
function RoborockMapView({ device }) {
  const [t, setT] = useState(Date.now())
  const [err, setErr] = useState(false)
  if (device.type !== 'roborock') return null
  const duid = String(device.key).split('/')[1]
  const src = `/api/roborock/${encodeURIComponent(duid)}/map.png?t=${t}`
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted,#8b949e)' }}>{gt('live_map', 'Live map')}</div>
        <button onClick={() => { setErr(false); setT(Date.now()) }} title={gt('refresh', 'Refresh')}
          style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--muted,#8b949e)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>↻</button>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', background: 'rgba(0,0,0,0.25)',
        border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: 10, minHeight: 200 }}>
        {err
          ? <span style={{ color: 'var(--muted,#8b949e)', fontSize: 12.5 }}>{gt('map_unavailable', 'Map unavailable')}</span>
          : <img src={src} alt="map" onError={() => setErr(true)}
              style={{ maxWidth: '100%', maxHeight: 380, imageRendering: 'pixelated', borderRadius: 10 }} />}
      </div>
    </div>
  )
}

// Consumable life bars for Roborock devices.
const RR_CONSUMABLES = [
  { path: 'main_brush', name: 'Main brush' },
  { path: 'side_brush', name: 'Side brush' },
  { path: 'filter',     name: 'Filter' },
  { path: 'sensor',     name: 'Sensor' },
]
function RoborockConsumables({ device }) {
  if (device.type !== 'roborock') return null
  const r = device.readings || {}
  const items = RR_CONSUMABLES.map(c => ({ ...c, v: r[c.path]?.value })).filter(c => typeof c.v === 'number')
  if (!items.length) return null
  const color = v => (v > 50 ? '#3fb950' : v > 20 ? '#d29922' : '#f85149')
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted,#8b949e)', marginBottom: 8 }}>
        {gt('consumables', 'Consumables')}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(c => (
          <div key={c.path} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 12.5, minWidth: 90, color: 'var(--text2,#aeb6c4)' }}>{c.name}</span>
            <div style={{ flex: 1, height: 8, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
              <div style={{ width: `${c.v}%`, height: '100%', background: color(c.v), borderRadius: 999 }} />
            </div>
            <span style={{ fontSize: 12.5, fontWeight: 700, minWidth: 38, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: color(c.v) }}>{c.v}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Multi-room clean panel for Roborock devices.
function RoborockRoomsPanel({ device }) {
  const [sel, setSel] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  if (device.type !== 'roborock' || !Array.isArray(device.rooms) || !device.rooms.length) return null
  const duid = String(device.key).split('/')[1]
  const toggle = id => setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const clean = async () => {
    const segments = [...sel]
    if (!segments.length) return
    setBusy(true); setMsg('')
    try {
      const res = await fetch(`/api/roborock/${encodeURIComponent(duid)}/clean-room`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ segments }),
      })
      setMsg(res.ok ? '✓ Cleaning' : '✗ Failed')
    } catch { setMsg('✗ Failed') }
    setBusy(false)
    setTimeout(() => setMsg(''), 3000)
  }
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted,#8b949e)', marginBottom: 8 }}>
        {gt('clean_rooms', 'Clean rooms')}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {device.rooms.map(r => {
          const on = sel.has(r.segmentId)
          return (
            <button key={r.segmentId} onClick={() => toggle(r.segmentId)} style={{
              padding: '5px 12px', borderRadius: 999, cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
              border: `1px solid ${on ? 'rgba(88,166,255,0.6)' : 'rgba(255,255,255,0.12)'}`,
              background: on ? 'rgba(88,166,255,0.18)' : 'rgba(255,255,255,0.04)',
              color: on ? '#c9e3ff' : 'var(--text2,#aeb6c4)',
            }}>{r.name}</button>
          )
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={clean} disabled={busy || !sel.size} style={{
          padding: '7px 18px', borderRadius: 10, border: 'none', cursor: sel.size ? 'pointer' : 'not-allowed',
          background: 'linear-gradient(135deg,#3fb950,#58a6ff)', color: '#fff', fontWeight: 700, fontSize: 12,
          opacity: sel.size ? 1 : 0.45,
        }}>{gt('clean_selected', 'Clean selected')}{sel.size ? ` (${sel.size})` : ''}</button>
        {msg && <span style={{ fontSize: 12, color: 'var(--text3,#8b949e)' }}>{msg}</span>}
      </div>
    </div>
  )
}

export default function DeviceModal({ device, onClose, onCommand }) {
  const [selected, setSelected] = useState(null)
  const [localState, setLocalState] = useState({})

  useEffect(() => { setSelected(null); setLocalState({}) }, [device?.key])
  useEffect(() => {
    const esc = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const r = device?.readings || {}
  const val = p => (localState[p] !== undefined ? localState[p] : r[p]?.value)

  const sensors = useMemo(() => (device?.sensors || []).filter(s => !s.hidden), [device])
  const controls = sensors.filter(s => s.controllable && s.type !== 'color')
  const graphable = sensors.filter(s => {
    const v = r[s.path]?.value
    return typeof v === 'number' || typeof v === 'boolean'
  })
  const sel = selected && graphable.find(s => s.path === selected) ? selected : graphable[0]?.path
  const selSensor = graphable.find(s => s.path === sel)

  const cmd = (sensor, value) => {
    setLocalState(s => ({ ...s, [sensor]: value }))
    onCommand(device.key, sensor, value)
  }

  const accent = '#79c0ff'

  return (
    <AnimatePresence>
      {device && (
        <motion.div key="backdrop"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0, zIndex: 300,
            background: 'rgba(5,7,15,0.72)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
          }}>
          <motion.div key="card"
            initial={{ opacity: 0, scale: 0.88, y: 26 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 16 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            onClick={e => e.stopPropagation()}
            className="device-modal-glow"
            style={{
              position: 'relative', width: 'min(680px, 100%)', maxHeight: '88vh',
              display: 'flex', flexDirection: 'column',
              background: 'linear-gradient(160deg, #131a28 0%, #0c111c 100%)',
              borderRadius: 22, overflow: 'hidden',
            }}>

            {/* gradient border via CSS mask */}
            <div style={{
              position: 'absolute', inset: 0, borderRadius: 22, padding: 1, pointerEvents: 'none',
              background: 'linear-gradient(140deg, rgba(88,166,255,0.7), rgba(57,197,207,0.45) 45%, rgba(94,80,190,0.4))',
              WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
              WebkitMaskComposite: 'xor', maskComposite: 'exclude',
            }} />

            {/* ambient glow blobs + dot grid */}
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', borderRadius: 22 }}>
              <div style={{ position: 'absolute', top: -90, left: -60, width: 260, height: 260, borderRadius: '50%', background: 'radial-gradient(circle, rgba(63,185,80,0.14), transparent 65%)' }} />
              <div style={{ position: 'absolute', bottom: -110, right: -70, width: 320, height: 320, borderRadius: '50%', background: 'radial-gradient(circle, rgba(88,166,255,0.12), transparent 65%)' }} />
              <div style={{ position: 'absolute', inset: 0, opacity: 0.5, backgroundImage: 'radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)', backgroundSize: '22px 22px' }} />
            </div>

            {/* header */}
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, padding: '18px 20px 12px' }}>
              <div style={{
                width: 44, height: 44, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
                background: 'linear-gradient(135deg, rgba(88,166,255,0.20), rgba(57,197,207,0.12))',
                border: '1px solid rgba(121,192,255,0.35)', boxShadow: '0 0 20px rgba(88,166,255,0.18)',
              }}>{(() => { const I = resolveIcon(device); return <I size={24} color="#a5d1ff"/> })()}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  background: 'linear-gradient(90deg, #a5d1ff 0%, #e9eef5 50%, #79c0ff 100%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent',
                }}>{device.label}</div>
                <div style={{ fontSize: 11, color: 'var(--muted, #8b949e)' }}>{device.key}</div>
              </div>
              <button onClick={onClose} style={{
                width: 32, height: 32, borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer',
                background: 'rgba(255,255,255,0.05)', color: 'var(--muted,#8b949e)', fontSize: 14,
              }}>✕</button>
            </div>

            {/* body */}
            <div style={{ position: 'relative', overflowY: 'auto', padding: '4px 20px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Roborock live map */}
              <RoborockMapView device={device} />

              {/* Controls */}
              {controls.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted,#8b949e)', marginBottom: 8 }}>Controls</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {controls.map(s => {
                      const v = val(s.path)
                      const isOn = v === 1 || v === true || v === 'on'
                      return (
                        <div key={s.path} style={{
                          display: 'flex', alignItems: 'center', gap: 14, padding: '10px 14px',
                          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14,
                        }}>
                          <span style={{ fontSize: 13, fontWeight: 600, minWidth: 110, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {s.name || s.label || s.path}
                          </span>
                          {(s.type === 'range' || s.type === 'color-temp') && (
                            <RangeControl sensor={s} value={typeof v === 'number' ? v : undefined} accent={accent}
                              onCommit={nv => cmd(s.path, nv)} />
                          )}
                          {s.type === 'trigger' && (
                            <button onClick={() => cmd(s.path, 1)} style={{
                              marginLeft: 'auto', padding: '7px 18px', borderRadius: 10, border: 'none', cursor: 'pointer',
                              background: 'linear-gradient(135deg,#3fb950,#58a6ff)', color: '#fff', fontWeight: 700, fontSize: 12,
                              boxShadow: '0 4px 14px rgba(88,166,255,0.3)',
                            }}>▶ Run</button>
                          )}
                          {s.path === 'my' && s.type !== 'range' && (
                            <button onClick={() => cmd('my', 1)} title="Move to favourite (My) position" style={{
                              marginLeft: 'auto', padding: '6px 16px', borderRadius: 10, cursor: 'pointer',
                              border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)',
                              color: 'var(--text2,#aeb6c4)', display: 'flex', alignItems: 'center',
                            }}><MyIcon size={18} /></button>
                          )}
                          {s.type !== 'range' && s.type !== 'color-temp' && s.type !== 'trigger' && s.path !== 'my' && (
                            <span style={{ marginLeft: 'auto' }}>
                              <BigToggle on={isOn} onChange={on => cmd(s.path, on ? 1 : 0)} />
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Roborock consumable life */}
              <RoborockConsumables device={device} />

              {/* Roborock multi-room clean */}
              <RoborockRoomsPanel device={device} />

              {/* Sensor chips + chart */}
              {graphable.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted,#8b949e)', marginBottom: 8 }}>History</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                    {graphable.map(s => {
                      const active = s.path === sel
                      const v = r[s.path]?.value
                      return (
                        <button key={s.path} onClick={() => setSelected(s.path)} style={{
                          display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 999, cursor: 'pointer',
                          background: active ? 'rgba(121,192,255,0.14)' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${active ? 'rgba(121,192,255,0.45)' : 'rgba(255,255,255,0.08)'}`,
                          color: active ? '#c9e3ff' : 'var(--muted,#8b949e)', fontSize: 11.5, fontWeight: 600,
                          boxShadow: active ? '0 0 14px rgba(121,192,255,0.15)' : 'none', transition: 'all .15s ease',
                        }}>
                          {s.name || s.label || s.path}
                          <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: active ? '#79c0ff' : 'inherit' }}>
                            {typeof v === 'number' ? `${Number.isInteger(v) ? v : v.toFixed(1)}${s.unit || ''}` : v === true ? 'on' : v === false ? 'off' : '—'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  {selSensor && <Chart deviceKey={device.key} sensor={selSensor} accent={accent} />}
                </div>
              )}

              {graphable.length === 0 && controls.length === 0 && (
                <div style={{ color: 'var(--muted,#8b949e)', fontSize: 13, textAlign: 'center', padding: 24 }}>
                  This device has no numeric sensors or controls.
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
