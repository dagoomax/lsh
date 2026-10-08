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
  const [scan, setScan] = useState({ busy: false, results: null, error: null, needsModule: false, showAll: false })

  const runScan = async () => {
    setScan((x) => ({ ...x, busy: true, error: null, needsModule: false }))
    try {
      const r = await fetch('/api/victron-ble/scan', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seconds: 10 }),
      })
      const j = await r.json()
      if (!j.success) return setScan((x) => ({ ...x, busy: false, error: j.error, needsModule: !!j.needsModule }))
      setScan((x) => ({ ...x, busy: false, results: j.data }))
    } catch (e) {
      setScan((x) => ({ ...x, busy: false, error: e.message }))
    }
  }

  const installModule = async () => {
    setScan((x) => ({ ...x, busy: true, error: 'Installing the Victron Bluetooth module…' }))
    const r = await fetch('/api/modules/victron-ble/install', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then((x) => x.json()).catch((e) => ({ success: false, error: e.message }))
    if (!r.success) return setScan((x) => ({ ...x, busy: false, error: r.error }))
    runScan()
  }

  const addFromScan = (d) => {
    if (devices.some((x) => String(x.mac || '').toUpperCase() === d.mac)) return
    setDevices([...devices, { name: d.victron?.model || d.name || d.mac, mac: d.mac, bindkey: '' }])
  }

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
      <div className="stg-actions" style={{ marginTop: 4 }}>
        <Button variant="secondary" busy={scan.busy} onClick={runScan}>📡 Scan for Bluetooth devices</Button>
        {scan.needsModule && <Button variant="primary" busy={scan.busy} onClick={installModule}>Install module</Button>}
        {scan.results && (
          <label className="stg-hint" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={scan.showAll} onChange={(e) => setScan((x) => ({ ...x, showAll: e.target.checked }))}/>
            show non-Victron devices
          </label>
        )}
      </div>
      {scan.error && <div className={`stg-banner ${scan.busy ? 'ok' : 'err'}`}>{scan.busy ? '' : '✗ '}{scan.error}</div>}
      {scan.results && <ScanResults results={scan.results} showAll={scan.showAll} devices={devices} onAdd={addFromScan}/>}
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

function ScanResults({ results, showAll, devices, onAdd }) {
  const configured = new Set(devices.map((d) => String(d.mac || '').toUpperCase()))
  const victron = results.filter((d) => d.victron)
  const shown = showAll ? results : victron
  return (
    <div className="stg-ble-scan">
      <div className="stg-hint">
        {results.length} Bluetooth device{results.length === 1 ? '' : 's'} in range · {victron.length} Victron
        {!victron.length && ' — make sure Instant readout is enabled and VictronConnect is disconnected'}
      </div>
      {shown.map((d) => (
        <div key={d.mac} className="stg-ble-row">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="stg-ble-name">
              {d.victron ? (d.victron.model || 'Victron device') : (d.name || 'Unnamed device')}
              {d.victron?.kindLabel && <span className="stg-ble-chip">{d.victron.kindLabel}</span>}
            </div>
            <div className="stg-hint">
              {d.mac} · {d.rssi} dBm{d.name && d.victron ? ` · ${d.name}` : ''}
              {d.victron?.keyStartsWith && ` · key starts with ${d.victron.keyStartsWith}`}
              {d.victron?.note && ` · ${d.victron.note}`}
              {!d.victron && d.manufacturers.length > 0 && ` · mfr ${d.manufacturers.join(', ')}`}
            </div>
          </div>
          {d.victron && (configured.has(d.mac)
            ? <span className="stg-hint">added</span>
            : <Button variant="secondary" onClick={() => onAdd(d)}>+ Add</Button>)}
        </div>
      ))}
    </div>
  )
}
