import { useEffect, useState } from 'react'
import { SettingsCard, ListEditor, Field, Toggle, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { gt } from '../../../i18n'

const FIELDS = [
  { key: 'name', label: 'Name', placeholder: 'SmartShunt' },
  { key: 'mac', label: 'MAC address', placeholder: '60:A4:23:91:8F:55' },
  { key: 'bindkey', label: 'Encryption key', type: 'password', placeholder: '32 hex characters' },
]

const ago = (t) => {
  if (!t) return 'never'
  const s = Math.round((Date.now() - t) / 1000)
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`
}

// Victron devices read over Bluetooth by the LSH host itself (Arduino UNO Q) —
// src/victron-ble-client.js, decoder ported from esphome-victron_ble.
export default function VictronBleSection({ config, reload }) {
  const cfg = config.victronBle || {}
  const [devices, setDevices] = useState(cfg.devices || [])
  const [adapter, setAdapter] = useState(cfg.adapter || 'hci0')
  const [feedDashboard, setFeedDashboard] = useState(cfg.feedDashboard !== false)
  const [status, setStatus] = useState(null)
  const save = useSettingsSave('/api/settings/victron-ble')

  useEffect(() => {
    const load = () => fetch('/api/victron-ble/status', { credentials: 'include' })
      .then((r) => r.json()).then((j) => setStatus(j.data)).catch(() => {})
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [])

  const live = new Map((status?.devices || []).map((d) => [d.mac, d]))

  return (
    <SettingsCard title="Victron Bluetooth" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Reads SmartShunt, SmartSolar, Orion, MultiPlus and other Victron devices directly over Bluetooth (Instant Readout) — no GX device or ESP32 needed. Runs on an LSH host with Bluetooth and BlueZ, such as the Arduino UNO Q. Readings also feed the Energy dashboard unless a GX device (MQTT/VRM) is connected. Get each device's encryption key in VictronConnect: Settings → Product info → Instant readout via Bluetooth → Show.">
      <ListEditor rows={devices} onChange={setDevices} fields={FIELDS} addLabel={gt('common.add_device', '+ Add Device')}
        renderExtra={(row) => {
          const d = live.get(String(row.mac || '').toUpperCase())
          if (!status || !d) return null
          return (
            <span className="stg-hint" style={{ whiteSpace: 'nowrap' }}>
              {d.error ? <span style={{ color: 'var(--red)' }}>✗ {d.error}</span>
                : d.lastSeen ? `✓ ${d.kind?.replace(/_/g, ' ') || ''} · ${ago(d.lastSeen)}` : 'waiting for signal…'}
            </span>
          )
        }}/>
      <Field label="Bluetooth adapter" value={adapter} onChange={setAdapter} placeholder="hci0"/>
      <Toggle label="Feed the Energy dashboard" checked={feedDashboard} onChange={setFeedDashboard}
        hint="battery SOC/voltage/current, solar power and yield"/>
      {!status && <p className="stg-hint">Not running on this LSH host (needs Linux + Bluetooth, and a restart after saving).</p>}
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy}
          onClick={() => save.save({ devices, adapter, feedDashboard }).then(reload).catch(() => {})}>
          {gt('common.save_devices', 'Save Devices')}
        </Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}
