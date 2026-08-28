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
  const [messages, setMessages] = useState([]) // voice messages waiting for myRoom
  const [recordingTo, setRecordingTo] = useState('') // roomId being recorded for, '' if idle
  const [airplaySpeakers, setAirplaySpeakers] = useState([]) // configured AirPlay speakers (src/airplay-client.js)
  const [castingId, setCastingId] = useState('') // message id currently being played out to a speaker, '' if idle

  const socketRef   = useRef(null)
  const recorderRef = useRef(null)
  const streamRef    = useRef(null)
  const audioElRef   = useRef(null)
  const sourceRef     = useRef(null) // MediaSource
  const sourceBufRef  = useRef(null) // SourceBuffer
  const queueRef       = useRef([])
  const activeRef       = useRef(null) // mirrors `active` for use inside socket callbacks
  const msgChunksRef    = useRef([]) // MediaRecorder blobs while recording a voice message
  const msgRecorderRef  = useRef(null)
  const msgStreamRef    = useRef(null)

  const refreshMessages = useCallback(() => {
    const room = localStorage.getItem(MY_ROOM_KEY)
    if (!room) { setMessages([]); return }
    fetch(`/api/paging/messages?room=${encodeURIComponent(room)}`, { credentials: 'same-origin' })
      .then(r => r.json()).then(j => setMessages(j?.data || [])).catch(() => {})
  }, [])

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

    const refreshRooms = () => fetch('/api/paging/rooms', { credentials: 'same-origin' })
      .then(r => r.json()).then(j => setRooms(j?.data || [])).catch(() => {})
    refreshRooms()

    // Static list (config-driven, not auto-discovered — see src/airplay-client.js), fine to fetch once.
    fetch('/api/airplay/speakers', { credentials: 'same-origin' })
      .then(r => r.json()).then(j => setAirplaySpeakers(j?.data || [])).catch(() => {})

    // Re-register (and re-fetch, as a defensive resync in case the register
    // ack never lands) on every reconnect, not just the first connect — a
    // dropped socket.io connection otherwise leaves this device showing as
    // permanently offline to everyone else until the tab is reloaded, even
    // though socket.io's own reconnection succeeded and rejoined the server.
    socket.on('connect', () => {
      const saved = localStorage.getItem(MY_ROOM_KEY)
      if (saved) {
        socket.emit('paging:register', saved, (res) => {
          if (!res?.success) console.warn('[Paging] Re-register on connect failed:', res?.error)
          refreshMessages()
        })
      }
      refreshRooms()
    })
    socket.io.on('reconnect_attempt', (n) => console.log(`[Paging] Socket reconnect attempt ${n}…`))
    socket.io.on('reconnect_failed', () => console.warn('[Paging] Socket gave up reconnecting'))
    socket.on('connect_error', (err) => console.warn('[Paging] Socket connect error:', err.message))

    socket.on('paging-rooms', (status) => setRooms(status || []))

    socket.on('paging:message', () => refreshMessages())

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
  }, [startPlayback, startMic, stopAudio, refreshMessages])

  const setMyRoom = useCallback((roomId) => {
    if (roomId) localStorage.setItem(MY_ROOM_KEY, roomId)
    else localStorage.removeItem(MY_ROOM_KEY)
    setMyRoomState(roomId || '')
    setMessages([])
    if (roomId && socketRef.current) {
      socketRef.current.emit('paging:register', roomId, (res) => {
        if (!res?.success) setError(res?.error || 'Could not register room')
        else refreshMessages()
      })
    }
  }, [refreshMessages])

  const startPage = useCallback((from, to) => {
    setError('')
    if (!socketRef.current) return
    socketRef.current.emit('paging:start', { from, to }, (res) => {
      if (!res?.success) setError(res?.error || 'Could not start page')
    })
  }, [])

  // ── Voice messages ──────────────────────────────────────────────────────
  // Same MediaRecorder approach as the live channel, but chunks accumulate
  // locally and go out as one upload on stop instead of streaming per-chunk
  // over the socket — there's no live listener on the other end to stream to.
  const startRecordingMessage = useCallback(async (toRoomId) => {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      msgStreamRef.current = stream
      msgChunksRef.current = []
      const rec = new MediaRecorder(stream, { mimeType: AUDIO_MIME })
      rec.ondataavailable = (e) => { if (e.data?.size) msgChunksRef.current.push(e.data) }
      rec.start()
      msgRecorderRef.current = rec
      setRecordingTo(toRoomId)
    } catch (err) {
      console.warn('[Paging] Mic access failed:', err.message)
      setError('Microphone access denied')
    }
  }, [])

  const _stopRecordingStream = () => {
    if (msgRecorderRef.current) { try { msgRecorderRef.current.stop() } catch { /* already stopped */ } msgRecorderRef.current = null }
    if (msgStreamRef.current) { msgStreamRef.current.getTracks().forEach(t => t.stop()); msgStreamRef.current = null }
  }

  const cancelRecordingMessage = useCallback(() => {
    _stopRecordingStream()
    msgChunksRef.current = []
    setRecordingTo('')
  }, [])

  const sendRecordedMessage = useCallback(() => {
    const to = recordingTo
    const rec = msgRecorderRef.current
    if (!to || !rec) return
    rec.onstop = async () => {
      const blob = new Blob(msgChunksRef.current, { type: AUDIO_MIME })
      msgChunksRef.current = []
      if (msgStreamRef.current) { msgStreamRef.current.getTracks().forEach(t => t.stop()); msgStreamRef.current = null }
      setRecordingTo('')
      if (!blob.size) return
      try {
        const res = await fetch(`/api/paging/message?from=${encodeURIComponent(myRoom)}&to=${encodeURIComponent(to)}`, {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': AUDIO_MIME },
          body: blob,
        })
        const json = await res.json()
        if (!json?.success) setError(json?.error || 'Could not send voice message')
      } catch {
        setError('Could not send voice message')
      }
    }
    try { rec.stop() } catch { /* already stopped */ }
    msgRecorderRef.current = null
  }, [recordingTo, myRoom])

  const deleteMessage = useCallback((id) => {
    setMessages(prev => prev.filter(m => m.id !== id))
    fetch(`/api/paging/message/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => {})
  }, [])

  // Messages disappear 24h after being left unless kept — this exempts (or
  // re-exposes) one to that expiry. Optimistic update, same pattern as delete.
  const keepMessage = useCallback((id, keep = true) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, kept: keep } : m))
    fetch(`/api/paging/message/${encodeURIComponent(id)}/keep`, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keep }),
    }).catch(() => {})
  }, [])

  // Play a voice message out loud on a configured AirPlay speaker (src/
  // airplay-client.js) — "posting" it, as opposed to playMessage() in
  // PagingWidget.jsx which just plays it locally in this browser tab.
  const castMessage = useCallback(async (messageId, speakerId) => {
    setError('')
    setCastingId(messageId)
    try {
      const res = await fetch(`/api/airplay/${encodeURIComponent(speakerId)}/play-message`, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId }),
      })
      const json = await res.json()
      if (!json?.success) setError(json?.error || 'Could not play on speaker')
    } catch {
      setError('Could not play on speaker')
    } finally {
      setCastingId('')
    }
  }, [])

  return {
    rooms, myRoom, setMyRoom, active, error, startPage, endPage,
    messages, recordingTo, startRecordingMessage, cancelRecordingMessage, sendRecordedMessage, deleteMessage, keepMessage,
    airplaySpeakers, castingId, castMessage,
  }
}
