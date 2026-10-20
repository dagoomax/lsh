import { useEffect, useState } from 'react'
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
  const [nvrs, setNvrs] = useState([])
  useEffect(() => {
    fetch('/api/dahua/status').then(r => r.json()).then(j => setNvrs(j.success ? j.data : [])).catch(() => setNvrs([]))
  }, [])
  const cams = nvrs.flatMap(n => n.channels.map(c => ({ ...c, nvr: n.name })))
  const full = (path) => `http://${window.location.host}${path}${path.includes('?') ? '&' : '?'}token=<API token>`

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
      {cams.length > 0 && (
        <>
          <label style={{ marginTop: 12 }}>{tr('For the Loxone app')}</label>
          <p className="stg-hint" style={{ margin: '0 0 8px' }}>{tr('The Loxone app shows only JPEG or MJPEG. In Loxone Config add an Intercom (custom) block per camera: the live address as the video stream, the snapshot as the image. LSH converts the low-resolution stream only while someone watches. Replace the token placeholder with an API token.')}</p>
          <div className="lox-media">
            {cams.map(c => (
              <div key={c.mjpeg} className="lox-media-row">
                <img src={c.snapshot.replace(/width=\d+/, 'width=160')} alt="" width="64" height="36" style={{ borderRadius: 4, flex: 'none', objectFit: 'cover' }} />
                <div className="lox-media-main">
                  <b>{c.name}</b>
                  <small>{tr('Live')}: <code>{full(c.mjpeg)}</code></small>
                  <small>{tr('Snapshot')}: <code>{full(c.snapshot)}</code></small>
                </div>
                <button type="button" className="lox-media-btn" onClick={() => navigator.clipboard?.writeText(full(c.mjpeg))} title={tr('Copy')}>⧉</button>
              </div>
            ))}
          </div>
        </>
      )}
    </SettingsCard>
  )
}
