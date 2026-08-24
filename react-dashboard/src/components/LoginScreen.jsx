import { useEffect, useRef, useState } from 'react'
import { gt } from '../i18n'

// In-app sign-in shown when the API answers 401. The iOS home-screen webapp
// (manifest scope /react/) must never navigate out to /login.html — Safari
// opens out-of-scope URLs in a separate browser context whose session cookie
// the webapp never sees. Logging in in place keeps the cookie in the app.
export default function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr]   = useState('')
  const [busy, setBusy] = useState(false)
  const userRef = useRef(null)
  const passRef = useRef(null)

  useEffect(() => { userRef.current?.focus() }, [])

  const submit = async (e) => {
    e?.preventDefault()
    // Browser autofill sets the DOM value directly and doesn't always fire
    // React's onChange, so `username`/`password` state can lag behind what's
    // actually in the fields (they'd look filled in but the button stayed
    // disabled and submit silently did nothing) — read the refs as the
    // source of truth instead of trusting state alone.
    const user = userRef.current?.value || username
    const pass = passRef.current?.value || password
    if (!user || !pass || busy) return
    setBusy(true)
    setErr('')
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass }),
      })
      const d = await r.json()
      if (d.success) { onLogin(); return }
      setErr(d.error || gt('login_failed', 'Login failed'))
      setPassword('')
    } catch (e2) {
      setErr('Network error — ' + e2.message)
    } finally { setBusy(false) }
  }

  return (
    <div className="lock-screen">
      <form className={`lock-card${err ? ' lock-shake' : ''}`} onSubmit={submit}>
        <img src="/logo.svg" alt="LSH"
          style={{ width: 44, height: 44, flexShrink: 0, display: 'block',
                   borderRadius: 11, boxShadow: '0 2px 16px color-mix(in srgb, var(--accent) 35%, transparent)' }}/>
        <div className="lock-title">{gt('sign_in', 'Sign in to LSH')}</div>
        <input
          ref={userRef}
          type="text"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          placeholder={gt('username', 'Username')}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="lock-input"
          style={{ letterSpacing: 'normal', fontSize: 15 }}
        />
        <input
          ref={passRef}
          type="password"
          name="password"
          autoComplete="current-password"
          placeholder={gt('password', 'Password')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="lock-input"
          style={{ letterSpacing: 'normal', fontSize: 15 }}
        />
        <button type="submit" className="lock-btn" disabled={busy}>
          {busy ? gt('signing_in', 'Signing in…') : gt('sign_in_btn', 'Sign In')}
        </button>
        {err && <div className="lock-err">{err}</div>}
      </form>
    </div>
  )
}
