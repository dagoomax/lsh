import { useState } from 'react'
import { SettingsCard, Field, ListEditor, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { PlugIcon } from '../../Icons'
import { gt, tr } from '../../../i18n'

const MODES = [
  { value: 'auto', label: 'Auto — LAN first, cloud fallback' },
  { value: 'cloud', label: 'Cloud only' },
  { value: 'local', label: 'Local only (LAN / DIY mode)' },
]
const REGIONS = [
  { value: 'eu', label: 'Europe' }, { value: 'us', label: 'Americas' },
  { value: 'as', label: 'Asia' }, { value: 'cn', label: 'China' },
]
const FIELDS = [
  { key: 'name', label: 'Name', placeholder: '(optional)' },
  { key: 'id', label: 'Device ID', placeholder: '1000abcdef' },
  { key: 'devicekey', label: 'Device Key', type: 'password', placeholder: '(empty for DIY mode)' },
  { key: 'host', label: 'IP', placeholder: '(auto-discovered)' },
]

export default function SonoffSection({ config, reload }) {
  const cfg = config.sonoff || {}
  const [mode, setMode] = useState(cfg.mode || 'auto')
  const [region, setRegion] = useState(cfg.region || 'eu')
  const [email, setEmail] = useState(cfg.email || cfg.phoneNumber || '')
  const [password, setPassword] = useState(cfg.password || '')
  const [countryCode, setCountryCode] = useState(cfg.countryCode || '+48')
  const [appId, setAppId] = useState(cfg.appId || '')
  const [appSecret, setAppSecret] = useState(cfg.appSecret || '')
  const [devices, setDevices] = useState(cfg.devices || [])
  const test = useSettingsSave('/api/settings/test-sonoff')
  const save = useSettingsSave('/api/settings/sonoff')
  const cloud = mode !== 'local'
  const body = () => ({ mode, region, email, ...(email.includes('@') ? {} : { phoneNumber: email }), password, countryCode, appId, appSecret })

  return (
    <SettingsCard icon={PlugIcon} title={gt('s.sonoff_title', 'Sonoff / eWeLink')} badge={{ label: gt('common.optional', 'Optional') }}
      desc={tr('Sonoff relays, plugs, dimmers, bulbs, TH sensors, curtain motors and Zigbee sensors. The eWeLink account lists every device with its device key; Auto then switches devices found on the LAN directly and uses the cloud for the rest. The cloud API needs an App ID and Secret from dev.ewelink.cc. Devices in DIY mode work locally with no account.')}>
      <Field label="Connection" type="select" value={mode} onChange={setMode} options={MODES}/>
      {cloud && <>
        <Field label="Account Region" type="select" value={region} onChange={setRegion} options={REGIONS}/>
        <Field label="eWeLink Email or Phone" value={email} onChange={setEmail} autoComplete="username"/>
        <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password"/>
        <Field label="Country Code" value={countryCode} onChange={setCountryCode} placeholder="+48"/>
        <Field label="App ID" hint="(dev.ewelink.cc)" value={appId} onChange={setAppId}/>
        <Field label="App Secret" type="password" value={appSecret} onChange={setAppSecret}/>
      </>}
      <div className="stg-field"><label>{tr('Local devices')}<span className="stg-hint"> {cloud ? tr('(optional — overrides, or DIY-mode devices)') : tr('(ID; device key unless in DIY mode)')}</span></label></div>
      <ListEditor rows={devices} onChange={setDevices} fields={FIELDS} addLabel="+ Add Sonoff Device"/>
      <div className="stg-actions">
        {cloud && <Button variant="secondary" busy={test.busy} disabled={!appId || !email}
          onClick={() => test.save(body()).then(res => {
            const list = (res.data?.devices || []).map(d => `${d.name}${d.online ? '' : ' (offline)'}`).join(', ')
            test.setResult({ ok: true, message: `${res.message}${list ? ' — ' + list : ''}` })
          }).catch(() => {})}>{gt('common.test_login', 'Test Login')}</Button>}
        <Button variant="primary" busy={save.busy}
          onClick={() => save.save({ ...body(), devices }).then(reload).catch(() => {})}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={test.result || save.result}/>
      </div>
    </SettingsCard>
  )
}
