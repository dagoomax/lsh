import { useMemo } from 'react'
import { gt } from '../i18n'
import { useHistoryPoints, smoothPath } from '../historyChart'

/**
 * Host system metrics (CPU / memory / disk) for the box LSH runs on — Homey
 * style: one card of ring-gauge tiles, a live CPU history sparkline, and
 * load/uptime chips in the header.
 *
 * Reads straight off the device store: system-metrics-client.js registers a
 * single `system/host` device (type 'system') with cpu / load1 / memPercent /
 * memUsed / memTotal / uptime sensors plus a disk_<slug>_percent|free|total
 * trio per configured mount. Disks are discovered from the device's own sensor
 * list, so a box reporting one mount or four both render correctly with no
 * per-deployment change here.
 */

const read = (dev, path) => dev.readings?.[path]?.value

// Gauge colour: calm until it matters, then amber, then red.
function levelColor(pct, warn, crit) {
  if (pct == null) return 'var(--text3)'
  if (pct >= crit) return 'var(--red)'
  if (pct >= warn) return 'var(--orange)'
  return 'var(--green)'
}

function fmtUptime(sec) {
  if (sec == null) return '—'
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// Ring gauge: 270° track opening at the bottom, arc animates to the value.
function Ring({ pct, color, size = 92, stroke = 9, children }) {
  const r = (size - stroke) / 2
  const c = size / 2
  const circ = 2 * Math.PI * r
  const sweep = 0.75 // 270°
  const val = pct == null ? 0 : Math.max(0, Math.min(100, pct))
  return (
    <div className="sm-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(135deg)' }}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--white-10)" strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={`${circ * sweep} ${circ}`} />
        <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={`${circ * sweep * (val / 100)} ${circ}`}
          style={{ transition: 'stroke-dasharray .8s cubic-bezier(.34,1.2,.64,1), stroke .4s ease' }} />
      </svg>
      <div className="sm-ring-center">{children}</div>
    </div>
  )
}

// CPU history: zero-anchored 0–100 %, area + line, "now" dot.
function CpuSpark({ points, color }) {
  const W = 240, H = 48
  if (!points || points.length < 2) return <div className="sm-spark-empty">{points == null ? '…' : '—'}</div>
  const t0 = points[0][0], t1 = points.at(-1)[0]
  const xy = points.map(([t, v]) => [((t - t0) / Math.max(1, t1 - t0)) * W, H - 3 - (Math.max(0, Math.min(100, v)) / 100) * (H - 6)])
  const line = smoothPath(xy)
  const [lx, ly] = xy.at(-1)
  return (
    <svg className="sm-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="sm-cpu-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L ${W} ${H} L 0 ${H} Z`} fill="url(#sm-cpu-fill)" />
      <path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r="3" fill={color} />
    </svg>
  )
}

function Tile({ label, pct, color, detail, children, wide = false }) {
  return (
    <div className={`sm-tile${wide ? ' sm-tile-wide' : ''}`}>
      <Ring pct={pct} color={color}>
        <span className="sm-pct">{pct == null ? '—' : Math.round(pct)}<small>%</small></span>
      </Ring>
      <div className="sm-tile-body">
        <div className="sm-label">{label}</div>
        {detail && <div className="sm-detail">{detail}</div>}
        {children}
      </div>
    </div>
  )
}

export default function SystemMetrics({ devices }) {
  const dev = useMemo(
    () => (devices || []).find(d => d.type === 'system' || d.key === 'system/host'),
    [devices],
  )
  const cpuHistory = useHistoryPoints(dev ? `${dev.key}/cpu` : null, 30000)

  // Discover disks from the sensor list: each mount is a disk_<slug>_percent.
  const disks = useMemo(() => {
    if (!dev) return []
    const out = []
    for (const s of dev.sensors || []) {
      const m = /^disk_(.+)_percent$/.exec(s.path || '')
      if (!m) continue
      const slug = m[1]
      const name = (s.name || '').replace(/^Disk\s+/, '').replace(/\s+Used$/, '') || slug
      out.push({
        slug, name,
        pct:   read(dev, `disk_${slug}_percent`),
        free:  read(dev, `disk_${slug}_free`),
        total: read(dev, `disk_${slug}_total`),
      })
    }
    return out
  }, [dev])

  if (!dev) return null

  const cpu  = read(dev, 'cpu')
  const memP = read(dev, 'memPercent')
  const memU = read(dev, 'memUsed')
  const memT = read(dev, 'memTotal')
  const load = read(dev, 'load1')
  const up   = read(dev, 'uptime')
  const gb = (v) => (v == null ? null : `${(+v).toFixed(1)} GB`)
  const cpuColor = levelColor(cpu, 70, 90)
  // Status dot: worst of all gauges
  const worst = Math.max(
    cpu >= 90 || memP >= 92 || disks.some(d => d.pct >= 92) ? 2 : 0,
    cpu >= 70 || memP >= 75 || disks.some(d => d.pct >= 80) ? 1 : 0,
  )
  const status = [
    { color: 'var(--green)', text: gt('system.healthy', 'Healthy') },
    { color: 'var(--orange)', text: gt('system.busy', 'Busy') },
    { color: 'var(--red)', text: gt('system.critical', 'Critical') },
  ][worst]

  return (
    <div className="card sm-card">
      <div className="sm-head">
        <div className="sm-host-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" />
            <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
          </svg>
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="sm-title">{dev.label || gt('system.title', 'System')}</div>
          <div className="sm-status"><span style={{ background: status.color }} />{status.text}</div>
        </div>
        <div className="sm-chips">
          {load != null && <span className="sm-chip">{gt('system.load', 'load')} <b>{(+load).toFixed(2)}</b></span>}
          {up != null && <span className="sm-chip">{gt('system.up', 'up')} <b>{fmtUptime(up)}</b></span>}
        </div>
      </div>

      <div className="sm-grid">
        <Tile wide label={gt('system.cpu', 'CPU')} pct={cpu} color={cpuColor}>
          <CpuSpark points={cpuHistory} color={cpuColor} />
        </Tile>
        <Tile label={gt('system.memory', 'Memory')} pct={memP} color={levelColor(memP, 75, 92)}
          detail={memU != null && memT != null ? `${gb(memU)} / ${gb(memT)}` : null} />
        {disks.map(d => (
          <Tile key={d.slug} label={`${gt('system.disk', 'Disk')} ${d.name}`} pct={d.pct} color={levelColor(d.pct, 80, 92)}
            detail={d.free != null && d.total != null ? `${gb(d.free)} ${gt('system.free', 'free')} / ${gb(d.total)}` : null} />
        ))}
      </div>
    </div>
  )
}
