import { useState } from 'react'
import { SettingsCard, ListEditor, Field, Toggle, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { DinRailIcon } from '../../Icons'
import { gt } from '../../../i18n'

const GRENTON_TYPES = ['light', 'dimmer', 'switch', 'blind', 'temperature', 'sensor']
const GRENTON_FIELDS = [
  { key: 'name', label: 'Name', placeholder: 'Lampa salon' },
  { key: 'object', label: 'Object', placeholder: 'DOU8272' },
  { key: 'type', label: 'Type', type: 'select', default: 'switch', options: GRENTON_TYPES.map(t => ({ value: t, label: t })) },
]

export default function BoneioGrentonSection({ config, reload }) {
  return (
    <>
      <BoneioCard boneio={config.boneio} reload={reload}/>
      <GrentonCard grenton={config.grenton} reload={reload}/>
    </>
  )
}

function BoneioCard({ boneio, reload }) {
  const [host, setHost] = useState(boneio?.host || '')
  const [port, setPort] = useState(boneio?.port || 1883)
  const test = useSettingsSave('/api/settings/test-boneio')
  const save = useSettingsSave('/api/settings/boneio')

  return (
    <SettingsCard icon={DinRailIcon} title={gt('s.boneio_title', 'BoneIO')} badge={{ label: gt('common.optional', 'Optional') }}
      desc={gt('sdesc.d22', 'Connects to a BoneIO controller via MQTT. Relays, inputs, and sensors are auto-discovered via Home Assistant MQTT discovery. Leave host blank to use the Cerbo GX MQTT broker.')}>
      <Field label={gt('s.boneio_host', 'MQTT Host / IP')} hint={gt('s.boneio_host_hint', '(leave blank to reuse Cerbo GX broker)')} value={host} onChange={setHost} placeholder="192.168.1.100"/>
      <Field label={gt('s.boneio_port', 'MQTT Port')} hint={gt('s.boneio_port_hint', '(default 1883)')} type="number" value={port} onChange={setPort}/>
      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy} onClick={() => test.save({ host, port: Number(port) })}>{gt('common.test', 'Test Connection')}</Button>
        <Button variant="primary" busy={save.busy} onClick={() => save.save({ host, port: Number(port) }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={test.result || save.result}/>
      </div>
    </SettingsCard>
  )
}

function GrentonCard({ grenton, reload }) {
  const [host, setHost] = useState(grenton?.host || '')
  const [port, setPort] = useState(grenton?.port || 80)
  const [path, setPath] = useState(grenton?.path || '/lsh')
  const [pollInterval, setPollInterval] = useState(grenton?.pollInterval ?? 5)
  const [token, setToken] = useState(grenton?.token || '')
  const [simEnabled, setSimEnabled] = useState(false)
  const [simStatus, setSimStatus] = useState('')
  const [devices, setDevices] = useState(grenton?.devices || [])
  const save = useSettingsSave('/api/settings/grenton')
  const simToggle = useSettingsSave('/api/simulators/grenton')

  const toggleSim = (checked) => {
    setSimEnabled(checked)
    simToggle.save({ enabled: checked }).then(res => {
      setSimStatus(res.data?.enabled ? (res.data.running ? `● running on :${res.data.port}` : '● starting…') : '')
    }).catch(err => { setSimEnabled(!checked); setSimStatus('Error: ' + err.message) })
  }

  return (
    <SettingsCard title="Grenton" badge={{ label: gt('common.optional', 'Optional') }}
      desc={<>Grenton CLU controllers via the GATE HTTP module running the companion Lua script (<code>docs/grenton-gate-lsh.lua</code>). Add each object by its Object Manager name. Advanced per-object options live in <code>config.json</code> and are preserved on save.</>}>
      <Field label="GATE Host / IP" value={host} onChange={setHost} placeholder="192.168.1.x"/>
      <Field label="Port" type="number" value={port} onChange={setPort} placeholder="80" style={{ maxWidth: 120 }}/>
      <Field label="Path" value={path} onChange={setPath} placeholder="/lsh" style={{ maxWidth: 160 }}/>
      <Field label="Poll (s)" type="number" value={pollInterval} onChange={setPollInterval} style={{ maxWidth: 120 }}/>
      <Field label="Token" hint="(optional — must match the Lua script)" type="password" value={token} onChange={setToken}/>
      <Toggle label="Run local simulator" hint="(off by default; disable when using a real GATE module)" checked={simEnabled} onChange={toggleSim}/>
      {simStatus && <span className="stg-hint">{simStatus}</span>}
      <h4 className="stg-subheading">Objects</h4>
      <ListEditor rows={devices} onChange={setDevices} fields={GRENTON_FIELDS} addLabel="+ Add Object"/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy}
          onClick={() => save.save({ host, port: Number(port), path, token, pollInterval: Number(pollInterval), devices }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}
