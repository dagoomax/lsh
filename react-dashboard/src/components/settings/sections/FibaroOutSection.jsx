import { useState } from 'react'
import { SettingsCard, ListEditor, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { ZWaveIcon } from '../../Icons'
import { gt } from '../../../i18n'

const FIELDS = [
  { key: 'mode', label: 'Mode', type: 'select', default: 'key',
    options: [{ value: 'key', label: 'Key' }, { value: 'prefix', label: 'Prefix' }] },
  { key: 'from', label: 'From', placeholder: 'satel/partition/1/armed' },
  { key: 'to', label: 'To (variable)', placeholder: 'LSH_SatelArmed' },
]

function toRows(mappings) {
  return (mappings || []).map(m => m.storeKey
    ? { mode: 'key', from: m.storeKey, to: m.variable || '' }
    : { mode: 'prefix', from: m.storePrefix, to: m.variablePrefix || '' })
}

function toMappings(rows) {
  return rows.filter(r => r.from && r.to).map(r => r.mode === 'prefix'
    ? { storePrefix: r.from, variablePrefix: r.to }
    : { storeKey: r.from, variable: r.to })
}

export default function FibaroOutSection({ config, reload }) {
  const [host, setHost] = useState(config.fibaroOut?.host || '')
  const [port, setPort] = useState(config.fibaroOut?.port || 80)
  const [username, setUsername] = useState(config.fibaroOut?.username || 'admin')
  const [password, setPassword] = useState(config.fibaroOut?.password || '')
  const [rows, setRows] = useState(toRows(config.fibaroOut?.mappings))
  const test = useSettingsSave('/api/settings/test-fibaro-out')
  const save = useSettingsSave('/api/settings/fibaro-out')
  const payload = () => ({ host, port: Number(port), username, password, mappings: toMappings(rows) })

  return (
    <SettingsCard icon={ZWaveIcon} title="Fibaro Outbound Push" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Pushes LSH store values to Fibaro Home Center global variables in real time, so HC scenes can react to anything LSH knows. Missing variables are created automatically; a prefix rule maps a whole key subtree at once (/ becomes _).">
      <Field label="Home Center Host / IP" value={host} onChange={setHost} placeholder="192.168.1.196"/>
      <Field label="Port" type="number" value={port} onChange={setPort} placeholder="80"/>
      <Field label="Username" value={username} onChange={setUsername}/>
      <Field label="Password" type="password" value={password} onChange={setPassword}/>
      <ListEditor rows={rows} onChange={setRows} fields={FIELDS} addLabel="+ Add mapping"/>
      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy} onClick={() => test.save(payload())}>{gt('common.test', 'Test Connection')}</Button>
        <Button variant="primary" busy={save.busy} onClick={() => save.save(payload()).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={test.result || save.result}/>
      </div>
    </SettingsCard>
  )
}
