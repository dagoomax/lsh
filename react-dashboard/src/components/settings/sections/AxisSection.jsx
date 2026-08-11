import { useState } from 'react'
import { SettingsCard, ListEditor, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { CameraIcon } from '../../Icons'
import { gt } from '../../../i18n'

const FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'host', label: 'Host / IP', placeholder: '192.168.1.70' },
  { key: 'username', label: 'Username', placeholder: 'root', default: 'root' },
  { key: 'password', label: 'Password', type: 'password' },
  { key: 'auth', label: 'Auth', type: 'select', default: 'digest',
    options: [{ value: 'digest', label: 'digest' }, { value: 'basic', label: 'basic' }] },
  { key: 'https', label: 'HTTPS', type: 'checkbox' },
  { key: 'port', label: 'Port', type: 'number', placeholder: '(auto)' },
  { key: 'rtspPort', label: 'RTSP Port', type: 'number', placeholder: '554', default: 554 },
  { key: 'resolution', label: 'Resolution', placeholder: '1280x720' },
  { key: 'ptz', label: 'PTZ pad', type: 'checkbox' },
  { key: 'ir', label: 'Night vision', type: 'checkbox' },
]

export default function AxisSection({ config, reload }) {
  const [cams, setCams] = useState(config.axis?.cameras || [])
  const [pollInterval, setPollInterval] = useState(config.axis?.pollInterval ?? 30)
  const save = useSettingsSave('/api/settings/axis')
  const test = useSettingsSave('/api/settings/test-axis')
  const [testingIdx, setTestingIdx] = useState(null)

  return (
    <SettingsCard icon={CameraIcon} title="Axis" badge={{ label: gt('common.optional', 'Optional') }}
      desc={<>Axis IP cameras via VAPIX. Snapshots (<code>/axis-cgi/jpg/image.cgi</code>) are proxied; Axis defaults to HTTP Digest auth. I/O relay outputs are advanced — configure them in <code>config.json</code>; they're preserved when you save here.</>}>
      <ListEditor rows={cams} onChange={setCams} fields={FIELDS} addLabel="+ Add Axis Camera"
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
