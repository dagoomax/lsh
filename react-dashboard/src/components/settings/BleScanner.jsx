import { useState } from 'react'
import { Button } from './primitives'

// Bluetooth LE scan of the LSH host (POST /api/lsh-ble/scan — lives in the
// lsh-ble module, so it offers to install that module when it's missing).
// Used by Settings → System → Bluetooth scan (everything in range) and
// Settings → Energy → LSH BLE (Victron devices, with "+ Add").

// Common Bluetooth SIG company ids, for readability.
const COMPANIES = {
  '0x0006': 'Microsoft', '0x004c': 'Apple', '0x0075': 'Samsung', '0x00e0': 'Google', '0x0087': 'Garmin',
  '0x0157': 'Huami', '0x038f': 'Xiaomi', '0x02e1': 'Victron', '0x0059': 'Nordic', '0x000f': 'Broadcom',
  '0x0131': 'Cypress', '0x0171': 'Amazon', '0x01da': 'Logitech', '0x0499': 'Ruuvi', '0x05a7': 'Sonos',
  '0x0822': 'Shelly', '0x0969': 'Woan (SwitchBot)', '0x05a8': 'Eve',
}
const company = (id) => COMPANIES[id] || id

export default function BleScanner({ victronOnly = false, configuredMacs = new Set(), onAdd, seconds = 10 }) {
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)
  const [needsModule, setNeedsModule] = useState(false)
  const [showAll, setShowAll] = useState(!victronOnly)

  const run = async () => {
    setBusy(true); setError(null); setNeedsModule(false)
    try {
      const r = await fetch('/api/lsh-ble/scan', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seconds }),
      })
      const j = await r.json()
      if (!j.success) { setError(j.error); setNeedsModule(!!j.needsModule) } else setResults(j.data)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const install = async () => {
    setBusy(true); setError('Installing the LSH BLE module…')
    const r = await fetch('/api/modules/lsh-ble/install', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then((x) => x.json()).catch((e) => ({ success: false, error: e.message }))
    if (!r.success) { setBusy(false); setError(r.error); return }
    run()
  }

  const victron = results?.filter((d) => d.victron) || []
  const shown = results ? (showAll ? results : victron) : []

  return (
    <div>
      <div className="stg-actions" style={{ marginTop: 4 }}>
        <Button variant="secondary" busy={busy} onClick={run}>📡 {results ? 'Scan again' : 'Scan for Bluetooth devices'}</Button>
        {needsModule && <Button variant="primary" busy={busy} onClick={install}>Install module</Button>}
        {results && victronOnly && (
          <label className="stg-hint" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)}/>
            show non-Victron devices
          </label>
        )}
      </div>
      {busy && !error && <div className="stg-hint" style={{ marginTop: 6 }}>Scanning for {seconds} s…</div>}
      {error && <div className={`stg-banner ${busy ? 'ok' : 'err'}`} style={{ marginTop: 6 }}>{busy ? '' : '✗ '}{error}</div>}
      {results && (
        <div className="stg-ble-scan">
          <div className="stg-hint">
            {results.length} Bluetooth device{results.length === 1 ? '' : 's'} in range · {victron.length} Victron
            {victronOnly && !victron.length && ' — make sure Instant readout is enabled and VictronConnect is disconnected'}
          </div>
          {shown.map((d) => (
            <div key={d.mac} className="stg-ble-row">
              <span className="stg-ble-rssi" title={`${d.rssi} dBm`}>{bars(d.rssi)}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="stg-ble-name">
                  {d.victron ? (d.victron.model || 'Victron device') : (d.name || 'Unnamed device')}
                  {d.victron?.kindLabel && <span className="stg-ble-chip">{d.victron.kindLabel}</span>}
                </div>
                <div className="stg-hint">
                  {d.mac} · {d.rssi} dBm{d.name && d.victron ? ` · ${d.name}` : ''}
                  {d.manufacturers.length > 0 && ` · ${d.manufacturers.map(company).join(', ')}`}
                  {d.victron?.keyStartsWith && ` · key starts with ${d.victron.keyStartsWith}`}
                  {d.victron?.note && ` · ${d.victron.note}`}
                </div>
              </div>
              {d.victron && onAdd && (configuredMacs.has(d.mac)
                ? <span className="stg-hint">added</span>
                : <Button variant="secondary" onClick={() => onAdd(d)}>+ Add</Button>)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// RSSI → 1–4 signal bars
function bars(rssi) {
  const n = rssi >= -60 ? 4 : rssi >= -70 ? 3 : rssi >= -80 ? 2 : 1
  return '▂▄▆█'.slice(0, n).padEnd(4, '·')
}
