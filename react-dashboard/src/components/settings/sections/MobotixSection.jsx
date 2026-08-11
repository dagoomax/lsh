import { useState } from 'react'
import { SettingsCard, ListEditor, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { CameraIcon } from '../../Icons'
import { gt } from '../../../i18n'

const FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'host', label: 'Host / IP', placeholder: '192.168.1.60' },
  { key: 'username', label: 'Username', placeholder: 'admin', default: 'admin' },
  { key: 'password', label: 'Password', type: 'password' },
  { key: 'https', label: 'HTTPS', type: 'checkbox' },
  { key: 'port', label: 'Port', type: 'number', placeholder: '(auto)' },
  { key: 'rtspPort', label: 'RTSP Port', type: 'number', placeholder: '554', default: 554 },
  { key: 'streamPath', label: 'Stream Path', placeholder: 'mobotix.mobotix.h264' },
  { key: 'door', label: 'Door', type: 'checkbox' },
]

export default function MobotixSection({ config, reload }) {
  const [cams, setCams] = useState(config.mobotix?.cameras || [])
  const [pollInterval, setPollInterval] = useState(config.mobotix?.pollInterval ?? 30)
  const save = useSettingsSave('/api/settings/mobotix')
  const test = useSettingsSave('/api/settings/test-mobotix')
  const [testingIdx, setTestingIdx] = useState(null)

  return (
    <SettingsCard icon={CameraIcon} title="MOBOTIX" badge={{ label: gt('common.optional', 'Optional') }}
      desc={<>MOBOTIX IP cameras / IP video door stations. Snapshots (<code>/cgi-bin/image.jpg</code>) are proxied so the password stays server-side. Door/relay outputs are advanced — configure them in <code>config.json</code>; they're preserved when you save here.</>}>
      <ListEditor rows={cams} onChange={setCams} fields={FIELDS} addLabel="+ Add MOBOTIX Camera"
        renderExtra={(row, i) => (
          <Button variant="secondary" busy={test.busy && testingIdx === i}
            onClick={() => { setTestingIdx(i); test.save(row).finally(() => setTestingIdx(null)) }}>
            {gt('common.test', 'Test')}
          </Button>
        )}/>
      <Field label="Poll interval" hint="(seconds)" type="number" value={pollInterval} onChange={setPollInterval} placeholder="30" style={{ maxWidth: 160 }}/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy}
          onClick={() => save.save({ cameras: cams, pollInterval: Number(pollInterval) }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result || test.result}/>
      </div>
    </SettingsCard>
  )
}
