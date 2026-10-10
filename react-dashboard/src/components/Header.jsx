import { useEffect, useState } from 'react'
import { LANGUAGES, getLang, setLang, gt } from '../i18n'
import { MonitorIcon, BroadcastIcon, LockIcon, SunIcon, MoonIcon } from './Icons'

// Every entry is an in-app view (App.jsx VIEWS); href is the view's own URL
// so ctrl/cmd/middle-click still opens it in a new tab.
const NAV = [
  { label: 'Dashboard', view: 'dashboard', href: '/react/' },
  { label: 'Settings',  view: 'settings',  href: '/react/settings' },
  { label: 'Logs',      view: 'logs',      href: '/react/logs' },
  { label: 'MQTT',      view: 'mqtt',      href: '/react/mqtt' },
  { label: 'Flows',     view: 'flows',     href: '/react/flows' },
  { label: 'Music',     view: 'music',     href: '/react/music', only: 'appleMusic' },
]

// 44×44 is the WCAG/mobile minimum comfortable touch target — these sit in a
// fixed 56px header, so there's headroom to hit it without the bar growing.
const iconBtnStyle = {
  width: 38, height: 38, flexShrink: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer',
}

export default function Header({ connection, connected, onLock, onOpenSettings, onOpenWall, onOpenCssEditor, onOpenClaudeCode, onOpenTerminal, onOpenView, pagingRoomCount, pagingMessageCount, onTogglePaging }) {
  // Optional nav entries (only: <feature>) show once the server says the feature is set up
  const [features, setFeatures] = useState({})
  useEffect(() => {
    fetch('/api/apple-music/status', { credentials: 'include' }).then((r) => r.json())
      .then((j) => setFeatures((f) => ({ ...f, appleMusic: !!j?.data?.configured }))).catch(() => {})
  }, [])
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('lsh-theme') || 'dark' } catch { return 'dark' }
  })
  // The CSS Editor page is admin-gated on its own (see CssEditorPage.jsx) —
  // this just decides whether the *link* shows up: never for viewers (no
  // point linking somewhere they'll immediately get "Admin access
  // required"), and not for admins either if they've hidden it in Settings
  // → Interface (same on/off pattern as hideMqtt/hideLogs there).
  const [showCssEditorLink, setShowCssEditorLink] = useState(false)
  // Claude Code chat is also gated server-side by source IP (localhost/LAN
  // only — see requireLocalAdmin in api-routes.js), which this client can't
  // replicate reliably (no equivalent of "am I on the LAN" in the browser).
  // Show the link to any admin; a denied admin on remote access just sees
  // the page's own "not available" state instead of a dead link.
  const [showClaudeCodeLink, setShowClaudeCodeLink] = useState(false)
  // Same reasoning as showClaudeCodeLink above, for the 'terminal' permission.
  const [showTerminalLink, setShowTerminalLink] = useState(false)
  const [version, setVersion] = useState(null)
  useEffect(() => {
    Promise.all([
      fetch('/api/auth/me', { credentials: 'include' }).then(r => r.json()).catch(() => null),
      fetch('/api/ui-prefs', { credentials: 'include' }).then(r => r.json()).catch(() => null),
    ]).then(([me, prefs]) => {
      const isAdmin = me?.success && me.data?.role === 'admin'
      const hidden = !!prefs?.data?.hideCssEditor
      setShowCssEditorLink(isAdmin && !hidden)
      // Admin role alone is no longer enough — Claude Code additionally
      // needs the 'claudeCode' permission flag, granted per-user in
      // Settings → Security (and only while installer mode is on there).
      setShowClaudeCodeLink(isAdmin && !!me.data?.permissions?.claudeCode)
      setShowTerminalLink(isAdmin && !!me.data?.permissions?.terminal)
      if (prefs?.data?.version) setVersion(prefs.data.version)
    })
  }, [])
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    try { localStorage.setItem('lsh-theme', next) } catch { /* ignore */ }
    setTheme(next)
  }
  const live = connected && (connection?.vrm?.connected || connection?.mqtt?.connected)

  return (
    <>
    <header style={{
      position: 'fixed', top: 'env(safe-area-inset-top, 0px)', left: 0, right: 0, zIndex: 100,
      height: 56,
      background: 'var(--sidebar)',
      backdropFilter: 'blur(20px) saturate(1.8)',
      WebkitBackdropFilter: 'blur(20px) saturate(1.8)',
      borderBottom: '0.5px solid var(--sep)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12,
      padding: '0 20px', flexShrink: 0,
    }}>
      {/* Logo + wordmark (left) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <img src="/logo.svg" alt="LSH" width={32} height={32} style={{
          borderRadius: 9, flexShrink: 0, display: 'block',
        }}/>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1, whiteSpace: 'nowrap' }}>
          <span style={{
            fontWeight: 700, fontSize: 20, letterSpacing: '-0.03em', color: 'var(--text)',
          }}>Aurora</span>
          <span style={{
            fontSize: 11, fontWeight: 500, color: 'var(--text2)', marginTop: 2,
          }}>Lightweight Smart Home</span>
        </div>
      </div>

      {/* Nav (center) — styled in global.css to match vanilla */}
      <nav className="header-nav-react">
        {NAV.filter((n) => !n.only || features[n.only]).map(({ label, view, href }) => (
          <a key={label} href={href} className={view === 'dashboard' ? 'active' : undefined}
            onClick={(e) => {
              // Plain left-click switches view in place; modified/middle
              // clicks open the view's URL in a new tab as normal.
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
              e.preventDefault()
              if (view === 'settings') onOpenSettings?.()
              else onOpenView?.(view)
            }}>
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
        {showClaudeCodeLink && (
          <a href="#" onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
            e.preventDefault(); onOpenClaudeCode?.()
          }}>
            {gt('nav_claude_code', 'Claude Code')}
          </a>
        )}
        {showTerminalLink && (
          <a href="#" onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
            e.preventDefault(); onOpenTerminal?.()
          }}>
            {gt('nav_terminal', 'Terminal')}
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
                background: 'var(--red)', border: '2px solid var(--bg)',
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
            background: 'var(--white-10)', color: 'var(--text)',
            border: 'none', borderRadius: 999,
            height: 38, flexShrink: 0,
            padding: '0 12px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', outline: 'none',
          }}>
          {LANGUAGES.map(([code, label]) => (
            <option key={code} value={code} style={{ background: 'var(--card)' }}>{label}</option>
          ))}
        </select>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6,
          background: live ? 'color-mix(in srgb, var(--green) 15%, transparent)' : 'color-mix(in srgb, var(--red) 15%, transparent)',
          borderRadius: 999, padding: '5px 11px',
        }}>
          <span className={live ? 'status-dot-live' : undefined} style={{ width: 7, height: 7, borderRadius: '50%',
            background: live ? 'var(--green)' : 'var(--red)',
            display: 'inline-block',
            animation: live ? 'none' : 'pulse 2s infinite',
          }}/>
          <span style={{ fontSize: 12, fontWeight: 600, color: live ? 'var(--green)' : 'var(--red)' }}>
            {live ? gt('connected', 'Connected') : gt('offline', 'Offline')}
          </span>
        </div>
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
