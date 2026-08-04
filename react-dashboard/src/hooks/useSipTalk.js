import { useRef, useCallback } from 'react'

// Push-to-talk mic capture for the live SIP intercom call — captures short
// live chunks and POSTs each to /api/sip/talk as it's produced, which feeds
// straight into the backend's ffmpeg audio bridge (see sip-audio-bridge.js).
// Deliberately simple (MediaRecorder + fetch, no WebSocket/streaming API) to
// match the backend's own tradeoff: not phone-call latency, but real audio.
export function useSipTalk() {
  const recorderRef = useRef(null)
  const streamRef    = useRef(null)

  const start = useCallback(async () => {
    if (recorderRef.current) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          fetch('/api/sip/talk', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'audio/webm' },
            body: e.data,
          }).catch(() => {}) // transient network hiccup — just drop this chunk
        }
      }
      rec.start(250) // fire ondataavailable every 250ms
      recorderRef.current = rec
    } catch (err) {
      console.warn('[SIP Talk] Mic access failed:', err.message)
    }
  }, [])

  const stop = useCallback(() => {
    if (recorderRef.current) {
      try { recorderRef.current.stop(); } catch { /* already stopped */ }
      recorderRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }, [])

  return { start, stop }
}
