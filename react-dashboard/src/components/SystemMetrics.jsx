import { useMemo } from 'react'
import { gt } from '../i18n'

/**
 * Host system metrics (CPU / memory / disk) for the box LSH runs on, rendered
 * as an ordinary dashboard card — same glass shell as the other sections.
 *
 * Reads straight off the device store: system-metrics-client.js registers a
 * single `system/host` device (type 'system') with cpu / load1 / memPercent /
 * memUsed / memTotal / uptime sensors plus a disk_<slug>_percent|free|total
 * trio per configured mount. Disks are discovered from the device's own sensor
 * list, so a box reporting one mount or four both render correctly with no
 * per-deployment change here.
 */

const read = (dev, path) => dev.readings?.[path]?.value

// Usage-bar colour: calm until it matters, then amber, then red.
function barColor(pct, warn, crit) {
  if (pct == null) return 'var(--muted)'
  if (pct >= crit) return 'var(--red)'
  if (pct >= warn) return 'var(--amber, #e0a03a)'
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

function UsageBar({ label, pct, detail, warn = 70, crit = 90 }) {
  const val = pct == null ? null : Math.max(0, Math.min(100, pct))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
          {val == null ? '—' : `${Math.round(val)}%`}
          {detail && <span style={{ color: 'var(--muted)', fontWeight: 500 }}>{`  ${detail}`}</span>}
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 6, background: 'var(--glass-border, rgba(255,255,255,0.12))', overflow: 'hidden' }}>
        <div style={{
          width: `${val ?? 0}%`, height: '100%', borderRadius: 6,
          background: barColor(val, warn, crit), transition: 'width .4s ease, background .4s ease',
        }} />
      </div>
    </div>
  )
}

export default function SystemMetrics({ devices }) {
  const dev = useMemo(
    () => (devices || []).find(d => d.type === 'system' || d.key === 'system/host'),
    [devices],
  )
  if (!dev) return null

  const cpu  = read(dev, 'cpu')
  const memP = read(dev, 'memPercent')
  const memU = read(dev, 'memUsed')
  const memT = read(dev, 'memTotal')
  const load = read(dev, 'load1')
  const up   = read(dev, 'uptime')

  // Discover disks from the sensor list: each mount is a disk_<slug>_percent.
  const disks = useMemo(() => {
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

  const gb = (v) => (v == null ? null : `${(+v).toFixed(1)} GB`)

  return (
    <div className="glass" style={{ padding: 16, borderRadius: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20 }}>🖥️</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{dev.label || gt('system.title', 'System')}</span>
        </div>
        <span style={{ fontSize: 11, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
          {load != null && `${gt('system.load', 'load')} ${(+load).toFixed(2)}`}
          {up != null && `  ·  ${gt('system.up', 'up')} ${fmtUptime(up)}`}
        </span>
      </div>

      <UsageBar label={gt('system.cpu', 'CPU')} pct={cpu} warn={70} crit={90} />
      <UsageBar label={gt('system.memory', 'Memory')} pct={memP} warn={75} crit={92}
        detail={memU != null && memT != null ? `${gb(memU)} / ${gb(memT)}` : null} />

      {disks.map(d => (
        <UsageBar key={d.slug} label={`${gt('system.disk', 'Disk')} ${d.name}`} pct={d.pct} warn={80} crit={92}
          detail={d.free != null && d.total != null ? `${gb(d.free)} ${gt('system.free', 'free')} / ${gb(d.total)}` : null} />
      ))}
    </div>
  )
}
