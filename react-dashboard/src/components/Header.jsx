import { useState, useEffect } from 'react'

function fmt(d) {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
function fmtDate(d) {
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export default function Header({ connection, connected }) {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const source = connection?.source === 'vrm' ? 'VRM Cloud'
               : connection?.source === 'mqtt' ? 'MQTT Local' : '—'
  const live = connected && (connection?.vrm?.connected || connection?.mqtt?.connected)

  return (
    <header style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
      height: 52,
      background: 'rgba(0,0,0,0.85)',
      backdropFilter: 'blur(40px) saturate(180%)',
      WebkitBackdropFilter: 'blur(40px) saturate(180%)',
      borderBottom: '1px solid rgba(255,255,255,0.08)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 24px', flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 20 }}>⚡</span>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.3px', lineHeight: 1.1 }}>LSH</div>
          <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1 }}>Local Smart Home</div>
        </div>
      </div>

      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 17, fontWeight: 300, letterSpacing: '0.05em', fontVariantNumeric: 'tabular-nums' }}>
          {fmt(now)}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text2)' }}>{fmtDate(now)}</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className={`badge ${live ? 'badge-green' : 'badge-red'}`}>
          <span style={{ fontSize: 7 }}>●</span>{live ? 'Live' : 'Offline'}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text2)' }}>{source}</span>
      </div>
    </header>
  )
}
