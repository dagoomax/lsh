import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { SettingsCard, Field, Toggle, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { gt, tr } from '../../../i18n'

const api = (url, method = 'GET', body) => fetch(url, {
  method, credentials: 'include',
  ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
}).then((r) => r.json())

const rid = () => 'ln-' + Math.random().toString(36).slice(2, 8)
const NEW_ITEM = (p = {}) => ({ id: rid(), category: '', name: '', desc: '', price: 0, available: true, ...p })
const money = (n, cur) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur || 'PLN' }).format(n) } catch { return `${n} ${cur || ''}` } }
const fmtTime = (ms) => new Date(ms).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })

const DEFAULT_SLOTS = ['As soon as possible', 'Morning (8:00–10:00)', 'Afternoon (14:00–16:00)', 'Evening (18:00–20:00)']
const STARTER_ITEMS = [
  ['Wash & iron', 'Shirt', 25], ['Wash & iron', 'Trousers', 30], ['Wash & iron', 'T-shirt', 15], ['Wash & iron', 'Underwear', 10], ['Wash & iron', 'Socks (pair)', 8],
  ['Dry cleaning', 'Suit jacket', 60], ['Dry cleaning', 'Suit (2 pieces)', 90], ['Dry cleaning', 'Dress', 70], ['Dry cleaning', 'Coat', 90],
  ['Pressing only', 'Shirt', 15], ['Pressing only', 'Trousers', 18],
].map(([category, name, price]) => NEW_ITEM({ category, name, price }))

// Functions, so the words are translated once the phrase book has loaded.
const statusLabel = () => ({ requested: tr('Requested'), collected: tr('Collected'), cleaning: tr('Cleaning'), ready: tr('Ready'), delivered: tr('Delivered'), cancelled: tr('Cancelled') })
const nextStep = () => ({ requested: ['collected', tr('Mark collected')], collected: ['cleaning', tr('Start cleaning')], cleaning: ['ready', tr('Mark ready')], ready: ['delivered', tr('Mark delivered')] })
const isOpen = (o) => o.status !== 'delivered' && o.status !== 'cancelled'

// Guest laundry: a price list guests order from on a per-room QR page, charged
// to the room, and an order board staff work through. Server:
// core-go/laundry_api.go, guest page at /laundry.
export default function LaundrySection({ config, reload }) {
  const [l, setL] = useState(null)
  const [rsRooms, setRsRooms] = useState([])
  const [orders, setOrders] = useState([])
  const [lic, setLic] = useState(null)
  const [boardError, setBoardError] = useState('')
  const save = useSettingsSave('/api/settings/laundry')

  const loadOrders = () => api('/api/laundry/orders').then((j) => setOrders(j.data || [])).catch(() => {})
  useEffect(() => {
    const base = { enabled: false, title: 'Laundry', currency: '', standardHours: 24, expressHours: 4, express: true, expressSurchargePct: 50, pickupSlots: DEFAULT_SLOTS, rooms: [], items: [], publicUrl: config?.roomService?.publicUrl || config?.tenant?.publicUrl || '' }
    api('/api/laundry').then((j) => {
      const r = j.data?.laundry || {}
      setRsRooms(j.data?.roomServiceRooms || [])
      setL({ ...base, ...r, express: r.express !== false, pickupSlots: r.pickupSlots?.length ? r.pickupSlots : DEFAULT_SLOTS,
        items: Array.isArray(r.items) ? r.items.map((i) => NEW_ITEM(i)) : [] })
    }).catch(() => setL(base))
    api('/api/license').then((j) => setLic(j.data || null)).catch(() => {})
    loadOrders()
    const t = setInterval(loadOrders, 15000)
    return () => clearInterval(t)
  }, [])

  const patch = (p) => setL((s) => ({ ...s, ...p }))
  const setItem = (i, p) => setL((s) => ({ ...s, items: s.items.map((it, j) => (j === i ? { ...it, ...p } : it)) }))
  const doSave = () => save.save({ laundry: l }).then(() => reload?.()).catch(() => {})
  const act = (req) => req.then((j) => { setBoardError(j.success === false ? j.error : ''); return loadOrders() })
    .catch((e) => setBoardError(e.message))
  const setStatus = (id, status) => act(api(`/api/laundry/orders/${id}/status`, 'POST', { status }))
  const remove = (id) => act(api(`/api/laundry/orders/${id}`, 'DELETE'))
  const clearFinished = () => act(api('/api/laundry/orders/finished', 'DELETE'))

  if (!l) return null
  const open = orders.filter(isOpen)
  const finished = orders.filter((o) => !isOpen(o))
  const now = Date.now()
  const late = open.filter((o) => now > o.dueAt).length
  const rooms = l.rooms?.length ? l.rooms : rsRooms

  const row = (o) => {
    const overdue = isOpen(o) && now > o.dueAt
    const next = nextStep()[o.status]
    return (
      <div key={o.id} className="stg-row" style={{ alignItems: 'flex-start', opacity: isOpen(o) ? 1 : 0.55, borderLeft: `3px solid ${overdue ? 'var(--bad, #ff453a)' : o.status === 'requested' ? 'var(--warn, #f5a623)' : 'var(--line)'}`, paddingLeft: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong>{tr('Room')} {o.room}</strong>{' '}
          {o.express && <span className="badge" style={{ background: 'rgba(245,166,35,.16)', color: 'var(--warn, #f5a623)', borderRadius: 20, padding: '2px 8px', fontSize: 12, fontWeight: 600 }}>{tr('Express')}</span>}
          <div style={{ color: 'var(--text-dim, #888)', fontSize: 13 }}>
            {statusLabel()[o.status] || o.status} · {tr('pickup')}: {o.pickup}
            {isOpen(o) && <> · <span style={overdue ? { color: 'var(--bad, #ff453a)', fontWeight: 600 } : undefined}>{overdue ? tr('overdue since') : tr('due')} {fmtTime(o.dueAt)}</span></>}
          </div>
          <div style={{ fontSize: 14, margin: '4px 0' }}>{(o.items || []).map((it) => `${it.qty}× ${it.name}`).join(', ')}</div>
          {o.note && <div style={{ fontSize: 13, color: 'var(--text-dim, #888)', fontStyle: 'italic' }}>“{o.note}”</div>}
          <strong>{money(o.total, o.currency)}</strong>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {next && <Button variant="primary" onClick={() => setStatus(o.id, next[0])}>{next[1]}</Button>}
          {isOpen(o) ? <Button onClick={() => setStatus(o.id, 'cancelled')}>Cancel</Button> : <Button onClick={() => remove(o.id)}>×</Button>}
        </div>
      </div>
    )
  }

  return (
    <>
      {lic && lic.limits?.hotel !== true && (
        <SettingsCard title="Plan & licence" desc="Laundry is a Hotel-plan feature. Guests can’t reach the page until the Hotel plan is active." />
      )}

      {orders.length > 0 && (
        <SettingsCard title="Laundry orders"
          badge={late ? { label: `${late} ${tr('overdue')}`, tone: 'warn' } : (open.length ? { label: `${open.length} ${tr('open')}`, tone: 'warn' } : undefined)}
          desc="Move each order along as the laundry goes through. Guests see the progress on their page, and the charge is on their room bill.">
          <div className="stg-actions" style={{ marginTop: 0 }}>
            <Button onClick={loadOrders}>Refresh</Button>
            {finished.length > 0 && <Button onClick={clearFinished}>Clear finished</Button>}
          </div>
          {boardError && <ResultBanner result={{ ok: false, message: boardError }} />}
          {[...open, ...finished].map(row)}
        </SettingsCard>
      )}

      <SettingsCard title="Laundry" badge={{ label: gt('common.optional', 'Optional') }}
        desc="Guests pick their garments on their phone by scanning a QR code in the room, and choose a service and a pickup time. The charge goes on the room bill.">
        <Toggle label="Enable laundry service" checked={l.enabled} onChange={(v) => patch({ enabled: v })} />
        <Field label="Heading shown to guests" value={l.title} onChange={(v) => patch({ title: v })} placeholder="Laundry" />
        <Field label="Currency" hint="(ISO code; blank uses the room-service currency)" value={l.currency} onChange={(v) => patch({ currency: v.toUpperCase() })} placeholder="PLN" />
        <Field label="Standard turnaround" hint="(hours)" type="number" value={l.standardHours} onChange={(v) => patch({ standardHours: Number(v) || 0 })} />
        <Toggle label="Offer express service" checked={l.express} onChange={(v) => patch({ express: v })} />
        {l.express && <>
          <Field label="Express turnaround" hint="(hours)" type="number" value={l.expressHours} onChange={(v) => patch({ expressHours: Number(v) || 0 })} />
          <Field label="Express surcharge" hint="(percent added to the total)" type="number" value={l.expressSurchargePct} onChange={(v) => patch({ expressSurchargePct: Number(v) || 0 })} />
        </>}
        <Field label="Pickup times" hint="(comma-separated; the first is the default)" value={(l.pickupSlots || []).join(', ')}
          onChange={(v) => patch({ pickupSlots: v.split(',').map((x) => x.trimStart()) })} />
      </SettingsCard>

      <SettingsCard title="Price list" desc="Garments guests can send. Group them with a category (Wash & iron, Dry cleaning…). Turn an item off to hide it without deleting it.">
        {l.items.map((it, i) => (
          <div key={it.id} className="stg-row" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'flex-end', borderBottom: '1px solid var(--line)', paddingBottom: 10, marginBottom: 10 }}>
            <Field label="Category" value={it.category} onChange={(v) => setItem(i, { category: v })} placeholder="Wash & iron" />
            <Field label="Name" value={it.name} onChange={(v) => setItem(i, { name: v })} placeholder="Shirt" />
            <Field label="Price" type="number" value={it.price} onChange={(v) => setItem(i, { price: Number(v) || 0 })} />
            <Field label="Description" value={it.desc} onChange={(v) => setItem(i, { desc: v })} placeholder="(optional)" />
            <Toggle label="Available" checked={it.available !== false} onChange={(v) => setItem(i, { available: v })} />
            <Button onClick={() => setL((s) => ({ ...s, items: s.items.filter((_, j) => j !== i) }))}>Remove</Button>
          </div>
        ))}
        <button className="stg-list-add" onClick={() => setL((s) => ({ ...s, items: [...s.items, NEW_ITEM()] }))}>+ {tr('Add item')}</button>
        {!l.items.length && <div className="stg-actions"><Button onClick={() => patch({ items: STARTER_ITEMS })}>Start with a typical price list</Button></div>}
      </SettingsCard>

      <SettingsCard title="QR codes" desc="One code per room. Print it and place it in the room, for example on the laundry bag. Scanning it opens the price list with the room already filled in. Save first so the address and rooms are stored.">
        <Field label="Public address of LSH" hint="(what the QR code opens — e.g. https://lsh.example.com)" value={l.publicUrl} onChange={(v) => patch({ publicUrl: v })} placeholder="https://…" />
        <Field label="Rooms" hint="(comma-separated; blank uses the room-service list. Orders for other rooms are refused.)" value={(l.rooms || []).join(', ')}
          onChange={(v) => patch({ rooms: v.split(',').map((x) => x.trim()).filter(Boolean) })} placeholder={rsRooms.join(', ') || '101, 102, 201'} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 12 }}>
          {rooms.map((room) => <RoomQR key={room} room={room} url={`${(l.publicUrl || '').replace(/\/$/, '')}/laundry?room=${encodeURIComponent(room)}`} />)}
          {!rooms.length && <p className="stg-hint">{tr('Add room numbers above to generate their QR codes.')}</p>}
        </div>
        {!l.publicUrl && <p className="stg-hint">{tr('Set the public address above so the codes point at the right place.')}</p>}
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
