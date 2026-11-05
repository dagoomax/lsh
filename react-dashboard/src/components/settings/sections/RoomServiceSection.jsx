import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { SettingsCard, Field, Toggle, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { gt, tr } from '../../../i18n'

const api = (url, method = 'GET', body) => fetch(url, {
  method, credentials: 'include',
  ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
}).then((r) => r.json())

const rid = () => 'it-' + Math.random().toString(36).slice(2, 8)
const NEW_ITEM = () => ({ id: rid(), category: '', name: '', desc: '', price: 0, available: true })
const money = (n, cur) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur || 'PLN' }).format(n) } catch { return `${n} ${cur || ''}` } }
const fmtTime = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

// Room service: a guest ordering page reached by a per-room QR code, orders
// charged to the room or paid now via Stripe (Apple Pay), and a menu edited
// here. Server: core-go/roomservice_api.go, guest page at /order.
export default function RoomServiceSection({ config, reload }) {
  const [rs, setRs] = useState(null)
  const [hideHotel, setHideHotel] = useState(false)
  const [orders, setOrders] = useState([])
  const [lic, setLic] = useState(null)
  const save = useSettingsSave('/api/settings/room-service')

  const loadOrders = () => api('/api/room-service/orders').then((j) => setOrders(j.data || [])).catch(() => {})
  useEffect(() => {
    api('/api/room-service').then((j) => {
      const d = j.data || {}
      const r = d.roomService || {}
      setRs({
        enabled: !!r.enabled, title: r.title || 'Room Service', currency: r.currency || 'PLN',
        payToRoom: r.payToRoom !== false, publicUrl: r.publicUrl || config?.tenant?.publicUrl || '',
        stripe: { enabled: !!(r.stripe && r.stripe.enabled), publishableKey: r.stripe?.publishableKey || '', secretKey: r.stripe?.secretKey || '' },
        rooms: Array.isArray(r.rooms) ? r.rooms : [], menu: Array.isArray(r.menu) ? r.menu.map((i) => ({ ...NEW_ITEM(), ...i })) : [],
      })
      setHideHotel(!!d.hideHotelServices)
    }).catch(() => setRs({ enabled: false, title: 'Room Service', currency: 'PLN', payToRoom: true, publicUrl: '', stripe: { enabled: false, publishableKey: '', secretKey: '' }, rooms: [], menu: [] }))
    api('/api/license').then((j) => setLic(j.data || null)).catch(() => {})
    loadOrders()
    const t = setInterval(loadOrders, 15000)
    return () => clearInterval(t)
  }, [])

  const patch = (p) => setRs((s) => ({ ...s, ...p }))
  const setItem = (i, p) => setRs((s) => ({ ...s, menu: s.menu.map((it, j) => (j === i ? { ...it, ...p } : it)) }))
  const doSave = () => save.save({ roomService: rs, hideHotelServices: hideHotel }).then(() => reload?.()).catch(() => {})
  const ack = (id) => api(`/api/room-service/orders/${id}/ack`, 'POST', {}).then(loadOrders)
  const remove = (id) => api(`/api/room-service/orders/${id}`, 'DELETE').then(loadOrders)
  const clearAll = () => api('/api/room-service/orders/all', 'DELETE').then(loadOrders)

  const cats = useMemo(() => [...new Set((rs?.menu || []).map((i) => i.category).filter(Boolean))], [rs])
  if (!rs) return null
  const newCount = orders.filter((o) => o.status === 'new').length

  const hotelOn = lic?.limits?.hotel === true

  return (
    <>
      {lic && (
        <SettingsCard title="Plan & licence"
          desc="Room service is a Hotel-plan feature. Free: up to 2 integrations and a 1-input / 1-output Loxone export. Managed lifts those limits; Hotel adds the hotel features.">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 15, textTransform: 'capitalize' }}>{tr('Current plan')}: {lic.tier}</span>
            <span className="badge" style={{ background: hotelOn ? 'rgba(52,199,89,.15)' : 'rgba(128,128,128,.15)', color: hotelOn ? 'var(--good,#34c759)' : 'var(--text-dim,#888)', borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>
              {hotelOn ? tr('Hotel features unlocked') : tr('Hotel features locked')}
            </span>
          </div>
          {!hotelOn && (
            <p className="stg-hint" style={{ marginTop: 8 }}>
              {tr('To enable room service, activate the Hotel plan')} — {tr('Managed')} {lic.pricing?.managed || '499 PLN'}, {tr('Hotel')} {lic.pricing?.hotel || 'call'}. {tr('Add the licence key to config.license.key.')}
            </p>
          )}
        </SettingsCard>
      )}
      {orders.length > 0 && (
        <SettingsCard title="Live orders"
          badge={newCount ? { label: `${newCount} ${gt('common.new', 'new')}`, tone: 'warn' } : undefined}
          desc="Orders guests place through the room-service page. New ones also raise a notification.">
          <div className="stg-actions" style={{ marginTop: 0 }}>
            <Button onClick={loadOrders}>Refresh</Button>
            <Button onClick={clearAll}>Clear all</Button>
          </div>
          {orders.map((o) => (
            <div key={o.id} className="stg-row" style={{ alignItems: 'flex-start', opacity: o.status === 'ack' ? 0.55 : 1, borderLeft: `3px solid ${o.status === 'new' ? 'var(--warn, #f5a623)' : 'var(--line)'}`, paddingLeft: 10 }}>
              <div style={{ flex: 1 }}>
                <strong>{o.room ? `${tr('Room')} ${o.room}` : tr('Guest')}</strong>
                {'  '}<span style={{ color: 'var(--text-dim, #888)' }}>{fmtTime(o.at)} · {o.payment === 'card' ? (o.paid ? tr('paid by card') : tr('card')) : tr('to room bill')}</span>
                <div style={{ fontSize: 14, margin: '4px 0' }}>
                  {(o.items || []).map((it) => `${it.qty}× ${it.name}`).join(', ')}
                </div>
                {o.note && <div style={{ fontSize: 13, color: 'var(--text-dim, #888)', fontStyle: 'italic' }}>“{o.note}”</div>}
                <strong>{money(o.total, o.currency)}</strong>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {o.status === 'new' && <Button variant="primary" onClick={() => ack(o.id)}>Acknowledge</Button>}
                <Button onClick={() => remove(o.id)}>×</Button>
              </div>
            </div>
          ))}
        </SettingsCard>
      )}

      <SettingsCard title="Room Service" badge={{ label: gt('common.optional', 'Optional') }}
        desc="A menu guests order from on their phone — by scanning a QR code in the room — with the bill added to their room or paid now by card / Apple Pay. Staff see and acknowledge orders above.">
        <Toggle label="Enable room service" checked={rs.enabled} onChange={(v) => patch({ enabled: v })} />
        <Field label="Heading shown to guests" value={rs.title} onChange={(v) => patch({ title: v })} placeholder="Room Service" />
        <Field label="Currency" hint="(ISO code, e.g. PLN, EUR, USD)" value={rs.currency} onChange={(v) => patch({ currency: v.toUpperCase() })} placeholder="PLN" />
        <Field label="Public address of LSH" hint="(what the QR code opens — e.g. https://lsh.example.com)" value={rs.publicUrl} onChange={(v) => patch({ publicUrl: v })} placeholder="https://…" />
        <Toggle label="Allow “add to room bill”" hint="Guests can charge the order to their room; the front desk settles it at checkout." checked={rs.payToRoom} onChange={(v) => patch({ payToRoom: v })} />
      </SettingsCard>

      <SettingsCard title="Menu" desc="Items guests can order. Group them with a category (Breakfast, Drinks…). Turn an item off to hide it without deleting it.">
        {rs.menu.map((it, i) => (
          <div key={it.id} className="stg-row" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'flex-end', borderBottom: '1px solid var(--line)', paddingBottom: 10, marginBottom: 10 }}>
            <Field label="Category" value={it.category} onChange={(v) => setItem(i, { category: v })} placeholder="Breakfast" />
            <Field label="Name" value={it.name} onChange={(v) => setItem(i, { name: v })} placeholder="Eggs Benedict" />
            <Field label="Price" type="number" value={it.price} onChange={(v) => setItem(i, { price: Number(v) || 0 })} />
            <Field label="Description" value={it.desc} onChange={(v) => setItem(i, { desc: v })} placeholder="(optional)" />
            <Toggle label="Available" checked={it.available !== false} onChange={(v) => setItem(i, { available: v })} />
            <Button onClick={() => setRs((s) => ({ ...s, menu: s.menu.filter((_, j) => j !== i) }))}>Remove</Button>
          </div>
        ))}
        <button className="stg-list-add" onClick={() => setRs((s) => ({ ...s, menu: [...s.menu, NEW_ITEM()] }))}>+ {tr('Add item')}</button>
      </SettingsCard>

      <SettingsCard title="Card payments (Stripe)"
        desc="“Pay now” uses Stripe, which shows Apple Pay on Apple devices. Add your Stripe keys and verify your domain in the Stripe dashboard; until then the button stays hidden and only “add to room” is offered. Test with Stripe test keys first.">
        <Toggle label="Enable pay-now (card / Apple Pay)" checked={rs.stripe.enabled} onChange={(v) => patch({ stripe: { ...rs.stripe, enabled: v } })} />
        <Field label="Stripe publishable key" value={rs.stripe.publishableKey} onChange={(v) => patch({ stripe: { ...rs.stripe, publishableKey: v } })} placeholder="pk_live_… / pk_test_…" />
        <Field label="Stripe secret key" type="password" value={rs.stripe.secretKey} onChange={(v) => patch({ stripe: { ...rs.stripe, secretKey: v } })} placeholder="sk_live_… / sk_test_…" />
      </SettingsCard>

      <SettingsCard title="QR codes" desc="One code per room. Print it and place it in the room — scanning it opens the menu with the room already filled in. Save first so the address and rooms are stored.">
        <Field label="Rooms" hint="(comma-separated, e.g. 101, 102, 201)" value={(rs.rooms || []).join(', ')}
          onChange={(v) => patch({ rooms: v.split(',').map((x) => x.trim()).filter(Boolean) })} placeholder="101, 102, 201" />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 12 }}>
          {(rs.rooms || []).map((room) => (
            <RoomQR key={room} room={room} url={`${(rs.publicUrl || '').replace(/\/$/, '')}/order?room=${encodeURIComponent(room)}`} />
          ))}
          {!rs.rooms?.length && <p className="stg-hint">{tr('Add room numbers above to generate their QR codes.')}</p>}
        </div>
        {!rs.publicUrl && <p className="stg-hint">{tr('Set the public address above so the codes point at the right place.')}</p>}
      </SettingsCard>

      <SettingsCard title="Hotel & rental services"
        desc="Hide the hotel/rental features (room service, guest portal, booking) across the dashboard — use this when this LSH runs as a private home rather than a rental.">
        <Toggle label="Hide hotel & rental services" checked={hideHotel} onChange={setHideHotel} />
      </SettingsCard>

      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} onClick={doSave}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result} />
      </div>
    </>
  )
}

function RoomQR({ room, url }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let live = true
    QRCode.toDataURL(url, { margin: 1, width: 180, errorCorrectionLevel: 'M' }).then((d) => { if (live) setSrc(d) }).catch(() => {})
    return () => { live = false }
  }, [url])
  return (
    <div style={{ textAlign: 'center' }}>
      {src ? <img src={src} alt={`QR ${room}`} width={140} height={140} style={{ borderRadius: 10, background: '#fff', padding: 6 }} /> : <div style={{ width: 140, height: 140 }} />}
      <div style={{ fontWeight: 700, marginTop: 4 }}>{room}</div>
    </div>
  )
}
