import { useState, useEffect } from 'react'

function fmt(d) {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
function fmtDate(d) {
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}

export default function Header({ connection, connected }) {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const source = connection?.source === 'vrm'  ? 'VRM Cloud'
               : connection?.source === 'mqtt' ? 'MQTT Local' : '—'
  const live = connected && (connection?.vrm?.connected || connection?.mqtt?.connected)

  return (
    <header style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
      height: 56,
      background: 'rgba(13,14,26,0.92)',
      backdropFilter: 'blur(32px)',
      WebkitBackdropFilter: 'blur(32px)',
      borderBottom: '1px solid rgba(124,58,237,0.15)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 20px', flexShrink: 0,
    }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <img src="/logo.svg" alt="LSH" width={32} height={32} style={{
          borderRadius: 9, flexShrink: 0, display: 'block',
          boxShadow: '0 2px 12px rgba(88,166,255,0.35)',
        }}/>
        <div>
          <div style={{
            fontSize: 14, fontWeight: 700, letterSpacing: '-0.3px', lineHeight: 1.1,
            background: 'linear-gradient(135deg, #3fb950 0%, #4fa8e0 55%, #58a6ff 100%)',
            WebkitBackgroundClip: 'text', backgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            width: 'fit-content',
          }}>
            LSH Server
          </div>
          <div style={{ fontSize: 10, color: 'var(--text3)', lineHeight: 1 }}>LSH Dashboard</div>
        </div>
      </div>

      {/* Clock */}
      <div style={{ textAlign: 'center' }} className="header-clock">
        <div style={{ fontSize: 16, fontWeight: 300, letterSpacing: '0.08em', fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>
          {fmt(now)}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text3)' }} className="header-date">{fmtDate(now)}</div>
      </div>

      {/* Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6,
          background: live ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
          border: `1px solid ${live ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
          borderRadius: 20, padding: '3px 10px',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%',
            background: live ? 'var(--green)' : 'var(--red)',
            display: 'inline-block',
            boxShadow: live ? '0 0 6px var(--green)' : 'none',
            animation: live ? 'none' : 'pulse 2s infinite',
          }}/>
          <span style={{ fontSize: 11, fontWeight: 600, color: live ? 'var(--green)' : 'var(--red)' }}>
            {live ? 'Connected' : 'Offline'}
          </span>
        </div>
        <span className="header-source" style={{ fontSize: 11, color: 'var(--text3)', background: 'rgba(255,255,255,0.04)',
          padding: '3px 8px', borderRadius: 8, border: '1px solid var(--border)' }}>
          {source}
        </span>
      </div>
    </header>
  )
}
