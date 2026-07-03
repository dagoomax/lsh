import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

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

function Chart({ deviceKey, sensor, accent = '#79c0ff' }) {
  const [points, setPoints] = useState(null)
  const [rangeH, setRangeH] = useState(6)
  const wrapRef = useRef(null)
  const [w, setW] = useState(560)
  const H = 190, padL = 42, padR = 14, padT = 14, padB = 24

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
            Collecting data — check back in a few minutes
          </div>
        )}
        {view !== null && view.pts.length > 1 && (
          <svg width={w} height={H} style={{ display: 'block' }}>
            <defs>
              <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accent} stopOpacity="0.35" />
                <stop offset="100%" stopColor={accent} stopOpacity="0" />
              </linearGradient>
              <linearGradient id="chartStroke" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#3fb950" />
                <stop offset="100%" stopColor={accent} />
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
            <path d={`${smoothPath(view.xy)} L ${view.xy[view.xy.length - 1][0]} ${H - padB} L ${view.xy[0][0]} ${H - padB} Z`} fill="url(#chartFill)" />
            <path d={smoothPath(view.xy)} fill="none" stroke="url(#chartStroke)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={view.last[0]} cy={view.last[1]} r="4" fill={accent}>
              <animate attributeName="opacity" values="1;0.35;1" dur="2s" repeatCount="indefinite" />
            </circle>
          </svg>
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
            style={{
              position: 'relative', width: 'min(680px, 100%)', maxHeight: '88vh',
              display: 'flex', flexDirection: 'column',
              background: 'linear-gradient(160deg, #12142a 0%, #0d0e1e 100%)',
              borderRadius: 22, overflow: 'hidden',
              boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 0 60px rgba(88,166,255,0.08)',
            }}>

            {/* gradient border via CSS mask */}
            <div style={{
              position: 'absolute', inset: 0, borderRadius: 22, padding: 1, pointerEvents: 'none',
              background: 'linear-gradient(140deg, rgba(63,185,80,0.55), rgba(88,166,255,0.45) 45%, rgba(188,140,255,0.35))',
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
                background: 'linear-gradient(135deg, rgba(63,185,80,0.18), rgba(88,166,255,0.18))',
                border: '1px solid rgba(88,166,255,0.25)', boxShadow: '0 0 20px rgba(88,166,255,0.15)',
              }}>{device.icon || '📟'}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  background: 'linear-gradient(135deg, #3fb950, #79c0ff)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent',
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
                          {s.type !== 'range' && s.type !== 'color-temp' && s.type !== 'trigger' && (
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
