import { useEffect, useState } from 'react'
import { SettingsCard, ListEditor, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { gt, tr } from '../../../i18n'

const listingFields = (placeholder) => [
  { key: 'name', label: 'Name', placeholder: 'Apartment' },
  { key: 'ical', label: 'Calendar export link (iCal)', type: 'password', placeholder },
  { key: 'checkIn', label: 'Check-in', placeholder: '15:00', default: '15:00' },
  { key: 'checkOut', label: 'Check-out', placeholder: '11:00', default: '11:00' },
  { key: 'prepareHours', label: 'Prepare (h before arrival)', type: 'number', default: 3 },
]

const AIRBNB_FIELDS = listingFields('https://www.airbnb.com/calendar/ical/….ics?s=…')
const VRBO_FIELDS = listingFields('https://www.vrbo.com/icalendar/….ics?nonTentative')
const BOOKING_FIELDS = [
  ...listingFields('https://ical.booking.com/v1/export?t=…'),
  { key: 'closedAsStays', label: 'Closed dates are stays', type: 'checkbox', default: true },
]


// Airbnb, Booking.com and VRBO reservations from each listing's calendar
// export link. Server: src/airbnb-client.js / booking-client.js / vrbo-client.js
// (each in its own process), src/routes/airbnb.js.
export default function AirbnbSection(props) {
  return <RentalSection {...props} id="airbnb" title="Airbnb" 
    desc="Reservations of your rental listings, read from each listing's calendar export link — in Airbnb: Calendar → Availability → Connect calendars → Export calendar (Booking.com and VRBO export links work too). Every listing becomes a device whose states change at your check-in and check-out times: Occupied, Guest arriving soon, Check-in today, Check-out today, Turnover day — use them in flows to heat or cool before a guest arrives, or to switch to an eco scene after check-out. Airbnb shares only dates, the reservation code and the last 4 digits of the guest's phone. Treat the link like a password." fields={AIRBNB_FIELDS}/>
}

export function BookingSection(props) {
  return <RentalSection {...props} id="booking" title="Booking.com" 
    desc="Reservations of your Booking.com properties, read from the calendar export link — in the Extranet: Rates & Availability → Sync calendars → Export calendar. Every property becomes a device whose states change at your check-in and check-out times: Occupied, Guest arriving soon, Check-in today, Check-out today, Turnover day — use them in flows. Booking.com exports every unavailable night as “CLOSED - Not available”, so a reservation and a date you closed yourself look the same and there are no guest details; with “Closed dates are stays” on, every closed period counts as a stay. Treat the link like a password." fields={BOOKING_FIELDS}/>
}

export function VrboSection(props) {
  return <RentalSection {...props} id="vrbo" title="VRBO" fields={VRBO_FIELDS}
    desc="Reservations of your VRBO properties, read from the calendar export link — in VRBO: Calendar → Import/Export → Export calendar. Every property becomes a device whose states change at your check-in and check-out times: Occupied, Guest arriving soon, Check-in today, Check-out today, Turnover day — use them in flows. VRBO marks stays “Reserved - guest name” and your own blocks “Blocked”, which don't count as stays. Treat the link like a password."/>
}

function RentalSection({ config, reload, id, title, desc, fields }) {
  const a = config[id] || {}
  const [listings, setListings] = useState(a.listings || [])
  const [pollMinutes, setPoll] = useState(a.pollMinutes || 30)
  const [status, setStatus] = useState([])
  const save = useSettingsSave(`/api/settings/${id}`)
  const test = useSettingsSave(`/api/${id}/test`)

  const load = () => fetch(`/api/${id}/status`, { credentials: 'include' })
    .then((r) => r.json()).then((j) => setStatus(j.data || [])).catch(() => {})
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [id])

  const runTest = async () => {
    const l = listings.find((x) => x.ical?.trim())
    if (!l) { test.setResult({ ok: false, message: tr('Add a calendar link first') }); return }
    await test.save(l).catch(() => {})
  }
  const doSave = () => save.save({ listings, pollMinutes })
    .then(() => { setTimeout(load, 3000); reload?.() }).catch(() => {})

  const yes = (v) => (v ? '●' : '○')
  return (
    <SettingsCard title={title} badge={{ label: gt('common.optional', 'Optional') }} desc={desc}>
      <ListEditor rows={listings} onChange={setListings} fields={fields} addLabel="Add listing"/>
      <Field label="Refresh calendar every" hint="(min)" type="number" value={pollMinutes} onChange={setPoll}/>

      {status.length > 0 && <>
        <h4 className="stg-subheading">{tr('Reservations')}</h4>
        <div style={{ overflowX: 'auto' }}>
          <table className="stg-table" style={{ width: '100%', fontSize: 12.5 }}>
            <thead><tr>
              <th>{tr('Listing')}</th><th>{tr('Occupied')}</th><th>{tr('Guest')}</th><th>{tr('Next check-in')}</th>
              <th>{tr('Next check-out')}</th><th>{tr('Occupancy (30 d)')}</th>
            </tr></thead>
            <tbody>
              {status.map((s) => (
                <tr key={s.key}>
                  <td>{s.name || s.key}</td>
                  <td style={{ color: s.occupied ? 'var(--green)' : 'inherit' }}>{s.occupied == null ? '—' : yes(s.occupied)}</td>
                  <td>{s.guest || s.nextGuest || '—'}</td>
                  <td style={{ color: s.prepare ? 'var(--orange, #f39c12)' : 'inherit' }}>{s.nextCheckIn ?? '—'}</td>
                  <td>{s.nextCheckOut ?? '—'}</td>
                  <td>{s.occupancy30 != null ? `${s.occupancy30}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}

      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy} onClick={runTest}>{tr('Test calendar link')}</Button>
        <Button variant="primary" busy={save.busy} onClick={doSave}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result || test.result}/>
      </div>
    </SettingsCard>
  )
}
