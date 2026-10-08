import { useEffect, useState } from 'react'
import { Button } from './primitives'
import BleDeepDive from './BleDeepDive'

// Bluetooth LE scan of the LSH host (POST /api/lsh-ble/scan — lives in the
// lsh-ble module, so it offers to install that module when it's missing).
// Used by Settings → System → Bluetooth scan (everything in range) and
// Settings → Energy → LSH BLE (Victron devices, with "+ Add").
// Shares the LAN scan look (.lan-hero / .lan-radar / .lan-tile in settings.css).

// Common Bluetooth SIG company ids, for readability.
const COMPANIES = {
  '0x0006': 'Microsoft', '0x004c': 'Apple', '0x0075': 'Samsung', '0x00e0': 'Google', '0x0087': 'Garmin',
  '0x0157': 'Huami', '0x038f': 'Xiaomi', '0x02e1': 'Victron', '0x0059': 'Nordic', '0x000f': 'Broadcom',
  '0x0131': 'Cypress', '0x0171': 'Amazon', '0x01da': 'Logitech', '0x0499': 'Ruuvi', '0x05a7': 'Sonos',
  '0x0822': 'Shelly', '0x0969': 'Woan (SwitchBot)', '0x05a8': 'Eve', '0x005c': 'Belkin', '0x0310': 'SGL Italia', '0x0002': 'Intel', '0x000a': 'Qualcomm',
}
const company = (id) => COMPANIES[id] || id

const GROUPS = [
  { id: 'victron', label: 'Victron', color: '#0a84ff', icon: '🔋', ids: ['0x02e1'] },
  { id: 'apple', label: 'Apple', color: '#bf5af2', icon: '🍎', ids: ['0x004c'] },
  { id: 'personal', label: 'Phones & wearables', color: '#30d158', icon: '⌚', ids: ['0x0075', '0x00e0', '0x0087', '0x0157', '0x038f', '0x0006', '0x01da'] },
  { id: 'home', label: 'Smart home', color: '#ff9f0a', icon: '🏠', ids: ['0x0171', '0x0499', '0x05a7', '0x0822', '0x0969', '0x05a8'] },
  { id: 'chip', label: 'Modules & beacons', color: '#64d2ff', icon: '📟', ids: ['0x0059', '0x000f', '0x0131'] },
  { id: 'other', label: 'Other', color: '#8e8e93', icon: '📶', ids: [] },
]
const groupOf = (d) => (d.victron ? GROUPS[0] : GROUPS.find((g) => d.manufacturers.some((m) => g.ids.includes(m))) || GROUPS[GROUPS.length - 1])

const strength = (rssi) => (rssi >= -60 ? 4 : rssi >= -70 ? 3 : rssi >= -80 ? 2 : 1)
const proximity = (rssi) => ['far', 'in range', 'nearby', 'very close'][strength(rssi) - 1]

// Radar position: distance from the centre follows signal strength, angle is
// stable per MAC.
function blip(d, i) {
  const n = d.mac.split(':').reduce((a, x) => (a * 31 + parseInt(x, 16)) % 100003, 7)
  const angle = ((n % 360) / 360) * Math.PI * 2
  const r = Math.min(0.95, Math.max(0.12, (-(d.rssi ?? -90) - 40) / 60))
  const c = groupOf(d).color
  return { left: `${50 + Math.cos(angle) * r * 46}%`, top: `${50 + Math.sin(angle) * r * 46}%`, background: c, color: c, animationDelay: `${(i % 12) * 0.12}s` }
}

export default function BleScanner({ victronOnly = false, configuredMacs = new Set(), onAdd, seconds = 10 }) {
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)
  const [needsModule, setNeedsModule] = useState(false)
  const [showAll, setShowAll] = useState(!victronOnly)
  const [group, setGroup] = useState(null)
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState(null) // MAC of the device being inspected

  useEffect(() => {
    if (!busy) return
    const t0 = Date.now()
    setElapsed(0)
    const t = setInterval(() => setElapsed((Date.now() - t0) / 1000), 250)
    return () => clearInterval(t)
  }, [busy])

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

  const all = results || []
  const victron = all.filter((d) => d.victron)
  const q = filter.trim().toLowerCase()
  const shown = (showAll ? all : victron)
    .filter((d) => !group || groupOf(d).id === group)
    .filter((d) => !q || [d.mac, d.name, d.victron?.model, d.victron?.kindLabel, ...d.manufacturers.map(company)].some((x) => String(x || '').toLowerCase().includes(q)))
  const present = GROUPS.map((g) => ({ g, n: all.filter((d) => groupOf(d) === g).length })).filter((x) => x.n)
  const strongest = all.length ? Math.max(...all.map((d) => d.rssi)) : null
  const scanning = busy && !needsModule

  return (
    <div>
      <div className="lan-hero ble-hero">
        <div className={`lan-radar${scanning ? ' scanning' : ''}`} aria-hidden="true">
          <div className="lan-radar-sweep"/>
          <div className="lan-radar-core ble-core"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 7l10 10-5 5V2l5 5L7 17"/></svg></div>
          {all.slice(0, 80).map((d, i) => <span key={d.mac} className="lan-blip" style={blip(d, i)}/>)}
        </div>
        <div className="lan-hero-body">
          {scanning ? (
            <>
              <div className="lan-hero-title">Listening<span className="lan-dots"><i/><i/><i/></span></div>
              <div className="lan-hero-sub">Bluetooth LE advertisements · {Math.max(0, Math.ceil(seconds - elapsed))} s left</div>
              <div className="lan-progress"><i style={{ width: `${Math.min(100, (elapsed / seconds) * 100)}%` }}/></div>
            </>
          ) : results ? (
            <>
              <div className="lan-hero-title">{all.length} device{all.length === 1 ? '' : 's'} in range</div>
              <div className="lan-hero-sub">
                {victronOnly && !victron.length ? 'No Victron devices — enable Instant readout and disconnect VictronConnect' : 'Closer to the centre = stronger signal'}
              </div>
            </>
          ) : (
            <>
              <div className="lan-hero-title">{victronOnly ? 'Find Victron devices' : 'What’s around, over Bluetooth'}</div>
              <div className="lan-hero-sub">Listens to Bluetooth LE advertisements on this LSH host for {seconds} s · manufacturer, signal strength, Victron model</div>
            </>
          )}
          {results && (
            <div className="lan-stats">
              <div className="lan-stat"><b>{all.length}</b><span>devices</span></div>
              <div className="lan-stat ble-blue"><b>{victron.length}</b><span>Victron</span></div>
              <div className="lan-stat"><b>{all.filter((d) => d.name || d.victron?.model).length}</b><span>named</span></div>
              <div className="lan-stat green"><b>{strongest ?? '—'}{strongest != null && <small>dBm</small>}</b><span>strongest</span></div>
            </div>
          )}
          {present.length > 0 && (
            <div className="lan-mix">{present.map(({ g, n }) => <i key={g.id} style={{ flex: n, background: g.color }} title={`${g.label}: ${n}`}/>)}</div>
          )}
          <div className="lan-hero-actions">
            <button className="lan-scan-btn" disabled={busy} onClick={run}>{scanning ? 'Listening…' : results ? '↻ Scan again' : '📡 Scan Bluetooth'}</button>
            {needsModule && <Button variant="primary" busy={busy} onClick={install}>Install module</Button>}
          </div>
        </div>
      </div>
      {error && <div className={`stg-banner ${busy ? 'ok' : 'err'}`} style={{ marginTop: 10 }}>{busy ? '' : '✗ '}{error}</div>}

      {results && (
        <>
          <div className="lan-toolbar">
            {all.length > 6 && <input className="stg-input lan-search" placeholder="Search name, MAC, manufacturer…" value={filter} onChange={(e) => setFilter(e.target.value)}/>}
            {victronOnly && (
              <label className="stg-hint" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)}/>
                show non-Victron devices
              </label>
            )}
          </div>
          {showAll && present.length > 1 && (
            <div className="lan-filters">
              <button className={`lan-filter${!group ? ' active' : ''}`} onClick={() => setGroup(null)}>All {all.length}</button>
              {present.map(({ g, n }) => (
                <button key={g.id} className={`lan-filter${group === g.id ? ' active' : ''}`} style={{ '--g': g.color }} onClick={() => setGroup(group === g.id ? null : g.id)}>
                  <i className="lan-filter-dot"/>{g.label} {n}
                </button>
              ))}
            </div>
          )}
          <div className="lan-grid">
            {shown.map((d, i) => {
              const g = groupOf(d)
              const isOpen = open === d.mac
              const s = strength(d.rssi)
              return (
                <div key={d.mac} className={`lan-tile${isOpen ? ' open' : ''}`} style={{ '--g': g.color, animationDelay: `${Math.min(i, 30) * 25}ms` }}>
                  <div className="lan-tile-main" onClick={() => setOpen(isOpen ? null : d.mac)} title="Deep dive">
                    <div className="lan-tile-icon"><span>{g.icon}</span></div>
                    <div className="lan-tile-text">
                      <div className="lan-tile-name">{d.victron ? (d.victron.model || 'Victron device') : (d.name || (COMPANIES[d.manufacturers[0]] ? `${COMPANIES[d.manufacturers[0]]} device` : 'Unnamed device'))}</div>
                      <div className="lan-tile-sub">{d.mac}{d.name && d.victron ? ` · ${d.name}` : ''}</div>
                    </div>
                    <div className={`ble-signal s${s}`} title={`${d.rssi} dBm · ${proximity(d.rssi)}`}>
                      <span className="ble-bars">{[1, 2, 3, 4].map((k) => <i key={k} className={k <= s ? 'on' : ''}/>)}</span>
                      <b>{d.rssi}<small>dBm</small></b>
                    </div>
                  </div>
                  <div className="lan-tile-chips">
                    <span className="lan-kind">{proximity(d.rssi)}</span>
                    {d.victron?.kindLabel && <span className="stg-ble-chip">{d.victron.kindLabel}</span>}
                    {d.victron?.keyStartsWith && <span className="lan-port">key {d.victron.keyStartsWith}…</span>}
                    {d.victron?.note && <span className="lan-tag tag-warn">{d.victron.note}</span>}
                    {d.manufacturers.map((m) => <span key={m} className="lan-port">{company(m)}</span>)}
                    {d.victron && onAdd && (configuredMacs.has(d.mac)
                      ? <span className="lan-tag tag-ok">added</span>
                      : <span onClick={(e) => e.stopPropagation()}><Button variant="primary" onClick={() => onAdd(d)}>+ Add</Button></span>)}
                  </div>
                  {isOpen && <BleDeepDive mac={d.mac}/>}
                </div>
              )
            })}
            {!shown.length && <div className="stg-hint">{victronOnly && !showAll ? 'No Victron devices in range.' : 'Nothing matches.'}</div>}
          </div>
        </>
      )}
    </div>
  )
}
