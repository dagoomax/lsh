import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CameraIcon } from './Icons'
import { gt } from '../i18n'

/**
 * Yale Access doorbells as an ordinary dashboard section — same card shell,
 * collapse behaviour, tile grid and modal as Cameras/Weather, so it reads as
 * part of the same dashboard rather than its own product.
 *
 * Reads straight off the device store (yale-client.js registers `yale/<id>`
 * with status / online / battery / image sensors) and pulls the picture
 * through the server-side proxy at /api/yale-camera/<id>/snapshot, because
 * the real `secure_url` needs a content token that must never reach the
 * browser (see api-routes.js and the constructor note in yale-client.js).
 *
 * Nothing here polls Yale itself — the server already does, every
 * `yale.pollInterval` seconds. The client only re-fetches the proxied JPEG
 * when the store's image URL changes, or when someone asks for it.
 *
 * Note these doorbells ALSO appear in the Cameras section, which aggregates
 * /api/cameras (yale-client.js's getCameras() feeds it). This section exists
 * for what a generic camera tile can't show: online state, battery, and how
 * old the frame is.
 *
 * `?yale=demo` renders two fictional doorbells against a drawn placeholder
 * so the section can be reviewed without a paired account.
 */

// A drawn stand-in for a porch at night: warm lamp, a mat, and the single
// most characteristic thing a doorbell camera ever sees — a parcel.
const DEMO_FRAME = 'data:image/svg+xml;utf8,' + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400">
  <defs>
    <linearGradient id="n" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2a2118"/><stop offset="0.62" stop-color="#151110"/><stop offset="1" stop-color="#211812"/>
    </linearGradient>
    <radialGradient id="lamp" cx="0.18" cy="0.08" r="0.6">
      <stop offset="0" stop-color="#E8CE93" stop-opacity="0.5"/><stop offset="1" stop-color="#E8CE93" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="300" height="400" fill="url(#n)"/>
  <rect width="300" height="400" fill="url(#lamp)"/>
  <path d="M0 268 L300 236 L300 400 L0 400 Z" fill="#1b1611"/>
  <path d="M52 344 L248 322 L266 372 L38 400 Z" fill="#2b2318"/>
  <path d="M60 348 L240 328 L252 362 L52 384 Z" fill="#342a1c" opacity="0.8"/>
  <rect x="112" y="252" width="78" height="62" rx="2" fill="#6b5a44" transform="rotate(-3 151 283)"/>
  <rect x="112" y="252" width="78" height="10" rx="2" fill="#7d6a50" transform="rotate(-3 151 283)"/>
  <rect x="146" y="252" width="9" height="62" fill="#8a7a61" opacity="0.65" transform="rotate(-3 151 283)"/>
  <rect x="0" y="0" width="300" height="234" fill="#0a0807" opacity="0.35"/>
  <rect x="222" y="24" width="78" height="212" fill="#221a11"/>
  <circle cx="236" cy="150" r="5" fill="#B08D4F" opacity="0.7"/>
</svg>`)

const DEMO = [
  { id: 'demo-front', label: 'Front Door',  status: 'doorbell_call_status_online',  online: 1, battery: 84, image: DEMO_FRAME },
  { id: 'demo-gate',  label: 'Garden Gate', status: 'doorbell_call_status_offline', online: 0, battery: 12, image: DEMO_FRAME },
]

// Yale's own status strings are wire values, not something to put in front of
// a person standing in a hallway. Say what the doorbell is doing.
function readState(status, online) {
  if (online) return gt('yale.watching', 'Watching')
  if (status === 'doorbell_call_status_offline') return gt('yale.silent', 'Not answering')
  if (!status) return gt('yale.unknown', 'Unknown')
  const plain = String(status).replace(/^doorbell_call_status_/, '').replace(/_/g, ' ')
  return plain.charAt(0).toUpperCase() + plain.slice(1)
}

function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const read = (device, path) => device.readings?.[path]?.value

function snapshotUrl(bell, demo, nonce) {
  if (!bell?.image) return null
  if (demo) return bell.image
  return `/api/yale-camera/${encodeURIComponent(bell.id)}/snapshot?v=${encodeURIComponent(bell.image)}&n=${nonce}`
}

function Tile({ bell, src, age, onOpen, index }) {
  const [imgError, setImgError] = useState(false)
  useEffect(() => { setImgError(false) }, [src])

  return (
    <div className="device-tile" onClick={() => onOpen(bell)} data-cat="Media" style={{
      '--i': index, padding: 0, overflow: 'hidden', cursor: 'pointer',
      minHeight: 0, display: 'flex', flexDirection: 'column',
    }}>
      {/* Doorbell frames are portrait 3:4; the tile stays 16/9 like every other
          camera tile, so the image is absolutely positioned — left in flow it
          would push the box out to its own intrinsic height (min-height:auto). */}
      <div style={{ position: 'relative', aspectRatio: '16/9', minHeight: 0, flex: 'none', background: '#05060a', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {src && !imgError
          ? <img src={src} alt={bell.label} loading="lazy" onError={() => setImgError(true)}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: 'var(--text3)' }}>
              <CameraIcon size={26} color="var(--text3)" />
              <span style={{ fontSize: 10 }}>
                {gt(imgError ? 'cam_unreachable' : 'yale.no_frame_yet', imgError ? 'Unreachable' : 'No frame yet')}
              </span>
            </div>}
        {!bell.online && (
          <span style={{
            position: 'absolute', top: 6, left: 6, fontSize: 9, fontWeight: 800, letterSpacing: '0.04em',
            padding: '2px 6px', borderRadius: 5, color: '#fff',
            background: 'rgba(220,38,38,0.85)', boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
          }}>{gt('yale.offline_badge', 'OFFLINE')}</span>
        )}
      </div>
      <div style={{ padding: '7px 10px 8px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {bell.label}
        </div>
        <div style={{ marginTop: 2, fontSize: 10, color: 'var(--text3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {[readState(bell.status, bell.online),
            bell.battery != null ? `${Math.round(bell.battery)}%` : null,
            age].filter(Boolean).join(' · ')}
        </div>
      </div>
    </div>
  )
}

function DoorbellModal({ bell, src, age, busy, onRefresh, onClose }) {
  const [imgError, setImgError] = useState(false)
  useEffect(() => { setImgError(false) }, [src])

  const rows = bell ? [
    [gt('yale.state', 'State'), readState(bell.status, bell.online), bell.online ? 'var(--green)' : 'var(--red)'],
    [gt('yale.battery', 'Battery'), bell.battery == null ? '—' : `${Math.round(bell.battery)}%`,
      bell.battery != null && bell.battery <= 20 ? 'var(--red)' : 'var(--text)'],
    [gt('yale.frame', 'Frame'), age || '—', 'var(--text)'],
  ] : []

  return (
    <AnimatePresence>
      {bell && (
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
              position: 'relative', width: 'min(430px, 96vw)', maxHeight: '92vh',
              display: 'flex', flexDirection: 'column',
              background: 'var(--modal-grad)', borderRadius: 22, overflow: 'hidden',
            }}>
            <div style={{
              position: 'absolute', inset: 0, borderRadius: 22, padding: 1, pointerEvents: 'none',
              background: 'var(--aurora-gradient)', opacity: 0.8,
              WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
              WebkitMaskComposite: 'xor', maskComposite: 'exclude',
            }} />

            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px 10px' }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--modal-chip-bg)', border: '1px solid var(--modal-chip-border)',
              }}><CameraIcon size={20} color="var(--modal-chip-ink)" /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="modal-device-title" style={{ fontSize: 17, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {bell.label}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted, #8b949e)' }}>
                  {gt('yale.subtitle', 'Yale Access doorbell')}
                </div>
              </div>
              <button onClick={onClose} title={gt('close', 'Close')} style={{
                width: 32, height: 32, borderRadius: 10, cursor: 'pointer', fontSize: 14,
                border: '1px solid var(--white-10)', background: 'var(--white-05)', color: 'var(--muted,#8b949e)',
              }}>✕</button>
            </div>

            <div style={{ position: 'relative', margin: '0 18px', borderRadius: 14, overflow: 'hidden', background: '#000', aspectRatio: '3/4' }}>
              {src && !imgError
                ? <img src={src} alt={bell.label} onError={() => setImgError(true)}
                    style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                : <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text3)' }}>
                    <CameraIcon size={40} color="var(--text3)" />
                    <span style={{ fontSize: 12 }}>
                      {gt(imgError ? 'yale.no_frame' : 'yale.no_frame_yet', imgError ? 'Frame did not load' : 'No frame yet')}
                    </span>
                  </div>}
            </div>

            <div style={{ display: 'flex', gap: 8, padding: '12px 18px 0' }}>
              {rows.map(([label, value, color]) => (
                <div key={label} style={{
                  flex: 1, minWidth: 0, padding: '8px 9px', borderRadius: 12,
                  background: 'var(--white-04)', border: '1px solid var(--border)',
                }}>
                  <div style={{ fontSize: 10, color: 'var(--text3)' }}>{label}</div>
                  <div style={{ marginTop: 3, fontSize: 14, fontWeight: 700, color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {value}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px 16px' }}>
              <button className="mini-btn" disabled={busy || !bell.image} onClick={onRefresh}
                style={{ padding: '7px 12px', borderRadius: 10, fontSize: 12, fontWeight: 700, color: '#e9eef5', opacity: busy ? 0.6 : 1 }}>
                {busy ? gt('yale.refreshing', 'Refreshing…') : gt('yale.refresh', 'Refresh frame')}
              </button>
              {!bell.online && (
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                  {gt('yale.note_offline', 'Yale reports this doorbell offline. The picture is the last frame it sent.')}
                </span>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default function YaleDoorbells({ devices = [] }) {
  const demo = useMemo(() => new URLSearchParams(location.search).get('yale') === 'demo', [])

  const bells = useMemo(() => {
    if (demo) return DEMO
    return devices
      .filter(d => d.type === 'yale')
      .map(d => ({
        id:      d.instance || String(d.key || '').split('/')[1],
        label:   d.label || 'Yale Doorbell',
        status:  read(d, 'status'),
        online:  read(d, 'online') ? 1 : 0,
        battery: read(d, 'battery'),
        image:   read(d, 'image'),
      }))
  }, [devices, demo])

  const [hidden, setHidden] = useState(() => localStorage.getItem('lsh-yale-hidden') === '1')
  const [openId, setOpenId] = useState(null)
  const [busy, setBusy]     = useState(false)
  const [nonce, setNonce]   = useState(0)
  const [now, setNow]       = useState(() => Date.now())

  // When each frame's age counter starts from. `observed` stays false until
  // this client has actually watched the store's image URL change — before
  // that all we honestly know is "at least this old", hence the ≥.
  const ages = useRef(new Map())
  bells.forEach(b => {
    if (!b.image) return
    const prev = ages.current.get(b.id)
    if (!prev) ages.current.set(b.id, { at: Date.now(), url: b.image, observed: false })
    else if (prev.url !== b.image) ages.current.set(b.id, { at: Date.now(), url: b.image, observed: true })
  })

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [])
  useEffect(() => { setBusy(false) }, [nonce])

  if (!bells.length) return null

  const toggleHidden = () => {
    const next = !hidden
    setHidden(next)
    localStorage.setItem('lsh-yale-hidden', next ? '1' : '0')
  }

  const ageOf = (bell) => {
    const seen = ages.current.get(bell.id)
    if (!seen) return null
    return `${seen.observed ? '' : '≥ '}${clock(now - seen.at)}`
  }

  const open = bells.find(b => b.id === openId) || null

  return (
    <div className="card" style={{ margin: '0 0 12px', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
      <div onClick={toggleHidden} title={hidden ? gt('yale.show', 'Show doorbells') : gt('yale.hide', 'Hide doorbells')}
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none', padding: '12px 14px 8px' }}>
        <CameraIcon size={15} color="var(--violet)" />
        <span style={{ fontSize: 13, fontWeight: 700 }}>{gt('yale.section', 'Yale Doorbells')}</span>
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
        <div style={{ padding: '0 12px 12px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
          {bells.map((b, i) => (
            <Tile key={b.id} bell={b} index={i} age={ageOf(b)}
              src={snapshotUrl(b, demo, nonce)} onOpen={() => setOpenId(b.id)} />
          ))}
        </div>
      )}

      <DoorbellModal bell={open} src={open ? snapshotUrl(open, demo, nonce) : null}
        age={open ? ageOf(open) : null} busy={busy}
        onRefresh={() => { setBusy(true); setNonce(n => n + 1) }}
        onClose={() => setOpenId(null)} />
    </div>
  )
}
