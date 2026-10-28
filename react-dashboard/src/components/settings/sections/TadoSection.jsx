import { useEffect, useState } from 'react'
import { SettingsCard, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { gt, tr, trn } from '../../../i18n'

// tado° — sign-in through tado's device-code page (src/routes/tado.js) and the
// client's options (src/routes/integration-settings.js, id "tado").
const OVERLAYS = [
  { value: 'next', label: 'Until the next schedule block' },
  { value: 'manual', label: 'Until changed again' },
  { value: '60', label: '1 hour' },
  { value: '180', label: '3 hours' },
]

export default function TadoSection({ config, reload }) {
  const saved = config.tado || {}
  const [pollInterval, setPoll] = useState(saved.pollInterval || '')
  const [dailyLimit, setLimit] = useState(saved.dailyLimit ?? '')
  const [overlay, setOverlay] = useState(saved.overlay != null ? String(saved.overlay) : 'next')
  const [auth, setAuth] = useState(null)
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const save = useSettingsSave('/api/settings/integration/tado')

  const loadAuth = () => fetch('/api/tado/auth', { credentials: 'include', cache: 'no-store' }).then(r => r.json()).then(j => j.success && setAuth(j.data)).catch(() => {})
  const loadStatus = () => fetch('/api/integration/tado/status', { credentials: 'include', cache: 'no-store' }).then(r => r.json()).then(j => j.success && setStatus(j.data)).catch(() => {})
  useEffect(() => { loadAuth(); loadStatus() }, [])

  // while a sign-in waits for confirmation on tado's page
  const pending = auth?.flow?.state === 'pending'
  useEffect(() => {
    if (!pending) return
    const t = setInterval(() => loadAuth().then(() => loadStatus()), 3000)
    return () => clearInterval(t)
  }, [pending])
  useEffect(() => { if (auth?.flow?.state === 'done') reload?.() }, [auth?.flow?.state])

  const post = (url) => {
    setBusy(true); setResult(null)
    return fetch(url, { method: 'POST', credentials: 'include' }).then(r => r.json())
      .then(j => { if (!j.success || j.message) setResult({ ok: !!j.success, message: j.message || j.error }); return loadAuth().then(loadStatus) })
      .catch(err => setResult({ ok: false, message: err.message }))
      .finally(() => setBusy(false))
  }

  const doSave = () => save.save({ config: { enabled: !!auth?.signedIn, pollInterval: pollInterval || 0, dailyLimit: dailyLimit || 100, overlay } }).then(() => { loadStatus(); reload?.() }).catch(() => {})
  const flow = auth?.flow

  return (
    <SettingsCard title="tado°" badge={{ label: gt('common.optional', 'Optional') }}
      desc="tado° smart thermostats, radiator valves, hot water and Smart AC Control (V3+ and earlier; tado X is not covered yet). Every zone becomes a device — set temperature, room temperature, humidity, heating power, open window, low battery, resume schedule — and a HomeKit thermostat; the home gets presence (home / away) with an away switch. tado allows 100 API calls a day without an Auto-Assist subscription, so LSH reads every ~20 minutes unless you set the interval; with Auto-Assist raise the daily limit to 20000.">
      <h4 className="stg-subheading">{tr('Account')}</h4>
      <p className="stg-hint">
        {auth?.signedIn ? tr('Signed in to tado since {since}', { since: auth.since ? new Date(auth.since).toLocaleString() : '—' }) : tr('Not signed in')}
      </p>
      {pending && (
        <div className="stg-hint" style={{ margin: '8px 0', lineHeight: 1.6 }}>
          {tr('Open this tado page, sign in and confirm the code {code}:', { code: flow.userCode })}<br/>
          <a href={flow.url} target="_blank" rel="noreferrer" style={{ wordBreak: 'break-all' }}>{flow.url}</a><br/>
          {tr('Waiting for confirmation…')}
        </div>
      )}
      {flow?.state === 'error' && <ResultBanner result={{ ok: false, message: flow.error }}/>}
      {flow?.state === 'done' && <ResultBanner result={{ ok: true, message: 'Signed in — tado is starting.' }}/>}
      <div className="stg-actions">
        <Button variant="primary" busy={busy && !auth?.signedIn} onClick={() => post('/api/tado/auth/start')}>{auth?.signedIn ? tr('Sign in again') : tr('Sign in to tado')}</Button>
        {auth?.signedIn && <Button variant="secondary" busy={busy} onClick={() => post('/api/tado/auth/logout')}>{tr('Sign out')}</Button>}
        <ResultBanner result={result}/>
      </div>

      <h4 className="stg-subheading">{tr('Options')}</h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0 12px' }}>
        <Field label="Poll interval" hint="(seconds, empty = within the API limit)" type="number" value={pollInterval} onChange={setPoll} placeholder="auto"/>
        <Field label="API calls a day" hint="(100, or 20000 with Auto-Assist)" type="number" value={dailyLimit} onChange={setLimit} placeholder="100"/>
        <Field label="A change made in LSH lasts" type="select" value={overlay} onChange={setOverlay} options={OVERLAYS}/>
      </div>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} onClick={doSave}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result}/>
      </div>
      {status && (
        <div className="stg-hint">
          {status.connected ? '● ' : '○ '}
          {status.connected ? tr('Connected') : status.running ? tr('Not connected yet') : tr('Not running')}
          {' · '}{trn('{n} device|{n} devices', status.devices.length)}
          {status.devices.length > 0 && ` — ${status.devices.map((d) => d.label).join(', ')}`}
        </div>
      )}
    </SettingsCard>
  )
}
