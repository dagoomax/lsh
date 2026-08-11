import { useState } from 'react'
import { SettingsCard, ListEditor, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { KnxBusIcon } from '../../Icons'
import { gt } from '../../../i18n'

const DPTS = ['DPT1', 'DPT5', 'DPT9', 'DPT14']
const HK_TYPES = ['', 'Switch', 'TemperatureSensor', 'HumiditySensor', 'LightSensor', 'OccupancySensor', 'ContactSensor']

const FIELDS = [
  { key: 'address', label: 'Group Address', placeholder: '1/1/1' },
  { key: 'name', label: 'Name' },
  { key: 'dpt', label: 'DPT', type: 'select', default: 'DPT1', options: DPTS.map(d => ({ value: d, label: d })) },
  { key: 'unit', label: 'Unit', placeholder: '(optional)' },
  { key: 'readable', label: 'Readable', type: 'checkbox', default: true },
  { key: 'writable', label: 'Writable', type: 'checkbox' },
  { key: 'homekitType', label: 'HomeKit type', type: 'select', options: HK_TYPES.map(h => ({ value: h, label: h || '(none)' })) },
]

export default function KnxSection({ config, reload }) {
  const [host, setHost] = useState(config.knx?.host || '')
  const [port, setPort] = useState(config.knx?.port || 3671)
  const [gas, setGas] = useState((config.knx?.groupAddresses || []).map(ga => ({ ...ga, readable: ga.readable !== false })))
  const test = useSettingsSave('/api/settings/test-knx')
  const save = useSettingsSave('/api/settings/knx')

  return (
    <SettingsCard icon={KnxBusIcon} title="KNX" badge={{ label: gt('common.optional', 'Optional') }}
      desc={<>Connects to a KNXnet/IP gateway or IP router over TCP/IP. Group addresses are mapped to dashboard device cards with read/write support. Requires <code>npm install knx</code>.</>}>
      <Field label="Gateway Host / IP" value={host} onChange={setHost} placeholder="192.168.1.100"/>
      <Field label="Port" hint="(default 3671)" type="number" value={port} onChange={setPort} style={{ maxWidth: 160 }}/>
      <h4 className="stg-subheading">Group Addresses</h4>
      <ListEditor rows={gas} onChange={setGas} fields={FIELDS} addLabel="+ Add Group Address"/>
      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy} onClick={() => test.save({ host, port: Number(port) })}>{gt('common.test', 'Test Connection')}</Button>
        <Button variant="primary" busy={save.busy} onClick={() => save.save({ host, port: Number(port), groupAddresses: gas }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={test.result || save.result}/>
      </div>
    </SettingsCard>
  )
}
