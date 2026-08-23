import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { gt } from '../i18n'
import { usePaging } from '../hooks/usePaging'

const ACCENT = '#38bdf8'
const REJECT = '#ff5a6a'

// Floating room-to-room paging (intercom) control. Self-contained: a small
// launcher button that expands into a room picker, plus a full-screen
// overlay while a page is incoming/active. Meant to be mounted once near the
// app root (see App.jsx) and again in WallDashboard, since a wall tablet is
// the primary paging endpoint.
export default function PagingWidget() {
  const { rooms, myRoom, setMyRoom, active, error, startPage, endPage } = usePaging()
  const [open, setOpen] = useState(false)
  const [bridgeFrom, setBridgeFrom] = useState('')
  const [bridgeTo, setBridgeTo] = useState('')

  if (!rooms.length) return null // paging disabled / no rooms configured

  const others = rooms.filter(r => r.id !== myRoom)
  const inSession = !!active
  const iAmParticipant = active && (active.from === myRoom || active.to === myRoom)

  return (
    <>
      {!inSession && (
        <motion.button
          whileTap={{ scale: 0.94 }}
          onClick={() => setOpen(o => !o)}
          title={gt('paging.title', 'Paging')}
          style={{
            position: 'fixed', right: 18, bottom: 18, zIndex: 350,
            width: 48, height: 48, borderRadius: '50%', cursor: 'pointer',
            background: 'var(--surface, #171b25)', color: ACCENT, fontSize: 20,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 8px 22px rgba(0,0,0,0.4)', border: `1px solid ${ACCENT}55`,
          }}
        >
          📟
        </motion.button>
      )}

      <AnimatePresence>
        {open && !inSession && (
          <motion.div
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
            style={{
              position: 'fixed', right: 18, bottom: 74, zIndex: 350, width: 260,
              background: 'var(--surface, #12151d)', border: `1px solid ${ACCENT}33`, borderRadius: 16,
              padding: 14, boxShadow: '0 16px 44px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)', marginBottom: 8 }}>
              {gt('paging.this_device', 'This device')}
            </div>
            <select
              value={myRoom} onChange={e => setMyRoom(e.target.value)}
              style={{ width: '100%', marginBottom: 12, padding: '6px 8px', borderRadius: 8, background: 'var(--surface2, #171b25)', color: 'var(--text)', border: '1px solid var(--border, rgba(255,255,255,0.14))' }}
            >
              <option value="">{gt('paging.not_a_room', 'Not a fixed room')}</option>
              {rooms.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>

            {myRoom ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)' }}>
                  {gt('paging.page', 'Page')}
                </div>
                {others.map(r => (
                  <button
                    key={r.id}
                    disabled={!r.online}
                    onClick={() => { startPage(myRoom, r.id); setOpen(false) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 10,
                      border: '1px solid var(--border, rgba(255,255,255,0.14))', background: 'var(--surface2, #171b25)',
                      color: r.online ? 'var(--text)' : 'var(--text3)', cursor: r.online ? 'pointer' : 'not-allowed', fontSize: 13,
                    }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: r.online ? 'var(--green)' : 'var(--text3)' }} />
                    {r.label}{!r.online ? ` (${gt('paging.offline', 'offline')})` : ''}
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)' }}>
                  {gt('paging.bridge', 'Connect two rooms')}
                </div>
                <select value={bridgeFrom} onChange={e => setBridgeFrom(e.target.value)}
                  style={{ padding: '6px 8px', borderRadius: 8, background: 'var(--surface2, #171b25)', color: 'var(--text)', border: '1px solid var(--border, rgba(255,255,255,0.14))' }}>
                  <option value="">{gt('paging.from', 'From…')}</option>
                  {rooms.map(r => <option key={r.id} value={r.id} disabled={!r.online}>{r.label}{!r.online ? ` (${gt('paging.offline', 'offline')})` : ''}</option>)}
                </select>
                <select value={bridgeTo} onChange={e => setBridgeTo(e.target.value)}
                  style={{ padding: '6px 8px', borderRadius: 8, background: 'var(--surface2, #171b25)', color: 'var(--text)', border: '1px solid var(--border, rgba(255,255,255,0.14))' }}>
                  <option value="">{gt('paging.to', 'To…')}</option>
                  {rooms.map(r => <option key={r.id} value={r.id} disabled={!r.online}>{r.label}{!r.online ? ` (${gt('paging.offline', 'offline')})` : ''}</option>)}
                </select>
                <button
                  disabled={!bridgeFrom || !bridgeTo || bridgeFrom === bridgeTo}
                  onClick={() => { startPage(bridgeFrom, bridgeTo); setOpen(false) }}
                  style={{
                    marginTop: 4, padding: '8px 10px', borderRadius: 10, border: 'none', cursor: 'pointer',
                    background: ACCENT, color: '#0b0d13', fontWeight: 600, fontSize: 13,
                  }}
                >
                  {gt('paging.start', 'Start')}
                </button>
              </div>
            )}
            {error && <div style={{ marginTop: 10, fontSize: 12, color: REJECT }}>{error}</div>}
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
                width: 'min(360px, 92vw)', borderRadius: 22, padding: 28, textAlign: 'center',
                background: 'var(--surface, #12151d)', border: `1px solid ${ACCENT}44`, boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
              }}
            >
              <div style={{ fontSize: 34, marginBottom: 10 }}>📟</div>
              <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)' }}>
                {iAmParticipant ? gt('paging.in_progress', 'Paging') : gt('paging.bridged', 'Bridged call')}
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', marginTop: 4 }}>
                {active.fromLabel} ↔ {active.toLabel}
              </div>
              {!iAmParticipant && (
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>
                  {gt('paging.bridged_hint', "You're not a participant — this device only started the connection.")}
                </div>
              )}
              <button
                onClick={endPage}
                style={{
                  marginTop: 20, padding: '12px 22px', borderRadius: 14, border: 'none', cursor: 'pointer',
                  background: REJECT, color: '#fff', fontWeight: 600, fontSize: 15,
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
