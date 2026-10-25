import { useEffect, useMemo, useState } from 'react'
import { SettingsCard, Field, Toggle, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { gt, tr } from '../../../i18n'

const api = (url, method = 'GET', body) => fetch(url, {
  method, credentials: 'include',
  ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
}).then((r) => r.json())

const RENTAL_TYPES = ['airbnb', 'booking', 'vrbo']
const NEW_PROPERTY = { name: '', listing: '', devices: [], wifi: { ssid: '', password: '' }, info: '', rules: '', pin: { mode: 'phone4', digits: 4 }, earlyHours: 0, lateHours: 1 }
const fmt = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const STATUS_CHIP = { active: 'ok', upcoming: '', ended: 'warn' }

// Guest portal for Airbnb / Booking.com / VRBO stays — a link and a door PIN
// per stay, valid only during it. Server: src/tenant-portal.js, src/routes/tenant.js.
export default function TenantSection({ config, reload }) {
  const t = config.tenant || {}
  const [enabled, setEnabled] = useState(!!t.enabled)
  const [publicUrl, setPublicUrl] = useState(t.publicUrl || '')
  const [props, setProps] = useState((t.properties || []).map((p) => ({ ...NEW_PROPERTY, ...p })))
  const [devices, setDevices] = useState([])
  const [stays, setStays] = useState([])
  const [reset, setReset] = useState(null)
  const save = useSettingsSave('/api/settings/tenant')

  const loadStays = () => api('/api/tenant/stays').then((j) => setStays(j.data || [])).catch(() => {})
  useEffect(() => {
    api('/api/devices').then((j) => setDevices(j.data || [])).catch(() => {})
    loadStays()
  }, [])

  const rentals = devices.filter((d) => RENTAL_TYPES.includes(d.type))
  const setProp = (i, patch) => setProps((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  const doSave = () => save.save({ enabled, publicUrl, properties: props })
    .then(() => { loadStays(); reload?.() }).catch(() => {})
  const resetLinks = async () => {
    const j = await api('/api/tenant/reset-links', 'POST', {}).catch((e) => ({ success: false, error: e.message }))
    setReset({ ok: j.success, message: j.message || j.error })
    loadStays()
  }

  return (
    <>
      <SettingsCard title="Guest portal" badge={{ label: gt('common.optional', 'Optional') }}
        desc="Each Airbnb, Booking.com or VRBO stay gets its own guest link and door PIN, valid only from check-in to check-out. Through the link the guest sees the Wi-Fi, the door code, your information and house rules, and controls only the devices you pick. Send the link in the booking message. The PIN is the guest's phone last 4 digits (Airbnb) or a generated code; flows can read it from the property's PIN device and keypads can check it at POST /api/tenant/check-pin.">
        <Toggle label="Enable guest portal" checked={enabled} onChange={setEnabled}/>
        <Field label="Public address of LSH" hint="(what guests open — e.g. https://lsh.example.com)" value={publicUrl}
          onChange={setPublicUrl} placeholder="https://…"/>
        {rentals.length === 0 && <p className="stg-hint">{tr('Add an Airbnb, Booking.com or VRBO listing first — its stays are what the portal uses.')}</p>}

        {props.map((p, i) => (
          <PropertyEditor key={i} p={p} rentals={rentals} devices={devices}
            onChange={(patch) => setProp(i, patch)}
            onRemove={() => setProps((ps) => ps.filter((_, j) => j !== i))}/>
        ))}
        <button className="stg-list-add" onClick={() => setProps((ps) => [...ps, { ...NEW_PROPERTY, listing: rentals[0]?.key || '' }])}>
          + {tr('Add property')}
        </button>

        <div className="stg-actions">
          <Button variant="primary" busy={save.busy} onClick={doSave}>{gt('common.save', 'Save')}</Button>
          <ResultBanner result={save.result}/>
        </div>
      </SettingsCard>

      {enabled && stays.length > 0 && (
        <SettingsCard title="Guest links"
          desc="Current and upcoming stays. Copy a link into the booking message. If a guest changes their dates, the stay gets a new link.">
          {stays.map((prop) => (
            <div key={prop.id}>
              <h4 className="stg-subheading">{prop.name || prop.listing}</h4>
              {prop.stays.length === 0 && <p className="stg-hint">{tr('No stays in the calendar.')}</p>}
              <div className="stg-mod-list">
                {prop.stays.map((s) => <StayRow key={s.link} s={s}/>)}
              </div>
            </div>
          ))}
          <div className="stg-actions">
            <Button variant="secondary" onClick={resetLinks}>{tr('Reset all links')}</Button>
            <ResultBanner result={reset}/>
          </div>
        </SettingsCard>
      )}
    </>
  )
}

function StayRow({ s }) {
  const [copied, setCopied] = useState(false)
  const url = s.link.startsWith('http') ? s.link : `${location.origin}${s.link}`
  const copy = () => navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  const label = { active: tr('active'), upcoming: tr('upcoming'), ended: tr('ended') }[s.status]
  return (
    <div className="stg-mod-row">
      <div className="stg-mod-main">
        <div className="stg-mod-name">
          {s.guest || tr('Guest')}
          <span className={`stg-mod-chip ${STATUS_CHIP[s.status] ?? ''}`}>{label}</span>
          <span className="stg-mod-chip cfg">PIN {s.pin}</span>
        </div>
        <div className="stg-hint stg-mod-meta">{fmt(s.start)} → {fmt(s.end)}</div>
        <div className="stg-hint stg-mod-meta" style={{ wordBreak: 'break-all' }}><code>{url}</code></div>
      </div>
      <Button variant="secondary" onClick={copy}>{copied ? tr('Copied') : tr('Copy link')}</Button>
    </div>
  )
}

function PropertyEditor({ p, rentals, devices, onChange, onRemove }) {
  const [q, setQ] = useState('')
  const controllable = useMemo(() => devices
    .filter((d) => (d.sensors || []).some((s) => s.controllable) && !RENTAL_TYPES.includes(d.type) && d.type !== 'tenant')
    .sort((a, b) => String(a.room || '').localeCompare(String(b.room || '')) || String(a.label).localeCompare(String(b.label))), [devices])
  const shown = controllable.filter((d) => p.devices.includes(d.key)
    || (q && `${d.label} ${d.room || ''} ${d.key}`.toLowerCase().includes(q.toLowerCase())))
  const toggleDev = (key) => onChange({ devices: p.devices.includes(key) ? p.devices.filter((k) => k !== key) : [...p.devices, key] })
  const locks = devices.filter((d) => d.type === 'nuki' || d.type === 'tedee')
  const listingOptions = [
    ...rentals.map((d) => ({ value: d.key, label: `${d.label} (${d.type})`, raw: true })),
    ...(p.listing && !rentals.some((d) => d.key === p.listing) ? [{ value: p.listing, label: p.listing, raw: true }] : []),
  ]

  return (
    <div className="stg-list-row" style={{ display: 'block' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0 12px' }}>
        <Field label="Name" value={p.name} onChange={(v) => onChange({ name: v })} placeholder="Apartment"/>
        <Field label="Listing" type="select" value={p.listing} onChange={(v) => onChange({ listing: v })} options={listingOptions}/>
        <Field label="Wi-Fi network" value={p.wifi?.ssid || ''} onChange={(v) => onChange({ wifi: { ...p.wifi, ssid: v } })}/>
        <Field label="Wi-Fi password" value={p.wifi?.password || ''} onChange={(v) => onChange({ wifi: { ...p.wifi, password: v } })}/>
        <Field label="Lock for keypad codes" type="select" value={p.lock || ''} onChange={(v) => onChange({ lock: v })}
          options={[{ value: '', label: 'None — PIN only shown and published' }, ...locks.map((d) => ({ value: d.key, label: `${d.label} (${d.type})`, raw: true }))]}/>
        <Field label="Door PIN" type="select" value={p.pin?.mode || 'phone4'} onChange={(v) => onChange({ pin: { ...p.pin, mode: v } })}
          options={[{ value: 'phone4', label: "Guest's phone last 4 digits (Airbnb), else generated" }, { value: 'random', label: 'Generated for each stay' }]}/>
        <Field label="Generated PIN length" type="number" min={4} max={8} value={p.pin?.digits ?? 4} onChange={(v) => onChange({ pin: { ...p.pin, digits: Number(v) } })}/>
        <Field label="Access starts" hint="(h before check-in)" type="number" min={0} max={48} value={p.earlyHours ?? 0} onChange={(v) => onChange({ earlyHours: Number(v) })}/>
        <Field label="Access ends" hint="(h after check-out)" type="number" min={0} max={48} value={p.lateHours ?? 1} onChange={(v) => onChange({ lateHours: Number(v) })}/>
      </div>
      <Field label="Information for guests" type="textarea" value={p.info || ''} onChange={(v) => onChange({ info: v })}
        placeholder="Parking, rubbish, heating, contact…"/>
      <Field label="House rules" type="textarea" value={p.rules || ''} onChange={(v) => onChange({ rules: v })}/>

      <h4 className="stg-subheading">{tr('Devices the guest controls')}</h4>
      <input className="stg-input stg-mod-filter" placeholder={tr('Search devices to add…')} value={q} onChange={(e) => setQ(e.target.value)}/>
      <div className="stg-mod-list">
        {shown.map((d) => (
          <label key={d.key} className="stg-mod-row" style={{ cursor: 'pointer' }}>
            <div className="stg-mod-main">
              <div className="stg-mod-name">{d.icon} {d.label}</div>
              <div className="stg-hint stg-mod-meta">{[d.room, d.key].filter(Boolean).join(' · ')}</div>
            </div>
            <input type="checkbox" className="stg-checkbox" checked={p.devices.includes(d.key)} onChange={() => toggleDev(d.key)}/>
          </label>
        ))}
        {shown.length === 0 && <p className="stg-hint">{tr('None picked — search above to add lights, air conditioning, blinds…')}</p>}
      </div>
      <div className="stg-actions">
        <Button variant="secondary" onClick={onRemove}>{tr('Remove property')}</Button>
      </div>
    </div>
  )
}
