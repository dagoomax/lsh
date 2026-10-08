import { useEffect, useState } from 'react'
import { SettingsCard, Button } from '../primitives'

// Settings → System → LAN scan — what's on this LSH host's local network
// (tool module lsh-lan, installed from here on first use). Click a host for
// a deep dive.
const KIND_ICON = {
  shelly: '🔌', hue: '💡', sonos: '🔊', esphome: '📟', loxone: '🏠', fibaro: '🏠', wled: '🌈', cast: '📺', androidtv: '📺',
  airplay: '🎵', homekit: '🏡', matter: '🧩', homeassistant: '🏠', nodered: '🔀', mqtt: '📨', knx: '🔗', modbus: '🔗',
  camera: '📷', printer: '🖨️', victron: '🔋', apple: '🍎', network: '📶', web: '🌐', unknown: '❔',
}

export default function LanScanSection() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [needsModule, setNeedsModule] = useState(false)
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(null)
  const [filter, setFilter] = useState('')

  const post = (url, body) => fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
    .then((r) => r.json()).catch((e) => ({ success: false, error: e.message }))

  const run = async () => {
    setBusy(true); setError(null); setNeedsModule(false)
    const j = await post('/api/lsh-lan/scan')
    setBusy(false)
    if (!j.success) { setError(j.error); setNeedsModule(!!j.needsModule); return }
    setData(j.data)
  }

  const install = async () => {
    setBusy(true); setError('Installing the LAN scanner module (oui-data, multicast-dns)…')
    const j = await post('/api/modules/lsh-lan/install')
    if (!j.success) { setBusy(false); setError(j.error); return }
    setError(null); run()
  }

  const q = filter.trim().toLowerCase()
  const hosts = (data?.hosts || []).filter((h) => !q || [h.ip, h.mac, h.vendor, h.name, h.hostname, h.id?.label, h.id?.integration, h.ports.join(' ')]
    .some((x) => String(x || '').toLowerCase().includes(q)))

  return (
    <SettingsCard title="LAN scan"
      desc="Finds devices on this LSH host's local network — IP, MAC and vendor, names from DNS / Bonjour (mDNS) / UPnP, open ports, what each one looks like and which LSH integration would connect it. Click a device for a deep dive (all common ports, banners, HTTP headers, TLS certificates, latency). Only scans this host's own LAN; takes 15–40 s.">
      <div className="stg-actions" style={{ marginTop: 0 }}>
        <Button variant="secondary" busy={busy} onClick={run}>🛰 {data ? 'Scan again' : 'Scan network'}</Button>
        {needsModule && <Button variant="primary" busy={busy} onClick={install}>Install module</Button>}
        {data && <input className="stg-input" style={{ maxWidth: 260 }} placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)}/>}
      </div>
      {busy && !error && <div className="stg-hint" style={{ marginTop: 6 }}>Scanning {data ? '' : 'the network '}— ARP, TCP, mDNS, UPnP…</div>}
      {error && <div className={`stg-banner ${busy ? 'ok' : 'err'}`} style={{ marginTop: 6 }}>{busy ? '' : '✗ '}{error}</div>}
      {data && (
        <div className="stg-ble-scan">
          <div className="stg-hint">
            {data.hosts.length} device{data.hosts.length === 1 ? '' : 's'} on {data.networks.map((n) => `${n.cidr} (${n.iface})`).join(', ')} · {Math.round(data.durationMs / 1000)} s
            {' · '}{data.hosts.filter((h) => h.id?.integration).length} with an LSH integration
          </div>
          {hosts.map((h) => (
            <div key={h.ip}>
              <div className={`stg-ble-row${open === h.ip ? ' open' : ''}`} onClick={() => setOpen(open === h.ip ? null : h.ip)}>
                <span style={{ fontSize: 18, width: 24, textAlign: 'center', flexShrink: 0 }}>{KIND_ICON[h.id?.kind] || '❔'}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="stg-ble-name">
                    {h.name || h.id?.label || h.ip}
                    {h.self && <span className="stg-ble-chip">this host</span>}
                    {h.id?.label && h.name !== h.id.label && <span className="stg-ble-chip">{h.id.label}</span>}
                    {h.id?.integration && <span className="stg-ble-chip lan-int">LSH: {h.id.integration}</span>}
                  </div>
                  <div className="stg-hint">
                    {h.ip}{h.mac ? ` · ${h.mac}` : ''}{h.vendor ? ` · ${h.vendor}` : ''}{h.latency ? ` · ${h.latency} ms` : ''}
                    {h.ports.length > 0 && ` · ports ${h.ports.join(', ')}`}
                  </div>
                </div>
                <span className="stg-ble-caret">{open === h.ip ? '▾' : '▸'}</span>
              </div>
              {open === h.ip && <LanDeepDive ip={h.ip} post={post}/>}
            </div>
          ))}
        </div>
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
