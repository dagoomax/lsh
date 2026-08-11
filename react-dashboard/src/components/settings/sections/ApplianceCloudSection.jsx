import { useState } from 'react'
import { SettingsCard, Field, Toggle, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { OvenIcon } from '../../Icons'
import { gt } from '../../../i18n'

export default function ApplianceCloudSection({ config, reload }) {
  return (
    <>
      <HomeConnectCard homeConnect={config.homeConnect} reload={reload}/>
      <MieleCard miele={config.miele} reload={reload}/>
    </>
  )
}

function HomeConnectCard({ homeConnect, reload }) {
  const [clientId, setClientId] = useState(homeConnect?.clientId || '')
  const [clientSecret, setClientSecret] = useState(homeConnect?.clientSecret || '')
  const [simulator, setSimulator] = useState(!!homeConnect?.simulator)
  const save = useSettingsSave('/api/settings/homeconnect')

  return (
    <SettingsCard icon={OvenIcon} title="Home Connect" badge={{ label: gt('common.optional', 'Optional') }}
      desc={<>Bosch, Siemens, Gaggenau and Neff appliances via the official Home Connect cloud. Register a free app at <a href="https://developer.home-connect.com" target="_blank" rel="noopener">developer.home-connect.com</a> (Device Flow), save credentials here, then run <code>node scripts/homeconnect-auth.js</code> once to authorize.</>}>
      <Field label="Client ID" value={clientId} onChange={setClientId}/>
      <Field label="Client Secret" type="password" value={clientSecret} onChange={setClientSecret}/>
      <Field label="Environment" type="select" value={String(simulator)} onChange={v => setSimulator(v === 'true')}
        options={[{ value: 'false', label: 'Production (real appliances)' }, { value: 'true', label: 'Simulator (developer.home-connect.com/simulator)' }]}/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} onClick={() => save.save({ clientId, clientSecret, simulator }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}

function MieleCard({ miele, reload }) {
  const [clientId, setClientId] = useState(miele?.clientId || '')
  const [clientSecret, setClientSecret] = useState(miele?.clientSecret || '')
  const [username, setUsername] = useState(miele?.username || '')
  const [password, setPassword] = useState(miele?.password || '')
  const [country, setCountry] = useState(miele?.country || 'de-DE')
  const [simEnabled, setSimEnabled] = useState(false)
  const [simStatus, setSimStatus] = useState('')
  const save = useSettingsSave('/api/settings/miele')
  const simToggle = useSettingsSave('/api/simulators/miele')

  const toggleSim = (checked) => {
    setSimEnabled(checked)
    simToggle.save({ enabled: checked }).then(res => {
      setSimStatus(res.data?.enabled ? (res.data.running ? `● running on :${res.data.port}` : '● starting…') : '')
    }).catch(err => { setSimEnabled(!checked); setSimStatus('Error: ' + err.message) })
  }

  return (
    <SettingsCard icon={OvenIcon} title="Miele@home" badge={{ label: gt('common.optional', 'Optional') }}
      desc={<>Miele appliances via the official 3rd Party API. Register a free app at <a href="https://developer.miele.com" target="_blank" rel="noopener">developer.miele.com</a>, enter its credentials plus your Miele account login. If direct login is rejected, run <code>node scripts/miele-auth.js</code> once instead.</>}>
      <Field label="Client ID" value={clientId} onChange={setClientId}/>
      <Field label="Client Secret" type="password" value={clientSecret} onChange={setClientSecret}/>
      <Field label="Miele Account Email" type="email" value={username} onChange={setUsername}/>
      <Field label="Miele Account Password" type="password" value={password} onChange={setPassword}/>
      <Field label="Country" hint="(account region, e.g. de-DE, pl-PL, en-GB)" value={country} onChange={setCountry} placeholder="de-DE" style={{ maxWidth: 180 }}/>
      <Toggle label="Run local simulator" hint="(off by default; disable when using a real Miele account)" checked={simEnabled} onChange={toggleSim}/>
      {simStatus && <span className="stg-hint">{simStatus}</span>}
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} onClick={() => save.save({ clientId, clientSecret, username, password, country }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}
