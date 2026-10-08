import { useEffect, useRef, useState } from 'react'
import { gt } from '../i18n'

// First run: no users exist yet, so every /api call answers 503
// { setupRequired: true } — create the admin account in place (same card as
// LoginScreen). POST /api/auth/setup also signs the new admin in.
export default function SetupScreen({ onDone }) {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const userRef = useRef(null)
  useEffect(() => { userRef.current?.select() }, [])

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    if (password.length < 8) return setErr(gt('setup_pw_short', 'Password must be at least 8 characters'))
    if (password !== password2) return setErr(gt('setup_pw_mismatch', 'Passwords do not match'))
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/auth/setup', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminUsername: username.trim(), adminPassword: password }),
      })
      const d = await r.json()
      if (d.success) { onDone(); return }
      setErr(d.error || 'Setup failed')
    } catch (e2) {
      setErr('Network error — ' + e2.message)
    } finally { setBusy(false) }
  }

  return (
    <div className="lock-screen">
      <form className={`lock-card${err ? ' lock-shake' : ''}`} onSubmit={submit}>
        <img src="/logo.svg" alt="LSH" style={{ width: 44, height: 44, display: 'block', borderRadius: 11 }}/>
        <div className="lock-title">{gt('setup_title', 'Welcome to LSH')}</div>
        <div style={{ fontSize: 13, color: 'var(--text2)', textAlign: 'center', marginTop: -6 }}>
          {gt('setup_sub', 'Create your admin account to secure the dashboard')}
        </div>
        <input ref={userRef} className="lock-input" style={{ letterSpacing: 'normal', fontSize: 15 }}
          name="username" autoComplete="username" autoCapitalize="none" autoCorrect="off"
          placeholder={gt('setup_username', 'Admin username')} value={username} onChange={(e) => setUsername(e.target.value)}/>
        <input type="password" className="lock-input" style={{ letterSpacing: 'normal', fontSize: 15 }}
          name="new-password" autoComplete="new-password"
          placeholder={gt('setup_password', 'Password (min. 8 characters)')} value={password} onChange={(e) => setPassword(e.target.value)}/>
        <input type="password" className="lock-input" style={{ letterSpacing: 'normal', fontSize: 15 }}
          name="new-password-2" autoComplete="new-password"
          placeholder={gt('setup_password2', 'Repeat password')} value={password2} onChange={(e) => setPassword2(e.target.value)}/>
        <button type="submit" className="lock-btn" disabled={busy || !username.trim() || !password}>
          {busy ? gt('setup_busy', 'Creating account…') : gt('setup_btn', 'Create Account & Sign In')}
        </button>
        {err && <div className="lock-err">{err}</div>}
      </form>
    </div>
  )
}
