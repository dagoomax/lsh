import { useEffect, useState, useCallback } from 'react'
import { io } from 'socket.io-client'

// Server-side SIP doorbell intercom (src/sip-server.js). A VoIP doorbell calls
// into LSH; the backend emits `sip-call` state and exposes /api/sip/* controls.
// State shape: { active, state, caller, callId, since, cameraName, canOpenDoor }
const IDLE = { active: false, state: 'idle' }

export function useSipCall() {
  const [call, setCall] = useState(IDLE)

  useEffect(() => {
    let mounted = true

    // Initial state (covers a page load mid-call)
    fetch('/api/sip/status', { credentials: 'same-origin' })
      .then(r => r.json())
      .then(j => { if (mounted && j?.data) setCall(j.data) })
      .catch(() => {})

    const socket = io('/', { transports: ['websocket', 'polling'] })
    socket.on('sip-call', state => setCall(state || IDLE))

    return () => { mounted = false; socket.disconnect() }
  }, [])

  const action = useCallback(async path => {
    try {
      await fetch(`/api/sip/${path}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
      })
    } catch { /* transient — backend/socket will re-sync state */ }
  }, [])

  return {
    call,
    answer:   useCallback(() => action('answer'),    [action]),
    reject:   useCallback(() => action('reject'),    [action]),
    hangup:   useCallback(() => action('hangup'),    [action]),
    openDoor: useCallback(() => action('open-door'), [action]),
  }
}
