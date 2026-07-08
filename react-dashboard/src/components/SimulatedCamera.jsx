import { useEffect, useMemo, useState } from 'react'

// Simulated "door camera" feed for the SIP demo — a stylised night porch with
// a door, a visitor, scan line + grain, and a live timestamp. Fills the camera
// slot of CallOverlay (which draws the INCOMING/LIVE badge + chooser on top). No
// hardware or /api/cameras request. `state` is 'ringing' | 'in-call'; `variant`
// (the chosen camera name) shifts the scene hue so switching cameras looks live.
export default function SimulatedCamera({ state, variant }) {
  const [ts, setTs] = useState('')
  useEffect(() => {
    const f = () => setTs(new Date().toLocaleTimeString('en-GB', { hour12: false }))
    f(); const i = setInterval(f, 1000); return () => clearInterval(i)
  }, [])

  const hue = useMemo(() => {
    let h = 0
    for (const c of String(variant || '')) h = (h * 31 + c.charCodeAt(0)) % 360
    return h
  }, [variant])

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {/* scene (hue shifts per chosen camera) */}
      <div style={{ position: 'absolute', inset: 0, filter: `hue-rotate(${hue}deg)` }}>
        <div style={{ position: 'absolute', inset: 0,
          background: 'radial-gradient(120px 80px at 50% 120%, rgba(255,214,140,.28), transparent 70%), linear-gradient(180deg,#0c1220 0%, #0a1a24 60%, #07131a 100%)' }} />
        {/* porch */}
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '46%',
          background: 'linear-gradient(180deg,#10202b,#0a151c)' }} />
        {/* door */}
        <div style={{ position: 'absolute', left: '50%', bottom: '14%', transform: 'translateX(-50%)',
          width: 96, height: 150, borderRadius: '6px 6px 2px 2px',
          background: 'linear-gradient(180deg,#3a2b1e,#25190f)', boxShadow: '0 0 0 3px #1a120b, inset 0 0 24px rgba(0,0,0,.5)' }}>
          <div style={{ position: 'absolute', right: 12, top: '50%', width: 7, height: 7, borderRadius: '50%',
            background: 'var(--gold, #d9b45b)', boxShadow: '0 0 8px var(--gold, #d9b45b)' }} />
        </div>
        {/* visitor */}
        <div style={{ position: 'absolute', left: '50%', bottom: '26%', transform: 'translateX(-50%)',
          width: 48, height: 70, borderRadius: '24px 24px 10px 10px',
          background: 'radial-gradient(circle at 50% 26%, #4a5568 0 34%, #2b3442 36%)', opacity: .92,
          filter: 'drop-shadow(0 6px 10px rgba(0,0,0,.5))' }}>
          <div style={{ position: 'absolute', left: '50%', top: -14, transform: 'translateX(-50%)',
            width: 26, height: 26, borderRadius: '50%', background: '#586274' }} />
        </div>
      </div>
      {/* scan line */}
      <div style={{ position: 'absolute', left: 0, right: 0, height: '38%', top: '-38%',
        background: 'linear-gradient(180deg,transparent, rgba(120,180,255,.06), transparent)',
        animation: 'camScan 4.5s linear infinite' }} />
      {/* grain */}
      <div style={{ position: 'absolute', inset: 0, opacity: .06, pointerEvents: 'none',
        backgroundImage: 'radial-gradient(rgba(255,255,255,.8) 1px, transparent 1px)', backgroundSize: '3px 3px',
        animation: 'camGrain .5s steps(2) infinite' }} />
      {/* timestamp */}
      <div style={{ position: 'absolute', right: 12, bottom: 10, fontSize: 11, fontFamily: 'ui-monospace, Menlo, monospace',
        color: '#dfe6f0', textShadow: '0 1px 3px #000', opacity: .85 }}>{ts}</div>
    </div>
  )
}
