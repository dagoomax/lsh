import { useState } from 'react'
import { SettingsCard, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { RobotVacuumIcon } from '../../Icons'
import { gt } from '../../../i18n'

export default function EcovacsSection({ config, reload }) {
  const cfg = config.ecovacs || {}
  const [email, setEmail] = useState(cfg.email || '')
  const [password, setPassword] = useState(cfg.password || '')
  const [country, setCountry] = useState(cfg.country || 'PL')
  const [did, setDid] = useState(cfg.did || '')
  const test = useSettingsSave('/api/settings/test-ecovacs')
  const save = useSettingsSave('/api/settings/ecovacs')

  return (
    <SettingsCard icon={RobotVacuumIcon} title={gt('s.ecovacs_title', 'Ecovacs Deebot')} badge={{ label: gt('common.optional', 'Optional') }}
      desc={gt('sdesc.ecovacs', 'Ecovacs Deebot and yeedi robot vacuums — cloud-only, same account as the Ecovacs Home app. Battery, status and errors, plus start cleaning and send to dock.')}>
      <Field label={gt('s.ecovacs_email', 'Ecovacs Account Email')} type="email" value={email} onChange={setEmail}/>
      <Field label={gt('common.password', 'Password')} type="password" value={password} onChange={setPassword}/>
      <Field label={gt('s.ecovacs_country', 'Account Country')} hint="(two-letter code, e.g. PL, DE, US)" value={country} onChange={setCountry} placeholder="PL"/>
      <Field label={gt('s.ecovacs_did', 'Robot ID')} hint="(optional — limit to one robot; shown after Test)" value={did} onChange={setDid}/>
      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy}
          onClick={() => test.save({ email, password, country }).then(res => {
            const list = (res.data?.devices || []).map(d => `${d.name} (${d.model}, ${d.did})`).join(', ')
            test.setResult({ ok: true, message: `${res.message}${list ? ' — ' + list : ''}` })
          })}>{gt('common.test_login', 'Test Login')}</Button>
        <Button variant="primary" busy={save.busy}
          onClick={() => save.save({ email, password, country, did }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={test.result || save.result}/>
      </div>
    </SettingsCard>
  )
}
