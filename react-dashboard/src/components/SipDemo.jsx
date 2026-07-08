import { useState } from 'react'
import '../styles/global.css'
import { CallOverlay } from './IncomingCall'
import SimulatedCamera from './SimulatedCamera'
import { useMockSipCall } from '../hooks/useMockSipCall'

// SIP intercom demo page (reachable at /react/?demo=sip). Drives the real
// CallOverlay with a local mock call and a simulated camera — no SIP hardware,
// no /api/sip/* traffic. Chosen at the app root in main.jsx.
const DEMO_CAMERAS = ['Front Door', 'Front Gate', 'Garden']

export default function SipDemo() {
  const sip = useMockSipCall()
  const s = sip.call.state

  // Camera chooser (mock list)
  const [cam, setCam] = useState(DEMO_CAMERAS[0])

  // Relay / connected-device controls (mock). In production these map to
  // /api/relay/:i/state and /api/device/<key>/set (Loxone, Fibaro, …).
  const [devices, setDevices] = useState([
    { id: 'gate',   label: 'Gate',        icon: '🚪', active: false, via: 'Loxone' },
    { id: 'garage', label: 'Garage',      icon: '🅿️', active: false, via: 'relay 0' },
    { id: 'porch',  label: 'Porch light', icon: '💡', active: false, via: 'Loxone' },
  ])
  const actions = devices.map(d => ({
    id: d.id, label: d.label, icon: d.icon, active: d.active,
    run: async () => setDevices(xs => xs.map(x => x.id === d.id ? { ...x, active: !x.active } : x)),
  }))

  const btn = (bg, color = '#0b0d13') => ({
    border: 'none', borderRadius: 11, padding: '11px 16px', fontSize: 14, fontWeight: 600,
    cursor: 'pointer', color, background: bg, display: 'inline-flex', alignItems: 'center', gap: 7,
  })
  const panel = {
    background: 'linear-gradient(180deg, var(--surface,#12151d), var(--surface2,#171b25))',
    border: '1px solid var(--border, rgba(255,255,255,0.09))', borderRadius: 16,
    padding: '18px', marginBottom: 18,
  }
  const h2 = { fontSize: 12, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text3)', margin: '0 0 12px' }

  return (
    <div style={{ minHeight: '100%', background: 'radial-gradient(1200px 700px at 70% -10%, #1a2438 0%, var(--bg,#0a0c12) 55%)', color: 'var(--text,#eef1f6)' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '28px 20px 60px', font: '15px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif' }}>
        <h1 style={{ fontSize: 22, margin: '0 0 2px', display: 'flex', alignItems: 'center', gap: 10 }}>
          🔔 LSH SIP Intercom
          <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 999, background: 'var(--surface2,#171b25)', color: 'var(--text2,#aeb6c4)', border: '1px solid var(--border,rgba(255,255,255,0.09))' }}>demo</span>
        </h1>
        <div style={{ color: 'var(--text3,#6d7788)', fontSize: 13, marginBottom: 22 }}>
          Drives the real call UI with a simulated doorbell — camera view, answer/decline, and door unlock. No SIP hardware required.
        </div>

        <div style={panel}>
          <h2 style={h2}>Demo controls</h2>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button style={{ ...btn('var(--accent,#5ea0ff)', '#04122b'), opacity: s === 'idle' ? 1 : 0.4, pointerEvents: s === 'idle' ? 'auto' : 'none' }} onClick={sip.ring}>
              📞 Simulate doorbell ring
            </button>
            <button style={{ ...btn('var(--surface2,#171b25)', 'var(--text2,#aeb6c4)'), border: '1px solid var(--border,rgba(255,255,255,0.09))', opacity: s === 'idle' ? 0.4 : 1, pointerEvents: s === 'idle' ? 'none' : 'auto' }} onClick={sip.reset}>
              Reset
            </button>
            <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 999, background: 'var(--surface2,#171b25)', color: 'var(--text2,#aeb6c4)', border: '1px solid var(--border,rgba(255,255,255,0.09))' }}>
              state: <b>{s}</b>
            </span>
          </div>
          <div style={{ color: 'var(--text3,#6d7788)', fontSize: 12, marginTop: 8 }}>
            Ring → the overlay appears with a live camera view (use the top-right <b>chooser</b> to switch cameras) → <b>Answer</b> → <b>Open door</b> pulses the door relay, and the <b>Controls</b> chips toggle a relay / Loxone device.
          </div>
        </div>

        <div style={panel}>
          <h2 style={h2}>How it maps to the real app</h2>
          <div style={{ fontSize: 13.5, color: 'var(--text2,#aeb6c4)', lineHeight: 1.7 }}>
            In production the backend emits <code>sip-call</code> over Socket.IO and the client seeds from
            <code> GET /api/sip/status</code>; the call buttons POST <code>/api/sip/answer</code>, <code>/reject</code>,
            <code> /hangup</code>, <code>/open-door</code> (which pulses <code>config.sip.doorRelay</code>). The camera
            chooser lists <code>/api/cameras</code> and shows the matching snapshot. The <b>Controls</b> chips toggle
            LSH relays via <code>/api/relay/:i/state</code> and any connected device (Loxone, Fibaro, …) via
            <code> /api/device/&lt;key&gt;/set</code>. Live component: <code>src/components/IncomingCall.jsx</code> —
            this demo renders the same <code>CallOverlay</code> with a mock driver.
          </div>
        </div>
      </div>

      <CallOverlay
        call={sip.call}
        answer={sip.answer}
        reject={sip.reject}
        hangup={sip.hangup}
        openDoor={sip.openDoor}
        camera={<SimulatedCamera state={sip.call.state} variant={cam} />}
        cameras={DEMO_CAMERAS}
        selectedCamera={cam}
        onSelectCamera={setCam}
        actions={actions}
      />
    </div>
  )
}
