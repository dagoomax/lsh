import { useState } from 'react'
import { SettingsCard, ListEditor, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { CameraIcon } from '../../Icons'
import { gt } from '../../../i18n'

const FIELDS = [
  { key: 'name', label: 'Name', placeholder: 'Driveway' },
  { key: 'host', label: 'Host', placeholder: '192.168.1.50' },
  { key: 'username', label: 'User', placeholder: 'admin' },
  { key: 'password', label: 'Password', type: 'password' },
  { key: 'channel', label: 'Channel', type: 'number', default: 0 },
  { key: 'stream', label: 'Stream', type: 'select', options: [{ value: 'main', label: 'Main' }, { value: 'sub', label: 'Sub' }] },
  { key: 'https', label: 'HTTPS', type: 'checkbox' },
  { key: 'port', label: 'Port', type: 'number', placeholder: '(auto)' },
  { key: 'webrtcUrl', label: 'WebRTC URL', placeholder: 'http://go2rtc/…/whep' },
  { key: 'ptz', label: 'PTZ pad', type: 'checkbox' },
  { key: 'ir', label: 'Night vision', type: 'checkbox' },
  { key: 'floodlight', label: 'Floodlight', type: 'checkbox' },
  { key: 'siren', label: 'Siren', type: 'checkbox' },
]

export default function ReolinkSection({ config, reload }) {
  const [cams, setCams] = useState(config.reolink?.cameras || [])
  const save = useSettingsSave('/api/settings/reolink')
  const test = useSettingsSave('/api/settings/test-reolink')
  const [testingIdx, setTestingIdx] = useState(null)

  const testRow = (row, i) => {
    setTestingIdx(i)
    test.save(row).finally(() => setTestingIdx(null))
  }

  return (
    <SettingsCard icon={CameraIcon} title="Reolink" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Reolink PoE cameras and NVRs. One row per camera — use channel 0 for a standalone camera, or add a row per NVR channel. PTZ/night-vision/floodlight/siren only apply if your camera model actually has that hardware.">
      <ListEditor rows={cams} onChange={setCams} fields={FIELDS} addLabel="+ Add Reolink Camera"
        renderExtra={(row, i) => (
          <Button variant="secondary" busy={test.busy && testingIdx === i} onClick={() => testRow(row, i)}>
            {gt('common.test', 'Test')}
          </Button>
        )}/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} onClick={() => save.save({ cameras: cams }).then(reload)}>
          {gt('common.save', 'Save')}
        </Button>
        <ResultBanner result={save.result || test.result}/>
      </div>
    </SettingsCard>
  )
}
