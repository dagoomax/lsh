import { useState } from 'react'
import { SettingsCard, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { RobotVacuumIcon } from '../../Icons'
import { gt } from '../../../i18n'

const REGIONS = [
  { value: 'eu', label: 'Europe' },
  { value: 'us', label: 'Americas' },
  { value: 'cn', label: 'Asia / China' },
]

export default function KarcherSection({ config, reload }) {
  const cfg = config.karcher || {}
  const [email, setEmail] = useState(cfg.email || '')
  const [password, setPassword] = useState(cfg.password || '')
  const [region, setRegion] = useState(cfg.region || 'eu')
  const [sn, setSn] = useState(cfg.sn || '')
  const test = useSettingsSave('/api/settings/test-karcher')
  const save = useSettingsSave('/api/settings/karcher')

  return (
    <SettingsCard icon={RobotVacuumIcon} title={gt('s.karcher_title', 'Kärcher Home Robots')} badge={{ label: gt('common.optional', 'Optional') }}
      desc={gt('sdesc.karcher', "Kärcher robot vacuums (RCV5, RCV3, RCF5) — cloud-only, same account as the Kärcher Home app. There's no local API for these robots; connects over MQTT via 3iRobotix's cloud, so an outage on their end makes the robot unreachable here too.")}>
      <Field label={gt('s.karcher_email', 'Kärcher Home Account Email')} type="email" value={email} onChange={setEmail}/>
      <Field label={gt('common.password', 'Password')} type="password" value={password} onChange={setPassword}/>
      <Field label={gt('s.karcher_region', 'Region')} type="select" value={region} onChange={setRegion} options={REGIONS}/>
      <Field label={gt('s.karcher_sn', 'Robot Serial Number')} hint="(optional — limit to one robot; shown after Test)" value={sn} onChange={setSn} placeholder="e.g. K2C..."/>
      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy}
          onClick={() => test.save({ email, password, region }).then(res => {
            const list = (res.data?.devices || []).map(d => `${d.nickname} (${d.model})`).join(', ')
            test.setResult({ ok: true, message: `${res.message}${list ? ' — ' + list : ''}` })
          })}>{gt('common.test_login', 'Test Login')}</Button>
        <Button variant="primary" busy={save.busy}
          onClick={() => save.save({ email, password, region, sn }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={test.result || save.result}/>
      </div>
    </SettingsCard>
  )
}
