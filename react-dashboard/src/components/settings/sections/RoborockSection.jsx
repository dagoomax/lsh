import { useState } from 'react'
import { SettingsCard, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { RobotVacuumIcon } from '../../Icons'
import { gt } from '../../../i18n'

// Two entirely independent config keys/endpoints under one card, matching
// the classic page: cloud account (app-paired robots) and a local
// Xiaomi-paired device (miio token) — a household can have either or both.
export default function RoborockSection({ config, reload }) {
  const cloud = config.roborock?.cloud
  const localDevice = (config.roborock?.devices || [])[0]

  const [email, setEmail] = useState(cloud?.email || '')
  const [password, setPassword] = useState(cloud?.password || '')
  const [duid, setDuid] = useState(cloud?.duid || '')
  const testCloud = useSettingsSave('/api/settings/test-roborock-cloud')
  const saveCloud = useSettingsSave('/api/settings/roborock-cloud')

  const [host, setHost] = useState(localDevice?.host || '')
  const [token, setToken] = useState(localDevice?.token || '')
  const testLocal = useSettingsSave('/api/settings/test-roborock')
  const saveLocal = useSettingsSave('/api/settings/roborock')

  return (
    <SettingsCard icon={RobotVacuumIcon} title="Roborock" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Roborock-app vacuums (e.g. Q Revo) connect via the Roborock cloud with your account email + password. Older Xiaomi-paired robots use a local IP + miio token instead.">
      <h4 className="stg-subheading">Cloud account (Q Revo / app devices)</h4>
      <Field label="Roborock Account Email" type="email" value={email} onChange={setEmail}/>
      <Field label="Password" type="password" value={password} onChange={setPassword}/>
      <Field label="Device DUID" hint="(optional — limit to one robot; shown after Test)" value={duid} onChange={setDuid} placeholder="ZXqqO8pTRE1nGvdMt639d"/>
      <div className="stg-actions">
        <Button variant="secondary" busy={testCloud.busy}
          onClick={() => testCloud.save({ email, password }).then(res => {
            const list = (res.data?.devices || []).map(d => `${d.name} (${d.duid})`).join(', ')
            testCloud.setResult({ ok: true, message: `${res.message}${list ? ' — ' + list : ''}` })
          })}>Test Login</Button>
        <Button variant="primary" busy={saveCloud.busy} onClick={() => saveCloud.save({ email, password, duid }).then(reload)}>Save Cloud</Button>
        <ResultBanner result={testCloud.result || saveCloud.result}/>
      </div>

      <h4 className="stg-subheading">Local device (Xiaomi-paired, miio token)</h4>
      <Field label="Device IP" value={host} onChange={setHost} placeholder="192.168.1.50"/>
      <Field label="Token" hint="(32 hex characters)" type="password" value={token} onChange={setToken}/>
      <div className="stg-actions">
        <Button variant="secondary" busy={testLocal.busy} onClick={() => testLocal.save({ host, token })}>Test Device</Button>
        <Button variant="primary" busy={saveLocal.busy}
          onClick={() => saveLocal.save(host ? [{ name: 'Roborock', host, token }] : []).then(reload)}>Save Device</Button>
        <ResultBanner result={testLocal.result || saveLocal.result}/>
      </div>
    </SettingsCard>
  )
}
