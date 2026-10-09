import { useEffect, useState } from 'react'
import { t } from './i18n.js'

// Pair & save: once the module is wired, pair it with a real network through a
// gateway LSH knows and save the link with the device's real id.
//   Z-Wave  → Z-Wave JS inclusion (S2 with the PIN from the DSK label, or insecure)
//   Wi-Fi / LAN → find it by address (Shelly recognised, otherwise by MAC)
//   any     → link a device LSH already has (Fibaro, Homey, Home Assistant, …)
// Server: src/routes/wiring-pair.js, src/wiring-links.js.

const api = (url, method = 'GET', body) => fetch(url, {
  method, credentials: 'include',
  ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
}).then((r) => r.json())

const ACTIVE = ['including', 'grant', 'dsk', 'interviewing', 'excluding']

export default function PairPanel({ device, scenario }) {
  const network = device.protocol === 'Wi-Fi' || device.protocol === 'LAN' ? 'wifi' : 'zwave'
  const [gw, setGw] = useState(null)
  const [how, setHow] = useState(network)       // 'zwave' | 'wifi' | 'existing'
  const [secure, setSecure] = useState(true)
  const [zs, setZs] = useState(null)            // Z-Wave pairing status
  const [pin, setPin] = useState('')
  const [host, setHost] = useState('')
  const [probe, setProbe] = useState(null)
  const [addToLsh, setAddToLsh] = useState(true)
  const [exType, setExType] = useState('')
  const [exDevices, setExDevices] = useState([])
  const [exKey, setExKey] = useState('')
  const [name, setName] = useState('')
  const [room, setRoom] = useState('')
  const [links, setLinks] = useState([])
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const loadLinks = () => api('/api/wiring/links').then((j) => j.success && setLinks(j.data)).catch(() => {})
  useEffect(() => { api('/api/wiring/gateways').then((j) => j.success && setGw(j.data)).catch(() => {}); loadLinks() }, [])
  useEffect(() => { setHow(network); setProbe(null); setZs(null); setMsg(null); setExKey('') }, [device.id])
  useEffect(() => { if (exType) api(`/api/wiring/devices?type=${encodeURIComponent(exType)}`).then((j) => j.success && setExDevices(j.data)) }, [exType])
  // Follow an inclusion / exclusion while it runs
  useEffect(() => {
    if (!zs || !ACTIVE.includes(zs.phase)) return
    const iv = setInterval(() => api('/api/wiring/zwave/status').then((j) => j.success && setZs(j.data)).catch(() => {}), 1000)
    return () => clearInterval(iv)
  }, [zs?.phase])

  const call = async (fn) => {
    setBusy(true); setMsg(null)
    try { const j = await fn(); if (!j.success) setMsg({ ok: false, text: j.error }); return j } finally { setBusy(false) }
  }
  const zw = gw?.zwave?.[0]
  const include = () => call(async () => { const j = await api('/api/wiring/zwave/include', 'POST', { secure }); if (j.success) setZs(j.data); return j })
  const exclude = () => call(async () => { const j = await api('/api/wiring/zwave/exclude', 'POST', {}); if (j.success) setZs(j.data); return j })
  const stop = () => call(async () => { const j = await api('/api/wiring/zwave/stop', 'POST', {}); if (j.success) setZs(j.data); return j })
  const sendPin = () => call(async () => { const j = await api('/api/wiring/zwave/pin', 'POST', { pin }); if (j.success) { setZs(j.data); setPin('') } return j })
  const find = () => call(async () => { setProbe(null); const j = await api('/api/wiring/lan/probe', 'POST', { host }); if (j.success) setProbe(j.data); return j })

  // What will be saved
  const target = how === 'zwave'
    ? (zs?.phase === 'done' && zs.realId ? { realId: zs.realId, deviceKey: zs.deviceKey, gateway: 'zwaveJs', info: zs.node } : null)
    : how === 'wifi'
      ? (probe ? { realId: probe.realId, deviceKey: null, gateway: 'lan', info: probe } : null)
      : (exKey ? { realId: exKey, deviceKey: exKey, gateway: `existing:${exType}`, info: null } : null)

  const save = () => call(async () => {
    const j = await api('/api/wiring/links', 'POST', {
      ...target, name, room, addToLsh: how === 'wifi' && probe?.kind === 'shelly' && addToLsh,
      emulatorDevice: device.id, model: `${device.manufacturer} ${device.model}`, scenario: scenario.id,
      protocol: how === 'zwave' ? 'Z-Wave' : how === 'wifi' ? (device.protocol || 'Wi-Fi') : exType,
    })
    if (j.success) { setMsg({ ok: true, text: t('Saved as {id}', { id: j.data.realId }) + (j.message && j.message !== 'Saved' ? ` · ${j.message}` : '') }); loadLinks() }
    return j
  })
  const unlink = (id) => api(`/api/wiring/links/${id}`, 'DELETE').then(loadLinks)

  const phaseText = {
    including: t('Inclusion mode is on — now press the device’s button (B / S1 three times, or as its manual says).'),
    grant: t('The device asks for secure (S2) keys — granting them…'),
    dsk: t('Enter the PIN: the first 5 digits of the DSK printed on the device (underlined).'),
    interviewing: t('Device joined — reading what it is…'),
    done: t('Paired.'),
    excluding: t('Exclusion mode is on — press the device’s button now.'),
    excluded: t('The device has left the network — it can be paired again.'),
    failed: zs?.error ? t(zs.error) : t('Pairing failed.'),
  }
  const mine = links.filter((l) => l.emulator?.device === device.id)

  return (
    <div className="wr-panel wr-pair">
      <div className="ble-dd-title">{t('Pair & save')}</div>
      <div className="wr-pair-tabs">
        {network === 'zwave' && <button className={how === 'zwave' ? 'on' : ''} onClick={() => setHow('zwave')}>{t('Z-Wave network')}</button>}
        {network === 'wifi' && <button className={how === 'wifi' ? 'on' : ''} onClick={() => setHow('wifi')}>{t('Wi-Fi / LAN')}</button>}
        <button className={how === 'existing' ? 'on' : ''} onClick={() => setHow('existing')}>{t('Already in LSH')}</button>
      </div>

      {how === 'zwave' && (!zw?.available ? (
        <div className="stg-hint">{t('No Z-Wave gateway is set up — add Z-Wave JS (Z-Wave JS UI / zwave-js-server) to LSH, or pair with your gateway’s app and use “Already in LSH”.')}</div>
      ) : (
        <>
          <div className="stg-hint">{t('Gateway')}: <b>{zw.label}</b> {zw.connected ? `· ${t('network')} ${zw.homeId}` : `· ${t('not connected')}`}</div>
          <label className="wr-pair-opt"><input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} disabled={ACTIVE.includes(zs?.phase)}/><span>{t('Secure (S2) — recommended')}</span></label>
          <div className="wr-pair-row">
            {!ACTIVE.includes(zs?.phase)
              ? <><button className="stg-btn stg-btn-primary" disabled={busy || !zw.connected} onClick={include}>➕ {t('Include')}</button>
                  <button className="stg-btn stg-btn-secondary" disabled={busy || !zw.connected} onClick={exclude}>➖ {t('Exclude')}</button></>
              : <button className="stg-btn stg-btn-secondary" onClick={stop}>■ {t('Stop')}</button>}
          </div>
          {zs && zs.phase !== 'idle' && <div className={`wr-pair-status ${zs.phase}`}>{ACTIVE.includes(zs.phase) && <span className="wr-pair-spin"/>}{phaseText[zs.phase]}</div>}
          {zs?.phase === 'dsk' && (
            <div className="wr-pair-row">
              <code className="wr-pair-dsk"><b>_____</b>{String(zs.dsk || '').replace(/^-+/, '-')}</code>
              <input className="stg-input" inputMode="numeric" maxLength={5} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="12345" style={{ width: 90 }}/>
              <button className="stg-btn stg-btn-primary" disabled={pin.length !== 5 || busy} onClick={sendPin}>{t('OK')}</button>
            </div>
          )}
          {(zs?.phase === 'done' || zs?.phase === 'interviewing') && zs.node && (
            <div className="wr-pair-found">
              <div><span className="stg-hint">{t('Node')}</span> <b>{zs.node.nodeId}</b></div>
              {zs.node.label && <div><span className="stg-hint">{t('Reports itself as')}</span> {zs.node.manufacturer} {zs.node.label}{zs.node.description ? ` — ${zs.node.description}` : ''}</div>}
              {zs.node.manufacturerId && <div><span className="stg-hint">{t('Ids')}</span> <code>{zs.node.manufacturerId} / {zs.node.productType} / {zs.node.productId}</code></div>}
              {zs.lowSecurity && <div className="wr-f warn">△ {t('Joined without security (S2 failed or not supported).')}</div>}
              {zs.realId && <div><span className="stg-hint">{t('Real id')}</span> <code>{zs.realId}</code></div>}
            </div>
          )}
        </>
      ))}

      {how === 'wifi' && (
        <>
          <div className="stg-hint">{t('Connect the device to your Wi-Fi with its own app or access point first, then find it here by its address.')}</div>
          <div className="wr-pair-row">
            <input className="stg-input" value={host} onChange={(e) => setHost(e.target.value.trim())} placeholder="192.168.1.50" onKeyDown={(e) => e.key === 'Enter' && host && find()}/>
            <button className="stg-btn stg-btn-primary" disabled={!host || busy} onClick={find}>🔍 {t('Find')}</button>
          </div>
          {probe && (
            <div className="wr-pair-found">
              <div><span className="stg-hint">{t('Found')}</span> <b>{probe.kind === 'shelly' ? `Shelly ${probe.model || ''}` : t('device on the network')}</b> {probe.host}</div>
              {probe.mac && <div><span className="stg-hint">MAC</span> <code>{probe.mac}</code></div>}
              {probe.firmware && <div><span className="stg-hint">{t('Firmware')}</span> {probe.firmware}</div>}
              {!probe.mac && <div className="wr-f warn">△ {t('Couldn’t read its MAC — it’s saved by address, which can change.')}</div>}
              {probe.kind === 'shelly' && <label className="wr-pair-opt"><input type="checkbox" checked={addToLsh} onChange={(e) => setAddToLsh(e.target.checked)}/><span>{t('Add it to LSH’s Shelly integration')}</span></label>}
              <div><span className="stg-hint">{t('Real id')}</span> <code>{probe.realId}</code></div>
            </div>
          )}
        </>
      )}

      {how === 'existing' && (
        <>
          <div className="stg-hint">{t('Paired already (gateway app, Fibaro, Homey, Home Assistant…)? Pick the device LSH has for it.')}</div>
          <div className="wr-pair-row">
            <select className="stg-input" value={exType} onChange={(e) => { setExType(e.target.value); setExKey('') }}>
              <option value="">{t('Gateway / integration…')}</option>
              {(gw?.existingTypes || []).map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
            <select className="stg-input" value={exKey} onChange={(e) => setExKey(e.target.value)} disabled={!exType}>
              <option value="">{t('Device…')}</option>
              {exDevices.map((d) => <option key={d.key} value={d.key}>{d.label || d.key}</option>)}
            </select>
          </div>
        </>
      )}

      {target && (
        <div className="wr-pair-save">
          <div className="wr-pair-row">
            <input className="stg-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Name, e.g. Hall light')}/>
            <input className="stg-input" value={room} onChange={(e) => setRoom(e.target.value)} placeholder={t('Room')}/>
          </div>
          <button className="stg-btn stg-btn-primary" disabled={busy} onClick={save}>💾 {t('Save with real id')}</button>
        </div>
      )}
      {msg && <div className={`wr-f ${msg.ok ? 'info' : 'danger'}`}>{msg.ok ? '✓ ' : '⚠ '}{msg.text}</div>}

      {mine.length > 0 && (
        <>
          <div className="ble-dd-title" style={{ marginTop: 10 }}>{t('Saved for this module')}</div>
          {mine.map((l) => (
            <div key={l.id} className="wr-pair-link">
              <span><b>{l.name || l.deviceKey || l.realId}</b>{l.room ? ` · ${l.room}` : ''}<br/><code>{l.realId}</code> <span className="stg-hint">· {l.protocol || l.gateway} · {new Date(l.pairedAt).toLocaleDateString()}</span></span>
              <button className="lan-popup-close" title={t('Remove the link (the device stays paired)')} onClick={() => unlink(l.id)}>✕</button>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
