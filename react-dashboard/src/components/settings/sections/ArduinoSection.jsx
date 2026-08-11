import { useState } from 'react'
import { SettingsCard, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { ArduinoIcon } from '../../Icons'
import { gt } from '../../../i18n'

const PLACEHOLDER = `[
  {
    "name": "Sensor Board",
    "stateTopic": "arduino/board/state",
    "commandTopic": "arduino/board/cmd",
    "sensors": [
      { "path": "temperature", "label": "Temperature", "unit": "°C" },
      { "path": "humidity",    "label": "Humidity",    "unit": "%" },
      { "path": "relay0",      "label": "Relay 1",     "type": "toggle",
        "payloadOn": "1", "payloadOff": "0" }
    ]
  }
]`

export default function ArduinoSection({ config, reload }) {
  const [host, setHost] = useState(config.arduino?.host || '')
  const [port, setPort] = useState(config.arduino?.port || 1883)
  const [username, setUsername] = useState(config.arduino?.username || '')
  const [password, setPassword] = useState(config.arduino?.password || '')
  const [devicesText, setDevicesText] = useState(config.arduino?.devices ? JSON.stringify(config.arduino.devices, null, 2) : '')
  const save = useSettingsSave('/api/settings/arduino')

  const doSave = () => {
    let devices
    try { devices = devicesText.trim() ? JSON.parse(devicesText) : [] }
    catch (err) { save.setResult({ ok: false, message: 'Invalid JSON: ' + err.message }); return }
    save.save({ host, port: Number(port), username, password, devices }).then(reload).catch(() => {})
  }

  return (
    <SettingsCard icon={ArduinoIcon} title="Arduino / Generic MQTT" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Subscribe to any MQTT topic and map JSON fields to sensor readings or controllable switches. Works with Arduino, ESP32, Tasmota custom firmware, or any device publishing JSON over MQTT.">
      <Field label="MQTT Broker Host" hint="(leave blank to reuse the main MQTT broker)" value={host} onChange={setHost} placeholder="192.168.1.100"/>
      <Field label="Port" hint="(default 1883)" type="number" value={port} onChange={setPort}/>
      <Field label="Username" hint="(optional)" value={username} onChange={setUsername} placeholder="(none)"/>
      <Field label="Password" hint="(optional)" type="password" value={password} onChange={setPassword}/>
      <Field label="Devices" hint="(JSON array — see example)" type="textarea" value={devicesText} onChange={setDevicesText} placeholder={PLACEHOLDER}/>
      <p className="stg-hint">
        Sensor <code>type</code>: omit for read-only · <code>"toggle"</code> for on/off switch · <code>"range"</code> for slider (add <code>min</code>/<code>max</code>).
        Override per-sensor with <code>stateTopic</code>/<code>commandTopic</code>. Use <code>jsonKey</code> if the JSON key differs from <code>path</code>.
      </p>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} onClick={doSave}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}
