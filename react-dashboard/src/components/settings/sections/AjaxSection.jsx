import { useEffect, useState } from 'react'
import { SettingsCard, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { gt, tr } from '../../../i18n'

const NEW_ACCOUNT = { account: '', name: '', key: '', pingMinutes: 1, zonesText: '' }
const zonesToText = (z) => Object.entries(z || {}).map(([n, name]) => `${n}=${name}`).join('\n')

// Ajax Systems Hub reporting to LSH over SIA DC-09 (LSH = monitoring
// station). Server: src/ajax-client.js (own process), src/routes/ajax.js.
export default function AjaxSection({ config, reload }) {
  const a = config.ajax || {}
  const [port, setPort] = useState(a.port || 12128)
  const [accounts, setAccounts] = useState((a.accounts || []).map((x) => ({ ...NEW_ACCOUNT, ...x, zonesText: zonesToText(x.zones) })))
  const [status, setStatus] = useState([])
  const save = useSettingsSave('/api/settings/ajax')

  const load = () => fetch('/api/ajax/status', { credentials: 'include' }).then((r) => r.json()).then((j) => setStatus(j.data || [])).catch(() => {})
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t) }, [])
  const setAcc = (i, patch) => setAccounts((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const st = (acc) => status.find((s) => String(s.account).toUpperCase() === String(acc).toUpperCase())

  return (
    <SettingsCard title="Ajax" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Ajax Systems alarm (Hub, Hub Plus, Hub 2, Hub Hybrid). LSH acts as the monitoring station the Hub reports to over SIA DC-09, on your network — no Ajax cloud. In the Ajax app: Hub → Settings → Monitoring Station → SIA DC-09, enter this computer's IP and the port below, the same object number (account), and optionally an encryption key. LSH then knows when the system is armed or disarmed and about intrusion, fire, flood, gas, panic, tamper and power alarms, for flows and notifications. It can't arm or disarm the system — Ajax only allows that to its certified partners.">
      <Field label="Listen on port" hint="(TCP and UDP)" type="number" value={port} onChange={setPort}/>
      {accounts.map((x, i) => {
        const s = st(x.account)
        return (
          <div key={i} className="stg-list-row" style={{ display: 'block' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0 12px' }}>
              <Field label="Account (object number)" value={x.account} onChange={(v) => setAcc(i, { account: v })} placeholder="A1B2"/>
              <Field label="Name" value={x.name} onChange={(v) => setAcc(i, { name: v })} placeholder="Home"/>
              <Field label="Encryption key" hint="(16, 24 or 32 characters, as in the Ajax app)" type="password" value={x.key || ''} onChange={(v) => setAcc(i, { key: v })}/>
              <Field label="Ping interval" hint="(min)" type="number" value={x.pingMinutes} onChange={(v) => setAcc(i, { pingMinutes: v })}/>
            </div>
            <Field label="Zone names" hint="(one per line: number=name)" type="textarea" value={x.zonesText} onChange={(v) => setAcc(i, { zonesText: v })}
              placeholder="5=Kitchen leak sensor"/>
            {s && <p className="stg-hint" style={{ color: s.online ? 'var(--green)' : 'inherit' }}>
              {s.online ? `● ${tr('connected')}` : `○ ${tr('no messages yet')}`}{s.mode ? ` · ${s.mode}` : ''}{s.lastEvent ? ` · ${s.lastEvent}` : ''}
            </p>}
            <div className="stg-actions">
              <Button variant="secondary" onClick={() => setAccounts((l) => l.filter((_, j) => j !== i))}>{tr('Remove')}</Button>
            </div>
          </div>
        )
      })}
      <button className="stg-list-add" onClick={() => setAccounts((l) => [...l, { ...NEW_ACCOUNT }])}>+ {tr('Add Hub')}</button>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} onClick={() => save.save({ port, accounts }).then(() => { reload?.(); setTimeout(load, 2000) }).catch(() => {})}>
          {gt('common.save', 'Save')}
        </Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}
