import { useEffect, useState } from 'react'
import { SettingsCard, Button } from '../primitives'

// Settings → System → CAN bus scan — passive (listen-only) look at a CAN bus:
// SocketCAN interfaces (incl. the Arduino VENTUNO Q's three CAN-FD ports,
// which its CANnectivity firmware exposes as can0..can2) or SLCAN USB
// adapters. Tool module lsh-can (src/lsh-can-scan.js). Shares the LAN scan
// look (.lan-hero / .lan-tile in settings.css).

const BITRATES = [125000, 250000, 500000, 1000000]
const kbit = (b) => (b ? `${b >= 1000000 ? b / 1000000 + ' M' : b / 1000 + ' k'}bit/s` : '?')
const PROTO_COLOR = { bms: '#30d158', nmea2000: '#0a84ff', j1939: '#ff9f0a', canopen: '#bf5af2', 'j1939-like': '#ff9f0a', unknown: '#8e8e93' }

const api = (url, body) => fetch(url, body ? { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'include' })
  .then((r) => r.json()).catch((e) => ({ success: false, error: e.message }))

function Wave({ active }) {
  // CAN_H / CAN_L differential pair, scrolling
  const bits = '0110100111010010110011101001011000101101'
  let h = 'M0 20', l = 'M0 40', x = 0
  for (const b of bits + bits) {
    const yh = b === '0' ? 8 : 20, yl = b === '0' ? 52 : 40
    h += ` L${x} ${yh} L${x + 12} ${yh}`; l += ` L${x} ${yl} L${x + 12} ${yl}`; x += 12
  }
  return (
    <div className={`can-wave${active ? ' scanning' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 480 60" preserveAspectRatio="none">
        <g className="can-wave-track">
          <path d={h} className="can-h"/>
          <path d={l} className="can-l"/>
        </g>
      </svg>
      <span className="can-wave-label h">CAN_H</span>
      <span className="can-wave-label l">CAN_L</span>
    </div>
  )
}

function Bytes({ hex, mask }) {
  const bytes = hex.match(/../g) || []
  return (
    <span className="can-bytes">
      {bytes.map((b, i) => <i key={i} className={mask & (1 << i) ? 'chg' : ''}>{b.toUpperCase()}</i>)}
      {!bytes.length && <i className="empty">—</i>}
    </span>
  )
}

export default function CanScanSection() {
  const [ifs, setIfs] = useState(null)
  const [src, setSrc] = useState(null) // { iface } | { serialPort }
  const [bitrate, setBitrate] = useState(250000)
  const [seconds, setSeconds] = useState(10)
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState(null)
  const [needsModule, setNeedsModule] = useState(false)
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(null)
  const [filter, setFilter] = useState('')

  const loadIfs = async () => {
    const j = await api('/api/lsh-can/interfaces')
    if (!j.success) { setNeedsModule(!!j.needsModule); setError(j.needsModule ? null : j.error); return }
    setNeedsModule(false); setIfs(j.data)
    setSrc((s) => s || (j.data.socketcan[0] ? { iface: j.data.socketcan[0].name } : j.data.serial.find((p) => p.slcanLikely) ? { serialPort: j.data.serial.find((p) => p.slcanLikely).path } : null))
  }
  useEffect(() => { loadIfs() }, [])
  useEffect(() => {
    if (!busy) return
    const t0 = Date.now(); setElapsed(0)
    const t = setInterval(() => setElapsed((Date.now() - t0) / 1000), 250)
    return () => clearInterval(t)
  }, [busy])

  const install = async () => {
    setBusy(true); setError('Installing the CAN bus scan module…')
    const j = await api('/api/modules/lsh-can/install', {})
    setBusy(false)
    if (!j.success) { setError(j.error); return }
    setError(null); loadIfs()
  }

  const run = async () => {
    if (!src) return
    setBusy(true); setError(null)
    const j = await api('/api/lsh-can/scan', { ...src, bitrate, seconds })
    setBusy(false)
    if (!j.success) { setError(j.error); if (j.needsModule) setNeedsModule(true); return }
    setData(j.data); setOpen(null); loadIfs()
  }

  const selIf = ifs?.socketcan.find((x) => x.name === src?.iface)
  const color = PROTO_COLOR[data?.protocol] || '#8e8e93'
  const q = filter.trim().toLowerCase()
  const rows = (data?.ids || []).filter((r) => !q || [r.idHex, r.name, r.pgn, r.source, r.data].some((x) => String(x ?? '').toLowerCase().includes(q)))

  return (
    <SettingsCard title="CAN bus scan"
      desc="Listens to a CAN bus without transmitting and shows what's on it: every frame ID with its rate, length and changing bytes, the protocol (NMEA 2000 / Victron VE.Can, J1939, CANopen, battery BMS) and the values it can decode. Works with SocketCAN interfaces — including the Arduino VENTUNO Q's three CAN-FD ports — and SLCAN USB adapters (CANable, USBtin).">
      <div className="lan-hero can-hero" style={{ '--g': color }}>
        <Wave active={busy}/>
        <div className="lan-hero-body">
          {busy ? (
            <>
              <div className="lan-hero-title">Listening<span className="lan-dots"><i/><i/><i/></span></div>
              <div className="lan-hero-sub">{src?.iface || src?.serialPort} · listen-only · {Math.max(0, Math.ceil(seconds - elapsed))} s left</div>
              <div className="lan-progress"><i style={{ width: `${Math.min(100, (elapsed / seconds) * 100)}%` }}/></div>
            </>
          ) : data ? (
            <>
              <div className="lan-hero-title">{data.protocolLabel}</div>
              <div className="lan-hero-sub">{data.source.name}{data.source.bitrate ? ` · ${kbit(data.source.bitrate)}` : ''} · {Math.round(data.durationMs / 1000)} s{data.source.listenOnly ? ' · listen-only' : ''}{data.truncated ? ' · capture capped' : ''}</div>
            </>
          ) : (
            <>
              <div className="lan-hero-title">{ifs?.ventuno ? 'VENTUNO Q CAN-FD' : 'What’s on the CAN bus'}</div>
              <div className="lan-hero-sub">Passive capture — frame IDs, rates, protocol, decoded values. Never transmits.</div>
            </>
          )}
          {data && (
            <div className="lan-stats">
              <div className="lan-stat"><b>{data.frames}</b><span>frames</span></div>
              <div className="lan-stat ble-blue"><b>{data.idCount}</b><span>IDs</span></div>
              <div className="lan-stat"><b>{data.nodes.length}</b><span>nodes</span></div>
              <div className={`lan-stat ${data.busLoad > 70 ? 'orange' : 'green'}`}><b>{data.busLoad ?? '—'}{data.busLoad != null && <small>%</small>}</b><span>bus load</span></div>
            </div>
          )}
          <div className="lan-hero-actions">
            <button className="lan-scan-btn" disabled={busy || !src || needsModule} onClick={run}>{busy ? 'Listening…' : data ? '↻ Listen again' : '🚌 Listen'}</button>
            {needsModule && <Button variant="primary" busy={busy} onClick={install}>Install module</Button>}
          </div>
        </div>
      </div>

      {error && <div className={`stg-banner ${busy ? 'ok' : 'err'}`} style={{ marginTop: 10 }}>{busy ? '' : '✗ '}{error}</div>}

      {ifs && (
        <div className="can-sources">
          {ifs.socketcan.map((x) => (
            <button key={x.name} className={`can-src${src?.iface === x.name ? ' active' : ''}`} onClick={() => setSrc({ iface: x.name })}>
              <i className={`lan-dot ${x.up ? 'on' : 'off'}`}/>
              <b>{x.name}</b>
              <span>{[x.label || (x.virtual ? 'virtual' : x.driver), x.bitrate && kbit(x.bitrate), x.fd && 'FD', x.listenOnly && 'listen-only', !x.up && 'down', x.state && x.state !== 'ERROR-ACTIVE' && x.state.toLowerCase()].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
          {ifs.serial.map((p) => (
            <button key={p.path} className={`can-src${src?.serialPort === p.path ? ' active' : ''}`} onClick={() => setSrc({ serialPort: p.path })} title={p.device}>
              <i className="lan-dot"/>
              <b>{p.label}</b>
              <span>SLCAN{p.slcanLikely ? '' : '?'} · {p.device}</span>
            </button>
          ))}
          {src?.serialPort && (
            <select className="stg-input can-select" value={bitrate} onChange={(e) => setBitrate(Number(e.target.value))}>
              {BITRATES.map((b) => <option key={b} value={b}>{kbit(b)}</option>)}
            </select>
          )}
          <select className="stg-input can-select" value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
            {[5, 10, 30, 60].map((s) => <option key={s} value={s}>{s} s</option>)}
          </select>
        </div>
      )}

      {ifs && <Hints ifs={ifs} sel={selIf}/>}

      {data && data.highlights.length > 0 && (
        <div className="can-values">
          {data.highlights.map((h, i) => (
            <div key={i} className="lan-stat can-value" style={{ animationDelay: `${i * 30}ms` }}>
              <b>{h.value}{h.unit && <small>{h.unit}</small>}</b><span>{h.label}</span><em>{h.from}</em>
            </div>
          ))}
        </div>
      )}

      {data && data.nodes.length > 0 && (
        <div className="lan-filters">
          {data.nodes.map((n) => (
            <span key={n.address} className="lan-filter" title={`${n.frames} frames${n.pgnCount ? ` · ${n.pgnCount} PGNs` : ''}`}>
              <i className="lan-filter-dot" style={{ background: color }}/>
              {n.name?.manufacturer || (n.name ? `mfr ${n.name.manufacturerCode}` : 'node')} · {n.address}
            </span>
          ))}
        </div>
      )}

      {data && (
        <>
          {data.ids.length > 8 && <div className="lan-toolbar"><input className="stg-input lan-search" placeholder="Search ID, PGN, name, bytes…" value={filter} onChange={(e) => setFilter(e.target.value)}/></div>}
          <div className="lan-grid can-grid">
            {rows.map((r, i) => {
              const key = `${r.ext ? 'x' : 's'}${r.id}`
              const isOpen = open === key
              return (
                <div key={key} className={`lan-tile${isOpen ? ' open' : ''}`} style={{ '--g': r.decoded.length ? color : r.name ? '#64d2ff' : '#8e8e93', animationDelay: `${Math.min(i, 30) * 20}ms` }}>
                  <div className="lan-tile-main" onClick={() => setOpen(isOpen ? null : key)}>
                    <div className="lan-tile-icon can-id">{r.ext ? 'EXT' : 'STD'}</div>
                    <div className="lan-tile-text">
                      <div className="lan-tile-name"><span className="can-mono">{r.idHex}</span> {r.name || 'Unknown'}</div>
                      <div className="lan-tile-sub">
                        {r.pgn != null ? `PGN ${r.pgn} · src ${r.source}` : ''}{r.pgn != null ? ' · ' : ''}{r.count}× · DLC {r.dlc.join('/')}{r.fd ? ' · FD' : ''}
                      </div>
                    </div>
                    <span className="lan-lat good">{r.rate}<small>Hz</small></span>
                  </div>
                  <div className="lan-tile-chips"><Bytes hex={r.data} mask={r.changedMask}/></div>
                  {r.decoded.length > 0 && (
                    <div className="lan-tile-chips">
                      {r.decoded.map((d) => <span key={d.label} className="lan-kind">{d.label}: <b>{d.value}{d.unit ? ` ${d.unit}` : ''}</b></span>)}
                    </div>
                  )}
                  {isOpen && (
                    <div className="ble-dd">
                      <div className="ble-dd-sec">
                        <div className="ble-dd-title">Last distinct payloads</div>
                        {r.samples.map((s) => <div key={s}><Bytes hex={s} mask={0}/></div>)}
                      </div>
                      <div className="ble-dd-sec">
                        <div className="ble-dd-kv"><span className="stg-hint">Period</span><span>{r.periodMs != null ? `${r.periodMs} ms` : '—'}</span></div>
                        {r.priority != null && <div className="ble-dd-kv"><span className="stg-hint">Priority / destination</span><span>{r.priority} / {r.dest === 255 ? 'broadcast' : r.dest}</span></div>}
                        <div className="ble-dd-kv"><span className="stg-hint">Changing bytes</span><span>{r.changedMask ? [...Array(8)].map((_, b) => (r.changedMask & (1 << b) ? b : null)).filter((x) => x != null).join(', ') : 'none (static)'}</span></div>
                        {r.remote > 0 && <div className="ble-dd-kv"><span className="stg-hint">Remote frames</span><span>{r.remote}</span></div>}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
            {!rows.length && <div className="stg-hint">{data.frames ? 'Nothing matches.' : 'No frames received — check wiring, termination (120 Ω at both ends) and bitrate.'}</div>}
          </div>
        </>
      )}
    </SettingsCard>
  )
}

function Hints({ ifs, sel }) {
  const tips = []
  if (ifs.platform !== 'linux') tips.push(<>CAN scanning needs a Linux LSH host (e.g. an Arduino VENTUNO Q).</>)
  else {
    if (ifs.ventuno && !ifs.ventuno.interfaces.length) tips.push(<>VENTUNO Q CAN-FD firmware found on USB (1209:ca01) but no CAN interfaces — load the gs_usb driver: <code>sudo modprobe gs_usb; echo 1209 ca01 | sudo tee /sys/bus/usb/drivers/gs_usb/new_id</code></>)
    if (ifs.socketcan.length && !ifs.candump) tips.push(<>Install can-utils for SocketCAN capture: <code>sudo apt install can-utils</code></>)
    if (sel && !sel.up) tips.push(<>{sel.name} is down. Bring it up listen-only, e.g. at 250 kbit/s (NMEA 2000, VE.Can, J1939) or 500 kbit/s (battery BMS): <code>sudo ip link set {sel.name} up type can bitrate 250000 listen-only on</code></>)
    if (sel && sel.up && !sel.listenOnly && !sel.virtual) tips.push(<>{sel.name} isn’t in listen-only mode — LSH never transmits, but the controller still ACKs frames. For a strictly passive tap: <code>sudo ip link set {sel.name} down; sudo ip link set {sel.name} up type can bitrate {sel.bitrate || 250000} listen-only on</code></>)
    if (!ifs.socketcan.length && !ifs.serial.length) tips.push(<>No CAN interface or USB serial adapter found on this host.</>)
  }
  if (!tips.length) return null
  return <div className="can-hints">{tips.map((t, i) => <div key={i} className="stg-hint">{t}</div>)}</div>
}
