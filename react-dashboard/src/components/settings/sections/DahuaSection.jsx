import { useState } from 'react'
import { SettingsCard, ListEditor, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { CameraIcon } from '../../Icons'
import { gt, tr } from '../../../i18n'

const FIELDS = [
  { key: 'name', label: 'Name', placeholder: '(optional)' },
  { key: 'host', label: 'Host / IP', placeholder: '192.168.1.108' },
  { key: 'username', label: 'Username', placeholder: 'admin', default: 'admin' },
  { key: 'password', label: 'Password', type: 'password' },
  { key: 'port', label: 'Port', type: 'number', placeholder: '80' },
  { key: 'https', label: 'HTTPS', type: 'checkbox' },
  { key: 'rtspPort', label: 'RTSP Port', type: 'number', placeholder: '554', default: 554 },
  { key: 'stream', label: 'Stream', type: 'select', default: 'main',
    options: [{ value: 'main', label: 'Main (full resolution)' }, { value: 'sub', label: 'Sub (low resolution)' }] },
  { key: 'events', label: 'Motion & AI events', type: 'checkbox', default: true },
]

export default function DahuaSection({ config, reload }) {
  const [devices, setDevices] = useState(config.dahua?.devices || [])
  const save = useSettingsSave('/api/settings/dahua')
  const test = useSettingsSave('/api/settings/test-dahua')
  const [testingIdx, setTestingIdx] = useState(null)

  return (
    <SettingsCard icon={CameraIcon} title={gt('s.dahua_title', 'Dahua NVR & Cameras')} badge={{ label: gt('common.optional', 'Optional') }}
      desc={tr('Dahua NVRs and IP cameras (also Imou, Amcrest, Lorex) on the local network. Every connected channel becomes a camera with its snapshot proxied through LSH, plus motion, person, vehicle and line-crossing events as sensors (HomeKit motion). A separate user on the NVR is best.')}>
      <ListEditor rows={devices} onChange={setDevices} fields={FIELDS} addLabel={tr('+ Add Dahua Device')}
        renderExtra={(row, i) => (
          <Button variant="secondary" busy={test.busy && testingIdx === i} disabled={!row.host}
            onClick={() => { setTestingIdx(i); test.save({ ...row, idx: i }).finally(() => setTestingIdx(null)) }}>
            {gt('common.test', 'Test')}
          </Button>
        )}/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} onClick={() => save.save({ devices }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result || test.result}/>
      </div>
    </SettingsCard>
  )
}
