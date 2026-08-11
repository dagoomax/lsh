import { useState } from 'react'
import { SettingsCard, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { BulbIcon } from '../../Icons'
import { gt } from '../../../i18n'

export default function LightingSection({ config, reload }) {
  return (
    <>
      <DirigeraCard dirigera={config.dirigera} reload={reload}/>
      <TradfriCard tradfri={config.tradfri} reload={reload}/>
    </>
  )
}

function DirigeraCard({ dirigera, reload }) {
  const [host, setHost] = useState(dirigera?.host || '')
  const [token, setToken] = useState(dirigera?.token || '')
  const test = useSettingsSave('/api/settings/test-dirigera')
  const save = useSettingsSave('/api/settings/dirigera')

  return (
    <SettingsCard icon={BulbIcon} title={gt('s.dirigera_title', 'IKEA Dirigera')} badge={{ label: gt('common.optional', 'Optional') }}
      desc={<>Connects to an IKEA Dirigera hub (2022+). Requires a bearer token obtained once via <code>node scripts/dirigera-auth.js &lt;hub-ip&gt;</code>.</>}>
      <Field label={gt('s.dirigera_host', 'Hub Host / IP')} value={host} onChange={setHost} placeholder="192.168.x.x"/>
      <Field label={gt('s.dirigera_token', 'Bearer Token')} hint={gt('s.dirigera_token_hint', '(from dirigera-auth.js)')} type="password" value={token} onChange={setToken}/>
      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy} onClick={() => test.save({ host, token })}>{gt('common.test', 'Test Connection')}</Button>
        <Button variant="primary" busy={save.busy} onClick={() => save.save({ host, token }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={test.result || save.result}/>
      </div>
    </SettingsCard>
  )
}

function TradfriCard({ tradfri, reload }) {
  const [host, setHost] = useState(tradfri?.host || '')
  const [securityCode, setSecurityCode] = useState('')
  const [identity, setIdentity] = useState(tradfri?.identity || '')
  const [psk, setPsk] = useState(tradfri?.psk || '')
  const save = useSettingsSave('/api/settings/tradfri')

  return (
    <SettingsCard icon={BulbIcon} title={gt('s.tradfri_title', 'IKEA Tradfri')} badge={{ label: gt('common.optional', 'Optional') }}
      desc="Connects to an older IKEA Tradfri gateway via CoAP/DTLS. First run: enter the security code from the gateway sticker. Subsequent runs: leave the code blank and fill in identity + PSK.">
      <Field label={gt('s.tradfri_host', 'Gateway Host / IP')} value={host} onChange={setHost} placeholder="192.168.x.x"/>
      <Field label={gt('s.tradfri_code', 'Security Code')} hint={gt('s.tradfri_code_hint', '(sticker on gateway — first run only)')} type="password" value={securityCode} onChange={setSecurityCode} placeholder="XXXX-XXXX-XXXX"/>
      <Field label={gt('s.tradfri_identity', 'Identity')} hint={gt('s.tradfri_identity_hint', '(generated on first run)')} value={identity} onChange={setIdentity} placeholder="lsh-xxxxxxxx"/>
      <Field label={gt('s.tradfri_psk', 'PSK')} hint={gt('s.tradfri_psk_hint', '(generated on first run)')} type="password" value={psk} onChange={setPsk}/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} onClick={() => save.save({ host, securityCode, identity, psk }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}
