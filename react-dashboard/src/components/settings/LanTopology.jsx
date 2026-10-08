import { useMemo, useState } from 'react'

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
  { id: 'hubs', label: 'Hubs & automation', color: '#0a84ff', kinds: ['homeassistant', 'nodered', 'mqtt', 'loxone', 'fibaro', 'knx', 'modbus'] },
  { id: 'cameras', label: 'Cameras', color: '#ff6961', kinds: ['camera'] },
  { id: 'printers', label: 'Printers', color: '#8e8e93', kinds: ['printer'] },
  { id: 'other', label: 'Other', color: '#636366', kinds: [] },
]
const groupOf = (h) => GROUPS.find((g) => g.kinds.includes(h.id?.kind)) || GROUPS[GROUPS.length - 1]
const short = (s, n = 18) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s)

export default function LanTopology({ data, onSelect, selected }) {
  const [hover, setHover] = useState(null)

  const { nodes, edges, size } = useMemo(() => layout(data), [data])

  return (
    <div className="lan-topo">
      <svg viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} className="lan-topo-svg" role="img" aria-label="Network topology">
        {edges.map((e, i) => (
          <line key={i} x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} className={`lan-edge lan-edge-${e.type}`}
            stroke={e.color} />
        ))}
        {nodes.map((n) => (
          <g key={n.key} transform={`translate(${n.x},${n.y})`}
            className={`lan-node lan-node-${n.type}${selected && n.host?.ip === selected ? ' sel' : ''}`}
            onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(null)}
            onClick={() => n.host && onSelect?.(n.host.ip)} style={{ cursor: n.host ? 'pointer' : 'default' }}>
            {n.integration && <circle r={n.r + 4} className="lan-int-ring" />}
            <circle r={n.r} fill={n.fill} stroke={n.stroke} strokeWidth={n.type === 'group' ? 2 : 1.5} />
            {n.icon && <text className="lan-icon" fontSize={n.r * 1.05} dy="0.36em">{n.icon}</text>}
            {n.label && (
              <text className={`lan-label lan-label-${n.type}`} y={n.labelY ?? n.r + 12}
                textAnchor={n.anchor || 'middle'} x={n.labelX || 0}>{n.label}</text>
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
      <div className="lan-legend">
        {GROUPS.filter((g) => data.hosts.some((h) => groupOf(h) === g)).map((g) => (
          <span key={g.id}><i style={{ background: g.color }} />{g.label}</span>
        ))}
        <span><i className="ring" />LSH can connect</span>
        <span className="stg-hint">Logical map — physical links (which mesh node / port) aren't visible to a scan.</span>
      </div>
    </div>
  )
}

function layout(data) {
  const hosts = data.hosts
  const gwIp = data.gateway?.ip || hosts.find((h) => h.gateway)?.ip || null
  const gw = hosts.find((h) => h.ip === gwIp) || null
  const others = hosts.filter((h) => h !== gw)

  // Clusters (non-empty groups); the LSH host gets its own spoke.
  const clusters = GROUPS.map((g) => ({ g, hosts: others.filter((h) => !h.self && groupOf(h) === g) })).filter((c) => c.hosts.length)
  const selfHosts = others.filter((h) => h.self)

  const leafCount = clusters.reduce((a, c) => a + c.hosts.length, 0) + selfHosts.length
  const R1 = 150, R2 = Math.max(290, 120 + leafCount * 6.5)
  const size = (R2 + 150) * 2

  const nodes = []
  const edges = []
  const root = { key: 'gw', type: 'root', x: 0, y: 0, r: 26, fill: '#1c3b5a', stroke: '#64d2ff', icon: '🌐',
    label: gw ? short(gw.name || 'Gateway', 22) : 'Gateway', host: gw, labelY: 42, integration: !!gw?.id?.integration }
  nodes.push(root)

  // Angular share proportional to cluster size (min share for small ones).
  const spokes = [...selfHosts.map((h) => ({ self: h, weight: 1.5 })), ...clusters.map((c) => ({ c, weight: Math.max(c.hosts.length, 2) }))]
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
      const gn = { key: `g-${g.id}`, type: 'group', x: Math.cos(mid) * R1, y: Math.sin(mid) * R1, r: 13,
        fill: 'var(--bg)', stroke: g.color, label: `${g.label} (${hs.length})`, labelY: -20 }
      nodes.push(gn)
      edges.push({ a: root, b: gn, type: 'trunk', color: g.color })
      hs.forEach((h, i) => {
        const a = hs.length === 1 ? mid : angle + (span * (i + 0.5)) / hs.length
        const x = Math.cos(a) * R2, y = Math.sin(a) * R2
        const right = Math.cos(a) >= 0
        const n = { key: `h-${h.ip}`, type: 'host', host: h, x, y, r: 9, fill: g.color, stroke: 'var(--bg)',
          label: short(h.name || h.ip), labelX: right ? 13 : -13, labelY: 4, anchor: right ? 'start' : 'end',
          integration: !!h.id?.integration }
        nodes.push(n)
        edges.push({ a: gn, b: n, type: 'leaf', color: g.color })
      })
    }
    angle += span
  }
  return { nodes, edges, size }
}
