import { useState } from 'react'
import { SettingsCard, ListEditor, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { RobotVacuumIcon } from '../../Icons'
import { gt } from '../../../i18n'

const FIELDS = [
  { key: 'name', label: 'Name', placeholder: '(optional)' },
  { key: 'host', label: 'Host', placeholder: '192.168.1.x' },
  { key: 'token', label: 'Token', type: 'password', placeholder: '32-char hex token' },
  { key: 'type', label: 'Type', type: 'select', default: 'vacuum',
    options: [{ value: 'vacuum', label: 'Robot Vacuum' }, { value: 'purifier', label: 'Air Purifier' }] },
]

export default function DreameSection({ config, reload }) {
  const [devices, setDevices] = useState(config.dreame?.devices || [])
  const save = useSettingsSave('/api/settings/dreame')
  const test = useSettingsSave('/api/settings/test-dreame')
  const [testingIdx, setTestingIdx] = useState(null)

  const testRow = (row, i) => {
    if (!row.host || !row.token || row.token.includes('•')) return
    setTestingIdx(i)
    test.save({ host: row.host, token: row.token }).finally(() => setTestingIdx(null))
  }

  return (
    <SettingsCard icon={RobotVacuumIcon} title={gt('s.dreame_title', 'Dreame')} badge={{ label: gt('common.optional', 'Optional') }}
      desc={gt('sdesc.d11', 'Connects to Dreame robot vacuums and air purifiers locally via the Mi Home (miio) protocol. Each device needs its local IP and 32-char hex token.')}>
      <ListEditor rows={devices} onChange={setDevices} fields={FIELDS} addLabel={gt('common.add_device', '+ Add Device')}
        renderExtra={(row, i) => (
          <Button variant="secondary" busy={test.busy && testingIdx === i} disabled={!row.host || !row.token || row.token.includes('•')}
            onClick={() => testRow(row, i)}>{gt('common.test', 'Test')}</Button>
        )}/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} onClick={() => save.save(devices).then(reload)}>{gt('common.save_devices', 'Save Devices')}</Button>
        <ResultBanner result={save.result || test.result}/>
      </div>
    </SettingsCard>
  )
}
