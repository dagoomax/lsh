import { useEffect, useState } from 'react'
import { SettingsCard, Button } from '../primitives'

// Settings → System → Modbus scan — read-only discovery of Modbus TCP servers
// on this host's LAN and of unit IDs on an RS-485 bus (Modbus RTU), with a
// register explorer. Tool module lsh-modbus (src/lsh-modbus-scan.js). Shares
// the LAN scan look (.lan-hero / .lan-tile in settings.css).

const KIND = {
  sunspec: { icon: '☀️', color: '#ffd60a', label: 'SunSpec' },
  'victron-gx': { icon: '🔋', color: '#0a84ff', label: 'Victron GX' },
  'energy-meter': { icon: '⚡', color: '#30d158', label: 'Energy meter' },
  huawei: { icon: '🔆', color: '#ff375f', label: 'Huawei' },
  'device-id': { icon: '🏷', color: '#bf5af2', label: 'Device ID' },
  unknown: { icon: '❔', color: '#8e8e93', label: 'Responds' },
  error: { icon: '⚠️', color: '#ff9f0a', label: 'Error' },
}
const FC = { 3: 'Holding registers (03)', 4: 'Input registers (04)', 1: 'Coils (01)', 2: 'Discrete inputs (02)' }
const BAUDS = [2400, 4800, 9600, 19200, 38400, 57600, 115200]

const api = (url, body) => fetch(url, body ? { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'include' })
  .then((r) => r.json()).catch((e) => ({ success: false, error: e.message }))

function RegGrid({ active }) {
  return (
    <div className={`mb-grid${active ? ' scanning' : ''}`} aria-hidden="true">
      {[...Array(40)].map((_, i) => <i key={i} style={{ animationDelay: `${((i * 37) % 40) * 0.09}s` }}>{((i * 2654435761) >>> 20 & 0xffff).toString(16).padStart(4, '0').toUpperCase()}</i>)}
    </div>
  )
}

export default function ModbusScanSection() {
  const [ports, setPorts] = useState(null)
  const [mode, setMode] = useState('tcp')
  const [host, setHost] = useState('')
  const [tcpPort, setTcpPort] = useState(502)
  const [units, setUnits] = useState('')
  const [serialPort, setSerialPort] = useState('')
  const [baud, setBaud] = useState(9600)
  const [parity, setParity] = useState('none')
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState(null)
  const [needsModule, setNeedsModule] = useState(false)
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(null)

  const loadPorts = async () => {
    const j = await api('/api/lsh-modbus/ports')
    if (!j.success) { setNeedsModule(!!j.needsModule); if (!j.needsModule) setError(j.error); return }
    setNeedsModule(false); setPorts(j.data)
    setSerialPort((p) => p || j.data.serial.find((s) => s.rs485Likely)?.path || j.data.serial[0]?.path || '')
  }
  useEffect(() => { loadPorts() }, [])
  useEffect(() => {
    if (!busy) return
    const t0 = Date.now(); setElapsed(0)
    const t = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500)
    return () => clearInterval(t)
  }, [busy])

  const install = async () => {
    setBusy(true); setError('Installing the Modbus scan module…')
    const j = await api('/api/modules/lsh-modbus/install', {})
    setBusy(false)
    if (!j.success) { setError(j.error); return }
    setError(null); loadPorts()
  }

  const run = async () => {
    setBusy(true); setError(null)
    const j = await api('/api/lsh-modbus/scan', mode === 'tcp'
      ? { mode, host, port: tcpPort, units }
      : { mode, serialPort, baud, parity, units })
    setBusy(false)
    if (!j.success) { setError(j.error); if (j.needsModule) setNeedsModule(true); return }
    setData(j.data); setOpen(null)
  }

  const devs = data?.devices || []
  const found = devs.filter((d) => d.kind !== 'error')
  const kinds = Object.keys(KIND).map((k) => ({ k, n: devs.filter((d) => d.kind === k).length })).filter((x) => x.n)
  const targetLabel = mode === 'tcp' ? (host || `LAN sweep ${ports?.subnets.map((s) => s.cidr).join(', ') || ''}`) : `${serialPort} · ${baud} ${parity}`

  return (
    <SettingsCard title="Modbus scan"
      desc="Finds Modbus devices without changing anything: Modbus TCP servers on this host's network (port 502) and the unit IDs behind them, or devices on an RS-485 bus (Modbus RTU through a USB adapter). Identifies SunSpec inverters, Victron GX, Eastron-style energy meters and Huawei SUN2000, and has a register explorer. Only read requests are sent.">
      <div className="lan-hero">
        <RegGrid active={busy}/>
        <div className="lan-hero-body">
          {busy ? (
            <>
              <div className="lan-hero-title">Polling<span className="lan-dots"><i/><i/><i/></span></div>
              <div className="lan-hero-sub">{targetLabel} · {elapsed} s</div>
              <div className="lan-progress"><i style={{ width: `${Math.min(96, (elapsed / (mode === 'rtu' ? 60 : 20)) * 100)}%` }}/></div>
            </>
          ) : data ? (
            <>
              <div className="lan-hero-title">{found.length} Modbus device{found.length === 1 ? '' : 's'}</div>
              <div className="lan-hero-sub">{data.mode === 'tcp' ? `${data.hosts.length} host${data.hosts.length === 1 ? '' : 's'} with port ${data.port} open` : data.target} · {Math.round(data.durationMs / 1000)} s</div>
            </>
          ) : (
            <>
              <div className="lan-hero-title">Find Modbus devices</div>
              <div className="lan-hero-sub">Modbus TCP on the LAN or RTU on RS-485 · identify, then browse registers</div>
            </>
          )}
          {data && (
            <div className="lan-stats">
              <div className="lan-stat"><b>{data.mode === 'tcp' ? data.hosts.length : '—'}</b><span>hosts</span></div>
              <div className="lan-stat ble-blue"><b>{found.length}</b><span>units</span></div>
              <div className="lan-stat green"><b>{found.filter((d) => d.kind !== 'unknown').length}</b><span>identified</span></div>
              <div className="lan-stat"><b>{Math.round(data.durationMs / 1000)}<small>s</small></b><span>scan time</span></div>
            </div>
          )}
          {kinds.length > 0 && <div className="lan-mix">{kinds.map(({ k, n }) => <i key={k} style={{ flex: n, background: KIND[k].color }} title={`${KIND[k].label}: ${n}`}/>)}</div>}
          <div className="lan-hero-actions">
            <button className="lan-scan-btn" disabled={busy || needsModule || (mode === 'rtu' && !serialPort)} onClick={run}>{busy ? 'Scanning…' : data ? '↻ Scan again' : '🔎 Scan'}</button>
            {needsModule && <Button variant="primary" busy={busy} onClick={install}>Install module</Button>}
          </div>
        </div>
      </div>

      {error && <div className={`stg-banner ${busy ? 'ok' : 'err'}`} style={{ marginTop: 10 }}>{busy ? '' : '✗ '}{error}</div>}

      <div className="lan-toolbar">
        <div className="lan-viewtoggle">
          <button className={mode === 'tcp' ? 'active' : ''} onClick={() => setMode('tcp')}>Modbus TCP</button>
          <button className={mode === 'rtu' ? 'active' : ''} onClick={() => setMode('rtu')}>Modbus RTU (RS-485)</button>
        </div>
      </div>
      <div className="mb-form">
        {mode === 'tcp' ? (
          <>
            <label><span>Host(s)</span><input className="stg-input" value={host} onChange={(e) => setHost(e.target.value)} placeholder="empty = sweep this LAN"/></label>
            <label className="narrow"><span>Port</span><input className="stg-input" type="number" value={tcpPort} onChange={(e) => setTcpPort(Number(e.target.value))}/></label>
            <label><span>Unit IDs</span><input className="stg-input" value={units} onChange={(e) => setUnits(e.target.value)} placeholder="1,2,3,100,126,247,255,0"/></label>
          </>
        ) : (
          <>
            <label><span>Serial port</span>
              <select className="stg-input" value={serialPort} onChange={(e) => setSerialPort(e.target.value)}>
                {!ports?.serial.length && <option value="">No USB serial adapter found</option>}
                {ports?.serial.map((p) => <option key={p.path} value={p.path}>{p.label} ({p.device})</option>)}
              </select>
            </label>
            <label className="narrow"><span>Baud</span>
              <select className="stg-input" value={baud} onChange={(e) => setBaud(Number(e.target.value))}>{BAUDS.map((b) => <option key={b}>{b}</option>)}</select>
            </label>
            <label className="narrow"><span>Parity</span>
              <select className="stg-input" value={parity} onChange={(e) => setParity(e.target.value)}>{['none', 'even', 'odd'].map((p) => <option key={p}>{p}</option>)}</select>
            </label>
            <label><span>Unit IDs</span><input className="stg-input" value={units} onChange={(e) => setUnits(e.target.value)} placeholder="1-247"/></label>
          </>
        )}
      </div>
      {mode === 'rtu' && <div className="stg-hint" style={{ margin: '0 0 8px' }}>A full 1–247 sweep takes about a minute. Most meters ship at 9600 baud, 8N1 or 8E1; if nothing answers, try swapping A/B.</div>}

      {data && (
        <div className="lan-grid">
          {devs.map((d, i) => {
            const k = KIND[d.kind] || KIND.unknown
            const key = `${d.host || d.target}-${d.unit}`
            const isOpen = open === key
            return (
              <div key={key} className={`lan-tile${isOpen ? ' open' : ''}`} style={{ '--g': k.color, animationDelay: `${Math.min(i, 30) * 25}ms` }}>
                <div className="lan-tile-main" onClick={() => d.unit != null && setOpen(isOpen ? null : key)}>
                  <div className="lan-tile-icon"><span>{k.icon}</span></div>
                  <div className="lan-tile-text">
                    <div className="lan-tile-name">{d.label || `Unit ${d.unit}`}</div>
                    <div className="lan-tile-sub">{d.transport === 'tcp' ? `${d.host}:${d.port}` : d.target}{d.unit != null ? ` · unit ${d.unit}` : ''}</div>
                  </div>
                  <span className="lan-kind">{k.label}</span>
                </div>
                <div className="lan-tile-chips">
                  {d.values?.map((v) => <span key={v.label} className="lan-kind">{v.label}: <b>{v.value}{v.unit ? ` ${v.unit}` : ''}</b></span>)}
                  {d.details?.sunspec && <span className="lan-port">SN {d.details.sunspec.serial} · fw {d.details.sunspec.version} · models {d.details.sunspec.models.join(', ')}</span>}
                  {d.details?.deviceId?.revision && <span className="lan-port">rev {d.details.deviceId.revision}</span>}
                  {d.kind === 'unknown' && d.probe?.exception && <span className="lan-port">exception {d.probe.exception} at register 0</span>}
                </div>
                {isOpen && <Explorer dev={d} rtu={{ serialPort, baud, parity }}/>}
              </div>
            )
          })}
          {!devs.length && <div className="stg-hint">No Modbus devices answered{data.mode === 'tcp' ? ` (no host with port ${data.port} open${data.hosts.length ? ' answered' : ''})` : ' — check baud, parity, A/B wiring and termination'}.</div>}
        </div>
      )}
    </SettingsCard>
  )
}

function Explorer({ dev, rtu }) {
  const [fc, setFc] = useState(dev.kind === 'energy-meter' ? 4 : 3)
  const [address, setAddress] = useState(dev.details?.sunspec?.base ?? (dev.kind === 'victron-gx' ? 840 : 0))
  const [count, setCount] = useState(16)
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    const target = dev.transport === 'tcp' ? { mode: 'tcp', host: dev.host, port: dev.port } : { mode: 'rtu', ...rtu }
    const j = await api('/api/lsh-modbus/read', { ...target, unit: dev.unit, fc, address, count })
    setBusy(false)
    setRes(j.success ? j.data : { error: j.error })
  }
  return (
    <div className="ble-dd" onClick={(e) => e.stopPropagation()}>
      <div className="mb-form tight">
        <label><span>Function</span><select className="stg-input" value={fc} onChange={(e) => setFc(Number(e.target.value))}>{Object.entries(FC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="narrow"><span>Address</span><input className="stg-input" type="number" value={address} onChange={(e) => setAddress(Number(e.target.value))}/></label>
        <label className="narrow"><span>Count</span><input className="stg-input" type="number" min="1" max="125" value={count} onChange={(e) => setCount(Number(e.target.value))}/></label>
        <Button variant="primary" busy={busy} onClick={go}>Read</Button>
      </div>
      {res?.error && <div className="stg-banner err">✗ {res.error}</div>}
      {res?.values && (res.fc <= 2 ? (
        <div className="can-bytes">{res.values.map((b, i) => <i key={i} className={b ? 'chg' : ''} title={`${res.address + i}`}>{b}</i>)}</div>
      ) : (
        <div className="mb-table-wrap">
          <table className="mb-table">
            <thead><tr><th>Addr</th><th>u16</th><th>i16</th><th>hex</th><th>ascii</th><th>u32</th><th>float32</th></tr></thead>
            <tbody>
              {res.values.map((v, i) => (
                <tr key={i}><td>{res.address + i}</td><td>{v.u16}</td><td>{v.i16}</td><td>{v.hex}</td><td>{v.ascii}</td><td>{v.u32 ?? ''}</td><td>{v.f32 ?? ''}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
