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
      <RestartCard/>
    </>
  )
}

// Restarts the LSH process itself (POST /api/admin/restart → process.exit(0)
// — see src/api-routes.js), not the host machine. Ported from the classic
// page's #btn-restart flow: confirm, fire the request (its response never
// actually arrives — the process exits mid-request, so the fetch rejecting
// is the expected/normal case, not an error), then poll GET /api/settings
// until it answers again and reload. A process manager (PM2 in production,
// per README) is what brings the process back up; running bare via
// `npm start` with nothing supervising it, restart never returns — the
// 60s safety reload below is what surfaces that instead of hanging forever.
function RestartCard() {
  const [restarting, setRestarting] = useState(false)
  const [phase, setPhase] = useState('restarting') // 'restarting' | 'back'
  const [secs, setSecs] = useState(15)

  const restart = async () => {
    if (!window.confirm('Restart the server now? The page will reconnect automatically.')) return
    setPhase('restarting')
    setSecs(15)
    setRestarting(true)
    try {
      await fetch('/api/admin/restart', { method: 'POST', credentials: 'same-origin' })
    } catch { /* expected — server closes the connection as it exits */ }

    const tick = setInterval(() => setSecs(s => Math.max(0, s - 1)), 1000)
    const poll = setInterval(async () => {
      try {
        const r = await fetch('/api/settings', { cache: 'no-store', credentials: 'same-origin' })
        if (r.ok) {
          clearInterval(tick)
          clearInterval(poll)
          setPhase('back')
          setTimeout(() => window.location.reload(), 800)
        }
      } catch { /* still down, keep polling */ }
    }, 1500)
    setTimeout(() => window.location.reload(), 60000)
  }

  return (
    <SettingsCard title={gt('s.restart_title', 'Restart Server')}
      desc={gt('sdesc.restart', 'Restarts the LSH process — every integration briefly drops and reconnects (MQTT, Loxone, HomeKit, …). Takes a few seconds; this page reconnects on its own once it’s back.')}>
      <div className="stg-actions">
        <Button variant="danger" onClick={restart}>{gt('s.restart_btn', 'Restart Server')}</Button>
      </div>
      {restarting && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
        }}>
          <div style={{
            background: 'var(--card-grad)', border: '1px solid var(--border)', borderRadius: 16,
            padding: '40px 48px', textAlign: 'center', minWidth: 280,
          }}>
            <span className="stg-spinner" style={{ width: 40, height: 40, borderWidth: 4, display: 'inline-block' }}/>
            <div style={{ fontSize: '1.2rem', fontWeight: 600, margin: '16px 0 8px' }}>
              {phase === 'back' ? gt('s.restart_back', 'Back online') : gt('s.restarting', 'Restarting…')}
            </div>
            <div style={{ fontSize: '0.9rem', color: 'var(--text2)' }}>
              {phase === 'back'
                ? gt('s.restart_back_sub', 'Server restarted successfully. Reloading…')
                : <>{gt('s.restart_sub', 'The server is restarting. Reconnecting in')} <strong>{secs}</strong>s…</>}
            </div>
          </div>
        </div>
      )}
    </SettingsCard>
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
