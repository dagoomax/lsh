import { useEffect, useState } from 'react'
import { SettingsCard, Field, Toggle, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { BroadcastIcon } from '../../Icons'
import { gt, tr } from '../../../i18n'

export default function MqttBrokerSection({ config, reload }) {
  const cfg = config.mqttBroker || {}
  const [enabled, setEnabled] = useState(!!cfg.enabled)
  const [port, setPort] = useState(String(cfg.port || 1883))
  const [username, setUsername] = useState(cfg.username || '')
  const [password, setPassword] = useState(cfg.password || '')
  const [status, setStatus] = useState(null)
  const save = useSettingsSave('/api/settings/mqtt-broker')

  useEffect(() => {
    let alive = true
    const load = () => fetch('/api/mqtt-broker/status', { credentials: 'include' }).then(r => r.json())
      .then(d => { if (alive) setStatus(d.data || null) }).catch(() => {})
    load()
    const t = setInterval(load, 5000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  return (
    <SettingsCard icon={BroadcastIcon} title="MQTT Broker" badge={{ label: gt('common.optional', 'Optional') }}
      desc={tr('A broker built into LSH for ESP / Arduino boards, Button+, Tasmota, Shelly, Zigbee2MQTT and other MQTT devices — no Cerbo GX or separate Mosquitto needed. LSH integrations with a blank MQTT host (Arduino, BoneIO, Flows, MQTT Explorer) use it. Victron keeps using the Cerbo GX.')}>
      <Toggle label="Enable built-in broker" checked={enabled} onChange={setEnabled}/>
      <Field label="Port" type="number" value={port} onChange={setPort} placeholder="1883"/>
      <Field label="Username" hint="(optional — empty = no login, open on the LAN)" value={username} onChange={setUsername} autoComplete="off"/>
      {username && <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="new-password"/>}
      {status && (
        <div className="stg-field">
          <label>{tr('Status')}</label>
          <div style={{ fontSize: 13, color: status.listening ? 'var(--green)' : status.error ? 'var(--red)' : 'var(--text2)' }}>
            {status.listening
              ? tr('Running on port {port} · {clients} client(s) · {messages} message(s)', { port: status.port, clients: status.clients.length, messages: status.messages })
              : status.error ? status.error : tr('Not running')}
          </div>
          {status.listening && status.clients.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
              {status.clients.map(c => `${c.id}${c.address ? ` (${c.address.replace('::ffff:', '')})` : ''}`).join(', ')}
            </div>
          )}
        </div>
      )}
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy}
          onClick={() => save.save({ enabled, port: Number(port) || 1883, username, password }).then(reload).catch(() => {})}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}
