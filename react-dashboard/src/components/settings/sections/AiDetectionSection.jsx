import { useEffect, useState } from 'react'
import { SettingsCard, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { CameraIcon } from '../../Icons'
import { gt } from '../../../i18n'

function statusText(data) {
  if (!data) return '—'
  if (data.loading) return `Downloading ${data.base}…`
  if (data.error) return `✗ ${data.base}: ${data.error}`
  if (data.loaded) return `✓ ${data.base} loaded`
  return 'Not running — add a camera under objectDetection.cameras first'
}

export default function AiDetectionSection() {
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
    <SettingsCard icon={CameraIcon} title="AI Camera Detection" badge={{ label: gt('common.optional', 'Optional') }}
      desc={<>Local person/car/pet detection for cameras with no on-device AI of their own (config key <code>objectDetection</code>, cameras list still set in <code>config.json</code>). Pick which detection model to use below — switching downloads it fresh and validates it loads before saving.</>}>
      <Field label="Detection Model" type="select" value={model} onChange={setModel}
        options={(status?.options || []).map(m => ({ value: m.id, label: m.label }))}/>
      <p className="stg-hint">{statusText(status)}</p>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} disabled={!model}
          onClick={() => save.save({ model }).then(res => setStatus(res.data))}>
          Download &amp; Use This Model
        </Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}
