import { useEffect, useState } from 'react'
import { LANGUAGES, getLang, setLang, gt } from '../i18n'
import { MonitorIcon, BroadcastIcon, LockIcon, SunIcon, MoonIcon } from './Icons'

const NAV = [
  { label: 'Dashboard', href: '/react/',        active: true },
  { label: 'Settings',  href: '/settings.html', special: 'settings' },
  { label: 'Logs',      href: '/logs.html',     active: false },
  { label: 'MQTT',      href: '/mqtt.html',     active: false },
  { label: 'Flows',     href: '/flows.html',    active: false },
]

// 44×44 is the WCAG/mobile minimum comfortable touch target — these sit in a
// fixed 56px header, so there's headroom to hit it without the bar growing.
const iconBtnStyle = {
  color: 'var(--text2)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
  width: 44, height: 44, flexShrink: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer',
}

export default function Header({ connection, connected, onLock, onOpenSettings, onOpenWall, onOpenCssEditor, pagingRoomCount, pagingMessageCount, onTogglePaging }) {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('lsh-theme') || 'dark' } catch { return 'dark' }
  })
  // The CSS Editor page is admin-gated on its own (see CssEditorPage.jsx) —
  // this just decides whether the *link* shows up: never for viewers (no
  // point linking somewhere they'll immediately get "Admin access
  // required"), and not for admins either if they've hidden it in Settings
  // → Interface (same on/off pattern as hideMqtt/hideLogs there).
  const [showCssEditorLink, setShowCssEditorLink] = useState(false)
  const [version, setVersion] = useState(null)
  useEffect(() => {
    Promise.all([
      fetch('/api/auth/me', { credentials: 'include' }).then(r => r.json()).catch(() => null),
      fetch('/api/ui-prefs', { credentials: 'include' }).then(r => r.json()).catch(() => null),
    ]).then(([me, prefs]) => {
      const isAdmin = me?.success && me.data?.role === 'admin'
      const hidden = !!prefs?.data?.hideCssEditor
      setShowCssEditorLink(isAdmin && !hidden)
      if (prefs?.data?.version) setVersion(prefs.data.version)
    })
  }, [])
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    try { localStorage.setItem('lsh-theme', next) } catch { /* ignore */ }
    setTheme(next)
  }
  const source = connection?.source === 'vrm'  ? 'VRM Cloud'
               : connection?.source === 'mqtt' ? 'MQTT Local' : '—'
  const live = connected && (connection?.vrm?.connected || connection?.mqtt?.connected)

  return (
    <>
    <header style={{
      position: 'fixed', top: 'env(safe-area-inset-top, 0px)', left: 0, right: 0, zIndex: 100,
      height: 56,
      background: 'var(--sidebar)',
      backdropFilter: 'blur(18px) saturate(1.4)',
      WebkitBackdropFilter: 'blur(18px) saturate(1.4)',
      borderBottom: '1px solid var(--border)',
      boxShadow: '0 1px 0 var(--white-03), 0 8px 24px rgba(0,0,0,0.25)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12,
      padding: '0 20px', flexShrink: 0,
    }}>
      {/* Logo + wordmark (left) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <img src="/logo.svg" alt="LSH" width={32} height={32} style={{
          borderRadius: 9, flexShrink: 0, display: 'block',
          boxShadow: '0 2px 12px color-mix(in srgb, var(--accent) 35%, transparent)',
        }}/>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1, whiteSpace: 'nowrap' }}>
          <span style={{
            fontFamily: 'var(--font-display)', fontStyle: 'italic', fontWeight: 500,
            fontSize: 21, letterSpacing: '-0.01em',
            background: 'var(--aurora-gradient)',
            WebkitBackgroundClip: 'text', backgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}>Aurora</span>
          <span style={{
            fontSize: 9.5, fontWeight: 600, letterSpacing: '0.11em', textTransform: 'uppercase',
            color: 'var(--text3)', marginTop: 2,
          }}>Lightweight Smart Home</span>
        </div>
      </div>

      {/* Nav (center) — styled in global.css to match vanilla */}
      <nav className="header-nav-react">
        {NAV.map(({ label, href, active, special }) => (
          <a key={label} href={href} className={active ? 'active' : undefined}
            onClick={special === 'settings' ? (e) => {
              // Plain left-click opens the in-app Settings view; ctrl/cmd/shift-click
              // or middle-click still opens /settings.html in a new tab as normal.
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
              e.preventDefault(); onOpenSettings?.()
            } : undefined}>
            {gt('nav_' + label.toLowerCase(), label)}
          </a>
        ))}
        {showCssEditorLink && (
          <a href="#" onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
            e.preventDefault(); onOpenCssEditor?.()
          }}>
            {gt('nav_css_editor', 'CSS Editor')}
          </a>
        )}
      </nav>

      {/* Connection status + source (right) — vanilla green/red + neutral chip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <button
          className="header-icon-btn"
          onClick={onOpenWall}
          title={gt('wall_view', 'Wall display view')}
          aria-label={gt('wall_view', 'Wall display view')}
          style={iconBtnStyle}>
          <MonitorIcon size={18}/>
        </button>
        {pagingRoomCount > 0 && (
          <button
            className="header-icon-btn"
            onClick={onTogglePaging}
            title={gt('paging.title', 'Paging')}
            aria-label={gt('paging.title', 'Paging')}
            style={{ ...iconBtnStyle, position: 'relative' }}>
            <BroadcastIcon size={18}/>
            {pagingMessageCount > 0 && (
              <span style={{
                position: 'absolute', top: 4, right: 4, width: 9, height: 9, borderRadius: '50%',
                background: 'var(--red, #ff4d5e)', border: '2px solid var(--sidebar, #12151d)',
              }}/>
            )}
          </button>
        )}
        <button
          className="header-icon-btn"
          onClick={onLock}
          title={gt('lock', 'Lock dashboard')}
          aria-label={gt('lock', 'Lock dashboard')}
          style={iconBtnStyle}>
          <LockIcon size={18}/>
        </button>
        <button
          className="header-icon-btn"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
          aria-label={theme === 'dark' ? 'Light theme' : 'Dark theme'}
          style={iconBtnStyle}>
          {theme === 'dark' ? <SunIcon size={18}/> : <MoonIcon size={18}/>}
        </button>
        <select
          value={getLang()}
          onChange={e => setLang(e.target.value)}
          title="Language"
          aria-label="Language"
          style={{
            background: 'var(--white-06)', color: 'var(--text2)',
            border: '1px solid var(--border)', borderRadius: 8,
            padding: '4px 6px', fontSize: 12, fontWeight: 600, cursor: 'pointer', outline: 'none',
          }}>
          {LANGUAGES.map(([code, label]) => (
            <option key={code} value={code} style={{ background: 'var(--card)' }}>{label}</option>
          ))}
        </select>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6,
          background: live ? 'rgba(63,185,80,0.15)' : 'rgba(248,81,73,0.15)',
          border: `1px solid ${live ? 'rgba(63,185,80,0.3)' : 'rgba(248,81,73,0.3)'}`,
          borderRadius: 20, padding: '3px 10px',
        }}>
          <span className={live ? 'status-dot-live' : undefined} style={{ width: 6, height: 6, borderRadius: '50%',
            background: live ? 'var(--green)' : '#f85149',
            display: 'inline-block',
            boxShadow: live ? '0 0 6px var(--green)' : 'none',
            animation: live ? 'none' : 'pulse 2s infinite',
          }}/>
          <span style={{ fontSize: 11, fontWeight: 600, color: live ? 'var(--green)' : '#f85149' }}>
            {live ? gt('connected', 'Connected') : gt('offline', 'Offline')}
          </span>
        </div>
        <span className="header-source" style={{ fontSize: 11, color: 'var(--text2)',
          background: 'var(--white-04)', padding: '3px 8px', borderRadius: 8, border: '1px solid var(--border)' }}>
          {source}
        </span>
      </div>
    </header>
    {version && (
      <div style={{
        position: 'fixed', left: 'calc(env(safe-area-inset-left, 0px) + 10px)',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)', zIndex: 90,
        fontSize: 10.5, fontWeight: 600, letterSpacing: '0.02em', color: 'var(--text3)',
        pointerEvents: 'none', userSelect: 'none',
      }}>
        v{version}
      </div>
    )}
    </>
  )
}
