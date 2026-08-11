import { useState } from 'react'
import { SettingsCard, ListEditor, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { gt } from '../../../i18n'

const SB_TYPES = ['switch', 'light', 'temperature', 'humidity', 'number', 'boolean']
const SB_HK = ['', 'switch-rw', 'light-rw', 'temperature', 'humidity', 'motion', 'contact', 'co2-sensor']

const FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'stateTopic', label: 'State topic', placeholder: 'state/topic' },
  { key: 'commandTopic', label: 'Command topic', placeholder: 'command/topic (optional)' },
  { key: 'type', label: 'Type', type: 'select', default: 'switch', options: SB_TYPES.map(t => ({ value: t, label: t })) },
  { key: 'unit', label: 'Unit', placeholder: '(optional)' },
  { key: 'homekitType', label: 'HomeKit type', type: 'select', options: SB_HK.map(h => ({ value: h, label: h || '(none)' })) },
]

export default function SmartBobSection({ config, reload }) {
  const sb = config.smartbob || {}
  const [name, setName] = useState(sb.name || 'SmartBob')
  const [host, setHost] = useState(sb.host || '')
  const [port, setPort] = useState(sb.port || 1883)
  const [username, setUsername] = useState(sb.username || '')
  const [password, setPassword] = useState(sb.password || '')
  const [entities, setEntities] = useState(sb.entities || [])
  const test = useSettingsSave('/api/settings/test-smartbob')
  const save = useSettingsSave('/api/settings/smartbob')

  return (
    <SettingsCard title="SmartBob" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Connects to SmartBob via MQTT. Add the broker address and define each entity with its state topic, optional command topic, and type.">
      <Field label="Device Name" value={name} onChange={setName} placeholder="SmartBob"/>
      <Field label="MQTT Broker Host" value={host} onChange={setHost} placeholder="192.168.1.100"/>
      <Field label="Port" hint="(default 1883)" type="number" value={port} onChange={setPort}/>
      <Field label="Username" hint="(optional)" value={username} onChange={setUsername} placeholder="(none)"/>
      <Field label="Password" hint="(optional)" type="password" value={password} onChange={setPassword}/>
      <h4 className="stg-subheading">Entities</h4>
      <ListEditor rows={entities} onChange={setEntities} fields={FIELDS} addLabel="+ Add Entity"/>
      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy} onClick={() => test.save({ host, port: Number(port) })}>Test Broker</Button>
        <Button variant="primary" busy={save.busy}
          onClick={() => save.save({ name, host, port: Number(port), username, password, entities }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={test.result || save.result}/>
      </div>
    </SettingsCard>
  )
}
