import { useState, useEffect } from 'react'

export default function Header({ connected, source }) {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <header style={{
      position: 'relative',
      height: 64,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 32px',
      background: 'rgba(7,7,15,0.9)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      borderBottom: '1px solid rgba(212,175,55,0.2)',
      zIndex: 100,
      flexShrink: 0,
    }}>
      {/* Animated gold top line */}
      <div style={{
        position: 'absolute',
        top: 0, left: 0, right: 0,
        height: 1,
        background: 'linear-gradient(90deg, transparent 0%, #D4AF37 30%, #F5E098 50%, #D4AF37 70%, transparent 100%)',
        backgroundSize: '200% 100%',
        animation: 'goldShift 4s ease infinite',
      }} />

      {/* Left — Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 10,
          background: 'linear-gradient(135deg, #D4AF37 0%, #9A7D1E 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20,
          boxShadow: '0 0 16px rgba(212,175,55,0.4)',
        }}>⚡</div>
        <div>
          <div className="gold-text" style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 800, lineHeight: 1 }}>LSH</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 2 }}>Local Smart Home</div>
        </div>
      </div>

      {/* Center — Clock */}
      <div style={{ textAlign: 'center' }}>
        <div style={{
          fontFamily: 'monospace',
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: '0.06em',
          color: 'var(--platinum)',
          lineHeight: 1,
        }}>{timeStr}</div>
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3, letterSpacing: '0.04em' }}>{dateStr}</div>
      </div>

      {/* Right — Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 14px',
          borderRadius: 20,
          background: connected ? 'rgba(61,186,110,0.12)' : 'rgba(232,69,69,0.12)',
          border: `1px solid ${connected ? 'rgba(61,186,110,0.35)' : 'rgba(232,69,69,0.35)'}`,
          fontSize: 12, fontWeight: 600,
          color: connected ? 'var(--green)' : 'var(--red)',
        }}>
          <span style={{ animation: connected ? 'pulse 2s ease infinite' : 'none' }}>●</span>
          {connected ? 'LIVE' : 'OFFLINE'}
        </div>
        {source && (
          <div style={{
            padding: '4px 10px', borderRadius: 6,
            background: 'rgba(212,175,55,0.08)',
            border: '1px solid rgba(212,175,55,0.2)',
            fontSize: 10, fontWeight: 600,
            color: 'var(--gold)', letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>{source}</div>
        )}
      </div>
    </header>
  )
}
