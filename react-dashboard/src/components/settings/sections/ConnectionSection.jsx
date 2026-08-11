import { useState } from 'react'
import { SettingsCard, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { RouterIcon, SunIcon } from '../../Icons'
import { gt } from '../../../i18n'

export default function ConnectionSection({ config, reload }) {
  return (
    <>
      <MqttCard mqtt={config.mqtt} reload={reload}/>
      <VrmCard vrm={config.vrm} reload={reload}/>
    </>
  )
}

function MqttCard({ mqtt, reload }) {
  const [host, setHost] = useState(mqtt?.host || '')
  const [port, setPort] = useState(mqtt?.port || 1883)
  const [portalId, setPortalId] = useState(mqtt?.portalId || '')
  const test = useSettingsSave('/api/settings/test-mqtt')
  const save = useSettingsSave('/api/settings')

  return (
    <SettingsCard icon={RouterIcon} title={gt('s.mqtt_title', 'Cerbo GX – MQTT Connection')}
      desc={gt('sdesc.d0', 'Direct local connection to your Cerbo GX (recommended).')}>
      <Field label={gt('s.mqtt_host', 'Host / IP Address')} value={host} onChange={setHost} placeholder="192.168.1.100"/>
      <Field label={gt('s.mqtt_port', 'Port')} type="number" value={port} onChange={setPort} placeholder="1883"/>
      <Field label={gt('s.mqtt_portal', 'Portal ID')} hint={gt('s.mqtt_portal_hint', '(leave blank to auto-discover)')}
        value={portalId} onChange={setPortalId} placeholder="e0ff50a097c0"/>
      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy} onClick={() => test.save({ host, port: Number(port) })}>
          {gt('common.test', 'Test Connection')}
        </Button>
        <Button variant="primary" busy={save.busy}
          onClick={() => save.save({ mqtt: { host, port: Number(port), portalId } })
            .then(reload)}>
          {gt('common.save', 'Save')}
        </Button>
        <ResultBanner result={test.result || save.result}/>
      </div>
    </SettingsCard>
  )
}

function VrmCard({ vrm, reload }) {
  const [apiToken, setApiToken] = useState(vrm?.apiToken || '')
  const [email, setEmail] = useState(vrm?.email || '')
  const [password, setPassword] = useState(vrm?.password || '')
  const [installationId, setInstallationId] = useState(vrm?.installationId || '')
  const [live, setLive] = useState(null)
  const test = useSettingsSave('/api/settings/test-vrm')
  const testLive = useSettingsSave('/api/settings/test-vrm-live')
  const save = useSettingsSave('/api/settings/vrm')

  const payload = { apiToken, email, password, installationId }

  const runTestLive = () => {
    setLive(null)
    testLive.save(payload).then(res => setLive(res.data)).catch(() => {})
  }

  return (
    <SettingsCard icon={SunIcon} title={gt('s.vrm_title', 'VRM Cloud API')}
      badge={{ label: gt('common.fallback', 'Fallback'), tone: 'fallback' }}
      desc={gt('sdesc.d1', 'Used when local MQTT is unavailable.')}>
      <Field label={gt('s.vrm_token', 'API Token')} hint={gt('s.vrm_token_hint', '(preferred — leave blank to use email/password)')}
        type="password" value={apiToken} onChange={setApiToken} placeholder="eyJ0eXAiOiJKV1Qi…"/>
      <Field label={gt('s.vrm_email', 'VRM Email')} type="email" value={email} onChange={setEmail} placeholder="you@example.com"/>
      <Field label={gt('s.vrm_password', 'VRM Password')} type="password" value={password} onChange={setPassword} placeholder="••••••••"/>
      <Field label={gt('s.vrm_id', 'Installation ID')} value={installationId} onChange={setInstallationId} placeholder="12345"/>

      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy} onClick={() => test.save(payload)}>
          {gt('common.test_creds', 'Test Credentials')}
        </Button>
        <Button variant="secondary" busy={testLive.busy} onClick={runTestLive}>
          {gt('common.test_live', 'Test Live Data')}
        </Button>
        <Button variant="primary" busy={save.busy} onClick={() => save.save(payload).then(reload)}>
          {gt('common.save', 'Save')}
        </Button>
      </div>
      <ResultBanner result={test.result || testLive.result || save.result}/>

      {live && (
        <div className="stg-live-preview">
          <div className="stg-live-title">{live.installationName || 'Installation'}</div>
          <div className="stg-live-grid">
            <LiveStat label="Battery SOC" value={live.soc} suffix="%"/>
            <LiveStat label="Voltage" value={live.voltage} suffix="V"/>
            <LiveStat label="Solar" value={live.solar} suffix="W"/>
            <LiveStat label="Grid" value={live.grid} suffix="W"/>
            <LiveStat label="Consumption" value={live.consumption} suffix="W"/>
            <LiveStat label="State" value={live.state}/>
          </div>
        </div>
      )}
    </SettingsCard>
  )
}

function LiveStat({ label, value, suffix }) {
  return (
    <div className="stg-live-stat">
      <div className="stg-live-stat-label">{label}</div>
      <div className="stg-live-stat-value">{value == null ? '—' : `${value}${suffix || ''}`}</div>
    </div>
  )
}
