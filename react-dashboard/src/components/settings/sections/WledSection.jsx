import { useState } from 'react'
import { SettingsCard, ListEditor, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { LedStripIcon } from '../../Icons'
import { gt } from '../../../i18n'

const FIELDS = [
  { key: 'name', label: 'Name', placeholder: '(optional)' },
  { key: 'host', label: 'Host / IP', placeholder: '192.168.1.80' },
  { key: 'port', label: 'Port', type: 'number', placeholder: '80', default: 80 },
]

export default function WledSection({ config, reload }) {
  const [devices, setDevices] = useState(config.wled?.devices || [])
  const [pollInterval, setPollInterval] = useState(config.wled?.pollInterval ?? 5)
  const save = useSettingsSave('/api/settings/wled')
  const test = useSettingsSave('/api/settings/test-wled')
  const [testingIdx, setTestingIdx] = useState(null)

  return (
    <SettingsCard icon={LedStripIcon} title="WLED" badge={{ label: gt('common.optional', 'Optional') }}
      desc="WLED addressable-LED controllers (ESP8266 / ESP32) via the local JSON API — power, brightness and RGB(W) colour.">
      <ListEditor rows={devices} onChange={setDevices} fields={FIELDS} addLabel="+ Add controller"
        renderExtra={(row, i) => (
          <Button variant="secondary" busy={test.busy && testingIdx === i}
            onClick={() => { setTestingIdx(i); test.save({ host: row.host, port: Number(row.port) || 80 }).finally(() => setTestingIdx(null)) }}>
            {gt('common.test', 'Test')}
          </Button>
        )}/>
      <Field label="Poll interval" hint="(seconds)" type="number" value={pollInterval} onChange={setPollInterval} placeholder="5" style={{ maxWidth: 160 }}/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy}
          onClick={() => save.save({ devices, pollInterval: Number(pollInterval) }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result || test.result}/>
      </div>
    </SettingsCard>
  )
}
