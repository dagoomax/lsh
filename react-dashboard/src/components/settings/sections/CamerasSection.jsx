import { useState } from 'react'
import { SettingsCard, ListEditor, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { CameraIcon } from '../../Icons'
import { gt } from '../../../i18n'

// The single worst-case array editor in the classic page: a nested onvif{}
// object per row plus two async side-effect buttons (WS-Discovery scan,
// per-row "Fetch via ONVIF"). ListEditor only knows about flat field sets,
// so rows are represented flat here (onvifHost/onvifPort/…) and folded back
// into { onvif: {...} } only when saving — same trick used by the vanilla
// page's collectCameras(), just done once at the boundary instead of ad hoc.
const FIELDS = [
  { key: 'name', label: 'Name', placeholder: 'Front Door' },
  { key: 'url', label: 'RTSP URL', placeholder: 'rtsp://…' },
  { key: 'snapshotUrl', label: 'Snapshot URL', placeholder: 'http://…/snapshot.jpg' },
  { key: 'mjpegUrl', label: 'MJPEG URL', placeholder: 'http://…/mjpeg' },
  { key: 'webrtcUrl', label: 'WebRTC / WHEP URL', placeholder: 'http://go2rtc/…/whep' },
  { key: 'twoWayAudio', label: 'Two-way audio', type: 'checkbox' },
  { key: 'onvifHost', label: 'ONVIF Host', placeholder: '(optional)' },
  { key: 'onvifPort', label: 'ONVIF Port', type: 'number', default: 80 },
  { key: 'onvifUser', label: 'ONVIF User' },
  { key: 'onvifPass', label: 'ONVIF Password', type: 'password' },
]

function toFlatRow(c) {
  return {
    name: c.name || '', url: c.url || '', snapshotUrl: c.snapshotUrl || '',
    mjpegUrl: c.mjpegUrl || '', webrtcUrl: c.webrtcUrl || '', twoWayAudio: !!c.twoWayAudio,
    onvifHost: c.onvif?.host || '', onvifPort: c.onvif?.port || 80,
    onvifUser: c.onvif?.username || '', onvifPass: c.onvif?.password || '',
  }
}

function toSavedCam(row) {
  const { onvifHost, onvifPort, onvifUser, onvifPass, ...rest } = row
  return {
    ...rest,
    ...(onvifHost ? { onvif: { host: onvifHost, port: Number(onvifPort) || 80, username: onvifUser, password: onvifPass } } : {}),
  }
}

export default function CamerasSection({ config, reload }) {
  const [rows, setRows] = useState((config.cameras || []).map(toFlatRow))
  const save = useSettingsSave('/api/settings/cameras')
  const discover = useSettingsSave('/api/onvif/discover')
  const fetchOnvif = useSettingsSave('/api/onvif/probe')
  const [busyIdx, setBusyIdx] = useState(null)

  const runDiscover = () => {
    discover.save(undefined, { method: 'GET' }).then(res => {
      const known = new Set(rows.map(r => r.onvifHost).filter(Boolean))
      const added = (res.data || []).filter(d => !known.has(d.host))
        .map(d => toFlatRow({ name: `Camera at ${d.host}`, onvif: { host: d.host, port: d.port || 80 } }))
      if (added.length) setRows([...rows, ...added])
    }).catch(() => {})
  }

  const fetchRowOnvif = (row, i, patch) => {
    if (!row.onvifHost) return
    setBusyIdx(i)
    fetchOnvif.save({ host: row.onvifHost, port: row.onvifPort, username: row.onvifUser, password: row.onvifPass })
      .then(res => patch({ url: res.data.streamUri, snapshotUrl: res.data.snapshotUri || row.snapshotUrl }))
      .catch(() => {})
      .finally(() => setBusyIdx(null))
  }

  return (
    <SettingsCard icon={CameraIcon} title="Cameras" desc="Cameras shown on the dashboard. Provide an RTSP URL and optionally a snapshot URL for live preview, or an ONVIF host to auto-fetch both.">
      <div className="stg-actions" style={{ marginBottom: 12 }}>
        <Button variant="secondary" busy={discover.busy} onClick={runDiscover}>🔍 Discover ONVIF cameras</Button>
        <ResultBanner result={discover.result}/>
      </div>
      <ListEditor rows={rows} onChange={setRows} fields={FIELDS} addLabel="+ Add Camera"
        renderExtra={(row, i, patch) => (
          <Button variant="secondary" busy={fetchOnvif.busy && busyIdx === i} onClick={() => fetchRowOnvif(row, i, patch)}
            disabled={!row.onvifHost} title={row.onvifHost ? 'Fetch stream/snapshot URL via ONVIF' : 'Enter an ONVIF host first'}>
            Fetch via ONVIF
          </Button>
        )}/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy}
          onClick={() => save.save(rows.map(toSavedCam)).then(reload)}>
          {gt('common.save', 'Save')}
        </Button>
        <ResultBanner result={save.result || fetchOnvif.result}/>
      </div>
    </SettingsCard>
  )
}
