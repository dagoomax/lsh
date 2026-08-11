import { useState } from 'react'
import { SettingsCard, ListEditor, Field, Toggle, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { RelayIcon, RouterIcon } from '../../Icons'
import { gt } from '../../../i18n'

const RELAY_FIELDS = [
  { key: 'index', label: 'Index', type: 'number' },
  { key: 'name', label: 'Name' },
]

export default function SystemMiscSection({ config, reload }) {
  return (
    <>
      <InterfaceCard ui={config.ui} reload={reload}/>
      <RelaysCard relays={config.relays} reload={reload}/>
      <ServerCard server={config.server} reload={reload}/>
    </>
  )
}

function InterfaceCard({ ui, reload }) {
  const [hideMqtt, setHideMqtt] = useState(!!ui?.hideMqtt)
  const [hideLogs, setHideLogs] = useState(!!ui?.hideLogs)
  const [customCss, setCustomCss] = useState(ui?.customCss || '')
  const save = useSettingsSave('/api/settings/ui')

  return (
    <SettingsCard title={gt('s.interface_title', 'Interface')}
      desc={gt('sdesc.interface', "Hide navigation links you don't use. Changes apply on the next page load — no restart needed.")}>
      <Toggle label={gt('s.hide_mqtt', 'Hide the MQTT link in the top navigation')} checked={hideMqtt} onChange={setHideMqtt}/>
      <Toggle label={gt('s.hide_logs', 'Hide the Logs link in the top navigation')} checked={hideLogs} onChange={setHideLogs}/>
      <Field label="Custom CSS" hint="(applies to both dashboards — loaded as a real stylesheet, so it may need !important)"
        type="textarea" value={customCss} onChange={setCustomCss} placeholder={'/* e.g. */\n.device-tile { border-radius: 4px !important; }'}/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} onClick={() => save.save({ hideMqtt, hideLogs, customCss }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}

function RelaysCard({ relays, reload }) {
  const [rows, setRows] = useState(relays || [])
  const save = useSettingsSave('/api/settings')

  return (
    <SettingsCard icon={RelayIcon} title={gt('s.relays_title', 'Relays')} badge={{ label: gt('common.optional', 'Optional') }}
      desc={gt('sdesc.d34', 'Name the relays on your Cerbo GX. Leave empty to hide the relay card from the dashboard entirely.')}>
      <ListEditor rows={rows} onChange={setRows} fields={RELAY_FIELDS} addLabel={gt('common.add_relay', '+ Add Relay')}/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy}
          onClick={() => save.save({ relays: rows.map(r => ({ index: Number(r.index) || 0, name: r.name || '' })) }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}

function ServerCard({ server, reload }) {
  const [port, setPort] = useState(server?.port || 3000)
  const save = useSettingsSave('/api/settings')

  return (
    <SettingsCard icon={RouterIcon} title={gt('s.server_title', 'Server')}>
      <Field label={gt('s.server_port', 'HTTP Port')} type="number" value={port} onChange={setPort} placeholder="3000" style={{ maxWidth: 160 }}/>
      <p className="stg-hint">Restart the server to apply a port change.</p>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} onClick={() => save.save({ server: { port: Number(port) } }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}
