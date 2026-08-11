import { useState } from 'react'
import { SettingsCard, ListEditor, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { gt } from '../../../i18n'

const TYPES = [
  { value: 'switch', label: 'Switch (on/off)' },
  { value: 'dimmer', label: 'Dimmer (0–100%)' },
  { value: 'sensor', label: 'Sensor (adjustable number)' },
  { value: 'text', label: 'Text (API-only, no dashboard slider)' },
  { value: 'button', label: 'Button (momentary trigger)' },
]

const FIELDS = [
  { key: 'name', label: 'Name', placeholder: 'e.g. Home/Away' },
  { key: 'type', label: 'Type', type: 'select', default: 'switch', options: TYPES },
  { key: 'unit', label: 'Unit', placeholder: '(sensor only, e.g. °C)' },
]

const randomId = () => Math.random().toString(36).slice(2, 10)

export default function VirtualDevicesSection({ config, reload }) {
  const [devices, setDevices] = useState(config.virtual?.devices || [])
  const save = useSettingsSave('/api/settings/virtual')

  return (
    <SettingsCard title="Virtual Devices" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Switches, dimmers, sensors, text values, and buttons with no real hardware behind them — automation flags, manual overrides, or a landing spot for values pushed in from an external script/webhook via /api/device/<key>/set.">
      <ListEditor rows={devices} onChange={setDevices} fields={FIELDS} addLabel="+ Add Virtual Device"/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy}
          onClick={() => save.save(devices.filter(d => d.name).map(d => ({ ...d, id: d.id || randomId() }))).then(reload)}>
          Save Virtual Devices
        </Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}
