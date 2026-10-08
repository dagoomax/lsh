import { useEffect, useMemo, useRef, useState } from 'react'

// Generated network map for Settings → System → LAN scan. Logical, not
// physical: a single host's scan can't see which mesh node / switch port a
// device hangs off (that needs the router's API or SNMP/LLDP), so devices are
// drawn off the gateway, clustered by type, with network gear (mesh nodes,
// APs) shown on their own ring next to the gateway. Radial tree layout in
// plain SVG — no graph library.

const GROUPS = [
  { id: 'infra', label: 'Network', color: '#64d2ff', kinds: ['network'] },
  { id: 'apple', label: 'Apple & AirPlay', color: '#bf5af2', kinds: ['apple', 'airplay'] },
  { id: 'homekit', label: 'HomeKit / Matter', color: '#ff9f0a', kinds: ['homekit', 'matter'] },
  { id: 'climate', label: 'Climate & appliances', color: '#30d158', kinds: ['climate', 'appliance', 'victron'] },
  { id: 'lighting', label: 'Lighting & switches', color: '#ffd60a', kinds: ['hue', 'shelly', 'esphome', 'wled'] },
  { id: 'media', label: 'Media', color: '#ff375f', kinds: ['cast', 'androidtv', 'sonos'] },
  { id: 'hubs', label: 'Hubs & automation', color: '#0a84ff', kinds: ['homeassistant', 'homey', 'nodered', 'mqtt', 'loxone', 'fibaro', 'knx', 'modbus'] },
  { id: 'cameras', label: 'Cameras', color: '#ff6961', kinds: ['camera'] },
  { id: 'printers', label: 'Printers', color: '#8e8e93', kinds: ['printer'] },
  { id: 'other', label: 'Other', color: '#636366', kinds: [] },
]
const groupOf = (h) => GROUPS.find((g) => g.kinds.includes(h.id?.kind)) || GROUPS[GROUPS.length - 1]
const short = (s, n = 18) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s)

export default function LanTopology({ data, onSelect, selected, renderDetails, icons }) {
  const [popup, setPopup] = useState(false)
  const graph = useMemo(() => layout(data, icons), [data, icons])
  return (
    <>
      <div className="lan-topo">
        <button className="lan-expand" onClick={() => setPopup(true)} title="Open large map">⤢</button>
        <Graph graph={graph} data={data} selected={selected} onSelect={(ip) => { setPopup(true); onSelect?.(ip) }} interactive={false}/>
        <Legend data={data}/>
        <div className="lan-open-large"><button onClick={() => setPopup(true)}>Open large map ⤢</button></div>
      </div>
      {popup && (
        <TopologyPopup graph={graph} data={data} selected={selected} onSelect={onSelect}
          renderDetails={renderDetails} onClose={() => setPopup(false)}/>
      )}
    </>
  )
}

function TopologyPopup({ graph, data, selected, onSelect, renderDetails, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])
  return (
    <div className="lan-popup-backdrop" onClick={onClose}>
      <div className="lan-popup" onClick={(e) => e.stopPropagation()}>
        <div className="lan-popup-head">
          <b>Network map</b>
          <span className="stg-hint">{data.hosts.length} devices · {data.networks.map((n) => n.cidr).join(', ')} · scroll to zoom, drag to pan, click a device for details</span>
          <button className="lan-popup-close" onClick={onClose} title="Close (Esc)">✕</button>
        </div>
        <div className="lan-popup-body">
          <div className="lan-popup-graph">
            <Graph graph={graph} data={data} selected={selected} onSelect={onSelect} interactive/>
            <Legend data={data}/>
          </div>
          {selected && renderDetails && (
            <aside className="lan-popup-side">
              <button className="lan-popup-close side" onClick={() => onSelect?.(selected)} title="Close details">✕</button>
              {renderDetails(selected)}
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}

// SVG graph; `interactive` adds wheel zoom (around the cursor), drag pan and
// zoom buttons by driving the viewBox.
function Graph({ graph, data, selected, onSelect, interactive }) {
  const { nodes, edges, size } = graph
  const full = { x: -size / 2, y: -size / 2, w: size, h: size }
  const [vb, setVb] = useState(full)
  const [hover, setHover] = useState(null)
  const svgRef = useRef(null)
  const drag = useRef(null)
  useEffect(() => setVb(full), [size])

  const toSvg = (cx, cy) => {
    const r = svgRef.current.getBoundingClientRect()
    // preserveAspectRatio meet: account for letterboxing
    const scale = Math.min(r.width / vb.w, r.height / vb.h)
    const ox = (r.width - vb.w * scale) / 2, oy = (r.height - vb.h * scale) / 2
    return { x: vb.x + (cx - r.left - ox) / scale, y: vb.y + (cy - r.top - oy) / scale, scale }
  }
  const zoom = (factor, cx, cy) => setVb((v) => {
    const w = Math.min(Math.max(v.w * factor, size / 12), size * 1.5), h = w * (v.h / v.w)
    const p = cx != null ? toSvg(cx, cy) : { x: v.x + v.w / 2, y: v.y + v.h / 2 }
    return { x: p.x - (p.x - v.x) * (w / v.w), y: p.y - (p.y - v.y) * (h / v.h), w, h }
  })
  useEffect(() => {
    if (!interactive) return
    const el = svgRef.current
    const onWheel = (e) => { e.preventDefault(); zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY) }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })
  const onDown = (e) => { if (interactive && e.button === 0) drag.current = { x: e.clientX, y: e.clientY, vb, moved: false } }
  const onMove = (e) => {
    const d = drag.current
    if (!d) return
    const { scale } = toSvg(e.clientX, e.clientY)
    const dx = (e.clientX - d.x) / scale, dy = (e.clientY - d.y) / scale
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) d.moved = true
    setVb({ ...d.vb, x: d.vb.x - dx, y: d.vb.y - dy })
  }
  const onUp = () => { setTimeout(() => { drag.current = null }, 0) }
  const click = (n) => { if (drag.current?.moved || !n.host) return; onSelect?.(n.host.ip) }
  const zoomed = vb.w < size * 0.6

  return (
    <div className={`lan-graph${interactive ? ' interactive' : ''}`}>
      {interactive && (
        <div className="lan-zoom">
          <button onClick={() => zoom(1 / 1.3)} title="Zoom in">+</button>
          <button onClick={() => zoom(1.3)} title="Zoom out">−</button>
          <button onClick={() => setVb(full)} title="Reset">⟲</button>
        </div>
      )}
      <svg ref={svgRef} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className="lan-topo-svg" role="img" aria-label="Network topology"
        onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}>
        {edges.map((e, i) => (
          <line key={i} x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} className={`lan-edge lan-edge-${e.type}`} stroke={e.color}/>
        ))}
        {nodes.map((n) => (
          <g key={n.key} transform={`translate(${n.x},${n.y})`}
            className={`lan-node lan-node-${n.type}${selected && n.host?.ip === selected ? ' sel' : ''}`}
            onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(null)}
            onClick={() => click(n)} style={{ cursor: n.host ? 'pointer' : 'default' }}>
            {n.integration && <circle r={n.r + 4} className="lan-int-ring"/>}
            <circle r={n.r} fill={n.fill} stroke={n.stroke} strokeWidth={n.type === 'group' ? 2 : 1.5}/>
            {n.icon && <text className="lan-icon" fontSize={n.r * 1.05} dy="0.36em">{n.icon}</text>}
            {n.img && (
              <>
                <clipPath id={`clip-${n.key.replace(/[^a-z0-9]/gi, '')}`}><circle r={n.r - 2}/></clipPath>
                <image href={n.img} x={-(n.r - 3)} y={-(n.r - 3)} width={(n.r - 3) * 2} height={(n.r - 3) * 2}
                  clipPath={n.imgBrand ? undefined : `url(#clip-${n.key.replace(/[^a-z0-9]/gi, '')})`} preserveAspectRatio="xMidYMid meet" style={{ pointerEvents: 'none' }}/>
              </>
            )}
            {n.label && (
              <text className={`lan-label lan-label-${n.type}`} y={n.labelY ?? n.r + 12}
                textAnchor={n.anchor || 'middle'} x={n.labelX || 0}>{zoomed && n.host?.ip && n.type === 'host' ? `${n.label} · ${n.host.ip}` : n.label}</text>
            )}
          </g>
        ))}
      </svg>
      {hover?.host && (
        <div className="lan-tip">
          <b>{hover.host.name || hover.host.ip}</b>
          <div>{hover.host.ip}{hover.host.mac ? ` · ${hover.host.mac}` : ''}</div>
          {hover.host.vendor && <div>{hover.host.vendor}</div>}
          {hover.host.id?.label && <div>{hover.host.id.label}{hover.host.id.integration ? ` → LSH “${hover.host.id.integration}”` : ''}</div>}
          {hover.host.ports?.length > 0 && <div>ports {hover.host.ports.join(', ')}</div>}
          {hover.host.latency != null && <div>{hover.host.latency} ms</div>}
        </div>
      )}
    </div>
  )
}

function Legend({ data }) {
  return (
    <div className="lan-legend">
      {GROUPS.filter((g) => data.hosts.some((h) => groupOf(h) === g)).map((g) => (
        <span key={g.id}><i style={{ background: g.color }}/>{g.label}</span>
      ))}
      <span><i className="ring"/>LSH can connect</span>
      <span className="stg-hint">Logical map — physical links (which mesh node / port) aren't visible to a scan.</span>
    </div>
  )
}

// icons: Map(ip → { file, source }) from the saved-device list
function layout(data, icons) {
  const hosts = data.hosts
  const gwIp = data.gateway?.ip || hosts.find((h) => h.gateway)?.ip || null
  const gw = hosts.find((h) => h.ip === gwIp) || null
  const others = hosts.filter((h) => h !== gw)

  // Clusters (non-empty groups); the LSH host gets its own spoke.
  const clusters = GROUPS.map((g) => ({ g, hosts: others.filter((h) => !h.self && groupOf(h) === g) })).filter((c) => c.hosts.length)
  const selfHosts = others.filter((h) => h.self)

  const leafCount = clusters.reduce((a, c) => a + c.hosts.length, 0) + selfHosts.length
  const R1 = 130, R2 = Math.max(250, 110 + leafCount * 6)
  const size = (R2 + 125) * 2

  const nodes = []
  const edges = []
  const root = { key: 'gw', type: 'root', x: 0, y: 0, r: 26, fill: '#1c3b5a', stroke: '#64d2ff', icon: '🌐',
    label: gw ? short(gw.name || 'Gateway', 22) : 'Gateway', host: gw, labelY: 42, integration: !!gw?.id?.integration }
  nodes.push(root)

  // Angular share proportional to cluster size (min share for small ones).
  // Alternate big and small clusters so small ones (and their labels)
  // don't bunch up on one side.
  const bySize = [...clusters].sort((a, b) => b.hosts.length - a.hosts.length)
  const mixed = []
  while (bySize.length) { mixed.push(bySize.shift()); if (bySize.length) mixed.push(bySize.pop()) }
  const spokes = [...selfHosts.map((h) => ({ self: h, weight: 2 })), ...mixed.map((c) => ({ c, weight: Math.max(c.hosts.length, 3) }))]
  const total = spokes.reduce((a, s) => a + s.weight, 0)
  let angle = -Math.PI / 2
  for (const s of spokes) {
    const span = (s.weight / total) * Math.PI * 2
    const mid = angle + span / 2
    if (s.self) {
      const h = s.self
      const n = { key: `h-${h.ip}`, type: 'self', host: h, x: Math.cos(mid) * R1, y: Math.sin(mid) * R1, r: 18,
        fill: '#3a2a0a', stroke: '#ffcc00', icon: '🏠', label: `LSH · ${h.ip}`, integration: false }
      nodes.push(n)
      edges.push({ a: root, b: n, type: 'self', color: '#ffcc00' })
    } else {
      const { g, hosts: hs } = s.c
      // Group label just outside the node, along the spoke — away from the centre.
      const gn = { key: `g-${g.id}`, type: 'group', x: Math.cos(mid) * R1, y: Math.sin(mid) * R1, r: 13,
        fill: 'var(--bg)', stroke: g.color, label: `${g.label} (${hs.length})`,
        labelX: Math.cos(mid) * 22, labelY: Math.sin(mid) * 22 + 4, anchor: Math.abs(Math.cos(mid)) < 0.3 ? 'middle' : Math.cos(mid) > 0 ? 'start' : 'end' }
      nodes.push(gn)
      edges.push({ a: root, b: gn, type: 'trunk', color: g.color })
      hs.forEach((h, i) => {
        const a = hs.length === 1 ? mid : angle + (span * (i + 0.5)) / hs.length
        const x = Math.cos(a) * R2, y = Math.sin(a) * R2
        const right = Math.cos(a) >= 0
        const icon = icons?.get(h.ip) || h.saved?.icon
        const n = { key: `h-${h.ip}`, type: 'host', host: h, x, y, r: icon ? 13 : 9, fill: g.color, stroke: 'var(--bg)',
          img: icon?.file ? `/api/lsh-lan/icons/${encodeURIComponent(icon.file)}` : null, imgBrand: icon?.source === 'vendor',
          label: short(h.saved?.label || h.name || h.ip), labelX: right ? (icon ? 17 : 13) : (icon ? -17 : -13), labelY: 4, anchor: right ? 'start' : 'end',
          integration: !!h.id?.integration }
        nodes.push(n)
        edges.push({ a: gn, b: n, type: 'leaf', color: g.color })
      })
    }
    angle += span
  }
  return { nodes, edges, size }
}
