import { useState } from 'react'
import { SettingsCard, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { LoxoneIcon } from '../../Icons'
import { gt } from '../../../i18n'

export default function LoxoneSection({ config, reload }) {
  return (
    <>
      <MiniserverCard loxone={config.loxone} reload={reload}/>
      <OutboundPushCard loxoneOut={config.loxoneOut} reload={reload}/>
    </>
  )
}

function MiniserverCard({ loxone, reload }) {
  const [host, setHost] = useState(loxone?.host || '')
  const [port, setPort] = useState(loxone?.port || 80)
  const [username, setUsername] = useState(loxone?.username || 'admin')
  const [password, setPassword] = useState(loxone?.password || '')
  const test = useSettingsSave('/api/settings/test-loxone')
  const save = useSettingsSave('/api/settings/loxone')
  const payload = () => ({ host, port: Number(port), username, password })

  return (
    <SettingsCard icon={LoxoneIcon} title={gt('s.loxone_title', 'Loxone Miniserver')} badge={{ label: gt('common.optional', 'Optional') }}
      desc={gt('sdesc.d14', 'Connects to a Loxone Miniserver via WebSocket. All rooms, switches, dimmers, blinds, thermostats, and sensors are auto-discovered.')}>
      <Field label={gt('s.loxone_host', 'Miniserver Host / IP')} value={host} onChange={setHost} placeholder="192.168.1.100"/>
      <Field label={gt('s.loxone_port', 'Port')} hint="(default 80)" type="number" value={port} onChange={setPort}/>
      <Field label={gt('s.loxone_user', 'Username')} value={username} onChange={setUsername} placeholder="admin"/>
      <Field label={gt('s.loxone_pass', 'Password')} type="password" value={password} onChange={setPassword}/>
      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy} onClick={() => test.save(payload())}>{gt('common.test', 'Test Connection')}</Button>
        <Button variant="primary" busy={save.busy} onClick={() => save.save(payload()).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={test.result || save.result}/>
      </div>
    </SettingsCard>
  )
}

function OutboundPushCard({ loxoneOut, reload }) {
  const [host, setHost] = useState(loxoneOut?.host || '')
  const [port, setPort] = useState(loxoneOut?.port || 80)
  const [username, setUsername] = useState(loxoneOut?.username || 'admin')
  const [password, setPassword] = useState(loxoneOut?.password || '')
  const [mappingsText, setMappingsText] = useState(
    (loxoneOut?.mappings || []).map(m => `${m.storeKey} = ${m.virtualInput}`).join('\n'))
  const save = useSettingsSave('/api/settings/loxone-out')

  const parseMappings = () => mappingsText.split('\n').map(l => l.trim()).filter(Boolean)
    .map(l => { const [k, v] = l.split('=').map(s => s.trim()); return k && v ? { storeKey: k, virtualInput: v } : null })
    .filter(Boolean)

  return (
    <SettingsCard icon={LoxoneIcon} title="Loxone Outbound Push" badge={{ label: gt('common.optional', 'Optional') }}
      desc={<>Pushes sensor values from LSH to Loxone Virtual Inputs in real time. One mapping per line: <code>storeKey = VirtualInputName</code>.</>}>
      <Field label="Miniserver Host / IP" value={host} onChange={setHost} placeholder="192.168.1.100"/>
      <Field label="Port" hint="(default 80)" type="number" value={port} onChange={setPort}/>
      <Field label="Username" value={username} onChange={setUsername}/>
      <Field label="Password" type="password" value={password} onChange={setPassword}/>
      <Field label="Mappings" hint="(storeKey = VirtualInputName, one per line)" type="textarea" value={mappingsText} onChange={setMappingsText}
        placeholder={'bayrol/19048/ph = PoolPH\nbayrol/19048/orp = PoolORP'}/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy}
          onClick={() => save.save({ host, port: Number(port), username, password, mappings: parseMappings() }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}
