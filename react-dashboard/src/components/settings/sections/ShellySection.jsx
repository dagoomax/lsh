import { useState } from 'react'
import { SettingsCard, ListEditor, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { PlugIcon } from '../../Icons'
import { gt } from '../../../i18n'

const FIELDS = [
  { key: 'host', label: 'Host', placeholder: '192.168.1.50' },
  { key: 'name', label: 'Name', placeholder: '(optional)' },
  { key: 'username', label: 'User', placeholder: '(optional)' },
  { key: 'password', label: 'Pass', type: 'password', placeholder: '(optional)' },
]

export default function ShellySection({ config, reload }) {
  const [devices, setDevices] = useState(config.shelly?.devices || [])
  const save = useSettingsSave('/api/settings/shelly')
  const test = useSettingsSave('/api/settings/test-shelly')
  const [testingIdx, setTestingIdx] = useState(null)

  return (
    <SettingsCard icon={PlugIcon} title="Shelly" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Shelly smart plugs / switches / relays — Gen1 and Gen2 devices, auto-detected.">
      <ListEditor rows={devices} onChange={setDevices} fields={FIELDS} addLabel="+ Add Shelly Device"
        renderExtra={(row, i) => (
          <Button variant="secondary" busy={test.busy && testingIdx === i}
            onClick={() => { setTestingIdx(i); test.save({ host: row.host, username: row.username, password: row.password }).finally(() => setTestingIdx(null)) }}>
            {gt('common.test', 'Test')}
          </Button>
        )}/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} onClick={() => save.save(devices).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result || test.result}/>
      </div>
    </SettingsCard>
  )
}
