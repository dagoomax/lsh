import { LANGUAGES, getLang, setLang, gt } from '../i18n'

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
      background: 'rgba(9,12,18,0.8)',
      backdropFilter: 'blur(18px) saturate(1.4)',
      WebkitBackdropFilter: 'blur(18px) saturate(1.4)',
      borderBottom: '1px solid var(--border)',
      boxShadow: '0 1px 0 rgba(255,255,255,0.03), 0 8px 24px rgba(0,0,0,0.25)',
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
          <a key={label} href={href} className={active ? 'active' : undefined}>{gt('nav_' + label.toLowerCase(), label)}</a>
        ))}
      </nav>

      {/* Connection status + source (right) — vanilla green/red + neutral chip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <select
          value={getLang()}
          onChange={e => setLang(e.target.value)}
          title="Language"
          style={{
            background: 'rgba(255,255,255,0.06)', color: 'var(--text2)',
            border: '1px solid var(--border)', borderRadius: 8,
            padding: '4px 6px', fontSize: 12, fontWeight: 600, cursor: 'pointer', outline: 'none',
          }}>
          {LANGUAGES.map(([code, label]) => (
            <option key={code} value={code} style={{ background: '#12161f' }}>{label}</option>
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
            {live ? gt('connected', 'Connected') : gt('offline', 'Offline')}
          </span>
        </div>
        <span className="header-source" style={{ fontSize: 11, color: 'var(--text2)',
          background: 'rgba(255,255,255,0.04)', padding: '3px 8px', borderRadius: 8, border: '1px solid var(--border)' }}>
          {source}
        </span>
      </div>
    </header>
  )
}
