import { useEffect, useState } from 'react'
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
      <p className="stg-hint">{tr('TESLA Smart works here too — it is Tuya inside: Wi-Fi plugs, power strips (each socket and the USB block switch separately), and the Zigbee accessories on the TESLA Smart Zigbee Hub (radiator heads, plugs, door, motion, gas and smoke sensors, buttons). Add them in the TESLA Smart or Smart Life app and link that account. Zigbee devices can also pair straight to a USB stick — see Z-Wave & Zigbee USB.')}</p>
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

// TechToy — Tuya inside, set up in the TESLA Smart app. Its own sidebar entry,
// the same Tuya connection underneath (config.tuya); lists what LSH found of it.
export function TechToySection(props) {
  const [devices, setDevices] = useState(null)
  useEffect(() => {
    fetch('/api/tuya/status', { credentials: 'include' }).then((r) => r.json())
      .then((j) => setDevices((j.data || []).filter((d) => d.brand === 'TechToy'))).catch(() => setDevices([]))
  }, [])
  return (
    <>
      <SettingsCard title="TechToy" badge={{ label: gt('common.optional', 'Optional') }}
        desc="TechToy smart bulbs, table lamps, LED strips, Christmas lights and plugs. They are Tuya devices set up in the TESLA Smart app, so LSH reaches them through the Tuya connection below — on the LAN when it can, else the cloud. Add them in the TESLA Smart app, link that app account to the Tuya cloud project and save. TechToy Zigbee bulbs work through the TESLA Smart Zigbee Hub, or pair straight to a USB stick (Z-Wave & Zigbee USB).">
        {devices === null ? null : devices.length === 0
          ? <p className="stg-hint">{tr('No TechToy devices found yet — they appear here once the linked app account has them.')}</p>
          : (
            <div className="stg-mod-list">
              {devices.map((d) => (
                <div key={d.id} className="stg-mod-row">
                  <div className="stg-mod-main">
                    <div className="stg-mod-name">
                      {d.name}
                      <span className={`stg-mod-chip ${d.online ? 'ok' : 'warn'}`}>{d.local ? tr('LAN') : d.online ? tr('cloud') : tr('offline')}</span>
                    </div>
                    <div className="stg-hint stg-mod-meta">{[d.product, d.ip, d.gateway ? tr('via Zigbee hub') : null].filter(Boolean).join(' · ')}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
      </SettingsCard>
      <TuyaSection {...props}/>
    </>
  )
}
