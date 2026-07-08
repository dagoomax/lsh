import { useState, useCallback } from 'react'

// Local mock driver for the SIP intercom demo. Same return shape as
// useSipCall ({ call, answer, reject, hangup, openDoor }) plus demo controls
// (ring, reset), but fully local — no Socket.IO, no /api/sip/* requests. Lets
// SipDemo drive the real CallOverlay through the full call lifecycle.
const CALLERS = ['sip:doorbell@lsh.local', 'Front Gate', 'sip:101@192.168.1.1', 'Garden Intercom']

const IDLE = { active: false, state: 'idle', caller: null, since: null, cameraName: 'Front Door', canOpenDoor: true }

export function useMockSipCall() {
  const [call, setCall] = useState(IDLE)

  const ring = useCallback(() => setCall(c => ({
    ...c, active: true, state: 'ringing',
    caller: CALLERS[Math.floor(Math.random() * CALLERS.length)], since: null,
  })), [])

  const answer = useCallback(() => setCall(c => ({ ...c, active: true, state: 'in-call', since: Date.now() })), [])
  const reset  = useCallback(() => setCall(IDLE), [])

  return {
    call,
    ring,
    reset,
    answer,
    reject:   reset,
    hangup:   reset,
    // Real app POSTs /api/sip/open-door (pulses config.sip.doorRelay); here it
    // resolves locally so the CallOverlay shows its "Opened ✓" feedback.
    openDoor: useCallback(() => Promise.resolve(), []),
  }
}
