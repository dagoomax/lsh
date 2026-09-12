import { useState } from 'react'
import { SettingsCard, ListEditor, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { LockIcon } from '../../Icons'
import { gt } from '../../../i18n'

const FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'host', label: 'Bridge Host / IP', placeholder: '192.168.1.x' },
  { key: 'apiToken', label: 'API Token', type: 'password' },
  { key: 'pollInterval', label: 'Poll Interval', type: 'number', default: 5, placeholder: '5' },
]

export default function TedeeSection({ config, reload }) {
  const [devices, setDevices] = useState(config.tedee?.devices || [])
  const save = useSettingsSave('/api/settings/tedee')
  const test = useSettingsSave('/api/settings/test-tedee')
  const [testingIdx, setTestingIdx] = useState(null)

  return (
    <SettingsCard icon={LockIcon} title="Tedee Smart Lock" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Controls Tedee smart locks through a Tedee Bridge's local REST API — no cloud round-trip for lock control. Enable it in the Tedee app first (select the Bridge → Settings → API → toggle on), which is also where the API token is shown.">
      <ListEditor rows={devices} onChange={setDevices} fields={FIELDS} addLabel="+ Add Bridge"
        renderExtra={(row, i) => (
          <Button variant="secondary" busy={test.busy && testingIdx === i}
            onClick={() => { setTestingIdx(i); test.save({ host: row.host, apiToken: row.apiToken }).finally(() => setTestingIdx(null)) }}>
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
