import { useEffect, useRef, useState } from 'react'
import { gt } from '../i18n'

// Fullscreen dashboard lock. Unlock PIN is verified server-side
// (config.dashboardPin, default 0000 — Settings → Security).
export default function LockScreen({ onUnlock }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const submit = async (e) => {
    e?.preventDefault()
    if (!pin || busy) return
    setBusy(true)
    try {
      const r = await fetch('/api/dashboard-pin/verify', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      })
      const d = await r.json()
      if (d.ok) { onUnlock(); return }
      setErr(true)
      setPin('')
      setTimeout(() => setErr(false), 900)
    } catch { setErr(true) }
    finally { setBusy(false) }
  }

  return (
    <div className="lock-screen">
      <form className={`lock-card${err ? ' lock-shake' : ''}`} onSubmit={submit}>
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--accent)"
          strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="11" width="16" height="10" rx="2"/>
          <path d="M8 11V7a4 4 0 0 1 8 0v4"/>
          <circle cx="12" cy="16" r="1.4" fill="var(--accent)" stroke="none"/>
        </svg>
        <div className="lock-title">{gt('locked', 'Dashboard locked')}</div>
        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={8}
          placeholder={gt('enter_pin', 'Enter PIN')}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          className="lock-input"
        />
        <button type="submit" className="lock-btn" disabled={busy || !pin}>
          {gt('unlock', 'Unlock')}
        </button>
        {err && <div className="lock-err">{gt('wrong_pin', 'Wrong PIN')}</div>}
      </form>
    </div>
  )
}
