import { useState } from 'react'
import { SettingsCard, ListEditor, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { LockIcon } from '../../Icons'
import { gt, tr } from '../../../i18n'

const FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'host', label: 'Bridge IP', placeholder: '192.168.1.x' },
  { key: 'port', label: 'Port', type: 'number', default: 8080, placeholder: '8080' },
  { key: 'token', label: 'Bridge token', type: 'password' },
]

// Nuki smart locks and Opener — local Bridge API and/or Nuki Web (needed for
// keypad codes). Server: src/nuki-client.js (own process), src/routes/nuki.js.
export default function NukiSection({ config, reload }) {
  const n = config.nuki || {}
  const [bridges, setBridges] = useState(n.bridges || [])
  const [webToken, setWebToken] = useState(n.webToken || '')
  const [pollSeconds, setPoll] = useState(n.pollSeconds || 15)
  const save = useSettingsSave('/api/settings/nuki')
  const test = useSettingsSave('/api/settings/test-nuki')
  const [testing, setTesting] = useState(null)

  const run = (key, body) => { setTesting(key); test.save(body).catch(() => {}).finally(() => setTesting(null)) }

  return (
    <SettingsCard icon={LockIcon} title="Nuki" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Nuki Smart Lock (1.0–4.0, Smart Door) and Nuki Opener. Locally through a Nuki Bridge — turn on Developer mode in the Nuki app (Bridge → Manage Bridge), which also shows the token — and/or through Nuki Web with an API token from web.nuki.io (Menu → API). Nuki Web is needed for keypad codes: with it, the guest portal creates each stay's PIN as a keypad code valid only during the stay.">
      <h4 className="stg-subheading">{tr('Bridges')}</h4>
      <ListEditor rows={bridges} onChange={setBridges} fields={FIELDS} addLabel="Add Bridge"
        renderExtra={(row, i) => (
          <Button variant="secondary" busy={testing === `b${i}`}
            onClick={() => run(`b${i}`, { host: row.host, port: row.port, token: row.token, index: i })}>
            {gt('common.test', 'Test')}
          </Button>
        )}/>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 12px' }}>
        <Field label="Nuki Web API token" hint="(for keypad codes, or without a Bridge)" type="password" value={webToken} onChange={setWebToken}/>
        <Field label="Poll every" hint="(s)" type="number" value={pollSeconds} onChange={setPoll}/>
      </div>
      <div className="stg-actions">
        <Button variant="secondary" busy={testing === 'web'} onClick={() => run('web', { webToken })}>{tr('Test Nuki Web')}</Button>
        <Button variant="primary" busy={save.busy} onClick={() => save.save({ bridges, webToken, pollSeconds }).then(reload).catch(() => {})}>
          {gt('common.save', 'Save')}
        </Button>
        <ResultBanner result={save.result || test.result}/>
      </div>
    </SettingsCard>
  )
}
