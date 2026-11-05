import { useEffect, useState } from 'react'
import { gt } from '../i18n'

// Room-service menu embedded as a dashboard card. Reads the public menu
// (/api/order/menu) — the same data guests see on the /order page — and shows
// it grouped by category, in the dashboard's flat style. A link opens the full
// guest ordering page so staff can preview or hand it to a device.
// Server: core-go/roomservice_api.go.

const money = (n, cur) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur || 'PLN', maximumFractionDigits: 0 }).format(n) } catch { return `${n} ${cur || ''}` } }

// Shared fetch so the card and the home-section gate don't double-request.
let cache = { data: undefined, at: 0, pending: null }
const listeners = new Set()
function fetchMenu(force) {
  if (!force && cache.data !== undefined && Date.now() - cache.at < 60000) return Promise.resolve(cache.data)
  if (cache.pending) return cache.pending
  cache.pending = fetch('/api/order/menu', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => { cache = { data: (j && j.data) || null, at: Date.now(), pending: null }; listeners.forEach((f) => f(cache.data)); return cache.data })
    .catch(() => { cache.pending = null; return null })
  return cache.pending
}

export function useRoomService() {
  const [data, setData] = useState(cache.data !== undefined ? cache.data : null)
  useEffect(() => {
    const f = (d) => setData(d)
    listeners.add(f)
    fetchMenu()
    const t = setInterval(() => fetchMenu(true), 60000)
    return () => { listeners.delete(f); clearInterval(t) }
  }, [])
  return data
}

export default function RoomServiceCard({ data }) {
  const rs = data
  const [open, setOpen] = useState(true)
  if (!rs || !rs.enabled || rs.hideHotelServices || !rs.menu?.length) return null

  const cats = []
  const byCat = {}
  for (const it of rs.menu) {
    const c = it.category || gt('home_sec_roomservice', 'Room service')
    if (!byCat[c]) { byCat[c] = []; cats.push(c) }
    byCat[c].push(it)
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div onClick={() => setOpen((o) => !o)} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setOpen((o) => !o) }}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', cursor: 'pointer' }}>
        <span style={{ fontSize: 18 }}>🍽️</span>
        <span style={{ flex: 1, fontWeight: 700, fontSize: 15 }}>{rs.title || gt('home_sec_roomservice', 'Room service')}</span>
        <span className="badge" style={{ background: 'var(--surface-2, rgba(128,128,128,.15))', color: 'var(--text-dim, #888)', borderRadius: 20, padding: '2px 9px', fontSize: 12, fontWeight: 600 }}>{rs.menu.length}</span>
        <a href="/order" target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
          style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent, #0a84ff)', textDecoration: 'none' }}>
          {gt('rs_open_page', 'Open')} ↗
        </a>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          style={{ opacity: .5, transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .2s' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
      {open && (
        <div style={{ padding: '0 16px 14px' }}>
          {cats.map((c) => (
            <div key={c} style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-dim, #888)', marginBottom: 8 }}>{c}</div>
              {byCat[c].map((it) => (
                <div key={it.id} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border, rgba(128,128,128,.12))' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{it.name}</div>
                    {it.desc && <div style={{ fontSize: 12.5, color: 'var(--text-dim, #888)', marginTop: 1 }}>{it.desc}</div>}
                  </div>
                  <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: 'var(--gold, var(--accent, #0a84ff))' }}>{money(it.price, rs.currency)}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
