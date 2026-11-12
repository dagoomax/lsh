import { useMemo } from 'react'
import { Button } from '../primitives'
import { tr } from '../../../i18n'

// Zigbee mesh map from zigbee/coordinator/mesh ({ at, nodes, links, failed },
// src/zigbee-client.js _scanMesh): the coordinator in the middle, routers on
// rings by hop count, battery devices just outside their parent router. Links
// are coloured by link quality; parent → child links are dashed.

const W = 720
const H = 520
const lqiColor = (q) => (q >= 150 ? 'var(--green)' : q >= 80 ? 'var(--orange)' : 'var(--red)')
const ago = (t) => {
  if (!t) return tr('never')
  const s = (Date.now() - t) / 1000
  if (s < 120) return tr('{n} s ago', { n: Math.round(s) })
  if (s < 7200) return tr('{n} min ago', { n: Math.round(s / 60) })
  if (s < 172800) return tr('{n} h ago', { n: Math.round(s / 3600) })
  return tr('{n} days ago', { n: Math.round(s / 86400) })
}

export function layout(mesh, labels = {}) {
  const nodes = new Map(mesh.nodes.map((n) => [n.ieee, { ...n, label: (n.key && labels[n.key]) || n.label }]))
  // undirected, best LQI per pair; parent/child from either side's table
  const pairs = new Map()
  const parent = new Map()
  for (const l of mesh.links) {
    if (!nodes.has(l.source) || !nodes.has(l.target) || l.source === l.target || !(l.lqi > 0)) continue
    const k = [l.source, l.target].sort().join('|')
    const p = pairs.get(k)
    if (!p || l.lqi > p.lqi) pairs.set(k, { a: l.source, b: l.target, lqi: l.lqi, child: p?.child || false })
    // relationship 1: target is source's child; 0: target is source's parent.
    // Routers also name a "parent" (who let them join) — only a battery
    // device's parent is the router it talks through.
    const end = (x) => nodes.get(x).type === 'EndDevice'
    if (l.relationship === 1 && end(l.target)) { parent.set(l.target, l.source); pairs.get(k).child = true }
    if (l.relationship === 0 && end(l.source)) { parent.set(l.source, l.target); pairs.get(k).child = true }
  }
  const coord = [...nodes.values()].find((n) => n.type === 'Coordinator')
  // hops over router/coordinator links
  const adj = new Map()
  for (const { a, b } of pairs.values()) {
    if (nodes.get(a).type === 'EndDevice' || nodes.get(b).type === 'EndDevice') continue
    if (!adj.has(a)) adj.set(a, []); if (!adj.has(b)) adj.set(b, [])
    adj.get(a).push(b); adj.get(b).push(a)
  }
  const hop = new Map()
  if (coord) {
    hop.set(coord.ieee, 0)
    const q = [coord.ieee]
    while (q.length) { const x = q.shift(); for (const y of adj.get(x) || []) if (!hop.has(y)) { hop.set(y, hop.get(x) + 1); q.push(y) } }
  }
  const cx = W / 2, cy = H / 2 - 20
  if (coord) Object.assign(nodes.get(coord.ieee), { x: cx, y: cy })
  const routers = [...nodes.values()].filter((n) => n.type !== 'EndDevice' && n !== nodes.get(coord?.ieee))
  const maxHop = Math.max(1, ...routers.map((r) => hop.get(r.ieee) || 1))
  const ringR = (h) => Math.max(95, (190 * h) / maxHop)
  const byHop = new Map()
  for (const r of routers) { const h = hop.get(r.ieee) ?? maxHop; if (!byHop.has(h)) byHop.set(h, []); byHop.get(h).push(r) }
  for (const [h, list] of byHop) {
    list.sort((a, b) => String(a.label).localeCompare(String(b.label)))
    list.forEach((r, i) => {
      // outer rings turned a little so their links don't run through the coordinator
      const ang = -Math.PI / 2 + (2 * Math.PI * i) / list.length + (h % 2 ? 0 : Math.PI / list.length + 0.55)
      Object.assign(r, { x: cx + Math.cos(ang) * ringR(h) * 1.25, y: cy + Math.sin(ang) * ringR(h), ang })
    })
  }
  // end devices: fanned out beyond their parent; unheard ones in a row below
  const kids = new Map()
  const orphans = []
  for (const n of nodes.values()) {
    if (n.type !== 'EndDevice') continue
    const p = parent.get(n.ieee) && nodes.get(parent.get(n.ieee))
    if (p && p.x != null) { if (!kids.has(p.ieee)) kids.set(p.ieee, []); kids.get(p.ieee).push(n) }
    else orphans.push(n)
  }
  for (const [pid, list] of kids) {
    const p = nodes.get(pid)
    const base = p.ang ?? -Math.PI / 2
    list.forEach((n, i) => {
      const a = base + (i - (list.length - 1) / 2) * 0.35
      Object.assign(n, { x: p.x + Math.cos(a) * 85, y: p.y + Math.sin(a) * 70 })
    })
  }
  const clampN = (n) => { n.x = Math.max(40, Math.min(W - 40, n.x)); n.y = Math.max(24, Math.min(H - 70, n.y)) }
  for (const n of nodes.values()) if (n.x != null) clampN(n)
  const edges = [...pairs.values()].filter(({ a, b }) => nodes.get(a).x != null && nodes.get(b).x != null).sort((x, y) => x.lqi - y.lqi)
  // LQI label nearer the outer end, away from the crowded middle
  for (const e of edges) {
    const a = nodes.get(e.a), b = nodes.get(e.b)
    const [inner, outer] = Math.hypot(a.x - cx, a.y - cy) <= Math.hypot(b.x - cx, b.y - cy) ? [a, b] : [b, a]
    e.lx = inner.x + (outer.x - inner.x) * 0.62
    e.ly = inner.y + (outer.y - inner.y) * 0.62 - 3
  }
  return { nodes: [...nodes.values()].filter((n) => n.x != null), edges, orphans, byIeee: nodes }
}

export default function ZigbeeMeshMap({ mesh, scanning, running, onScan, labels }) {
  const g = useMemo(() => (mesh?.nodes?.length ? layout(mesh, labels) : null), [mesh, labels])
  const failed = new Set((mesh?.failed || []).map((f) => f.ieee))

  return (
    <div className="stg-mesh">
      <div className="stg-actions" style={{ alignItems: 'center' }}>
        <Button variant="secondary" busy={scanning} disabled={!running || scanning} onClick={onScan}>{scanning ? tr('Scanning…') : tr('Scan mesh')}</Button>
        {mesh?.at && <span className="stg-hint">{tr('Scanned {x}', { x: ago(mesh.at) })} · {tr('{n} links', { n: g?.edges.length ?? 0 })}</span>}
      </div>
      {!g && !scanning && <p className="stg-hint">{tr('No scan yet. Each router is asked for its neighbours in turn, which takes a few seconds per router. Battery devices show up through the router they are attached to.')}</p>}
      {g && (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tr('Zigbee mesh map')} style={{ width: '100%', height: 'auto', display: 'block', maxHeight: 560 }}>
            {g.edges.map((e) => {
              const a = g.byIeee.get(e.a), b = g.byIeee.get(e.b)
              const weak = e.lqi < 80 && !e.child
              return (
                <g key={`${e.a}|${e.b}`}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={lqiColor(e.lqi)} strokeWidth={weak ? 0.8 : e.child ? 1.5 : 1 + e.lqi / 70}
                    strokeDasharray={e.child ? '5 4' : undefined} strokeOpacity={weak ? 0.3 : 0.85}/>
                  {!weak && <text x={e.lx} y={e.ly} textAnchor="middle" fontSize="10" fill="var(--text2)"
                    stroke="var(--card)" strokeWidth="3" paintOrder="stroke">{e.lqi}</text>}
                </g>
              )
            })}
            {g.nodes.map((n) => {
              const r = n.type === 'Coordinator' ? 14 : n.type === 'Router' ? 10 : 7
              const fill = n.type === 'Coordinator' ? 'var(--accent)' : n.type === 'Router' ? 'var(--card)' : 'var(--white-08)'
              return (
                <g key={n.ieee}>
                  <title>{[n.label, n.ieee, n.nwk != null ? `nwk 0x${Number(n.nwk).toString(16).padStart(4, '0')}` : '', `${tr('last seen')} ${ago(n.lastSeen)}`, failed.has(n.ieee) ? tr("didn't answer the scan") : ''].filter(Boolean).join('\n')}</title>
                  <circle cx={n.x} cy={n.y} r={r} fill={fill} stroke={failed.has(n.ieee) ? 'var(--red)' : n.type === 'Coordinator' ? 'var(--accent)' : 'var(--text2)'}
                    strokeWidth={n.type === 'EndDevice' ? 1 : 1.5} strokeDasharray={n.type === 'EndDevice' ? '2 2' : undefined}/>
                  <text x={n.x} y={n.y + r + 13} textAnchor="middle" fontSize="11" fontWeight={n.type === 'Coordinator' ? 600 : 400}
                    fill={n.unknown ? 'var(--text3)' : 'var(--text)'} stroke="var(--card)" strokeWidth="4" paintOrder="stroke">{n.label}</text>
                </g>
              )
            })}
          </svg>
          <div className="stg-hint" style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <span><b style={{ color: 'var(--green)' }}>━</b> {tr('LQI 150+')}</span>
            <span><b style={{ color: 'var(--orange)' }}>━</b> 80–149</span>
            <span><b style={{ color: 'var(--red)', opacity: 0.5 }}>━</b> {tr('under 80')}</span>
            <span>┅ {tr('battery device → its router')}</span>
          </div>
          {g.orphans.length > 0 && (
            <p className="stg-hint">{tr('Not in any neighbour table (asleep, out of range or flat battery):')} {g.orphans.map((n) => `${n.label} (${ago(n.lastSeen)})`).join(', ')}</p>
          )}
          {mesh.failed?.length > 0 && (
            <p className="stg-hint">{tr("Didn't answer the scan:")} {mesh.failed.map((f) => g.byIeee.get(f.ieee)?.label || f.ieee).join(', ')}</p>
          )}
        </>
      )}
    </div>
  )
}
