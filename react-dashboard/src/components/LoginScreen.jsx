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

  useEffect(() => { userRef.current?.focus() }, [])

  const submit = async (e) => {
    e?.preventDefault()
    if (!username || !password || busy) return
    setBusy(true)
    setErr('')
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
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
        <img src="/logo.svg" alt="LSH" width={44} height={44}
          style={{ borderRadius: 11, boxShadow: '0 2px 16px rgba(88,166,255,0.35)' }}/>
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
          type="password"
          name="password"
          autoComplete="current-password"
          placeholder={gt('password', 'Password')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="lock-input"
          style={{ letterSpacing: 'normal', fontSize: 15 }}
        />
        <button type="submit" className="lock-btn" disabled={busy || !username || !password}>
          {busy ? gt('signing_in', 'Signing in…') : gt('sign_in_btn', 'Sign In')}
        </button>
        {err && <div className="lock-err">{err}</div>}
      </form>
    </div>
  )
}
