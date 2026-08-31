import { useEffect, useState } from 'react'
import { SettingsCard, Field, ListEditor, Toggle, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { CameraIcon } from '../../Icons'
import { gt } from '../../../i18n'

const CAMERA_FIELDS = [
  { key: 'name', label: 'Name', placeholder: 'Wejście' },
  { key: 'url', label: 'RTSP URL', placeholder: 'rtsp://192.168.1.50:554/stream1' },
]

function statusText(data) {
  if (!data) return '—'
  if (data.loading) return `Downloading ${data.base}…`
  if (data.error) return `✗ ${data.base}: ${data.error}`
  if (data.loaded) return `✓ ${data.base} loaded`
  return 'Not running — add a camera below, save, then restart LSH'
}

function ModelCard() {
  const [status, setStatus] = useState(null)
  const [model, setModel] = useState('')
  const save = useSettingsSave('/api/settings/object-detection/model')

  const load = () => fetch('/api/settings/object-detection/model', { credentials: 'include' })
    .then(r => r.json()).then(d => {
      if (!d.success) return
      setStatus(d.data)
      if (d.data.base) setModel(d.data.base)
      else if (d.data.options?.length) setModel(d.data.options[0].id)
    })
  useEffect(() => { load() }, [])

  return (
    <SettingsCard icon={CameraIcon} title={gt('s.aidetect_model_title', 'Detection Model')} badge={{ label: gt('common.optional', 'Optional') }}
      desc={gt('sdesc.d40', 'Local object detection — person, car, dog, cat, and 76 other everyday classes — for any camera that only exposes a plain RTSP stream (generic IP camera, ONVIF source, the Tuya bridge, …), no on-device AI required. Runs a TensorFlow.js model against a periodic frame grab. Pick which model to use below — switching downloads it fresh and validates it loads before saving.')}>
      <Field label={gt('s.aidetect_model', 'Detection Model')} type="select" value={model} onChange={setModel}
        options={(status?.options || []).map(m => ({ value: m.id, label: m.label }))}/>
      <p className="stg-hint">{statusText(status)}</p>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} disabled={!model}
          onClick={() => save.save({ model }).then(res => setStatus(res.data))}>
          {gt('s.aidetect_download', 'Download & Use This Model')}
        </Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}

function CamerasCard({ config, reload }) {
  const od = config.objectDetection || {}
  const [cameras, setCameras] = useState(od.cameras || [])
  const [pollInterval, setPollInterval] = useState(od.pollInterval ?? 15)
  const [minConfidence, setMinConfidence] = useState(od.minConfidence ?? 0.5)
  const [petVerification, setPetVerification] = useState(od.petVerification !== false)
  const [requirePetVerification, setRequirePetVerification] = useState(!!od.requirePetVerification)
  const [autoCreateFlows, setAutoCreateFlows] = useState(od.autoCreateFlows !== false)
  const save = useSettingsSave('/api/settings/object-detection')

  return (
    <SettingsCard title={gt('s.aidetect_cameras_title', 'Cameras to Watch')}
      desc={gt('s.aidetect_cameras_desc', "Any RTSP stream works here — it doesn't need to be one of the camera integrations elsewhere in Settings. Each entry gets its own person/dog/cat/etc. sensors (exposed to HomeKit as motion), an auto-created Flow, and — for cat/dog/bird/horse — a second-pass breed guess.")}>
      <ListEditor rows={cameras} onChange={setCameras} fields={CAMERA_FIELDS} addLabel={gt('common.add_camera', '+ Add Camera')}/>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 4 }}>
        <Field label={gt('s.aidetect_poll', 'Poll Interval (s)')} type="number" min={5} value={pollInterval} onChange={setPollInterval}/>
        <Field label={gt('s.aidetect_confidence', 'Min Confidence')} type="number" min={0} max={1} value={minConfidence} onChange={setMinConfidence}/>
      </div>
      <Toggle label={gt('s.aidetect_pet_verify', 'Verify pet breed with a second model (cat/dog/bird/horse)')} checked={petVerification} onChange={setPetVerification}/>
      <Toggle label={gt('s.aidetect_require_pet_verify', 'Drop unverified pet detections instead of just flagging them')} checked={requirePetVerification} onChange={setRequirePetVerification}/>
      <Toggle label={gt('s.aidetect_auto_flows', 'Auto-create a starter Flow the first time each class is seen')} checked={autoCreateFlows} onChange={setAutoCreateFlows}/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy}
          onClick={() => save.save({
            cameras: cameras.filter(c => c.name && c.url),
            pollInterval: Number(pollInterval) || 15,
            minConfidence: Number(minConfidence),
            petVerification, requirePetVerification, autoCreateFlows,
          }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}

export default function AiDetectionSection({ config, reload }) {
  return (
    <>
      <CamerasCard config={config} reload={reload}/>
      <ModelCard/>
    </>
  )
}
