import { useEffect, useMemo, useState } from 'react'
import { SettingsCard, Button } from '../primitives'
import LanTopology, { GROUPS, groupOf } from '../LanTopology'
import LanDevices, { TagChips, DeviceIcon } from '../LanDevices'

// Settings → System → LAN scan — what's on this LSH host's local network
// (tool module lsh-lan, installed from here on first use). Click a host for
// a deep dive.
const KIND_ICON = {
  shelly: '🔌', hue: '💡', sonos: '🔊', esphome: '📟', loxone: '🏠', fibaro: '🏠', wled: '🌈', cast: '📺', androidtv: '📺',
  airplay: '🎵', homekit: '🏡', matter: '🧩', homeassistant: '🏠', nodered: '🔀', mqtt: '📨', knx: '🔗', modbus: '🔗',
  camera: '📷', printer: '🖨️', victron: '🔋', apple: '🍎', network: '📶', web: '🌐', unknown: '❔',
}
const PHASES = ['ARP sweep', 'TCP probes', 'Bonjour / mDNS', 'UPnP / SSDP', 'Vendor lookup', 'Fingerprinting']

const latencyClass = (ms) => (ms == null ? '' : ms < 60 ? 'good' : ms < 250 ? 'ok' : 'slow')

// Stable pseudo-random position for a host on the radar (by IP)
function blip(h, i) {
  const n = h.ip.split('.').reduce((a, x) => a * 31 + Number(x), 7)
  const g = GROUPS.indexOf(groupOf(h))
  const angle = (g / GROUPS.length) * Math.PI * 2 + ((n % 100) / 100) * 0.55
  const r = 0.28 + ((n >> 3) % 60) / 100
  return { left: `${50 + Math.cos(angle) * r * 46}%`, top: `${50 + Math.sin(angle) * r * 46}%`, background: groupOf(h).color, color: groupOf(h).color, animationDelay: `${(i % 12) * 0.12}s` }
}

function Radar({ hosts, scanning }) {
  return (
    <div className={`lan-radar${scanning ? ' scanning' : ''}`} aria-hidden="true">
      <div className="lan-radar-sweep"/>
      <div className="lan-radar-core">📡</div>
      {hosts.slice(0, 80).map((h, i) => <span key={h.ip} className={`lan-blip${h.self ? ' self' : ''}`} style={blip(h, i)}/>)}
    </div>
  )
}

function Hero({ data, busy, elapsed, onScan, needsModule, onInstall }) {
  const hosts = data?.hosts || []
  const lsh = hosts.filter((h) => h.id?.integration).length
  const lat = hosts.map((h) => h.latency).filter((x) => x != null)
  const avg = lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null
  const groups = GROUPS.map((g) => ({ g, n: hosts.filter((h) => groupOf(h) === g).length })).filter((x) => x.n)
  return (
    <div className="lan-hero">
      <Radar hosts={hosts} scanning={busy}/>
      <div className="lan-hero-body">
        {busy ? (
          <>
            <div className="lan-hero-title">Scanning<span className="lan-dots"><i/><i/><i/></span></div>
            <div className="lan-hero-sub">{PHASES[Math.floor(elapsed / 4) % PHASES.length]} · {elapsed}s</div>
            <div className="lan-progress"><i style={{ width: `${Math.min(96, (elapsed / 35) * 100)}%` }}/></div>
          </>
        ) : data ? (
          <>
            <div className="lan-hero-title">{data.networks.map((n) => n.cidr).join(' · ')}</div>
            <div className="lan-hero-sub">{data.networks.map((n) => n.iface).join(', ')} · scanned in {Math.round(data.durationMs / 1000)} s{data.baseline ? ' · baseline saved' : ''}</div>
          </>
        ) : (
          <>
            <div className="lan-hero-title">Your network, mapped</div>
            <div className="lan-hero-sub">ARP, TCP, Bonjour and UPnP discovery · vendors, open ports, fingerprints and LSH integrations</div>
          </>
        )}
        {data && (
          <div className="lan-stats">
            <Stat value={hosts.length} label="devices"/>
            <Stat value={lsh} label="LSH-ready" tone="green"/>
            <Stat value={data.newDevices || 0} label="new" tone={data.newDevices ? 'orange' : ''}/>
            <Stat value={avg != null ? avg : '—'} unit={avg != null ? 'ms' : ''} label="avg latency"/>
          </div>
        )}
        {groups.length > 0 && (
          <div className="lan-mix" title="Device mix">
            {groups.map(({ g, n }) => <i key={g.id} style={{ flex: n, background: g.color }} title={`${g.label}: ${n}`}/>)}
          </div>
        )}
        <div className="lan-hero-actions">
          <button className="lan-scan-btn" disabled={busy} onClick={onScan}>{busy ? 'Scanning…' : data ? '↻ Scan again' : '🛰 Scan network'}</button>
          {needsModule && <Button variant="primary" busy={busy} onClick={onInstall}>Install module</Button>}
        </div>
      </div>
    </div>
  )
}

const Stat = ({ value, unit, label, tone }) => (
  <div className={`lan-stat${tone ? ` ${tone}` : ''}`}><b>{value}{unit && <small>{unit}</small>}</b><span>{label}</span></div>
)

export default function LanScanSection() {
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState(null)
  const [needsModule, setNeedsModule] = useState(false)
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(null)
  const [filter, setFilter] = useState('')
  const [group, setGroup] = useState(null)
  const [view, setView] = useState('list') // 'list' | 'topology' | 'devices'
  const [devicesKey, setDevicesKey] = useState(0)
  // Saved-device icons for the topology map (ip → icon), refreshed with the list.
  const [saved, setSaved] = useState([])
  useEffect(() => {
    if (view !== 'topology') return
    fetch('/api/lsh-lan/devices', { credentials: 'include' }).then((r) => r.json()).then((j) => j.success && setSaved(j.data)).catch(() => {})
  }, [view, devicesKey])
  const icons = useMemo(() => new Map(saved.filter((d) => d.icon).map((d) => [d.ip, d.icon])), [saved])
  useEffect(() => {
    if (!busy) return
    const t0 = Date.now()
    setElapsed(0)
    const t = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500)
    return () => clearInterval(t)
  }, [busy])

  const post = (url, body) => fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
    .then((r) => r.json()).catch((e) => ({ success: false, error: e.message }))

  const run = async () => {
    setBusy(true); setError(null); setNeedsModule(false)
    const j = await post('/api/lsh-lan/scan')
    setBusy(false)
    if (!j.success) { setError(j.error); setNeedsModule(!!j.needsModule); return }
    setData(j.data)
    setDevicesKey((k) => k + 1)
  }

  const install = async () => {
    setBusy(true); setError('Installing the LAN scanner module (oui-data, multicast-dns)…')
    const j = await post('/api/modules/lsh-lan/install')
    if (!j.success) { setBusy(false); setError(j.error); return }
    setError(null); run()
  }

  const q = filter.trim().toLowerCase()
  const hosts = (data?.hosts || [])
    .filter((h) => !group || groupOf(h).id === group)
    .filter((h) => !q || [h.ip, h.mac, h.vendor, h.name, h.hostname, h.id?.label, h.id?.integration, h.ports.join(' ')]
      .some((x) => String(x || '').toLowerCase().includes(q)))
  const presentGroups = GROUPS.filter((g) => (data?.hosts || []).some((h) => groupOf(h) === g))

  return (
    <SettingsCard title="LAN scan"
      desc="Finds devices on this LSH host's local network — IP, MAC and vendor, names from DNS / Bonjour (mDNS) / UPnP, open ports, what each one looks like and which LSH integration would connect it. Click a device for a deep dive. Only scans this host's own LAN; takes 15–40 s.">
      <Hero data={data} busy={busy && !needsModule} elapsed={elapsed} onScan={run} needsModule={needsModule} onInstall={install}/>
      {error && <div className={`stg-banner ${busy ? 'ok' : 'err'}`} style={{ marginTop: 10 }}>{busy ? '' : '✗ '}{error}</div>}
      <div className="lan-toolbar">
        <div className="lan-viewtoggle">
          {['list', 'topology', 'devices'].map((v) => (
            <button key={v} className={view === v ? 'active' : ''} disabled={v !== 'devices' && !data}
              onClick={() => setView(v)}>{{ list: '▤ Devices', topology: '◎ Map', devices: '★ Saved' }[v]}</button>
          ))}
        </div>
        {data && view === 'list' && <input className="stg-input lan-search" placeholder="Search name, IP, vendor, port…" value={filter} onChange={(e) => setFilter(e.target.value)}/>}
      </div>
      {view === 'devices' && (
        <>
          {data?.newDevices > 0 && <div className="stg-banner ok" style={{ marginTop: 6 }}>{data.newDevices} new device{data.newDevices === 1 ? '' : 's'} since the last scan</div>}
          <LanDevices refreshKey={devicesKey} onInspect={(ip) => { setOpen(ip); setView(data ? 'list' : 'devices') }}/>
          {open && !data && <LanDeepDive key={open} ip={open} post={post}/>}
        </>
      )}
      {data && view === 'topology' && (
        <LanTopology data={data} icons={icons} selected={open} onSelect={(ip) => setOpen(open === ip ? null : ip)}
          renderDetails={(ip) => <LanDeepDive key={ip} ip={ip} post={post}/>}/>
      )}
      {data && view === 'list' && (
        <>
          {presentGroups.length > 1 && (
            <div className="lan-filters">
              <button className={`lan-filter${!group ? ' active' : ''}`} onClick={() => setGroup(null)}>All {data.hosts.length}</button>
              {presentGroups.map((g) => (
                <button key={g.id} className={`lan-filter${group === g.id ? ' active' : ''}`} style={{ '--g': g.color }} onClick={() => setGroup(group === g.id ? null : g.id)}>
                  <i className="lan-filter-dot"/>{g.label} {data.hosts.filter((h) => groupOf(h) === g).length}
                </button>
              ))}
            </div>
          )}
          <div className="lan-grid">
            {hosts.map((h, i) => {
              const g = groupOf(h)
              const isOpen = open === h.ip
              return (
                <div key={h.ip} className={`lan-tile${isOpen ? ' open' : ''}${h.self ? ' self' : ''}`} style={{ '--g': g.color, animationDelay: `${Math.min(i, 30) * 25}ms` }}>
                  <div className="lan-tile-main" onClick={() => setOpen(isOpen ? null : h.ip)}>
                    <div className="lan-tile-icon">
                      {h.saved?.icon ? <DeviceIcon icon={h.saved.icon} size={26}/> : <span>{h.self ? '🏠' : KIND_ICON[h.id?.kind] || '❔'}</span>}
                      {h.id?.integration && <i className="lan-tile-badge" title={`LSH integration: ${h.id.integration}`}>✓</i>}
                    </div>
                    <div className="lan-tile-text">
                      <div className="lan-tile-name">{h.saved?.label || h.name || h.id?.label || h.ip}</div>
                      <div className="lan-tile-sub">{h.ip}{h.vendor ? ` · ${h.vendor}` : ''}</div>
                    </div>
                    {h.latency != null && <span className={`lan-lat ${latencyClass(h.latency)}`}>{h.latency}<small>ms</small></span>}
                  </div>
                  <div className="lan-tile-chips">
                    {h.self && <span className="stg-ble-chip">this host</span>}
                    {h.gateway && <span className="stg-ble-chip">gateway</span>}
                    {h.id?.label && h.name !== h.id.label && <span className="lan-kind">{h.id.label}</span>}
                    {h.id?.integration && <span className="stg-ble-chip lan-int">LSH · {h.id.integration}</span>}
                    <TagChips tags={h.saved?.tags}/>
                    {h.saved?.monitored && <span title="Monitored">🔔</span>}
                    {h.ports.slice(0, 6).map((p) => <span key={p} className="lan-port">{p}</span>)}
                    {h.ports.length > 6 && <span className="lan-port">+{h.ports.length - 6}</span>}
                  </div>
                  {isOpen && <LanDeepDive ip={h.ip} post={post}/>}
                </div>
              )
            })}
            {!hosts.length && <div className="stg-hint">Nothing matches.</div>}
          </div>
        </>
      )}
    </SettingsCard>
  )
}

function LanDeepDive({ ip, post }) {
  const [state, setState] = useState({ busy: true })
  useEffect(() => {
    let alive = true
    post('/api/lsh-lan/inspect', { ip }).then((j) => alive && setState(j.success ? { data: j.data } : { error: j.error }))
    return () => { alive = false }
  }, [ip])
  if (!state || state.busy) return <div className="ble-dd stg-hint">Deep dive on {ip} — probing ~120 ports, Bonjour, UPnP…</div>
  if (state.error) return <div className="ble-dd"><div className="stg-banner err">✗ {state.error}</div></div>
  const d = state.data
  return (
    <div className="ble-dd">
      <Sec title="Identity">
        <KV k="IP" v={d.ip}/>
        <KV k="MAC / vendor" v={d.mac ? `${d.mac}${d.vendor ? ` · ${d.vendor}` : ''}` : null}/>
        <KV k="Reverse DNS" v={d.reverseDns?.join(', ')}/>
        <KV k="Bonjour host" v={d.mdns?.hostname}/>
        <KV k="Looks like" v={d.id?.label ? `${d.id.label}${d.id.integration ? ` → LSH integration "${d.id.integration}"` : ''}` : null}/>
        <KV k="Latency" v={d.latency ? `min ${d.latency.min} / avg ${d.latency.avg} / max ${d.latency.max} ms (TCP :${d.latency.port})` : null}/>
        <KV k="Scan" v={`${d.ports.length} open of ${d.scannedPorts} ports · ${Math.round(d.durationMs / 1000)} s`}/>
      </Sec>

      {d.portDetails.length > 0 && (
        <Sec title="Open ports">
          {d.portDetails.map((p) => (
            <div key={p.port} className="ble-dd-svc">
              <div className="ble-dd-svc-name"><span className="ble-dd-mono">{p.port}</span> {p.service || ''}</div>
              {p.http && <div className="ble-dd-char">HTTP {p.http.status}{p.http.server ? ` · ${p.http.server}` : ''}{p.http.title ? ` · “${p.http.title}”` : ''}
                {Object.entries(p.http.headers || {}).filter(([k]) => k !== 'server').map(([k, v]) => <div key={k} className="ble-dd-mono stg-hint">{k}: {v}</div>)}</div>}
              {p.tls && <div className="ble-dd-char">TLS {p.tls.protocol} · CN {p.tls.subject} · issuer {p.tls.issuer}{p.tls.selfSigned ? ' (self-signed)' : ''} · valid to {p.tls.validTo}
                {p.tls.altNames && <div className="ble-dd-mono stg-hint">{p.tls.altNames}</div>}</div>}
              {p.banner && <div className="ble-dd-char ble-dd-mono">{p.banner}</div>}
            </div>
          ))}
        </Sec>
      )}

      {d.mdns?.services?.length > 0 && (
        <Sec title="Bonjour / mDNS services">
          {d.mdns.services.map((s, i) => (
            <div key={i} className="ble-dd-char">
              <b>{s.name}</b> <span className="ble-dd-mono">{s.type}:{s.port}</span>
              {Object.keys(s.txt || {}).length > 0 && <div className="ble-dd-mono stg-hint">{Object.entries(s.txt).map(([k, v]) => `${k}=${v}`).join('  ')}</div>}
            </div>
          ))}
        </Sec>
      )}

      {d.ssdp && (
        <Sec title="UPnP / SSDP">
          <KV k="Server" v={d.ssdp.server}/>
          <KV k="Device" v={d.ssdp.description ? [d.ssdp.description.friendlyName, d.ssdp.description.manufacturer, d.ssdp.description.modelName, d.ssdp.description.modelNumber].filter(Boolean).join(' · ') : null}/>
          <KV k="Types" v={d.ssdp.types?.join(', ')}/>
          <KV k="Description" v={d.ssdp.description?.location}/>
        </Sec>
      )}

      {(d.http?.shelly || d.http?.hue || d.http?.sonos) && (
        <Sec title="Product API">
          {d.http.shelly && <KV k="Shelly" v={`${d.http.shelly.model} · gen ${d.http.shelly.gen} · fw ${d.http.shelly.fw || '?'}${d.http.shelly.name ? ` · ${d.http.shelly.name}` : ''}`}/>}
          {d.http.hue && <KV k="Hue bridge" v={`${d.http.hue.name} · ${d.http.hue.model} · ${d.http.hue.bridgeId} · sw ${d.http.hue.sw}`}/>}
          {d.http.sonos && <KV k="Sonos" v={`${d.http.sonos.room} · ${d.http.sonos.model}`}/>}
        </Sec>
      )}
    </div>
  )
}

const Sec = ({ title, children }) => <div className="ble-dd-sec"><div className="ble-dd-title">{title}</div>{children}</div>
const KV = ({ k, v }) => (v == null || v === '' ? null : <div className="ble-dd-kv"><span className="stg-hint">{k}</span><span>{v}</span></div>)
