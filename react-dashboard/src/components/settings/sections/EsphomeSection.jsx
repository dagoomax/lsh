import { useState } from 'react'
import { SettingsCard, ListEditor, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { ChipIcon } from '../../Icons'
import { gt } from '../../../i18n'

const FIELDS = [
  { key: 'host', label: 'Host', placeholder: '192.168.1.200' },
  { key: 'port', label: 'Port', type: 'number', default: 80, placeholder: '80' },
  { key: 'name', label: 'Name', placeholder: '(optional)' },
  { key: 'password', label: 'Password', type: 'password', placeholder: '(optional)' },
]

export default function EsphomeSection({ config, reload }) {
  const [devices, setDevices] = useState(config.esphome?.devices || [])
  const save = useSettingsSave('/api/settings/esphome')
  const test = useSettingsSave('/api/settings/test-esphome')
  const [testingIdx, setTestingIdx] = useState(null)

  return (
    <SettingsCard icon={ChipIcon} title="ESPHome" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Connects to ESP32/ESP8266 devices running ESPHome with the web_server: component enabled. Sensors, switches, binary sensors, lights, and covers are auto-discovered.">
      <ListEditor rows={devices} onChange={setDevices} fields={FIELDS} addLabel={gt('common.add_device', '+ Add Device')}
        renderExtra={(row, i) => (
          <Button variant="secondary" busy={test.busy && testingIdx === i}
            onClick={() => { setTestingIdx(i); test.save({ host: row.host, port: Number(row.port) || 80, password: row.password }).finally(() => setTestingIdx(null)) }}>
            {gt('common.test', 'Test')}
          </Button>
        )}/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} onClick={() => save.save(devices).then(reload)}>{gt('common.save_devices', 'Save Devices')}</Button>
        <ResultBanner result={save.result || test.result}/>
      </div>
    </SettingsCard>
  )
}
