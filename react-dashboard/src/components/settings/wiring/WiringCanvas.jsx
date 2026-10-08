import { useEffect, useMemo, useRef, useState } from 'react'
import { PART_PORTS, WIRE_COLORS } from './devices.js'
import { usesPE, netKind } from './sim.js'
import { t } from './i18n.js'

// SVG schematic: mains rails on top, parts in the middle, the module at the
// bottom. Wires are routed orthogonally; colours follow what each wire
// carries when powered (live / neutral / earth / switch supply).

const W = 960, H = 600
const RAIL = { L: 36, N: 62, PE: 88 }
const PART_Y = 228
const TERM_Y = 446
const WIRE_CSS = Object.fromEntries(WIRE_COLORS.filter((c) => c.css).map((c) => [c.id, c.id === 'gnye' ? '#9acd32' : c.css]))
const COLORS = { live: '#b5651d', neutral: '#2f80ed', pe: '#9acd32', sx: '#ff9f0a', idle: 'var(--wire-idle)', draft: 'var(--wire-draft)' }

export function layout(device, scenario) {
  const n = device.terminals.length
  const terms = {}
  device.terminals.forEach((t, j) => { terms[t.id] = { x: 330 + (j - (n - 1) / 2) * 62, y: TERM_Y } })
  const xs = Object.values(terms).map((p) => p.x)
  const devBox = { x0: Math.min(...xs) - 46, x1: Math.max(...xs) + 46, y0: TERM_Y - 14, y1: H - 18 }
  const parts = {}
  const k = scenario.parts.length
  scenario.parts.forEach((p, i) => {
    const cx = 210 + (i + 0.5) * (680 / k)
    const geo = { cx, cy: PART_Y, kind: p.kind, ports: {} }
    if (p.kind === 'switch') { geo.box = { x0: cx - 32, x1: cx + 32, y0: 176, y1: 254 }; geo.ports = { com: [cx - 14, 270], o1: [cx + 14, 270] } }
    if (p.kind === 'switch2') { geo.box = { x0: cx - 42, x1: cx + 42, y0: 176, y1: 254 }; geo.ports = { com: [cx - 24, 270], o1: [cx, 270], o2: [cx + 24, 270] } }
    if (p.kind === 'lamp') { geo.box = { x0: cx - 32, x1: cx + 32, y0: 190, y1: 262 }; geo.ports = { b: [cx, 172], a: [cx, 280] } }
    if (p.kind === 'motor') { geo.box = { x0: cx - 44, x1: cx + 44, y0: 186, y1: 278 }; geo.ports = { n: [cx - 14, 172], pe: [cx + 22, 172], up: [cx - 22, 292], down: [cx + 22, 292] } }
    if (p.kind === 'motorDriver') { geo.box = { x0: cx - 56, x1: cx + 56, y0: 186, y1: 272 }; geo.ports = { l: [cx - 34, 172], n: [cx - 10, 172], pe: [cx + 34, 172], up: [cx - 16, 288], down: [cx + 16, 288] } }
    parts[p.id] = geo
  })
  return { terms, devBox, parts, pe: usesPE(scenario) }
}

// Connector geometry: body centred on (x, y), ports along the top edge
export function wagoGeo(w) {
  const width = 26 * w.poles + 14
  const x0 = w.x - width / 2, y0 = w.y - 17
  const ports = {}
  for (let i = 0; i < w.poles; i++) ports[`p${i + 1}`] = [x0 + 20 + 26 * i, y0 - 8]
  return { x0, y0, width, height: 34, ports }
}

function pos(L, port) {
  if (port === 'L' || port === 'N' || port === 'PE') return { rail: true, y: RAIL[port] }
  const [owner, q] = port.split(':')
  if (owner === 'dev') return { term: true, x: L.terms[q].x, y: L.terms[q].y - 14 }
  if (L.wagos?.[owner]) { const [x, y] = L.wagos[owner].ports[q]; return { wago: true, x, y } }
  const g = L.parts[owner]
  const [x, y] = g.ports[q]
  return { x, y, top: y < g.cy, bottom: y > g.cy, box: g.box }
}

const blocked = (L, x) => Object.values(L.parts).some((g) => x > g.box.x0 - 6 && x < g.box.x1 + 6)

// Orthogonal route between two ports; i = wire index (spreads lanes)
function route(L, a, b, i, points) {
  let pa = pos(L, a), pb = pos(L, b)
  if (points?.length) {
    // Hand-drawn: orthogonal elbows through the user's bend points
    const first = points[0], last = points[points.length - 1]
    const sx = pa.rail ? first[0] : pa.x, sy = pa.y
    let d = `M ${sx} ${sy}`
    for (const [x, y] of points) d += ` V ${y} H ${x}`
    const ex = pb.rail ? last[0] : pb.x
    return `${d} H ${ex} V ${pb.y}`
  }
  const lane = 312 + (i % 12) * 9
  if (pa.wago || pb.wago) {
    if (!pa.wago) [pa, pb] = [pb, pa]
    const up = pa.y - 12 - (i % 5) * 4
    if (pb.rail) return `M ${pa.x} ${pa.y} V ${pb.y}`
    if (pb.wago) return `M ${pa.x} ${pa.y} V ${Math.min(up, pb.y - 12)} H ${pb.x} V ${pb.y}`
    if (pb.top) return `M ${pa.x} ${pa.y} V ${up} H ${pb.box.x1 + 12 + (i % 3) * 5} V ${pb.y - 12} H ${pb.x} V ${pb.y}`
    return `M ${pa.x} ${pa.y} V ${Math.min(up, pb.y + 26 + (i % 4) * 5)} H ${pb.x} V ${pb.y}`
  }
  if (pa.rail && pb.rail) return `M ${24 + i * 4} ${pa.y} V ${pb.y}`
  if (pb.rail) [pa, pb] = [pb, pa]
  if (pa.rail) {
    const p = pb
    if (p.top) return `M ${p.x} ${p.y} V ${pa.y}`
    if (p.term) {
      if (!blocked(L, p.x)) return `M ${p.x} ${p.y} V ${pa.y}`
      const riser = 56 + (i % 10) * 8
      return `M ${p.x} ${p.y} V ${lane} H ${riser} V ${pa.y}`
    }
    // bottom port of a part: go round the part's side
    const side = p.x < (p.box.x0 + p.box.x1) / 2 ? p.box.x0 - 10 - (i % 4) * 5 : p.box.x1 + 10 + (i % 4) * 5
    return `M ${p.x} ${p.y} V ${p.y + 10 + (i % 3) * 4} H ${side} V ${pa.y}`
  }
  if (pa.term && pb.term) { const y = pa.y - 12 - (i % 4) * 6; return `M ${pa.x} ${pa.y} V ${y} H ${pb.x} V ${pb.y}` }
  if (pb.term) [pa, pb] = [pb, pa]
  if (pa.term) {
    if (pb.bottom) return `M ${pa.x} ${pa.y} V ${lane} H ${pb.x} V ${pb.y}`
    const side = pb.box.x1 + 12 + (i % 3) * 5
    return `M ${pa.x} ${pa.y} V ${lane} H ${side} V ${pb.y - 12} H ${pb.x} V ${pb.y}`
  }
  // part ↔ part
  if (pa.bottom && pb.bottom) { const y = Math.max(pa.y, pb.y) + 14 + (i % 3) * 5; return `M ${pa.x} ${pa.y} V ${y} H ${pb.x} V ${pb.y}` }
  const y = Math.min(pa.y, pb.y) - 14 - (i % 3) * 5
  return `M ${pa.x} ${pa.y} V ${y} H ${pb.x} V ${pb.y}`
}

function railX(L, other, i, points) {
  if (points?.length) return null
  const p = pos(L, other)
  if (p.rail) return 24 + i * 4
  if (p.wago) return p.x
  if (p.top) return p.x
  if (p.term) return blocked(L, p.x) ? 56 + (i % 10) * 8 : p.x
  return p.x < (p.box.x0 + p.box.x1) / 2 ? p.box.x0 - 10 - (i % 4) * 5 : p.box.x1 + 10 + (i % 4) * 5
}

export default function WiringCanvas({ device, scenario, wires, extras = [], highlight, sim, powered, switches, onPress, onRelease, onToggle, pending, onPort, onWireClick, interactive, shutterPos, draft, onCanvasPoint, onPointerMove, onExtraMove, onExtraRemove, draftColor, zoomable }) {
  const base = useMemo(() => layout(device, scenario), [device, scenario])
  const L = useMemo(() => ({ ...base, wagos: Object.fromEntries(extras.filter((e) => e.kind === 'wago').map((e) => [e.id, wagoGeo(e)])) }), [base, extras])
  const svgRef = useRef(null)
  const drag = useRef(null)
  const pan = useRef(null)
  const FULL = { x: 0, y: 0, w: W, h: H }
  const [vb, setVb] = useState(FULL)
  useEffect(() => { if (!zoomable) setVb(FULL) }, [zoomable])
  const zoom = (f, cx, cy) => setVb((v) => {
    const w = Math.min(W * 1.2, Math.max(W / 6, v.w * f)), h = w * (H / W)
    let px = v.x + v.w / 2, py = v.y + v.h / 2
    if (cx != null) {
      const svg = svgRef.current, pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy
      const p = pt.matrixTransform(svg.getScreenCTM().inverse()); px = p.x; py = p.y
    }
    return { x: px - (px - v.x) * (w / v.w), y: py - (py - v.y) * (h / v.h), w, h }
  })
  useEffect(() => {
    if (!zoomable) return
    const el = svgRef.current
    const onWheel = (e) => { e.preventDefault(); zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY) }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomable])
  const toSvg = (e) => {
    const svg = svgRef.current
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY
    const p = pt.matrixTransform(svg.getScreenCTM().inverse())
    return [Math.round(p.x / 10) * 10, Math.round(p.y / 10) * 10]
  }
  const momentary = (scenario.inputMode || 'momentary') === 'momentary'
  const colorOf = (a, b, meta) => {
    if (meta?.color && WIRE_CSS[meta.color]) return WIRE_CSS[meta.color]
    if (powered && sim?.nets) {
      const k = netKind(sim, device, a) !== 'idle' ? netKind(sim, device, a) : netKind(sim, device, b)
      return COLORS[k]
    }
    for (const r of ['L', 'N', 'PE']) if (a === r || b === r) return COLORS[{ L: 'live', N: 'neutral', PE: 'pe' }[r]]
    return COLORS.draft
  }
  const live = (a) => powered && sim?.nets && netKind(sim, device, a) === 'live'

  const Port = ({ id, x, y }) => (
    <g className={`wr-port${pending === id ? ' pending' : ''}${interactive ? ' clickable' : ''}`} onClick={interactive ? (e) => { e.stopPropagation(); onPort(id) } : undefined}>
      <circle cx={x} cy={y} r={interactive ? 7 : 4}/>
      <title>{id}</title>
    </g>
  )

  return (
    <>
    {zoomable && (
      <div className="lan-zoom wr-zoom">
        <button onClick={() => zoom(1 / 1.3)} title={t('Zoom in')}>+</button>
        <button onClick={() => zoom(1.3)} title={t('Zoom out')}>−</button>
        <button onClick={() => setVb(FULL)} title={t('Fit')}>⟲</button>
      </div>
    )}
    <svg ref={svgRef} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet" className={`wr-svg${draft ? ' drawing' : ''}${zoomable ? ' zoomable' : ''}`} role="img" aria-label="Wiring diagram"
      onPointerMove={(e) => {
        if (drag.current) { const [x, y] = toSvg(e); onExtraMove?.(drag.current, x, y); return }
        if (pan.current) {
          const svg = svgRef.current, r = svg.getBoundingClientRect()
          const scale = Math.min(r.width / pan.current.vb.w, r.height / pan.current.vb.h)
          setVb({ ...pan.current.vb, x: pan.current.vb.x - (e.clientX - pan.current.x) / scale, y: pan.current.vb.y - (e.clientY - pan.current.y) / scale })
          return
        }
        if (draft) onPointerMove?.(toSvg(e))
      }}
      onPointerDown={(e) => {
        if (zoomable && !draft && e.button === 0 && !e.target.closest('.wr-port, .wr-wire.clickable, .wr-key, .wr-wago, .wr-rail-hit')) pan.current = { x: e.clientX, y: e.clientY, vb }
      }}
      onPointerUp={() => { drag.current = null; pan.current = null }}
      onPointerLeave={() => { drag.current = null; pan.current = null }}
      onContextMenu={(e) => { if (draft) { e.preventDefault(); onCanvasPoint?.(null) } }}>
      {(interactive || zoomable) && <rect x={-W} y={-H} width={W * 3} height={H * 3} fill="transparent" className={zoomable && !draft ? 'wr-pan' : undefined}
        onClick={(e) => draft && onCanvasPoint?.(toSvg(e))}/>}
      <defs>
        <radialGradient id="wr-glow"><stop offset="0" stopColor="#ffe9a8" stopOpacity="0.95"/><stop offset="0.5" stopColor="#ffd60a" stopOpacity="0.55"/><stop offset="1" stopColor="#ffd60a" stopOpacity="0"/></radialGradient>
      </defs>
      {/* rails */}
      {['L', 'N', ...(L.pe ? ['PE'] : [])].map((r) => (
        <g key={r} className="wr-rail">
          <line x1="20" x2={W - 20} y1={RAIL[r]} y2={RAIL[r]} stroke={COLORS[{ L: 'live', N: 'neutral', PE: 'pe' }[r]]} strokeWidth="4" strokeDasharray={r === 'PE' ? '10 6' : undefined}/>
          <text x={W - 16} y={RAIL[r] + 4} textAnchor="end" className="wr-rail-label">{r}</text>
          {interactive && <rect x="20" y={RAIL[r] - 9} width={W - 70} height="18" className="wr-rail-hit" onClick={(e) => { e.stopPropagation(); onPort(r, toSvg(e)) }}/>}
        </g>
      ))}

      {/* wires */}
      {wires.map(([a, b, meta], i) => {
        const d = route(L, a, b, i, meta?.points)
        const hl = highlight === i
        const c = colorOf(a, b, meta)
        const ra = railX(L, b, i, meta?.points) ?? meta?.points?.[0]?.[0]
        const rb = railX(L, a, i, meta?.points) ?? meta?.points?.[meta.points.length - 1]?.[0]
        return (
          <g key={`${a}-${b}-${i}`} className={`wr-wire${hl ? ' hl' : ''}${interactive && !draft ? ' clickable' : ''}`} onClick={interactive && !draft ? (e) => { e.stopPropagation(); onWireClick(i) } : undefined}>
            <path d={d} className="wr-wire-hit"/>
            <path d={d} className="wr-wire-casing"/>
            <path d={d} stroke={c} className="wr-wire-line"/>
            {meta?.color === 'gnye' && <path d={d} className="wr-wire-gnye"/>}
            {(live(a) || live(b)) && <path d={d} className="wr-wire-flow"/>}
            {['L', 'N', 'PE'].includes(a) && <circle cx={ra} cy={RAIL[a]} r="4.5" fill={c}/>}
            {['L', 'N', 'PE'].includes(b) && <circle cx={rb} cy={RAIL[b]} r="4.5" fill={c}/>}
          </g>
        )
      })}
      {draft && (() => {
        const start = pos(L, draft.from)
        const pts = [...draft.points, ...(draft.cursor ? [draft.cursor] : [])]
        const sx = start.rail ? (pts[0]?.[0] ?? 40) : start.x
        let d = `M ${sx} ${start.y}`
        for (const [x, y] of pts) d += ` V ${y} H ${x}`
        return <path d={d} className="wr-wire-draft" stroke={WIRE_CSS[draftColor] || '#ffd60a'}/>
      })()}
      {draft?.points.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="3.5" className="wr-bend"/>)}

      {/* parts */}
      {scenario.parts.map((p) => {
        const g = L.parts[p.id]
        const s = switches[p.id] || []
        if (p.kind === 'lamp') {
          const lvl = sim?.lamps?.[p.id] || 0
          return (
            <g key={p.id} className="wr-part">
              {lvl > 0 && <circle cx={g.cx} cy={g.cy - 4} r={34 + 30 * lvl} fill="url(#wr-glow)" opacity={0.35 + 0.65 * lvl}/>}
              <circle cx={g.cx} cy={g.cy - 4} r="28" className={`wr-lamp${lvl > 0 ? ' on' : ''}`} style={lvl > 0 ? { fillOpacity: 0.25 + 0.75 * lvl } : undefined}/>
              <path d={`M ${g.cx - 18} ${g.cy - 22} L ${g.cx + 18} ${g.cy + 14} M ${g.cx + 18} ${g.cy - 22} L ${g.cx - 18} ${g.cy + 14}`} className="wr-lamp-x"/>
              <line x1={g.cx} x2={g.cx} y1={g.ports.b[1]} y2={g.cy - 32}/><line x1={g.cx} x2={g.cx} y1={g.cy + 24} y2={g.ports.a[1]}/>
              <text x={g.cx + 38} y={g.cy} className="wr-part-label" textAnchor="start" style={{ textAnchor: 'start' }}>{t(p.label)}{lvl > 0 && lvl < 1 ? ` · ${Math.round(lvl * 100)}%` : ''}</text>
            </g>
          )
        }
        if (p.kind === 'switch' || p.kind === 'switch2') {
          const keys = p.kind === 'switch2' ? 2 : 1
          const kw = (g.box.x1 - g.box.x0 - 12) / keys
          return (
            <g key={p.id} className="wr-part">
              <rect x={g.box.x0} y={g.box.y0} width={g.box.x1 - g.box.x0} height={g.box.y1 - g.box.y0} rx="12" className="wr-switch"/>
              {[...Array(keys)].map((_, k) => {
                const on = !!s[k]
                const handlers = momentary
                  ? { onPointerDown: (e) => { e.preventDefault(); onPress(p.id, k) }, onPointerUp: () => onRelease(p.id, k), onPointerLeave: () => s[k] && onRelease(p.id, k) }
                  : { onClick: () => onToggle(p.id, k) }
                return (
                  <g key={k} className={`wr-key${on ? ' on' : ''}`} {...handlers}>
                    <rect x={g.box.x0 + 6 + k * kw} y={g.box.y0 + 6} width={kw - (keys > 1 ? 2 : 0)} height={g.box.y1 - g.box.y0 - 12} rx="8"/>
                    <text x={g.box.x0 + 6 + k * kw + kw / 2} y={(g.box.y0 + g.box.y1) / 2 + 5}>{p.keys?.[k] || (momentary ? (on ? '●' : '○') : on ? 'I' : 'O')}</text>
                  </g>
                )
              })}
              {Object.entries(g.ports).map(([q, [x, y]]) => <line key={q} x1={x} x2={x} y1={g.box.y1} y2={y}/>)}
              <text x={g.cx} y={g.box.y0 - 8} className="wr-part-label">{t(p.label)}</text>
            </g>
          )
        }
        if (p.kind === 'motor' || p.kind === 'motorDriver') {
          const dir = sim?.motors?.[p.id]
          const box = g.box
          return (
            <g key={p.id} className={`wr-part wr-motor${dir ? ` run-${dir}` : ''}`}>
              {p.kind === 'motor'
                ? <circle cx={g.cx} cy={g.cy + 4} r="38" className="wr-motor-body"/>
                : <rect x={box.x0} y={box.y0} width={box.x1 - box.x0} height={box.y1 - box.y0} rx="10" className="wr-motor-body"/>}
              <text x={g.cx} y={g.cy + 14} className="wr-motor-m">M</text>
              {dir && dir !== 'both' && <text x={g.cx + (p.kind === 'motor' ? 0 : 0)} y={g.cy - 14} className="wr-motor-dir">{dir === 'up' ? '▲' : '▼'}</text>}
              {dir === 'both' && <text x={g.cx} y={g.cy - 14} className="wr-motor-dir bad">⚠</text>}
              {Object.entries(g.ports).map(([q, [x, y]]) => (
                <g key={q}>
                  <line x1={x} x2={x} y1={y} y2={y < g.cy ? box.y0 + 6 : box.y1 - 6}/>
                  <text x={x + 5} y={y < g.cy ? y + 12 : y - 4} className="wr-port-label">{{ up: '↑', down: '↓', n: 'N', pe: 'PE', l: 'L' }[q]}</text>
                </g>
              ))}
              {shutterPos != null && (
                <g>
                  <rect x={box.x1 + 14} y={box.y0} width="12" height={box.y1 - box.y0} rx="3" className="wr-blind-track"/>
                  <rect x={box.x1 + 14} y={box.y0} width="12" height={(box.y1 - box.y0) * (1 - shutterPos / 100)} rx="3" className="wr-blind"/>
                </g>
              )}
              <text x={g.cx} y={box.y1 + 30} className="wr-part-label">{t(p.label)}</text>
            </g>
          )
        }
        return null
      })}

      {/* the module */}
      <g className="wr-device">
        <path d={`M ${L.devBox.x0} ${L.devBox.y0} H ${L.devBox.x1} V ${L.devBox.y1 - 30} Q ${L.devBox.x1} ${L.devBox.y1} ${L.devBox.x1 - 30} ${L.devBox.y1} H ${L.devBox.x0 + 30} Q ${L.devBox.x0} ${L.devBox.y1} ${L.devBox.x0} ${L.devBox.y1 - 30} Z`} className="wr-device-body" style={{ '--brand': device.color }}/>
        <rect x={L.devBox.x0} y={L.devBox.y0} width={L.devBox.x1 - L.devBox.x0} height="5" fill={device.color}/>
        {device.terminals.map((term) => {
          const p = L.terms[term.id]
          return (
            <g key={term.id}>
              <rect x={p.x - 20} y={p.y - 6} width="40" height="30" rx="4" className="wr-screw-box"/>
              <circle cx={p.x} cy={p.y + 9} r="8" className="wr-screw"/>
              <path d={`M ${p.x - 5} ${p.y + 4} L ${p.x + 5} ${p.y + 14} M ${p.x + 5} ${p.y + 4} L ${p.x - 5} ${p.y + 14}`} className="wr-screw-x"/>
              <text x={p.x} y={p.y + 42} className={`wr-term-label role-${term.role}`}>{term.label}</text>
              <title>{t(term.desc)}</title>
            </g>
          )
        })}
        <text x={(L.devBox.x0 + L.devBox.x1) / 2} y={L.devBox.y1 - 52} className="wr-device-name">{device.manufacturer} {device.name}</text>
        <text x={(L.devBox.x0 + L.devBox.x1) / 2} y={L.devBox.y1 - 34} className="wr-device-model">{device.model}</text>
        <circle cx={L.devBox.x0 + 26} cy={L.devBox.y1 - 40} r="6" className={`wr-led${powered && sim?.powered ? ' on' : ''}`}/>
      </g>

      {/* connectors */}
      {extras.filter((e) => e.kind === 'wago').map((w) => {
        const g = L.wagos[w.id]
        return (
          <g key={w.id} className={`wr-wago${interactive ? ' movable' : ''}`}
            onPointerDown={interactive ? (e) => { e.stopPropagation(); drag.current = w.id } : undefined}>
            <rect x={g.x0} y={g.y0} width={g.width} height={g.height} rx="6" className="wr-wago-body"/>
            {Object.entries(g.ports).map(([q, [x, y]]) => (
              <g key={q}>
                <rect x={x - 9} y={g.y0 + 4} width="18" height="12" rx="3" className="wr-wago-lever"/>
                <line x1={x} x2={x} y1={y} y2={g.y0}/>
              </g>
            ))}
            <text x={w.x} y={g.y0 + g.height - 6} className="wr-wago-label">{w.label ? `${(w.label.match(/\(([A-Z]+)\)/) || [])[1] || t(w.label)} · ` : ''}{w.model?.replace('WAGO ', '') || `${w.poles}-way`}</text>
            {interactive && onExtraRemove && <g className="wr-wago-x" onClick={(e) => { e.stopPropagation(); onExtraRemove(w.id) }}><circle cx={g.x0 + g.width} cy={g.y0} r="8"/><text x={g.x0 + g.width} y={g.y0 + 4}>×</text></g>}
          </g>
        )
      })}

      {/* ports on top */}
      {extras.filter((e) => e.kind === 'wago').flatMap((w) => Object.entries(L.wagos[w.id].ports).map(([q, [x, y]]) => interactive
        ? <Port key={`${w.id}:${q}`} id={`${w.id}:${q}`} x={x} y={y}/>
        : <circle key={`${w.id}:${q}`} cx={x} cy={y} r="3" className="wr-wago-dot"/>))}
      {interactive && device.terminals.map((term) => <Port key={term.id} id={`dev:${term.id}`} x={L.terms[term.id].x} y={L.terms[term.id].y - 14}/>)}
      {interactive && scenario.parts.flatMap((p) => (PART_PORTS[p.kind] || []).map((q) => <Port key={`${p.id}:${q}`} id={`${p.id}:${q}`} x={L.parts[p.id].ports[q][0]} y={L.parts[p.id].ports[q][1]}/>))}
    </svg>
    </>
  )
}
