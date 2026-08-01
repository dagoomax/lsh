import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { io } from 'socket.io-client'
import { CameraIcon } from './Icons'
import { gt } from '../i18n'

// Full-parity port of the classic dashboard's camera grid + modal
// (public/app.js) into the React/Aurora dashboard: MJPEG/snapshot/WebRTC
// preview, PTZ pad, two-way audio (WHEP), and the live motion/sound event
// log. Self-contained — only touches DeviceList.jsx via a single <Cameras/>
// insertion in the "All" category view, matching where the classic
// dashboard's cameras-section sits (after Energy, before the device grid).

const LOG_LABELS = {
  motion:              '🟡 Motion detected',
  sound:               '🔊 Sound detected',
  snapshot:            '📸 Snapshot updated',
  'capture-triggered': '▶ Capture triggered',
  recording:           '🔴 HKSV recording',
}
// object-detection.js pushes 'object' events for every COCO-SSD class it
// sees (detail: "<class> (<score>%)") — cats/dogs get their own paw icon
// here rather than the generic target one everything else falls back to.
const PET_CLASSES = new Set(['cat', 'dog', 'bird', 'horse'])
function logLabel(entry) {
  if (entry.type === 'object') {
    const cls = (entry.detail || '').split(' ')[0]
    return PET_CLASSES.has(cls) ? '🐾 Pet detected' : '🎯 Object detected'
  }
  return LOG_LABELS[entry.type] || entry.type
}

function fmtLogTime(ts) {
  const d = new Date(ts)
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// The video/img element renders at object-fit:contain inside its container,
// so it's letterboxed whenever its aspect ratio doesn't match the
// container's — bounding boxes (in source-frame pixel coords) need mapping
// through that same letterbox rect, not just naively scaled to the full
// container, or they'd drift off the actual picture.
function computeContainRect(containerW, containerH, mediaW, mediaH) {
  if (!mediaW || !mediaH || !containerW || !containerH) return null
  const containerRatio = containerW / containerH
  const mediaRatio = mediaW / mediaH
  let width, height
  if (mediaRatio > containerRatio) {
    width = containerW
    height = containerW / mediaRatio
  } else {
    height = containerH
    width = containerH * mediaRatio
  }
  return { left: (containerW - width) / 2, top: (containerH - height) / 2, width, height }
}

// Object-detection boxes overlaid on the live view — position:absolute
// layer scaled through computeContainRect. Purely presentational; boxes
// come from object-detection.js's periodic poll (see detection-boxes.js),
// so they update roughly every pollInterval seconds, not frame-by-frame.
function DetectionBoxesOverlay({ containerRef, boxes }) {
  const [mediaRect, setMediaRect] = useState(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const recompute = () => {
      setMediaRect(computeContainRect(el.clientWidth, el.clientHeight, boxes?.imgWidth, boxes?.imgHeight))
    }
    recompute()
    const ro = new ResizeObserver(recompute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [containerRef, boxes?.imgWidth, boxes?.imgHeight])

  if (!mediaRect || !boxes?.items?.length) return null
  const scaleX = mediaRect.width / boxes.imgWidth
  const scaleY = mediaRect.height / boxes.imgHeight

  return (
    <>
      {boxes.items.map((b, i) => {
        const [bx, by, bw, bh] = b.bbox
        const isPet = PET_CLASSES.has(b.class)
        const color = isPet ? '#ffb020' : '#ff3b3b'
        return (
          <div key={i} style={{
            position: 'absolute', pointerEvents: 'none',
            left: mediaRect.left + bx * scaleX, top: mediaRect.top + by * scaleY,
            width: bw * scaleX, height: bh * scaleY,
            border: `2px solid ${color}`, borderRadius: 4,
            boxShadow: '0 0 0 1px rgba(0,0,0,0.45)',
          }}>
            <span style={{
              position: 'absolute', left: -2, top: -18, whiteSpace: 'nowrap',
              fontSize: 10, fontWeight: 800, padding: '1px 6px', borderRadius: 4,
              background: color, color: '#14161c',
            }}>
              {isPet ? '🐾 ' : ''}{b.class} {Math.round(b.score * 100)}%
            </span>
          </div>
        )
      })}
    </>
  )
}

// ── WebRTC (WHEP via server proxy) — identical contract to the classic
// dashboard's _startWebRTC: offer/answer through POST /api/webrtc/offer,
// optional sendrecv mic transceiver for two-way audio (muted by default,
// the Talk button just flips track.enabled — no renegotiation needed). ──
async function startWebRTC(videoEl, whepUrl, twoWay) {
  const pc = new RTCPeerConnection({
    iceServers:   [{ urls: 'stun:stun.l.google.com:19302' }],
    bundlePolicy: 'max-bundle',
  })

  pc.ontrack = e => {
    if (e.streams && e.streams[0]) videoEl.srcObject = e.streams[0]
  }

  pc.addTransceiver('video', { direction: 'recvonly' })

  let micTrack = null
  if (twoWay) {
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      micTrack = micStream.getAudioTracks()[0]
      micTrack.enabled = false
      pc.addTransceiver(micTrack, { direction: 'sendrecv' })
    } catch (err) {
      console.warn('[WebRTC] Mic access failed, falling back to receive-only audio:', err.message)
    }
  }
  if (!micTrack) {
    pc.addTransceiver('audio', { direction: 'recvonly' })
  }

  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)

  await new Promise(resolve => {
    if (pc.iceGatheringState === 'complete') { resolve(); return }
    const done = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', done)
        resolve()
      }
    }
    pc.addEventListener('icegatheringstatechange', done)
    setTimeout(resolve, 3000)
  })

  const resp = await fetch('/api/webrtc/offer', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ url: whepUrl, sdp: pc.localDescription.sdp }),
  })

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}))
    throw new Error(body.error || `HTTP ${resp.status}`)
  }

  const { sdp, error } = await resp.json()
  if (error) throw new Error(error)

  await pc.setRemoteDescription({ type: 'answer', sdp })
  return { pc, micTrack }
}

// ── Grid card ────────────────────────────────────────────────────────────
function CameraCard({ cam, onOpen }) {
  const hasMjpeg    = !!(cam.mjpegUrl    && cam.mjpegUrl.trim())
  const hasSnapshot = !!(cam.snapshotUrl && cam.snapshotUrl.trim())
  const hasWebrtc   = !!(cam.webrtcUrl   && cam.webrtcUrl.trim())
  const [src, setSrc] = useState(() => hasMjpeg ? cam.mjpegUrl : (hasSnapshot ? cam.snapshotUrl : ''))

  useEffect(() => {
    if (hasMjpeg || !hasSnapshot) return
    const iv = setInterval(() => setSrc(`${cam.snapshotUrl}?_=${Date.now()}`), 10000)
    return () => clearInterval(iv)
  }, [cam.snapshotUrl, hasMjpeg, hasSnapshot])

  const badge = hasMjpeg ? 'LIVE' : (hasWebrtc ? 'WebRTC' : null)

  return (
    <div className="device-tile" onClick={() => onOpen(cam)} data-cat="Media"
      style={{ padding:0, overflow:'hidden', cursor:'pointer', minHeight:0, display:'flex', flexDirection:'column' }}>
      <div style={{ position:'relative', aspectRatio:'16/9', background:'#05060a', display:'flex', alignItems:'center', justifyContent:'center' }}>
        {src ? (
          <img src={src} alt={cam.name} loading="lazy" style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />
        ) : (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6, color:'var(--text3)' }}>
            <CameraIcon size={26} color="var(--text3)" />
            <span style={{ fontSize:10 }}>{gt('cam_no_snapshot', 'No snapshot')}</span>
          </div>
        )}
        {badge && (
          <span style={{
            position:'absolute', top:6, left:6, fontSize:9, fontWeight:800, letterSpacing:'0.04em',
            padding:'2px 6px', borderRadius:5, color:'#fff',
            background: badge === 'LIVE' ? 'rgba(220,38,38,0.85)' : 'color-mix(in srgb, var(--accent) 80%, transparent)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
          }}>{badge}</span>
        )}
      </div>
      <div style={{ padding:'7px 10px', fontSize:12, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
        {cam.name}
      </div>
    </div>
  )
}

// ── PTZ pad — continuous move: op fires on press, 'stop' fires on release ──
const PTZ_GRID = {
  display: 'grid',
  gridTemplateAreas: '".  up   zin" "left . right" ". down zout"',
  gridTemplateColumns: '36px 36px 36px',
  gridTemplateRows:    '36px 36px 36px',
  gap: 4,
  position: 'absolute', right: 10, bottom: 10,
}
const PTZ_BTNS = [
  { op: 'up',      area: 'up',   label: '▲' },
  { op: 'left',    area: 'left', label: '◀' },
  { op: 'right',   area: 'right',label: '▶' },
  { op: 'down',    area: 'down', label: '▼' },
  { op: 'zoomin',  area: 'zin',  label: '＋' },
  { op: 'zoomout', area: 'zout', label: '−' },
]

function PtzPad({ ptzUrl }) {
  const activeRef = useRef(false)
  const send = useCallback(async (op) => {
    if (!ptzUrl) return
    try {
      await fetch(ptzUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op }),
      })
    } catch { /* transient — a stop is always sent on release */ }
  }, [ptzUrl])

  if (!ptzUrl) return null

  return (
    <div style={PTZ_GRID}>
      {PTZ_BTNS.map(({ op, area, label }) => (
        <button key={op} className="mini-btn"
          onPointerDown={e => { e.preventDefault(); activeRef.current = true; send(op) }}
          onPointerUp={() => { if (activeRef.current) { activeRef.current = false; send('stop') } }}
          onPointerLeave={() => { if (activeRef.current) { activeRef.current = false; send('stop') } }}
          onPointerCancel={() => { if (activeRef.current) { activeRef.current = false; send('stop') } }}
          style={{
            gridArea: area, borderRadius: 9, color: '#e9eef5', fontSize: 14,
            background: 'rgba(10,14,20,0.65)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
            touchAction: 'none', WebkitUserSelect: 'none', userSelect: 'none',
          }}>
          {label}
        </button>
      ))}
    </div>
  )
}

// ── Modal ────────────────────────────────────────────────────────────────
function CameraModal({ cam, onClose }) {
  const videoRef      = useRef(null)
  const imgRef        = useRef(null)
  const pcRef         = useRef(null)
  const micTrackRef   = useRef(null)
  const snapTimerRef  = useRef(null)
  const [status, setStatus]   = useState('')
  const [imgSrc, setImgSrc]   = useState('')
  const [showVideo, setShowVideo] = useState(false)
  const [showNoSnap, setShowNoSnap] = useState(false)
  const [talking, setTalking] = useState(false)
  const [canTalk, setCanTalk] = useState(false)
  const [log, setLog]         = useState([])
  const [boxes, setBoxes]     = useState(null)
  const [stats, setStats]     = useState(null)
  const previewRef            = useRef(null)

  const refreshSnap = useCallback((url) => {
    const next = new Image()
    next.onload = () => setImgSrc(next.src)
    next.src = `${url}?_=${Date.now()}`
  }, [])

  const closeStreams = useCallback(() => {
    if (snapTimerRef.current) { clearInterval(snapTimerRef.current); snapTimerRef.current = null }
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null }
    if (micTrackRef.current) { micTrackRef.current.stop(); micTrackRef.current = null }
    setImgSrc('')
    if (videoRef.current) { videoRef.current.srcObject = null; videoRef.current.muted = true }
    setTalking(false)
    setCanTalk(false)
  }, [])

  useEffect(() => {
    if (!cam) return
    setShowVideo(false)
    setShowNoSnap(false)
    setStatus('')
    setImgSrc('')

    const hasWebrtc   = !!(cam.webrtcUrl   && cam.webrtcUrl.trim())
    const hasMjpeg    = !!(cam.mjpegUrl    && cam.mjpegUrl.trim())
    const hasSnapshot = !!(cam.snapshotUrl && cam.snapshotUrl.trim())

    if (hasWebrtc) {
      setShowVideo(true)
      setStatus('WebRTC connecting…')
      startWebRTC(videoRef.current, cam.webrtcUrl.trim(), !!cam.twoWayAudio)
        .then(({ pc, micTrack }) => {
          pcRef.current = pc
          micTrackRef.current = micTrack
          setStatus('WebRTC live')
          // Unmute regardless of two-way audio — opening the modal is
          // itself a user gesture, so browsers allow audible autoplay here.
          // Only the Talk button (sending audio back) needs a mic track.
          if (videoRef.current) videoRef.current.muted = false
          if (micTrack) setCanTalk(true)
        })
        .catch(err => {
          console.error('[WebRTC]', err.message)
          setStatus(`WebRTC failed — ${err.message}`)
          setShowVideo(false)
          if (hasMjpeg) {
            setImgSrc(cam.mjpegUrl)
            setStatus('Fallback: MJPEG')
          } else if (hasSnapshot) {
            refreshSnap(cam.snapshotUrl)
            snapTimerRef.current = setInterval(() => refreshSnap(cam.snapshotUrl), 2000)
            setStatus('Fallback: snapshot (2 s)')
          } else {
            setShowNoSnap(true)
          }
        })
    } else if (hasMjpeg) {
      setImgSrc(cam.mjpegUrl)
      setStatus('MJPEG live stream')
    } else if (hasSnapshot) {
      refreshSnap(cam.snapshotUrl)
      snapTimerRef.current = setInterval(() => refreshSnap(cam.snapshotUrl), 2000)
      setStatus('Refreshing every 2 s')
    } else {
      setShowNoSnap(true)
    }

    return () => closeStreams()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cam])

  // Event log + detection boxes: seed from API, then listen live for this camera
  useEffect(() => {
    if (!cam) return
    let cancelled = false
    setBoxes(null)
    setStats(null)
    fetch(`/api/camera-log?camera=${encodeURIComponent(cam.name)}&limit=100`)
      .then(r => r.json())
      .then(({ data }) => { if (!cancelled && data) setLog(data) })
      .catch(() => {})
    fetch(`/api/detection-boxes?camera=${encodeURIComponent(cam.name)}`)
      .then(r => r.json())
      .then(({ data }) => { if (!cancelled && data?.items?.length) setBoxes(data) })
      .catch(() => {})
    fetch(`/api/objectdetect/stats?camera=${encodeURIComponent(cam.name)}`)
      .then(r => r.json())
      .then(({ success, data }) => { if (!cancelled && success) setStats(data) })
      .catch(() => {})

    const socket = io('/', { transports: ['websocket'] })
    socket.on('camera-event', entry => {
      if (entry.camera !== cam.name) return
      setLog(prev => [entry, ...prev].slice(0, 100))
    })
    socket.on('detection-boxes', entry => {
      if (entry.camera !== cam.name) return
      setBoxes(entry)
    })
    return () => { cancelled = true; socket.disconnect() }
  }, [cam])

  useEffect(() => {
    const esc = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const talkStart = e => {
    if (!micTrackRef.current) return
    e.preventDefault()
    micTrackRef.current.enabled = true
    setTalking(true)
  }
  const talkStop = () => {
    if (!micTrackRef.current) return
    micTrackRef.current.enabled = false
    setTalking(false)
  }

  return (
    <AnimatePresence>
      {cam && (
        <motion.div key="backdrop"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0, zIndex: 300,
            background: 'rgba(5,7,15,0.72)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
          }}>
          <motion.div key="card"
            initial={{ opacity: 0, scale: 0.88, y: 26 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 16 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            onClick={e => e.stopPropagation()}
            className="device-modal-glow"
            style={{
              position: 'relative', width: 'min(1520px, 96vw)', maxHeight: '90vh',
              display: 'flex', flexDirection: 'column',
              background: 'var(--modal-grad)',
              borderRadius: 22, overflow: 'hidden',
            }}>

            {/* gradient border via CSS mask */}
            <div style={{
              position: 'absolute', inset: 0, borderRadius: 22, padding: 1, pointerEvents: 'none',
              background: 'linear-gradient(140deg, color-mix(in srgb, var(--accent) 70%, transparent), color-mix(in srgb, var(--teal) 45%, transparent) 45%, color-mix(in srgb, var(--violet) 40%, transparent))',
              WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
              WebkitMaskComposite: 'xor', maskComposite: 'exclude',
            }} />

            {/* header */}
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px 10px' }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--modal-chip-bg)', border: '1px solid var(--modal-chip-border)',
              }}><CameraIcon size={20} color="var(--modal-chip-ink)" /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="modal-device-title" style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {cam?.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted, #8b949e)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {cam?.url || status}
                </div>
              </div>
              <button onClick={onClose} title={gt('close', 'Close')} style={{
                width: 32, height: 32, borderRadius: 10, cursor: 'pointer', fontSize: 14,
                border: '1px solid var(--white-10)', background: 'var(--white-05)', color: 'var(--muted,#8b949e)',
              }}>✕</button>
            </div>

            {/* video/preview area */}
            <div ref={previewRef} style={{ position: 'relative', margin: '0 18px', borderRadius: 14, overflow: 'hidden', background: '#000', aspectRatio: '16/9' }}>
              <video ref={videoRef} autoPlay playsInline muted
                style={{ width: '100%', height: '100%', objectFit: 'contain', display: showVideo ? 'block' : 'none' }} />
              {!showVideo && imgSrc && (
                <img ref={imgRef} src={imgSrc} alt={cam?.name} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
              )}
              {!showVideo && !imgSrc && showNoSnap && (
                <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:8, color:'var(--text3)' }}>
                  <CameraIcon size={40} color="var(--text3)" />
                  <span style={{ fontSize: 12 }}>{gt('cam_no_stream', 'No stream URL configured')}</span>
                </div>
              )}
              <DetectionBoxesOverlay containerRef={previewRef} boxes={boxes} />
              <PtzPad ptzUrl={cam?.ptzUrl} />
              {canTalk && (
                <button className="mini-btn"
                  onPointerDown={talkStart} onPointerUp={talkStop} onPointerLeave={talkStop} onPointerCancel={talkStop}
                  style={{
                    position: 'absolute', left: 12, bottom: 12, padding: '7px 12px', borderRadius: 10, fontSize: 12, fontWeight: 700,
                    color: talking ? '#fff' : '#e9eef5',
                    background: talking ? 'color-mix(in srgb, var(--accent) 75%, transparent)' : 'rgba(10,14,20,0.65)',
                    WebkitUserSelect: 'none', userSelect: 'none', touchAction: 'none',
                  }}>
                  🎤 {gt('cam_hold_to_talk', 'Hold to talk')}
                </button>
              )}
            </div>
            <div style={{ padding: '8px 18px 0', fontSize: 11, color: 'var(--text3)' }}>{status}</div>

            {/* detection stats — from Mongo history, see object-detection.js's
                _saveDetectionRecords; empty (not shown) if mongo isn't configured */}
            {stats && (stats.today.length > 0 || stats.week.length > 0) && (
              <div style={{ margin: '10px 18px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {stats.today.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{gt('cam_stats_today', 'Today')}</span>
                    {stats.today.map(s => (
                      <span key={s.class} style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: 'var(--white-05)', border: '1px solid var(--border)' }}>
                        {PET_CLASSES.has(s.class) ? '🐾' : '🎯'} {s.class} ×{s.count}
                      </span>
                    ))}
                  </div>
                )}
                {stats.week.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{gt('cam_stats_week', '7 days')}</span>
                    {stats.week.map(s => (
                      <span key={s.class} style={{ fontSize: 11, color: 'var(--text3)' }}>
                        {s.class} ×{s.count}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* event log */}
            <div style={{ margin: '12px 18px 18px', padding: '10px 12px', background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)' }}>{gt('cam_events', 'Events')}</span>
              </div>
              <div style={{ overflowY: 'auto', maxHeight: 160, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {log.length === 0 && (
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>{gt('cam_no_events', 'No events yet')}</span>
                )}
                {log.map((entry, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, fontSize: 11, alignItems: 'baseline' }}>
                    <span style={{ color: 'var(--text3)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{fmtLogTime(entry.ts)}</span>
                    <span style={{ color: 'var(--text)' }}>{logLabel(entry)}</span>
                    {entry.detail && <span style={{ color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.detail}</span>}
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ── Top-level section ────────────────────────────────────────────────────
export default function Cameras() {
  const [cameras, setCameras] = useState([])
  const [openCam, setOpenCam] = useState(null)
  const [hidden, setHidden]   = useState(() => localStorage.getItem('lsh-cameras-hidden') === '1')

  useEffect(() => {
    fetch('/api/cameras')
      .then(r => r.json())
      .then(({ data }) => setCameras(data || []))
      .catch(() => {})
  }, [])

  const toggleHidden = () => {
    const next = !hidden
    setHidden(next)
    localStorage.setItem('lsh-cameras-hidden', next ? '1' : '0')
  }

  if (!cameras.length) return null

  return (
    <div className="card" style={{ margin: '0 0 12px', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
      <div onClick={toggleHidden} title={hidden ? 'Show cameras' : 'Hide cameras'}
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none',
          padding: hidden ? '12px 14px' : '12px 14px 8px' }}>
        <CameraIcon size={15} color="var(--violet)" />
        <span style={{ fontSize: 13, fontWeight: 700 }}>{gt('cameras', 'Cameras')}</span>
        <span style={{ marginLeft: 'auto', color: 'var(--text3)', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {hidden && <span>{gt('hidden', 'hidden')}</span>}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: hidden ? 'rotate(-90deg)' : 'none', transition: 'transform 0.2s ease' }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </div>
      {!hidden && (
        <div style={{
          padding: '0 12px 12px', display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10,
        }}>
          {cameras.map(cam => <CameraCard key={cam.name} cam={cam} onOpen={setOpenCam} />)}
        </div>
      )}
      <CameraModal cam={openCam} onClose={() => setOpenCam(null)} />
    </div>
  )
}
