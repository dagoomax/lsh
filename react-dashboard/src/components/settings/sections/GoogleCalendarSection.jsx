import { useEffect, useState } from 'react'
import { SettingsCard, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { BoltIcon } from '../../Icons'

export default function GoogleCalendarSection({ config }) {
  const [clientId, setClientId] = useState(config?.googleCalendar?.clientId || '')
  const [clientSecret, setClientSecret] = useState(config?.googleCalendar?.clientSecret || '')
  const [calendarId, setCalendarId] = useState(config?.googleCalendar?.calendarId || 'primary')
  const [status, setStatus] = useState(null) // { configured, connected } | null
  const save = useSettingsSave('/api/settings/google-calendar')

  useEffect(() => {
    setClientId(config?.googleCalendar?.clientId || '')
    setClientSecret(config?.googleCalendar?.clientSecret || '')
    setCalendarId(config?.googleCalendar?.calendarId || 'primary')
  }, [config])

  useEffect(() => {
    fetch('/api/google-calendar/status', { credentials: 'include' })
      .then(r => r.json()).then(d => setStatus(d.data)).catch(() => {})
  }, [save.result])

  return (
    <SettingsCard icon={BoltIcon} title="Google Calendar" badge={{ label: 'Optional' }}
      desc="Read-only access to one Google Calendar, shown in the Wall Dashboard's agenda alongside locally-added private events and missed calls. Create an OAuth client at console.cloud.google.com (OAuth consent screen + Credentials → OAuth client ID → Web application), add this LSH instance's own address plus /api/google-calendar/oauth/callback as an authorized redirect URI, and paste the client ID/secret below.">
      <Field label="Client ID" value={clientId} onChange={setClientId} placeholder="xxxxx.apps.googleusercontent.com"/>
      <Field label="Client secret" type="password" value={clientSecret} onChange={setClientSecret} placeholder="GOCSPX-…"/>
      <Field label="Calendar ID" value={calendarId} onChange={setCalendarId} placeholder="primary"/>

      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} onClick={() => save.save({ clientId, clientSecret, calendarId })}>
          Save
        </Button>
        <ResultBanner result={save.result}/>
      </div>

      {status?.configured && (
        <div className="stg-actions" style={{ marginTop: 8 }}>
          {status.connected
            ? <span className="stg-hint">✓ Connected</span>
            : <Button variant="primary" href="/api/google-calendar/oauth/start">Connect with Google</Button>}
        </div>
      )}
      {!status?.configured && (
        <p className="stg-hint">Save a client ID and secret, then restart LSH — a "Connect with Google" link will appear here.</p>
      )}
    </SettingsCard>
  )
}
