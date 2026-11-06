import { useEffect, useState } from 'react'
import { SettingsCard, Field, Toggle, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { tr } from '../../../i18n'

const api = (url, method = 'GET', body) => fetch(url, {
  method, credentials: 'include',
  ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
}).then((r) => r.json())

const rid = () => 'hk-' + Math.random().toString(36).slice(2, 8)
const NEW_HOOK = () => ({ id: rid(), name: '', url: '', secret: '', events: ['room-service.order'], enabled: true })
const fmtTime = (ms) => { try { return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) } catch { return '' } }

// One label per event name (raw English — primitives/tr translate it).
const EVENT_LABEL = {
  'room-service.order': 'Room-service order placed',
  'room-service.ack': 'Order acknowledged',
  'room-service.escalation': 'Order unacknowledged too long',
  'laundry.order': 'Laundry pickup requested',
  'laundry.status': 'Laundry order status changed',
  'laundry.overdue': 'Laundry order overdue',
  'laundry.checkout-open': 'Check-out with laundry still open',
  'hotel.checkin': 'Guest checked in',
  'hotel.checkout': 'Guest checked out',
  'hotel.daily-report': 'Daily service report',
}

// Hotel automation via n8n: LSH posts hotel events (room-service orders, check
// -in/out, a daily report, unacked-order escalation) to n8n Webhook nodes,
// signed with HMAC. Server: core-go/n8n.go + src/n8n.js.
export default function N8nSection() {
  const [cfg, setCfg] = useState(null)
  const [events, setEvents] = useState([])
  const [hotel, setHotel] = useState(null)
  const [rooms, setRooms] = useState([])
  const [checkin, setCheckin] = useState({ room: '', guest: '', nights: '' })
  const [testMsg, setTestMsg] = useState({})
  const save = useSettingsSave('/api/settings/n8n')

  const loadRooms = () => api('/api/hotel/rooms').then((j) => setRooms(j.data || [])).catch(() => {})
  useEffect(() => {
    api('/api/n8n').then((j) => {
      const d = j.data || {}
      const n = d.n8n || {}
      setCfg({
        enabled: n.enabled === true,
        escalateAfterMinutes: Number(n.escalateAfterMinutes) || 15,
        dailyReportAt: n.dailyReportAt || '',
        arrivalScene: n.arrivalScene || '',
        hooks: Array.isArray(n.hooks) ? n.hooks.map((h) => ({ ...NEW_HOOK(), ...h, events: Array.isArray(h.events) ? h.events : [] })) : [],
      })
      setEvents(Array.isArray(d.events) ? d.events : [])
      setHotel(d.hotel || null)
    }).catch(() => setCfg({ enabled: false, escalateAfterMinutes: 15, dailyReportAt: '', hooks: [] }))
    loadRooms()
    const t = setInterval(loadRooms, 20000)
    return () => clearInterval(t)
  }, [])

  const patch = (p) => setCfg((s) => ({ ...s, ...p }))
  const setHook = (i, p) => setCfg((s) => ({ ...s, hooks: s.hooks.map((h, j) => (j === i ? { ...h, ...p } : h)) }))
  const toggleEvent = (i, ev) => setCfg((s) => ({
    ...s,
    hooks: s.hooks.map((h, j) => j !== i ? h : { ...h, events: h.events.includes(ev) ? h.events.filter((e) => e !== ev) : [...h.events, ev] }),
  }))
  const addHook = () => setCfg((s) => ({ ...s, hooks: [...s.hooks, NEW_HOOK()] }))
  const removeHook = (i) => setCfg((s) => ({ ...s, hooks: s.hooks.filter((_, j) => j !== i) }))
  const doSave = () => save.save({ n8n: cfg }).catch(() => {})

  const test = async (id) => {
    setTestMsg((m) => ({ ...m, [id]: tr('Sending…') }))
    try {
      const j = await api('/api/n8n/test', 'POST', { hookId: id })
      setTestMsg((m) => ({ ...m, [id]: j.success ? tr('Delivered') + ' (HTTP ' + (j.data?.status || 200) + ')' : (tr('Failed') + ': ' + (j.error || '')) }))
    } catch (e) { setTestMsg((m) => ({ ...m, [id]: tr('Failed') + ': ' + e.message })) }
  }

  const doCheckin = async () => {
    if (!checkin.room.trim()) return
    await api('/api/hotel/checkin', 'POST', { room: checkin.room.trim(), guest: checkin.guest.trim(), nights: Number(checkin.nights) || 0 })
    setCheckin({ room: '', guest: '', nights: '' })
    loadRooms()
  }
  const doCheckout = async (room) => { await api('/api/hotel/checkout', 'POST', { room }); loadRooms() }

  if (!cfg) return null
  const hotelOn = hotel?.hotel === true

  return (
    <>
      {hotel && (
        <SettingsCard title="Plan & licence"
          desc="Hotel automation is a Hotel-plan feature, like Room Service. On other plans you can set it up, but events are only delivered on the Hotel plan.">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 15, textTransform: 'capitalize' }}>{tr('Current plan')}: {hotel.tier}</span>
            <span style={{ background: hotelOn ? 'rgba(52,199,89,.15)' : 'rgba(128,128,128,.15)', color: hotelOn ? 'var(--good,#34c759)' : 'var(--text-dim,#888)', borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>
              {hotelOn ? tr('Hotel features unlocked') : tr('Hotel features locked')}
            </span>
          </div>
        </SettingsCard>
      )}

      <SettingsCard title="n8n hotel automation"
        desc="Send hotel events to n8n so you can alert staff, run arrival/departure scenes, and email a daily report — without changing code. In n8n, add a Webhook node, copy its URL into a hook below, and (optionally) set a shared secret; LSH signs each delivery with X-LSH-Signature (HMAC-SHA256), the same header the LSH Trigger node checks.">
        <Toggle label="Enable hotel automation" checked={cfg.enabled} onChange={(v) => patch({ enabled: v })} />
        <Field label="Daily report time (HH:MM, local)" value={cfg.dailyReportAt} placeholder="08:00"
          onChange={(v) => patch({ dailyReportAt: v })} hint="Leave empty to disable the daily report." />
        <Field label="Escalate an unacknowledged order after (minutes)" type="number" value={cfg.escalateAfterMinutes}
          onChange={(v) => patch({ escalateAfterMinutes: Number(v) || 15 })}
          hint="A room-service order still unacknowledged after this long fires room-service.escalation." />
        <Field label="Arrival scene — run on check-in" value={cfg.arrivalScene}
          onChange={(v) => patch({ arrivalScene: v })}
          hint="LSH scene ID to run automatically when a guest checks in (e.g. turn the TV and lights on). Create the scene first, then paste its ID here. Leave empty for none." />
      </SettingsCard>

      <SettingsCard title="Hooks" desc="Each hook is one n8n Webhook node. Pick which events it receives.">
        {cfg.hooks.length === 0 && <p style={{ color: 'var(--text-dim,#888)', margin: '4px 0 12px' }}>{tr('No hooks yet. Add one and paste your n8n Webhook URL.')}</p>}
        {cfg.hooks.map((h, i) => (
          <div key={h.id} style={{ border: '1px solid var(--border,#333)', borderRadius: 12, padding: 14, marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <Toggle label="Enabled" checked={h.enabled !== false} onChange={(v) => setHook(i, { enabled: v })} />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {testMsg[h.id] && <span style={{ fontSize: 12, color: 'var(--text-dim,#888)' }}>{testMsg[h.id]}</span>}
                {h.last && <span style={{ fontSize: 12, color: h.last.error ? 'var(--bad,#ff3b30)' : 'var(--good,#34c759)' }}>{h.last.error ? tr('last: failed') : tr('last: ok')} · {fmtTime(h.last.at)}</span>}
                <Button onClick={() => test(h.id)}>Test</Button>
                <Button variant="danger" onClick={() => removeHook(i)}>Remove</Button>
              </div>
            </div>
            <Field label="Name" value={h.name} placeholder="Kitchen alert" onChange={(v) => setHook(i, { name: v })} />
            <Field label="n8n Webhook URL" value={h.url} placeholder="https://n8n.example.com/webhook/abc123" onChange={(v) => setHook(i, { url: v })} />
            <Field label="Shared secret (optional)" value={h.secret} placeholder="auto-generated if empty"
              onChange={(v) => setHook(i, { secret: v })} hint="Used for the X-LSH-Signature HMAC. Leave the dots to keep the current one." />
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim,#888)', marginBottom: 6 }}>{tr('Events')}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {events.map((ev) => (
                  <label key={ev} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, border: '1px solid var(--border,#333)', borderRadius: 20, padding: '4px 10px', cursor: 'pointer', background: h.events.includes(ev) ? 'rgba(52,199,89,.12)' : 'transparent' }}>
                    <input type="checkbox" checked={h.events.includes(ev)} onChange={() => toggleEvent(i, ev)} />
                    {tr(EVENT_LABEL[ev] || ev)}
                  </label>
                ))}
              </div>
            </div>
          </div>
        ))}
        <Button onClick={addHook}>Add hook</Button>
      </SettingsCard>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '4px 0 20px' }}>
        <Button variant="primary" busy={save.busy} onClick={doSave}>Save</Button>
        <ResultBanner result={save.result} />
      </div>

      <SettingsCard title="Check-in / check-out"
        desc="Record a guest arrival or departure. Each fires hotel.checkin / hotel.checkout so an n8n workflow can run the arrival or departure scene (lights, climate, welcome). Also drivable from your PMS via POST /api/hotel/checkin.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10, alignItems: 'end' }}>
          <Field label="Room" value={checkin.room} placeholder="101" onChange={(v) => setCheckin((s) => ({ ...s, room: v }))} />
          <Field label="Guest (optional)" value={checkin.guest} placeholder="Name" onChange={(v) => setCheckin((s) => ({ ...s, guest: v }))} />
          <Field label="Nights (optional)" type="number" value={checkin.nights} onChange={(v) => setCheckin((s) => ({ ...s, nights: v }))} />
          <Button variant="primary" onClick={doCheckin} disabled={!checkin.room.trim()}>Check in</Button>
        </div>
        {rooms.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim,#888)', marginBottom: 6 }}>{tr('Currently checked in')}</div>
            {rooms.map((r) => (
              <div key={r.room} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 2px', borderBottom: '1px solid var(--border,#2a2a2a)' }}>
                <span><b>{tr('Room')} {r.room}</b>{r.guest ? ' · ' + r.guest : ''}{r.nights ? ' · ' + r.nights + ' ' + tr('nights') : ''}</span>
                <Button onClick={() => doCheckout(r.room)}>Check out</Button>
              </div>
            ))}
          </div>
        )}
      </SettingsCard>
    </>
  )
}
