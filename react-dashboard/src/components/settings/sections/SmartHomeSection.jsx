import { useState } from 'react'
import { SettingsCard, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { HomeIcon, ShutterIcon, RelayIcon, ZWaveIcon } from '../../Icons'
import { gt } from '../../../i18n'

export default function SmartHomeSection({ config, reload }) {
  return (
    <>
      <HomeyCard homey={config.homey} reload={reload}/>
      <SomfyCard somfy={config.somfy} reload={reload}/>
      <LandroidCard landroid={config.landroid} reload={reload}/>
      <SupplaCard suppla={config.suppla} reload={reload}/>
      <FibaroCard fibaro={config.fibaro} reload={reload}/>
    </>
  )
}

function HomeyCard({ homey, reload }) {
  const [mode, setMode] = useState(homey?.mode || 'local')
  const [host, setHost] = useState(homey?.host || '')
  const [homeyId, setHomeyId] = useState(homey?.homeyId || '')
  const [token, setToken] = useState(homey?.token || '')
  const [pollInterval, setPollInterval] = useState(homey?.pollInterval ?? 10)
  const test = useSettingsSave('/api/settings/test-homey')
  const save = useSettingsSave('/api/settings/homey')

  const payload = () => ({ mode, host, homeyId, token, pollInterval: Number(pollInterval) })

  return (
    <SettingsCard icon={HomeIcon} title={gt('s.homey_title', 'Homey')} badge={{ label: gt('common.optional', 'Optional') }}
      desc={gt('sdesc.d4', 'Connects to Athom Homey Pro 2023+ or Homey Cloud. All devices are auto-discovered with full control.')}>
      <Field label={gt('s.homey_mode', 'Connection Mode')} type="select" value={mode} onChange={setMode}
        options={[{ value: 'local', label: gt('s.homey_mode_local', 'Local (Homey Pro — same network)') }, { value: 'cloud', label: gt('s.homey_mode_cloud', 'Cloud (Homey Cloud / remote)') }]}/>
      {mode === 'local'
        ? <Field label={gt('s.homey_host', 'Homey IP Address')} hint={gt('s.homey_host_hint', '(Settings → General → IP Address)')} value={host} onChange={setHost} placeholder="192.168.1.x"/>
        : <Field label={gt('s.homey_id', 'Homey Cloud ID')} hint={gt('s.homey_id_hint', '(my.homey.app → your Homey → Settings → API)')} value={homeyId} onChange={setHomeyId} placeholder="xxxxxxxx-xxxx-…"/>}
      <Field label={gt('s.homey_token', 'Personal Access Token')} hint={gt('s.homey_token_hint', '(my.homey.app → Account → Security → Tokens)')}
        type="password" value={token} onChange={setToken} placeholder="••••••••••••••••••••••••••••••••"/>
      <Field label={gt('s.homey_poll', 'Poll Interval')} hint={gt('s.homey_poll_hint', '(seconds, default 10)')} type="number" value={pollInterval} onChange={setPollInterval} placeholder="10"/>
      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy} onClick={() => test.save(payload())}>{gt('common.test', 'Test Connection')}</Button>
        <Button variant="primary" busy={save.busy} onClick={() => save.save(payload()).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={test.result || save.result}/>
      </div>
    </SettingsCard>
  )
}

function SomfyCard({ somfy, reload }) {
  const [host, setHost] = useState(somfy?.host || '')
  const [port, setPort] = useState(somfy?.port || 8443)
  const [token, setToken] = useState(somfy?.token || '')
  const [email, setEmail] = useState(somfy?.email || '')
  const [password, setPassword] = useState(somfy?.password || '')
  const [devicesText, setDevicesText] = useState((somfy?.devices || []).join(', '))
  const [pollInterval, setPollInterval] = useState(somfy?.pollInterval ?? 30)
  const test = useSettingsSave('/api/settings/test-somfy')
  const save = useSettingsSave('/api/settings/somfy')

  return (
    <SettingsCard icon={ShutterIcon} title="Somfy TaHoma" badge={{ label: gt('common.optional', 'Optional') }}
      desc={gt('sdesc.d5', 'Connects to a Somfy TaHoma or Connexoon box on your local network. Shutters, screens, blinds, awnings, and gates are auto-discovered.')}>
      <Field label="TaHoma Hostname / IP" hint="(use gateway-XXXX-XXXX-XXXX.local for Developer Mode)" value={host} onChange={setHost} placeholder="gateway-2001-0001-1891.local"/>
      <Field label="Port" hint="(default 8443)" type="number" value={port} onChange={setPort}/>
      <Field label="Developer Token" hint="(preferred — from TaHoma Developer Mode)" type="password" value={token} onChange={setToken}/>
      <Field label="Somfy Account Email" hint="(only if no token)" type="email" value={email} onChange={setEmail}/>
      <Field label="Password" hint="(only if no token)" type="password" value={password} onChange={setPassword}/>
      <Field label="Device Filter" hint="(comma-separated labels — leave blank for all)" value={devicesText} onChange={setDevicesText} placeholder="Living Room Blind, Garage Door"/>
      <Field label="Poll Interval" hint="(seconds, default 30)" type="number" value={pollInterval} onChange={setPollInterval}/>
      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy} onClick={() => test.save({ host, port: Number(port), email, password })}>Test Connection</Button>
        <Button variant="primary" busy={save.busy} onClick={() => save.save({
          host, port: Number(port), token, email, password,
          devices: devicesText.split(',').map(s => s.trim()).filter(Boolean),
          pollInterval: Number(pollInterval),
        }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={test.result || save.result}/>
      </div>
    </SettingsCard>
  )
}

function LandroidCard({ landroid, reload }) {
  const [brand, setBrand] = useState(landroid?.brand || 'worx')
  const [email, setEmail] = useState(landroid?.email || '')
  const [password, setPassword] = useState(landroid?.password || '')
  const [pollInterval, setPollInterval] = useState(landroid?.pollInterval ?? 60)
  const test = useSettingsSave('/api/settings/test-landroid')
  const save = useSettingsSave('/api/settings/landroid')

  return (
    <SettingsCard title="Landroid" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Worx Landroid robot mower (and the Kress / Landxcape sister brands) via the manufacturer cloud.">
      <Field label="Brand" type="select" value={brand} onChange={setBrand}
        options={[{ value: 'worx', label: 'Worx' }, { value: 'kress', label: 'Kress' }, { value: 'landxcape', label: 'Landxcape' }]}/>
      <Field label="Account Email" type="email" value={email} onChange={setEmail}/>
      <Field label="Password" type="password" value={password} onChange={setPassword}/>
      <Field label="Poll Interval" hint="(seconds)" type="number" value={pollInterval} onChange={setPollInterval} placeholder="60"/>
      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy} onClick={() => test.save({ brand, email, password })}>Test Login</Button>
        <Button variant="primary" busy={save.busy} onClick={() => save.save({ brand, email, password, pollInterval: Number(pollInterval) }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={test.result || save.result}/>
      </div>
    </SettingsCard>
  )
}

function SupplaCard({ suppla, reload }) {
  const [token, setToken] = useState(suppla?.token || '')
  const [server, setServer] = useState(suppla?.server || 'https://cloud.supla.org')
  const [pollInterval, setPollInterval] = useState(suppla?.pollInterval ?? 30)
  const test = useSettingsSave('/api/settings/test-suppla')
  const save = useSettingsSave('/api/settings/suppla')

  return (
    <SettingsCard icon={RelayIcon} title="Suppla" badge={{ label: gt('common.optional', 'Optional') }}
      desc={gt('sdesc.d9', 'Connects to the Suppla cloud or a self-hosted server. Discovers all channels and groups them by device.')}>
      <Field label="Personal Access Token" type="password" value={token} onChange={setToken} autoComplete="off"/>
      <Field label="Server URL" hint="(default: https://cloud.supla.org)" value={server} onChange={setServer}/>
      <Field label="Poll Interval" hint="(seconds, min 10)" type="number" value={pollInterval} onChange={setPollInterval}/>
      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy} onClick={() => test.save({ token, server })}>Test Connection</Button>
        <Button variant="primary" busy={save.busy} onClick={() => save.save({ token, server, pollInterval: Number(pollInterval) }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={test.result || save.result}/>
      </div>
    </SettingsCard>
  )
}

function FibaroCard({ fibaro, reload }) {
  const [host, setHost] = useState(fibaro?.host || '')
  const [port, setPort] = useState(fibaro?.port || 80)
  const [username, setUsername] = useState(fibaro?.username || 'admin')
  const [password, setPassword] = useState(fibaro?.password || '')
  const test = useSettingsSave('/api/settings/test-fibaro')
  const save = useSettingsSave('/api/settings/fibaro')
  const payload = () => ({ host, port: Number(port), username, password })

  return (
    <SettingsCard icon={ZWaveIcon} title={gt('s.fibaro_title', 'Fibaro Home Center')} badge={{ label: gt('common.optional', 'Optional') }}
      desc={gt('sdesc.d28', 'Connects to a Fibaro Home Center 2/3 via its local REST API. Devices are grouped by room.')}>
      <Field label={gt('s.fibaro_host', 'Host / IP Address')} value={host} onChange={setHost} placeholder="192.168.1.100"/>
      <Field label={gt('s.fibaro_port', 'Port')} hint="(default 80)" type="number" value={port} onChange={setPort}/>
      <Field label={gt('s.fibaro_user', 'Username')} hint="(default: admin)" value={username} onChange={setUsername}/>
      <Field label={gt('s.fibaro_pass', 'Password')} type="password" value={password} onChange={setPassword}/>
      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy} onClick={() => test.save(payload())}>{gt('common.test', 'Test Connection')}</Button>
        <Button variant="primary" busy={save.busy} onClick={() => save.save(payload()).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={test.result || save.result}/>
      </div>
    </SettingsCard>
  )
}
