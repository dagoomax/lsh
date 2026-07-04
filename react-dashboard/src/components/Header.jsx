import { LANGUAGES, getLang, setLang } from '../i18n'

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
      background: 'rgba(13,17,23,0.85)',            // #0d1117 (vanilla --bg)
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      borderBottom: '1px solid #21262d',            // vanilla --card-border
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

      {/* Nav (center) — styled in global.css to match vanilla */}
      <nav className="header-nav-react">
        {NAV.map(({ label, href, active }) => (
          <a key={label} href={href} className={active ? 'active' : undefined}>{label}</a>
        ))}
      </nav>

      {/* Connection status + source (right) — vanilla green/red + neutral chip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <select
          value={getLang()}
          onChange={e => setLang(e.target.value)}
          title="Language"
          style={{
            background: 'rgba(255,255,255,0.06)', color: 'var(--text2, #8b949e)',
            border: '1px solid #21262d', borderRadius: 8,
            padding: '4px 6px', fontSize: 12, fontWeight: 600, cursor: 'pointer', outline: 'none',
          }}>
          {LANGUAGES.map(([code, label]) => (
            <option key={code} value={code} style={{ background: '#161b22' }}>{label}</option>
          ))}
        </select>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6,
          background: live ? 'rgba(63,185,80,0.15)' : 'rgba(248,81,73,0.15)',
          border: `1px solid ${live ? 'rgba(63,185,80,0.3)' : 'rgba(248,81,73,0.3)'}`,
          borderRadius: 20, padding: '3px 10px',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%',
            background: live ? '#3fb950' : '#f85149',
            display: 'inline-block',
            boxShadow: live ? '0 0 6px #3fb950' : 'none',
            animation: live ? 'none' : 'pulse 2s infinite',
          }}/>
          <span style={{ fontSize: 11, fontWeight: 600, color: live ? '#3fb950' : '#f85149' }}>
            {live ? 'Connected' : 'Offline'}
          </span>
        </div>
        <span className="header-source" style={{ fontSize: 11, color: '#8b949e',
          background: '#161b22', padding: '3px 8px', borderRadius: 8, border: '1px solid #21262d' }}>
          {source}
        </span>
      </div>
    </header>
  )
}
