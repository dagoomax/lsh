import { useEffect, useState } from 'react'
import { SettingsCard, Field, Toggle, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { gt, tr } from '../../../i18n'

const api = (url, method = 'GET', body) => fetch(url, {
  method, credentials: 'include',
  ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
}).then((r) => r.json())

// Sticks offered up front; anything else is "Other" with the fields open
const STICKS = [
  { value: 'aeotec-zstick10pro', label: 'Aeotec Z-Stick 10 Pro', raw: true, zwave: true, zigbee: true, adapter: 'ember', rtscts: false },
  { value: 'zwaveme-zstation', label: 'Z-Wave.Me Z-Station', raw: true, zwave: true, zigbee: true, adapter: 'ember', rtscts: false },
  { value: 'other', label: 'Other stick' },
]
const CHANNELS = Array.from({ length: 16 }, (_, i) => 11 + i)
  .map((c) => ({ value: String(c), label: [15, 20, 25].includes(c) ? `${c} ★` : String(c), raw: true }))
const ACTIVE = ['including', 'grant', 'dsk', 'interviewing', 'excluding']

// LSH's own Z-Wave and Zigbee networks on a USB stick. Server:
// src/zwave-usb-client.js + src/zwave-js-client.js, src/zigbee-client.js,
// src/usb-radio-scan.js, src/routes/usb-radio.js.
export default function UsbRadioSection({ config, reload }) {
  const zw = config.zwaveUsb || {}
  const zb = config.zigbee || {}
  const [stick, setStick] = useState(zb.stick || zw.stick || 'aeotec-zstick10pro')
  const [zwOn, setZwOn] = useState(!!zw.port || !(zw.port || zb.port))
  const [zwPort, setZwPort] = useState(zw.port || '')
  const [region, setRegion] = useState(zw.region || '')
  const [zbOn, setZbOn] = useState(!!zb.port || !(zw.port || zb.port))
  const [zbPort, setZbPort] = useState(zb.port || '')
  const [channel, setChannel] = useState(String(zb.channel || 15))
  const [adapter, setAdapter] = useState(zb.adapter || 'ember')
  const [rtscts, setRtscts] = useState(!!zb.rtscts)
  const [status, setStatus] = useState(null)
  const save = useSettingsSave('/api/settings/usb-radio')

  const loadStatus = () => api('/api/usb-radio/status').then((j) => j.success && setStatus(j.data)).catch(() => {})
  useEffect(() => { loadStatus(); const t = setInterval(loadStatus, 5000); return () => clearInterval(t) }, [])

  const pickStick = (v) => {
    setStick(v)
    const s = STICKS.find((x) => x.value === v)
    if (s?.adapter) { setAdapter(s.adapter); setRtscts(s.rtscts) }
    if (s?.zwave) setZwOn(true)
    if (s?.zigbee) setZbOn(true)
  }
  const doSave = () => save.save({
    stick,
    zwave: { enabled: zwOn, port: zwPort.trim(), region },
    zigbee: { enabled: zbOn, port: zbPort.trim(), channel: Number(channel), adapter, rtscts },
  }).then(() => { setTimeout(loadStatus, 4000); reload?.() }).catch(() => {})

  const regions = (status?.regions || ['']).map((r) => (r ? { value: r, label: r, raw: true } : { value: '', label: 'As set in the stick' }))
  const adapters = (status?.adapters || ['ember']).map((a) => ({ value: a, label: a, raw: true }))

  return (
    <>
      <SettingsCard title="Z-Wave / Zigbee USB stick" badge={{ label: gt('common.optional', 'Optional') }}
        desc="Plug a USB stick into this LSH host and LSH runs the Z-Wave and/or Zigbee network itself — no Z-Wave JS UI, Zigbee2MQTT or MQTT broker needed. The Aeotec Z-Stick 10 Pro and the Z-Wave.Me Z-Station have both radios, each on its own serial port; Find ports below tells them apart. Zigbee devices use the Zigbee2MQTT device library (thousands of models), Z-Wave runs on zwave-js. Devices appear on the dashboard, in HomeKit, Loxone and flows. Network keys are created on first start in persist/zwave and persist/zigbee — include them in your backups.">
        <Field label="Stick" type="select" value={stick} onChange={pickStick} options={STICKS}/>
        <PortFinder onUse={(radio, p) => (radio === 'zwave' ? (setZwPort(p), setZwOn(true)) : (setZbPort(p), setZbOn(true)))}/>

        <h4 className="stg-subheading">{tr('Z-Wave')}</h4>
        <Toggle label="Use the stick for Z-Wave" checked={zwOn} onChange={setZwOn}/>
        {zwOn && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 12px' }}>
            <Field label="Z-Wave serial port" value={zwPort} onChange={setZwPort}/>
            <Field label="Region" type="select" value={region} onChange={setRegion} options={regions}/>
          </div>
        )}
        {zwOn && config.zwaveJs?.host && <p className="stg-hint">{tr('An external Z-Wave JS server is also set up — LSH stays connected to that one; remove it to use the stick.')}</p>}

        <h4 className="stg-subheading">{tr('Zigbee')}</h4>
        <Toggle label="Use the stick for Zigbee" checked={zbOn} onChange={setZbOn}/>
        {zbOn && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0 12px' }}>
            <Field label="Zigbee serial port" value={zbPort} onChange={setZbPort} style={{ gridColumn: 'span 2' }}/>
            <Field label="Channel" hint="(★ least Wi-Fi overlap)" type="select" value={channel} onChange={setChannel} options={CHANNELS}/>
            {stick === 'other' && <Field label="Adapter type" type="select" value={adapter} onChange={setAdapter} options={adapters}/>}
          </div>
        )}
        {zbOn && stick === 'other' && <Toggle label="Hardware flow control (RTS/CTS)" checked={rtscts} onChange={setRtscts}/>}
        {zbOn && <p className="stg-hint">{tr('Changing the channel later makes battery devices rejoin slowly — pick it once. Coming from Zigbee2MQTT? Copy pan_id, ext_pan_id and network_key into persist/zigbee/network.json before the first start and use the same channel; paired devices stay paired.')}</p>}

        <div className="stg-actions">
          <Button variant="primary" busy={save.busy} onClick={doSave}>{gt('common.save', 'Save')}</Button>
          <ResultBanner result={save.result}/>
        </div>
      </SettingsCard>

      {status?.zwave && <ZwaveCard s={status.zwave}/>}
      {status?.zigbee && <ZigbeeCard s={status.zigbee} reload={loadStatus}/>}
    </>
  )
}

function PortFinder({ onUse }) {
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [needsModule, setNeedsModule] = useState(false)

  const list = async () => {
    const j = await api('/api/usb-radio/ports').catch((e) => ({ success: false, error: e.message }))
    if (!j.success) { setNeedsModule(!!j.needsModule); if (!j.needsModule) setError(j.error); return }
    setNeedsModule(false); setRows(j.data.ports)
  }
  useEffect(() => { list() }, [])
  const probe = async () => {
    setBusy(true); setError(null)
    const j = await api('/api/usb-radio/probe', 'POST', {}).catch((e) => ({ success: false, error: e.message }))
    setBusy(false)
    if (!j.success) { setError(j.error); if (j.needsModule) setNeedsModule(true); return }
    setRows(j.data)
  }
  const install = async () => {
    setBusy(true); setError(null)
    const j = await api('/api/modules/usb-radio/install', 'POST', {}).catch((e) => ({ success: false, error: e.message }))
    setBusy(false)
    if (!j.success) { setError(j.error); return }
    list()
  }
  const found = (r) => {
    if (r.inUse) return <span className="stg-mod-chip cfg">{tr('in use by LSH')}</span>
    if (r.busy) return <span className="stg-mod-chip warn">{tr('busy')}</span>
    if (r.radio === 'zwave') return <span className="stg-mod-chip ok">{tr('Z-Wave')} · {r.version}</span>
    if (r.radio === 'zigbee') return <span className="stg-mod-chip ok">{tr('Zigbee')} · {r.protocol}</span>
    if (r.error) return <span className="stg-mod-chip warn">{tr('no radio answered')}</span>
    return null
  }

  return (
    <div style={{ margin: '6px 0 4px' }}>
      <div className="stg-actions" style={{ marginTop: 0 }}>
        <Button variant="secondary" busy={busy} disabled={needsModule} onClick={probe}>{tr('Find ports')}</Button>
        {needsModule && <Button variant="primary" busy={busy} onClick={install}>{tr('Install module')}</Button>}
      </div>
      {needsModule && <p className="stg-hint">{tr('Finding ports needs the small USB radio scan module.')}</p>}
      {error && <div className="stg-banner err" style={{ marginTop: 8 }}>✗ {error}</div>}
      {rows && rows.length === 0 && <p className="stg-hint">{tr('No USB serial ports on this host — plug the stick in and look again.')}</p>}
      {rows && rows.length > 0 && (
        <div className="stg-mod-list">
          {rows.map((r) => (
            <div key={r.path} className="stg-mod-row">
              <div className="stg-mod-main">
                <div className="stg-mod-name" style={{ wordBreak: 'break-all' }}>{r.path} {found(r)}</div>
                <div className="stg-hint stg-mod-meta">{[r.stick, r.usb, r.device !== r.path ? r.device : null].filter(Boolean).join(' · ')}</div>
              </div>
              {!r.inUse && r.radio !== 'zigbee' && <Button variant="secondary" onClick={() => onUse('zwave', r.path)}>{tr('Use for Z-Wave')}</Button>}
              {!r.inUse && r.radio !== 'zwave' && <Button variant="secondary" onClick={() => onUse('zigbee', r.path)}>{tr('Use for Zigbee')}</Button>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ZwaveCard({ s }) {
  const [zs, setZs] = useState(null)
  const [secure, setSecure] = useState(true)
  const [pin, setPin] = useState('')
  const [err, setErr] = useState(null)
  const poll = () => api('/api/wiring/zwave/status').then((j) => j.success && setZs(j.data)).catch(() => {})
  useEffect(() => { poll() }, [])
  useEffect(() => {
    if (!zs || !ACTIVE.includes(zs.phase)) return
    const t = setInterval(poll, 1000)
    return () => clearInterval(t)
  }, [zs?.phase])
  const call = async (url, body = {}) => {
    setErr(null)
    const j = await api(url, 'POST', body).catch((e) => ({ success: false, error: e.message }))
    if (j.success) setZs(j.data); else setErr(j.error)
  }
  const phase = {
    including: tr('Put the device in inclusion mode now (usually its button pressed 3×)…'),
    grant: tr('Device found — granting security…'),
    dsk: tr('Enter the 5-digit PIN from the device label (first part of the DSK).'),
    interviewing: tr('Added — reading what the device can do…'),
    done: tr('Device added — it is on the dashboard.'),
    excluding: tr('Put the device in exclusion mode now…'),
    excluded: tr('Device removed from the network.'),
    failed: zs?.error || tr('Failed'),
  }[zs?.phase]
  const active = ACTIVE.includes(zs?.phase)

  return (
    <SettingsCard title="Z-Wave network"
      desc="Add a device: start, then put the device in inclusion mode. Remove: start, then the same on the device — that also clears a device paired with another controller before.">
      <div className="stg-mod-list">
        <div className="stg-mod-row">
          <div className="stg-mod-main">
            <div className="stg-mod-name">
              {tr('Stick')}
              <span className={`stg-mod-chip ${s.stick ? 'ok' : 'warn'}`}>{s.stick ? tr('ready') : tr('not ready')}</span>
              {s.homeId && <span className="stg-mod-chip cfg">{tr('Home ID')} {s.homeId}</span>}
            </div>
            <div className="stg-hint stg-mod-meta" style={{ wordBreak: 'break-all' }}>{s.port}{s.region ? ` · ${s.region}` : ''} · {tr('{n} device(s)', { n: s.nodes })}</div>
          </div>
        </div>
      </div>
      <Toggle label="Secure inclusion (S2) — recommended" checked={secure} onChange={setSecure}/>
      <div className="stg-actions">
        {!active ? (
          <>
            <Button variant="primary" disabled={!s.connected} onClick={() => call('/api/wiring/zwave/include', { secure })}>{tr('Add device')}</Button>
            <Button variant="secondary" disabled={!s.connected} onClick={() => call('/api/wiring/zwave/exclude')}>{tr('Remove device')}</Button>
          </>
        ) : <Button variant="secondary" onClick={() => call('/api/wiring/zwave/stop')}>{tr('Stop')}</Button>}
      </div>
      {zs?.phase === 'dsk' && (
        <div className="stg-actions">
          <input className="stg-input" style={{ maxWidth: 120 }} inputMode="numeric" maxLength={5} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}/>
          <Button variant="primary" onClick={() => call('/api/wiring/zwave/pin', { pin }).then(() => setPin(''))}>{tr('Confirm')}</Button>
        </div>
      )}
      {phase && zs?.phase !== 'idle' && <div className={`stg-banner ${zs?.phase === 'failed' ? 'err' : 'ok'}`} style={{ marginTop: 8 }}>{phase}</div>}
      {err && <div className="stg-banner err" style={{ marginTop: 8 }}>✗ {err}</div>}
    </SettingsCard>
  )
}

function ZigbeeCard({ s, reload }) {
  const [err, setErr] = useState(null)
  const [left, setLeft] = useState(0)
  useEffect(() => { setLeft(s.permitJoin ? s.permitJoinLeft || 240 : 0) }, [s.permitJoin, s.permitJoinLeft])
  useEffect(() => {
    if (!left) return
    const t = setTimeout(() => setLeft((x) => Math.max(0, x - 1)), 1000)
    return () => clearTimeout(t)
  }, [left])
  const call = async (url, body) => {
    setErr(null)
    const j = await api(url, 'POST', body).catch((e) => ({ success: false, error: e.message }))
    if (!j.success) setErr(j.error)
    reload()
  }
  const joining = !!s.permitJoin && left > 0

  return (
    <SettingsCard title="Zigbee network"
      desc="Pair: start pairing, then reset the device (usually its button held 5 s, or a bulb switched on and off 6×). It joins within a minute and appears on the dashboard. Routers (mains-powered plugs and bulbs) extend the range for battery sensors.">
      <div className="stg-mod-list">
        <div className="stg-mod-row">
          <div className="stg-mod-main">
            <div className="stg-mod-name">
              {tr('Coordinator')}
              <span className={`stg-mod-chip ${s.running ? 'ok' : 'warn'}`}>{s.running ? tr('ready') : tr('not ready')}</span>
              {s.channel && <span className="stg-mod-chip cfg">{tr('channel {n}', { n: s.channel })}</span>}
              {s.panId && <span className="stg-mod-chip cfg">PAN {s.panId}</span>}
            </div>
            <div className="stg-hint stg-mod-meta" style={{ wordBreak: 'break-all' }}>{[s.port, s.firmware, s.adapter].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
      </div>
      <div className="stg-actions">
        {joining
          ? <Button variant="secondary" onClick={() => call('/api/usb-radio/zigbee/permit', { on: false })}>{tr('Stop pairing ({n} s)', { n: left })}</Button>
          : <Button variant="primary" disabled={!s.running} onClick={() => call('/api/usb-radio/zigbee/permit', { on: true })}>{tr('Pair devices')}</Button>}
      </div>
      {err && <div className="stg-banner err" style={{ marginTop: 8 }}>✗ {err}</div>}

      <h4 className="stg-subheading">{tr('Devices ({n})', { n: s.devices?.length || 0 })}</h4>
      {!s.devices?.length && <p className="stg-hint">{tr('No Zigbee devices yet.')}</p>}
      <div className="stg-mod-list">
        {(s.devices || []).map((d) => (
          <div key={d.key} className="stg-mod-row">
            <div className="stg-mod-main">
              <div className="stg-mod-name">
                {d.label}
                {d.linkquality != null && <span className={`stg-mod-chip ${d.linkquality < 50 ? 'warn' : 'ok'}`}>LQI {d.linkquality}</span>}
                {d.battery != null && <span className="stg-mod-chip cfg">🔋 {d.battery}%</span>}
              </div>
              <div className="stg-hint stg-mod-meta">{[d.model, d.ieee, d.room].filter(Boolean).join(' · ')}</div>
            </div>
            <Button variant="secondary" onClick={() => call('/api/usb-radio/zigbee/remove', { ieee: d.ieee })}>{tr('Remove')}</Button>
          </div>
        ))}
      </div>
    </SettingsCard>
  )
}
