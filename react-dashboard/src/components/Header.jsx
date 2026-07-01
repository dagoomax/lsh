const NAV = [
  { label: 'Dashboard', href: '/react/',        active: true  },
  { label: 'Settings',  href: '/settings.html', active: false },
  { label: 'Logs',      href: '/logs.html',     active: false },
  { label: 'MQTT',      href: '/mqtt.html',     active: false },
]

export default function Header({ connection, connected }) {
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
      gap: 12,
      padding: '0 20px', flexShrink: 0,
    }}>
      {/* Logo + wordmark (left) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <img src="/logo.svg" alt="LSH" width={32} height={32} style={{
          borderRadius: 9, flexShrink: 0, display: 'block',
          boxShadow: '0 2px 12px rgba(88,166,255,0.35)',
        }}/>
        <span style={{
          fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', whiteSpace: 'nowrap',
          background: 'linear-gradient(135deg, #3fb950 0%, #4fa8e0 55%, #58a6ff 100%)',
          WebkitBackgroundClip: 'text', backgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}>LSHServer</span>
      </div>

      {/* Nav (center) */}
      <nav className="header-nav-react" style={{
        display: 'flex', gap: 6,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid var(--border)',
        borderRadius: 10, padding: 4,
      }}>
        {NAV.map(({ label, href, active }) => (
          <a key={label} href={href} style={{
            fontSize: 13, fontWeight: 500, padding: '7px 16px', borderRadius: 7,
            textDecoration: 'none', whiteSpace: 'nowrap',
            color: active ? '#fff' : 'var(--text2)',
            background: active ? 'var(--purple)' : 'transparent',
            boxShadow: active ? '0 2px 8px rgba(124,58,237,0.35)' : 'none',
            transition: 'color 0.15s, background 0.15s',
          }}>{label}</a>
        ))}
      </nav>

      {/* Connection status + source (right) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
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
