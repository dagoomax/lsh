import { useEffect, useRef, useState, useCallback } from 'react'
import { io } from 'socket.io-client'

// Room-to-room paging (intercom) — src/paging.js on the backend. Every
// endpoint is a browser (a Wall Dashboard tablet or the regular dashboard),
// so unlike the SIP doorbell (useSipCall/useSipTalk, which bridges to real
// SIP hardware via ffmpeg) this needs no server-side media pipeline: audio
// is plain MediaRecorder chunks relayed browser-to-browser over Socket.IO
// and played back by appending them straight into a MediaSource buffer.
//
// "myRoom" is this device's identity — which configured room it physically
// sits in — persisted in localStorage so a Wall Dashboard tablet only has to
// be told once. A device with no myRoom set can still see room status and
// bridge two OTHER rooms together (e.g. an admin dashboard), it just isn't a
// live participant itself.

const MY_ROOM_KEY = 'lsh-paging-room'
const AUDIO_MIME = 'audio/webm;codecs=opus'
const IDLE = null

export function usePaging() {
  const [rooms, setRooms]   = useState([])
  const [myRoom, setMyRoomState] = useState(() => localStorage.getItem(MY_ROOM_KEY) || '')
  const [active, setActive] = useState(IDLE) // { pageId, from, to, fromLabel, toLabel } | null
  const [error, setError]   = useState('')

  const socketRef   = useRef(null)
  const recorderRef = useRef(null)
  const streamRef    = useRef(null)
  const audioElRef   = useRef(null)
  const sourceRef     = useRef(null) // MediaSource
  const sourceBufRef  = useRef(null) // SourceBuffer
  const queueRef       = useRef([])
  const activeRef       = useRef(null) // mirrors `active` for use inside socket callbacks

  const stopAudio = useCallback(() => {
    if (recorderRef.current) { try { recorderRef.current.stop() } catch { /* already stopped */ } recorderRef.current = null }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
    if (audioElRef.current) { try { audioElRef.current.pause() } catch { /* ignore */ } audioElRef.current = null }
    sourceRef.current = null
    sourceBufRef.current = null
    queueRef.current = []
  }, [])

  const startPlayback = useCallback(() => {
    try {
      const ms = new MediaSource()
      const el = new Audio()
      el.autoplay = true
      el.src = URL.createObjectURL(ms)
      audioElRef.current = el
      sourceRef.current = ms
      ms.addEventListener('sourceopen', () => {
        try {
          const sb = ms.addSourceBuffer(AUDIO_MIME)
          sb.addEventListener('updateend', () => {
            if (queueRef.current.length && !sb.updating) sb.appendBuffer(queueRef.current.shift())
          })
          sourceBufRef.current = sb
        } catch (err) { console.warn('[Paging] Playback unsupported:', err.message) }
      })
      el.play().catch(() => {}) // may need a user gesture on some browsers
    } catch (err) { console.warn('[Paging] Playback setup failed:', err.message) }
  }, [])

  const startMic = useCallback(async (pageId) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const rec = new MediaRecorder(stream, { mimeType: AUDIO_MIME })
      rec.ondataavailable = async (e) => {
        if (!e.data || !e.data.size || !socketRef.current) return
        const buf = await e.data.arrayBuffer()
        socketRef.current.emit('paging:audio', { pageId, chunk: buf })
      }
      rec.start(250)
      recorderRef.current = rec
    } catch (err) {
      console.warn('[Paging] Mic access failed:', err.message)
      setError('Microphone access denied')
    }
  }, [])

  const endPage = useCallback(() => {
    const current = activeRef.current
    if (current && socketRef.current) socketRef.current.emit('paging:end', { pageId: current.pageId })
    stopAudio()
    setActive(IDLE)
  }, [stopAudio])

  useEffect(() => {
    const socket = io('/', { transports: ['websocket', 'polling'] })
    socketRef.current = socket

    fetch('/api/paging/rooms', { credentials: 'same-origin' })
      .then(r => r.json()).then(j => setRooms(j?.data || [])).catch(() => {})

    socket.on('connect', () => {
      const saved = localStorage.getItem(MY_ROOM_KEY)
      if (saved) socket.emit('paging:register', saved, () => {})
    })

    socket.on('paging-rooms', (status) => setRooms(status || []))

    socket.on('paging:incoming', (session) => {
      setError('')
      setActive(session)
      activeRef.current = session
      const mine = session.from === localStorage.getItem(MY_ROOM_KEY) || session.to === localStorage.getItem(MY_ROOM_KEY)
      if (mine) { startPlayback(); startMic(session.pageId) }
    })

    socket.on('paging:audio', ({ pageId, chunk }) => {
      if (!activeRef.current || pageId !== activeRef.current.pageId) return
      const sb = sourceBufRef.current
      const data = chunk instanceof ArrayBuffer ? chunk : chunk?.buffer
      if (!data) return
      if (sb && !sb.updating && !queueRef.current.length) sb.appendBuffer(data)
      else queueRef.current.push(data)
    })

    socket.on('paging:ended', () => {
      stopAudio()
      setActive(IDLE)
      activeRef.current = null
    })

    return () => { stopAudio(); socket.disconnect() }
  }, [startPlayback, startMic, stopAudio])

  const setMyRoom = useCallback((roomId) => {
    if (roomId) localStorage.setItem(MY_ROOM_KEY, roomId)
    else localStorage.removeItem(MY_ROOM_KEY)
    setMyRoomState(roomId || '')
    if (roomId && socketRef.current) {
      socketRef.current.emit('paging:register', roomId, (res) => {
        if (!res?.success) setError(res?.error || 'Could not register room')
      })
    }
  }, [])

  const startPage = useCallback((from, to) => {
    setError('')
    if (!socketRef.current) return
    socketRef.current.emit('paging:start', { from, to }, (res) => {
      if (!res?.success) setError(res?.error || 'Could not start page')
    })
  }, [])

  return { rooms, myRoom, setMyRoom, active, error, startPage, endPage }
}
