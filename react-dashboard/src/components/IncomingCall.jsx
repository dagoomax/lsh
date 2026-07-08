import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { gt } from '../i18n'
import { useSipCall } from '../hooks/useSipCall'

// ── Doorbell intercom call overlay ─────────────────────────────────────────
// CallOverlay is the presentational call UI (blurred backdrop, gradient border,
// camera slot + camera chooser, ring pulse, answer/decline/open-door, and a row
// of relay/device control chips). It is driven by a call state + action set and
// takes the camera view as a node, so it is reused by both the live intercom
// (default export below, real snapshot + real relays) and the demo (SipDemo,
// simulated camera + mock devices). Design language matches DeviceModal.

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

// Camera names available on the server (for the chooser).
function useCameraList(active) {
  const [names, setNames] = useState([])
  useEffect(() => {
    if (!active) return
    let stop = false
    fetch('/api/cameras', { credentials: 'same-origin' })
      .then(r => r.json())
      .then(j => { if (!stop) setNames((j?.data || []).map(c => c.name).filter(Boolean)) })
      .catch(() => {})
    return () => { stop = true }
  }, [active])
  return names
}

// Relays exposed as in-call control chips (toggle any relay — gate, garage…).
// Uses the same REST endpoints Loxone/other clients use, so it also covers
// connected devices: relays via /api/relay/:i/state, and any device via
// /api/device/:key/set (extend `actions` in the caller for those).
function useRelayActions(active) {
  const [relays, setRelays] = useState([])
  const load = useCallback(() => {
    fetch('/api/relays', { credentials: 'same-origin' })
      .then(r => r.json()).then(j => setRelays(j?.data || [])).catch(() => {})
  }, [])
  useEffect(() => { if (active) load() }, [active, load])
  const toggle = useCallback(async (index, next) => {
    await fetch(`/api/relay/${index}/state`, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: next }),
    }).catch(() => {})
    load()
  }, [load])
  return { relays, toggle }
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

// A relay/device control chip. `action` = { label, icon?, active?, run() }.
function ActionChip({ action }) {
  const [busy, setBusy] = useState(false)
  const click = async () => {
    setBusy(true)
    try { await action.run() } finally { setTimeout(() => setBusy(false), 600) }
  }
  return (
    <motion.button
      whileTap={{ scale: 0.95 }} onClick={click}
      style={{
        border: '1px solid var(--border, rgba(255,255,255,0.14))', borderRadius: 999,
        padding: '7px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: action.active ? 'var(--gold, #d9b45b)' : 'var(--surface2, #171b25)',
        color: action.active ? '#0b0d13' : 'var(--text2, #aeb6c4)',
      }}
    >
      <span>{action.icon || '⚙️'}</span>{action.label}{busy ? ' …' : ''}
    </motion.button>
  )
}

// Default "no camera" fill used by the live intercom when no snapshot is available.
export function NoCameraFill() {
  return (
    <div style={{ color: 'var(--text3)', fontSize: 13, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 40, opacity: 0.5 }}>📷</span>
      {gt('sip.no_camera', 'No camera')}
    </div>
  )
}

// Presentational overlay. `camera` is a node rendered as the camera view fill;
// `cameras`/`selectedCamera`/`onSelectCamera` drive the chooser; `actions` is an
// optional array of control chips shown while in a call.
export function CallOverlay({ call, answer, reject, hangup, openDoor, camera,
  cameras = [], selectedCamera, onSelectCamera, actions = [] }) {
  const ringing = call.state === 'ringing'
  const inCall  = call.state === 'in-call'
  const visible = ringing || inCall

  const timer = useCallTimer(call.state, call.since)
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
  const camLabel = selectedCamera || call.cameraName || gt('sip.door_station', 'Door station')

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
              {camera}

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

              {/* camera chooser */}
              {cameras.length > 1 && (
                <select
                  value={selectedCamera || ''}
                  onChange={e => onSelectCamera && onSelectCamera(e.target.value)}
                  title={gt('sip.choose_camera', 'Choose camera')}
                  style={{
                    position: 'absolute', top: 12, right: 12, maxWidth: '55%',
                    background: 'rgba(5,7,15,0.72)', color: '#fff', border: '1px solid rgba(255,255,255,0.18)',
                    borderRadius: 8, fontSize: 12, padding: '5px 8px', cursor: 'pointer',
                    backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
                  }}
                >
                  {cameras.map(name => <option key={name} value={name} style={{ color: '#000' }}>{name}</option>)}
                </select>
              )}
            </div>

            {/* Caller + actions */}
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)' }}>
                  {camLabel}
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', marginTop: 4, wordBreak: 'break-all' }}>
                  {call.caller || gt('sip.unknown_caller', 'Unknown caller')}
                </div>
              </div>

              {/* relay / connected-device controls (in-call) */}
              {inCall && actions.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)' }}>
                    {gt('sip.controls', 'Controls')}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                    {actions.map(a => <ActionChip key={a.id} action={a} />)}
                  </div>
                </div>
              )}

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

// Live intercom: real SIP state, real door-camera snapshot, real relays.
export default function IncomingCall() {
  const { call, answer, reject, hangup, openDoor } = useSipCall()
  const visible  = call.state === 'ringing' || call.state === 'in-call'

  const cameras  = useCameraList(visible)
  const [selected, setSelected] = useState(null)
  useEffect(() => {
    if (!visible) { setSelected(null); return }
    if (!selected) setSelected(call.cameraName || cameras[0] || null)
  }, [visible, call.cameraName, cameras, selected])
  const activeCam = selected || call.cameraName
  const snapshot  = useDoorSnapshot(visible, activeCam)

  const { relays, toggle } = useRelayActions(visible)
  const actions = relays.map(r => ({
    id: `relay-${r.index}`, label: r.name || `Relay ${r.index + 1}`, icon: '⚡',
    active: !!r.on, run: () => toggle(r.index, !r.on),
  }))

  const camera = snapshot
    ? <img src={snapshot} alt={activeCam || 'Door camera'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    : <NoCameraFill />

  return (
    <CallOverlay
      call={call} answer={answer} reject={reject} hangup={hangup} openDoor={openDoor}
      camera={camera} cameras={cameras} selectedCamera={activeCam} onSelectCamera={setSelected}
      actions={actions}
    />
  )
}
