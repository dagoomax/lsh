import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { gt } from '../i18n'
import { useSipCall } from '../hooks/useSipCall'

// ── Doorbell intercom call overlay ─────────────────────────────────────────
// Full-screen answer/decline UI driven by useSipCall(). Shows the door camera
// snapshot (matched by name from /api/cameras), a ring pulse while ringing, and
// an in-call timer with an Open Door control. Design language matches
// DeviceModal (blurred backdrop, gradient border, glow blobs).

function useDoorSnapshot(active, cameraName) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    if (!active || !cameraName) { setSrc(null); return }
    let stop = false, timer = null

    ;(async () => {
      let url = null
      try {
        const r = await fetch('/api/cameras', { credentials: 'same-origin' })
        const j = await r.json()
        url = (j?.data || []).find(c => c.name === cameraName)?.snapshotUrl || null
      } catch { url = null }
      if (stop) return
      if (!url) { setSrc(null); return }
      const tick = () => { if (!stop) setSrc(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`) }
      tick()
      timer = setInterval(tick, 2000)
    })()

    return () => { stop = true; if (timer) clearInterval(timer) }
  }, [active, cameraName])
  return src
}

function useCallTimer(state, since) {
  const [elapsed, setElapsed] = useState('0:00')
  useEffect(() => {
    if (state !== 'in-call') { setElapsed('0:00'); return }
    const start = since || Date.now()
    const fmt = () => {
      const s = Math.max(0, Math.floor((Date.now() - start) / 1000))
      setElapsed(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`)
    }
    fmt()
    const iv = setInterval(fmt, 1000)
    return () => clearInterval(iv)
  }, [state, since])
  return elapsed
}

// Best-effort ring tone via WebAudio (browsers may block it until the user has
// interacted with the page — purely additive, never throws).
function useRingtone(ringing) {
  const ctxRef = useRef(null)
  useEffect(() => {
    if (!ringing) return
    let stopped = false, loop = null
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext
      if (!Ctx) return
      const ctx = ctxRef.current || (ctxRef.current = new Ctx())
      const beep = () => {
        if (stopped || ctx.state === 'suspended') return
        const osc = ctx.createOscillator(), gain = ctx.createGain()
        osc.type = 'sine'; osc.frequency.value = 620
        gain.gain.setValueAtTime(0.0001, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.14, ctx.currentTime + 0.05)
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4)
        osc.connect(gain).connect(ctx.destination)
        osc.start(); osc.stop(ctx.currentTime + 0.42)
      }
      beep()
      loop = setInterval(beep, 1600)
    } catch { /* audio unavailable — silent ring */ }
    return () => { stopped = true; if (loop) clearInterval(loop) }
  }, [ringing])
}

const REJECT = '#ff5a6a'

function CallButton({ color, onClick, glow, children }) {
  return (
    <motion.button
      whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
      onClick={onClick}
      style={{
        flex: 1, minWidth: 120, padding: '14px 18px', borderRadius: 14, border: 'none',
        cursor: 'pointer', fontSize: 15, fontWeight: 600, color: '#0b0d13', background: color,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        boxShadow: glow ? `0 8px 26px ${glow}` : '0 6px 18px rgba(0,0,0,0.35)',
      }}
    >
      {children}
    </motion.button>
  )
}

export default function IncomingCall() {
  const { call, answer, reject, hangup, openDoor } = useSipCall()
  const ringing = call.state === 'ringing'
  const inCall  = call.state === 'in-call'
  const visible = ringing || inCall

  const snapshot = useDoorSnapshot(visible, call.cameraName)
  const timer    = useCallTimer(call.state, call.since)
  useRingtone(ringing)

  const [doorPulsed, setDoorPulsed] = useState(false)
  const onOpenDoor = () => {
    setDoorPulsed(true)
    openDoor()
    setTimeout(() => setDoorPulsed(false), 2500)
  }

  const stateLabel = ringing
    ? gt('sip.incoming_call', 'Incoming call')
    : gt('sip.in_call', 'In call')

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="sip-backdrop"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{
            position: 'fixed', inset: 0, zIndex: 400,
            background: 'rgba(5,7,15,0.78)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <motion.div
            key="sip-card"
            initial={{ scale: 0.9, y: 24, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.92, y: 12, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            style={{
              position: 'relative', width: 'min(420px, 94vw)', borderRadius: 24,
              background: 'var(--surface, #12151d)', overflow: 'hidden',
              boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
            }}
          >
            {/* gradient border */}
            <div style={{
              position: 'absolute', inset: 0, borderRadius: 24, padding: 1, pointerEvents: 'none',
              background: 'linear-gradient(160deg, rgba(255,255,255,0.22), rgba(255,255,255,0.02) 40%)',
              WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
              WebkitMaskComposite: 'xor', maskComposite: 'exclude',
            }} />

            {/* Camera view */}
            <div style={{
              position: 'relative', height: 240, background: '#05070d',
              display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
            }}>
              {snapshot
                ? <img src={snapshot} alt={call.cameraName || 'Door camera'}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <div style={{ color: 'var(--text3)', fontSize: 13, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 40, opacity: 0.5 }}>📷</span>
                    {gt('sip.no_camera', 'No camera')}
                  </div>}

              {/* ring pulse badge */}
              <div style={{ position: 'absolute', top: 14, left: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                <motion.span
                  animate={ringing ? { scale: [1, 1.35, 1], opacity: [1, 0.6, 1] } : { scale: 1, opacity: 1 }}
                  transition={{ repeat: ringing ? Infinity : 0, duration: 1.2 }}
                  style={{ width: 10, height: 10, borderRadius: '50%', background: ringing ? REJECT : 'var(--green)' }}
                />
                <span style={{ fontSize: 12, fontWeight: 600, color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
                  {stateLabel}{inCall ? ` · ${timer}` : ''}
                </span>
              </div>
            </div>

            {/* Caller + actions */}
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)' }}>
                  {call.cameraName || gt('sip.door_station', 'Door station')}
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', marginTop: 4, wordBreak: 'break-all' }}>
                  {call.caller || gt('sip.unknown_caller', 'Unknown caller')}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                {ringing && <>
                  <CallButton color={REJECT} onClick={reject} glow="rgba(255,90,106,0.35)">
                    ✕ {gt('sip.decline', 'Decline')}
                  </CallButton>
                  <CallButton color="var(--green)" onClick={answer} glow="rgba(60,200,120,0.35)">
                    📞 {gt('sip.answer', 'Answer')}
                  </CallButton>
                </>}

                {inCall && <>
                  {call.canOpenDoor && (
                    <CallButton color="var(--gold, #d9b45b)" onClick={onOpenDoor} glow="rgba(217,180,91,0.4)">
                      {doorPulsed ? '✓ ' : '🔓 '}{doorPulsed ? gt('sip.opened', 'Opened') : gt('sip.open_door', 'Open door')}
                    </CallButton>
                  )}
                  <CallButton color={REJECT} onClick={hangup} glow="rgba(255,90,106,0.35)">
                    ✕ {gt('sip.hang_up', 'Hang up')}
                  </CallButton>
                </>}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
