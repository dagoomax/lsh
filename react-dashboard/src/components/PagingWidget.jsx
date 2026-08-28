import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { gt } from '../i18n'
import { usePaging } from '../hooks/usePaging'
import { BroadcastIcon, MicIcon, StarIcon, SpeakerIcon } from './Icons'

const ACCENT = '#38bdf8'
const REJECT = '#ff5a6a'
const MESSAGE_TTL_MS = 24 * 60 * 60 * 1000 // mirrors EXPIRE_MS in src/paging-messages.js

// "3m ago" / "just now" — compact enough for the messages list, doesn't need
// the precision DeviceModal.jsx's timeAgo() has for sensor freshness.
function timeAgo(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// Un-kept messages disappear 24h after being left — surface that countdown
// so "why did my message vanish" never has to be asked.
function expiryText(m) {
  if (m.kept) return gt('paging.kept', 'Kept')
  const left = MESSAGE_TTL_MS - (Date.now() - m.at)
  if (left <= 0) return gt('paging.expiring', 'Expiring…')
  const h = Math.ceil(left / 3600000)
  return h <= 1 ? gt('paging.expires_soon', 'Expires within the hour') : gt('paging.expires_in', 'Expires in {h}h').replace('{h}', h)
}

function playMessage(id) {
  const el = new Audio(`/api/paging/message/${id}/audio`)
  el.play().catch(() => {})
}

// Room picker + incoming/active-call overlay for room-to-room paging
// (intercom). Presentational only — takes paging state and open/setOpen as
// props so callers decide where the trigger button lives and where the
// dropdown panel anchors. `anchorTop` positions the panel under a header
// trigger (e.g. App.jsx, next to the Wall Dashboard button) instead of the
// default bottom-right floating position (e.g. WallDashboard.jsx, which has
// no header to anchor to).
// Rooms are configured as { id: <name>, label: <extension> } — e.g.
// { id: "Gabinet", label: "001" } — so the useful display text combines
// both rather than showing just the bare extension number.
function roomText(r) {
  return r.label && r.label !== r.id ? `${r.id} (${r.label})` : r.id
}

export function PagingPanel({
  rooms, myRoom, setMyRoom, active, error, startPage, endPage, open, setOpen, anchorTop,
  messages = [], recordingTo = '', startRecordingMessage, cancelRecordingMessage, sendRecordedMessage, deleteMessage, keepMessage,
  airplaySpeakers = [], castingId = '', castMessage,
}) {
  const [bridgeFrom, setBridgeFrom] = useState('')
  const [bridgeTo, setBridgeTo] = useState('')

  if (!rooms.length) return null // paging disabled / no rooms configured
  const roomLabel = (id) => { const r = rooms.find(x => x.id === id); return r ? roomText(r) : id }

  const others = rooms.filter(r => r.id !== myRoom)
  const inSession = !!active
  const iAmParticipant = active && (active.from === myRoom || active.to === myRoom)

  const panelPosition = anchorTop
    ? { top: 64, right: 20, bottom: 'auto' }
    : { bottom: 74, right: 18, top: 'auto' }

  return (
    <>
      <AnimatePresence>
        {open && !inSession && (
          <motion.div
            initial={{ opacity: 0, y: anchorTop ? -12 : 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: anchorTop ? -12 : 12 }}
            style={{
              position: 'fixed', ...panelPosition, zIndex: 350, width: 340,
              background: 'var(--surface, #12151d)', border: `1px solid ${ACCENT}33`, borderRadius: 18,
              padding: 18, boxShadow: '0 16px 44px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)', marginBottom: 10 }}>
              {gt('paging.this_device', 'This device')}
            </div>
            <select
              value={myRoom} onChange={e => setMyRoom(e.target.value)}
              style={{ width: '100%', marginBottom: 16, padding: '10px 12px', borderRadius: 10, fontSize: 16, background: 'var(--surface2, #171b25)', color: 'var(--text)', border: '1px solid var(--border, rgba(255,255,255,0.14))' }}
            >
              <option value="">{gt('paging.not_a_room', 'Not a fixed room')}</option>
              {rooms.map(r => <option key={r.id} value={r.id}>{roomText(r)}</option>)}
            </select>

            {myRoom ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)' }}>
                  {gt('paging.page', 'Page')}
                </div>
                {others.map(r => (
                  <div key={r.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        disabled={!r.online}
                        onClick={() => { startPage(myRoom, r.id); setOpen(false) }}
                        style={{
                          flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12,
                          border: '1px solid var(--border, rgba(255,255,255,0.14))', background: 'var(--surface2, #171b25)',
                          color: r.online ? 'var(--text)' : 'var(--text3)', cursor: r.online ? 'pointer' : 'not-allowed', fontSize: 16, fontWeight: 600,
                        }}
                      >
                        <span style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: r.online ? 'var(--green)' : 'var(--text3)' }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {roomText(r)}{!r.online ? ` — ${gt('paging.offline', 'offline')}` : ''}
                        </span>
                      </button>
                      <button
                        onClick={() => (recordingTo === r.id ? cancelRecordingMessage() : startRecordingMessage(r.id))}
                        title={gt('paging.leave_message', 'Leave a voice message')}
                        aria-label={gt('paging.leave_message', 'Leave a voice message')}
                        style={{
                          width: 44, flexShrink: 0, borderRadius: 12, cursor: 'pointer',
                          border: `1px solid ${recordingTo === r.id ? REJECT : 'var(--border, rgba(255,255,255,0.14))'}`,
                          background: recordingTo === r.id ? `${REJECT}22` : 'var(--surface2, #171b25)',
                          color: recordingTo === r.id ? REJECT : 'var(--text2)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        <MicIcon size={19}/>
                      </button>
                    </div>
                    {recordingTo === r.id && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, color: REJECT, padding: '0 2px' }}>
                        <motion.span
                          animate={{ opacity: [1, 0.35, 1] }} transition={{ repeat: Infinity, duration: 1.2 }}
                          style={{ width: 8, height: 8, borderRadius: '50%', background: REJECT, flexShrink: 0 }}
                        />
                        {gt('paging.recording', 'Recording…')}
                        <button onClick={sendRecordedMessage} style={{
                          marginLeft: 'auto', padding: '6px 14px', borderRadius: 10, border: 'none', cursor: 'pointer',
                          background: ACCENT, color: '#0b0d13', fontWeight: 700, fontSize: 13,
                        }}>{gt('paging.send', 'Send')}</button>
                        <button onClick={cancelRecordingMessage} style={{
                          padding: '6px 14px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                          border: '1px solid var(--border, rgba(255,255,255,0.14))', background: 'transparent', color: 'var(--text3)',
                        }}>{gt('paging.cancel', 'Cancel')}</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)' }}>
                  {gt('paging.bridge', 'Connect two rooms')}
                </div>
                <select value={bridgeFrom} onChange={e => setBridgeFrom(e.target.value)}
                  style={{ padding: '10px 12px', borderRadius: 10, fontSize: 16, background: 'var(--surface2, #171b25)', color: 'var(--text)', border: '1px solid var(--border, rgba(255,255,255,0.14))' }}>
                  <option value="">{gt('paging.from', 'From…')}</option>
                  {rooms.map(r => <option key={r.id} value={r.id} disabled={!r.online}>{roomText(r)}{!r.online ? ` — ${gt('paging.offline', 'offline')}` : ''}</option>)}
                </select>
                <select value={bridgeTo} onChange={e => setBridgeTo(e.target.value)}
                  style={{ padding: '10px 12px', borderRadius: 10, fontSize: 16, background: 'var(--surface2, #171b25)', color: 'var(--text)', border: '1px solid var(--border, rgba(255,255,255,0.14))' }}>
                  <option value="">{gt('paging.to', 'To…')}</option>
                  {rooms.map(r => <option key={r.id} value={r.id} disabled={!r.online}>{roomText(r)}{!r.online ? ` — ${gt('paging.offline', 'offline')}` : ''}</option>)}
                </select>
                <button
                  disabled={!bridgeFrom || !bridgeTo || bridgeFrom === bridgeTo}
                  onClick={() => { startPage(bridgeFrom, bridgeTo); setOpen(false) }}
                  style={{
                    marginTop: 6, padding: '12px 14px', borderRadius: 12, border: 'none', cursor: 'pointer',
                    background: ACCENT, color: '#0b0d13', fontWeight: 700, fontSize: 16,
                  }}
                >
                  {gt('paging.start', 'Start')}
                </button>
              </div>
            )}
            {myRoom && messages.length > 0 && (
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border, rgba(255,255,255,0.14))', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)' }}>
                  {gt('paging.messages', 'Messages')}
                </div>
                {messages.map(m => (
                  <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderRadius: 12, background: 'var(--surface2, #171b25)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <button onClick={() => playMessage(m.id)} title={gt('paging.play', 'Play')} aria-label={gt('paging.play', 'Play')} style={{
                        width: 36, height: 36, borderRadius: '50%', flexShrink: 0, cursor: 'pointer', border: 'none',
                        background: ACCENT, color: '#0b0d13', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>▶</button>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{roomLabel(m.from)}</div>
                        <div style={{ fontSize: 12, color: m.kept ? 'var(--gold, #ffc44d)' : 'var(--text3)', lineHeight: 1.35 }}>
                          {timeAgo(m.at)} · {expiryText(m)}
                        </div>
                      </div>
                      <button onClick={() => keepMessage(m.id, !m.kept)}
                        title={m.kept ? gt('paging.unkeep', 'Stop keeping — let it expire normally') : gt('paging.keep', 'Keep — never auto-expire')}
                        aria-label={m.kept ? gt('paging.unkeep', 'Stop keeping — let it expire normally') : gt('paging.keep', 'Keep — never auto-expire')}
                        style={{
                          width: 30, height: 30, borderRadius: 9, flexShrink: 0, cursor: 'pointer',
                          border: `1px solid ${m.kept ? 'var(--gold, #ffc44d)' : 'var(--border, rgba(255,255,255,0.14))'}`,
                          background: m.kept ? 'color-mix(in srgb, var(--gold, #ffc44d) 16%, transparent)' : 'transparent',
                          color: m.kept ? 'var(--gold, #ffc44d)' : 'var(--text3)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                        <StarIcon size={14} filled={m.kept}/>
                      </button>
                      <button onClick={() => deleteMessage(m.id)} title={gt('paging.delete', 'Delete')} aria-label={gt('paging.delete', 'Delete')} style={{
                        width: 30, height: 30, borderRadius: 9, flexShrink: 0, cursor: 'pointer', fontSize: 14,
                        border: '1px solid var(--border, rgba(255,255,255,0.14))', background: 'transparent', color: 'var(--text3)',
                      }}>✕</button>
                    </div>
                    {airplaySpeakers.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 46 }}>
                        <SpeakerIcon size={14} color="var(--text3)"/>
                        <select
                          value=""
                          disabled={castingId === m.id}
                          onChange={e => { if (e.target.value) castMessage(m.id, e.target.value); e.target.value = '' }}
                          title={gt('paging.play_on_speaker', 'Play on speaker')}
                          style={{
                            flex: 1, minWidth: 0, padding: '5px 8px', borderRadius: 8, fontSize: 12,
                            background: 'var(--surface, #12151d)', color: 'var(--text2)',
                            border: '1px solid var(--border, rgba(255,255,255,0.14))', cursor: castingId === m.id ? 'wait' : 'pointer',
                          }}>
                          <option value="" disabled>
                            {castingId === m.id ? gt('paging.playing', 'Playing…') : gt('paging.play_on_speaker', 'Play on speaker…')}
                          </option>
                          {airplaySpeakers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {error && <div style={{ marginTop: 12, fontSize: 14, fontWeight: 600, color: REJECT }}>{error}</div>}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {inSession && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{
              position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(5,7,15,0.78)',
              backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
            }}
          >
            <motion.div
              initial={{ scale: 0.9, y: 24, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.92, y: 12, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 26 }}
              style={{
                width: 'min(400px, 92vw)', borderRadius: 24, padding: 34, textAlign: 'center',
                background: 'var(--surface, #12151d)', border: `1px solid ${ACCENT}44`, boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'center', color: ACCENT, marginBottom: 12 }}><BroadcastIcon size={40}/></div>
              <div style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)' }}>
                {iAmParticipant ? gt('paging.in_progress', 'Paging') : gt('paging.bridged', 'Bridged call')}
              </div>
              <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text)', marginTop: 6 }}>
                {active.fromLabel} ↔ {active.toLabel}
              </div>
              {!iAmParticipant && (
                <div style={{ fontSize: 14, color: 'var(--text3)', marginTop: 8 }}>
                  {gt('paging.bridged_hint', "You're not a participant — this device only started the connection.")}
                </div>
              )}
              <button
                onClick={endPage}
                style={{
                  marginTop: 24, padding: '14px 26px', borderRadius: 16, border: 'none', cursor: 'pointer',
                  background: REJECT, color: '#fff', fontWeight: 700, fontSize: 17,
                  boxShadow: '0 8px 26px rgba(255,90,106,0.35)',
                }}
              >
                ✕ {gt('paging.end', 'End')}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

// Self-contained version: floating launcher button + its own paging state,
// for spots with no header to anchor a trigger to (WallDashboard.jsx — a
// wall tablet is the primary paging endpoint, and the kiosk view has no
// top bar). App.jsx instead calls usePaging() itself and renders PagingPanel
// directly, with the trigger button next to the Wall Dashboard toggle in
// Header.jsx.
export default function PagingWidget() {
  const paging = usePaging()
  const [open, setOpen] = useState(false)
  const inSession = !!paging.active

  return (
    <>
      {!inSession && (
        <motion.button
          whileTap={{ scale: 0.94 }}
          onClick={() => setOpen(o => !o)}
          title={gt('paging.title', 'Paging')}
          aria-label={gt('paging.title', 'Paging')}
          style={{
            position: 'fixed', right: 18, bottom: 18, zIndex: 350,
            width: 48, height: 48, borderRadius: '50%', cursor: 'pointer',
            background: 'var(--surface, #171b25)', color: ACCENT,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 8px 22px rgba(0,0,0,0.4)', border: `1px solid ${ACCENT}55`,
          }}
        >
          <BroadcastIcon size={22}/>
        </motion.button>
      )}
      <PagingPanel {...paging} open={open} setOpen={setOpen} />
    </>
  )
}
