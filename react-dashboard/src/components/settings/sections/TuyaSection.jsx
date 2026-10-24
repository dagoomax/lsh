import { useState } from 'react'
import { SettingsCard, Field, ListEditor, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { SwitchOutletIcon } from '../../Icons'
import { gt, tr } from '../../../i18n'

const MODES = [
  { value: 'auto', label: 'Auto — local first, cloud fallback' },
  { value: 'cloud', label: 'Cloud only' },
  { value: 'local', label: 'Local only (LAN)' },
]
const REGIONS = [
  { value: 'eu', label: 'Central Europe' }, { value: 'eu-w', label: 'Western Europe' },
  { value: 'us', label: 'Western America' }, { value: 'us-e', label: 'Eastern America' },
  { value: 'cn', label: 'China' }, { value: 'in', label: 'India' },
]
const FIELDS = [
  { key: 'name', label: 'Name', placeholder: '(optional)' },
  { key: 'id', label: 'Device ID' },
  { key: 'key', label: 'Local Key', type: 'password' },
  { key: 'ip', label: 'IP', placeholder: '(auto-discovered)' },
  { key: 'version', label: 'Protocol', placeholder: '(auto) 3.3' },
]

export default function TuyaSection({ config, reload }) {
  const cfg = config.tuya || {}
  const [mode, setMode] = useState(cfg.mode || 'auto')
  const [region, setRegion] = useState(cfg.region || 'eu')
  const [accessId, setAccessId] = useState(cfg.accessId || '')
  const [accessSecret, setAccessSecret] = useState(cfg.accessSecret || '')
  const [uid, setUid] = useState(cfg.uid || '')
  const [devices, setDevices] = useState(cfg.devices || [])
  const test = useSettingsSave('/api/settings/test-tuya')
  const save = useSettingsSave('/api/settings/tuya')
  const cloud = mode !== 'local'

  return (
    <SettingsCard icon={SwitchOutletIcon} title={gt('s.tuya_title', 'Tuya / Smart Life')} badge={{ label: gt('common.optional', 'Optional') }}
      desc={tr('Tuya and Smart Life plugs, switches, bulbs, LED strips, curtain motors and sensors. The cloud project (iot.tuya.com → Cloud → your project, with the Smart Life app account linked) lists every device and its local key; Auto then talks to each device on the LAN and falls back to the cloud. Local-only devices need their ID and local key below.')}>
      <Field label="Connection" type="select" value={mode} onChange={setMode} options={MODES}/>
      {cloud && <>
        <Field label="Data Centre" type="select" value={region} onChange={setRegion} options={REGIONS}/>
        <Field label="Access ID / Client ID" value={accessId} onChange={setAccessId}/>
        <Field label="Access Secret / Client Secret" type="password" value={accessSecret} onChange={setAccessSecret}/>
        <Field label="App account UID" hint="(optional — default: every linked account)" value={uid} onChange={setUid}/>
      </>}
      <div className="stg-field"><label>{tr('Local devices')}<span className="stg-hint"> {cloud ? tr('(optional — overrides, or devices not on the cloud project)') : tr('(ID + local key; IP is found on the LAN)')}</span></label></div>
      <ListEditor rows={devices} onChange={setDevices} fields={FIELDS} addLabel="+ Add Tuya Device"/>
      <div className="stg-actions">
        {cloud && <Button variant="secondary" busy={test.busy} disabled={!accessId}
          onClick={() => test.save({ accessId, accessSecret, region, uid }).then(res => {
            const list = (res.data?.devices || []).map(d => `${d.name}${d.online ? '' : ' (offline)'}`).join(', ')
            test.setResult({ ok: true, message: `${res.message}${list ? ' — ' + list : ''}` })
          }).catch(() => {})}>{gt('common.test_login', 'Test Login')}</Button>}
        <Button variant="primary" busy={save.busy}
          onClick={() => save.save({ mode, region, accessId, accessSecret, uid, devices }).then(reload).catch(() => {})}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={test.result || save.result}/>
      </div>
    </SettingsCard>
  )
}
