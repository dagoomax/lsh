import { useState, useRef } from 'react'
import { SettingsCard, ListEditor, Field, Toggle, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { DinRailIcon } from '../../Icons'
import { gt, tr } from '../../../i18n'

// Same CDN loader the HomeKit card uses for its pairing QR — no extra npm dep.
const QRCODEJS_SRC = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js'
let qrcodejsPromise = null
function loadQrcodejs() {
  if (window.QRCode) return Promise.resolve()
  if (!qrcodejsPromise) {
    qrcodejsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = QRCODEJS_SRC
      s.onload = resolve
      s.onerror = () => reject(new Error('Failed to load QR library'))
      document.head.appendChild(s)
    })
  }
  return qrcodejsPromise
}

const GRENTON_TYPES = ['light', 'dimmer', 'switch', 'blind', 'temperature', 'sensor']
const GRENTON_FIELDS = [
  { key: 'name', label: 'Name', placeholder: 'Lampa salon' },
  { key: 'object', label: 'Object', placeholder: 'DOU8272' },
  { key: 'type', label: 'Type', type: 'select', default: 'switch', options: GRENTON_TYPES.map(t => ({ value: t, label: t })) },
]

export default function BoneioGrentonSection({ config, reload }) {
  return (
    <>
      <BoneioCard boneio={config.boneio} reload={reload}/>
      <GrentonCard grenton={config.grenton} reload={reload}/>
    </>
  )
}

function BoneioCard({ boneio, reload }) {
  const [host, setHost] = useState(boneio?.host || '')
  const [port, setPort] = useState(boneio?.port || 1883)
  const test = useSettingsSave('/api/settings/test-boneio')
  const save = useSettingsSave('/api/settings/boneio')

  return (
    <SettingsCard icon={DinRailIcon} title={gt('s.boneio_title', 'BoneIO')} badge={{ label: gt('common.optional', 'Optional') }}
      desc={gt('sdesc.d22', 'Connects to a BoneIO controller via MQTT. Relays, inputs, and sensors are auto-discovered via Home Assistant MQTT discovery. Leave host blank to use the Cerbo GX MQTT broker.')}>
      <Field label={gt('s.boneio_host', 'MQTT Host / IP')} hint={gt('s.boneio_host_hint', '(leave blank to reuse Cerbo GX broker)')} value={host} onChange={setHost} placeholder="192.168.1.100"/>
      <Field label={gt('s.boneio_port', 'MQTT Port')} hint={gt('s.boneio_port_hint', '(default 1883)')} type="number" value={port} onChange={setPort}/>
      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy} onClick={() => test.save({ host, port: Number(port) })}>{gt('common.test', 'Test Connection')}</Button>
        <Button variant="primary" busy={save.busy} onClick={() => save.save({ host, port: Number(port) }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={test.result || save.result}/>
      </div>
    </SettingsCard>
  )
}

function GrentonCard({ grenton, reload }) {
  const [host, setHost] = useState(grenton?.host || '')
  const [port, setPort] = useState(grenton?.port || 80)
  const [path, setPath] = useState(grenton?.path || '/lsh')
  const [pollInterval, setPollInterval] = useState(grenton?.pollInterval ?? 5)
  const [token, setToken] = useState(grenton?.token || '')
  const [simEnabled, setSimEnabled] = useState(false)
  const [simStatus, setSimStatus] = useState('')
  const [devices, setDevices] = useState(grenton?.devices || [])
  const save = useSettingsSave('/api/settings/grenton')
  const simToggle = useSettingsSave('/api/simulators/grenton')

  // Endpoint QR — gives the GATE's Lua script the LSH URL + an API token so a
  // real Grenton installation can call LSH (GET /api/devices, POST
  // /api/device/:key/command) and drive LSH-provided objects as a vCLU.
  const [syncUrl, setSyncUrl] = useState(() => window.location.origin)
  const [syncToken, setSyncToken] = useState('')
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncErr, setSyncErr] = useState('')
  const [copied, setCopied] = useState('')
  const qrRef = useRef(null)

  const generateSync = async () => {
    setSyncBusy(true); setSyncErr(''); setCopied('')
    try {
      const res = await fetch('/api/auth/tokens', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `Grenton GATE ${new Date().toISOString().slice(0, 10)}` }),
      })
      const data = await res.json()
      if (!res.ok || !data.token) throw new Error(data.error || `HTTP ${res.status}`)
      setSyncToken(data.token)
      const cleanUrl = syncUrl.replace(/\/+$/, '')
      const payload = `url: ${cleanUrl}\ntoken: ${data.token}`
      await loadQrcodejs()
      if (qrRef.current) {
        qrRef.current.innerHTML = ''
        // eslint-disable-next-line no-undef
        new window.QRCode(qrRef.current, {
          text: payload, width: 180, height: 180,
          colorDark: '#e6edf3', colorLight: '#161b22', correctLevel: window.QRCode.CorrectLevel.M,
        })
      }
    } catch (err) { setSyncErr(err.message) }
    finally { setSyncBusy(false) }
  }

  const copy = (value, what) => {
    navigator.clipboard?.writeText(value).then(() => { setCopied(what); setTimeout(() => setCopied(''), 1500) }).catch(() => {})
  }

  const toggleSim = (checked) => {
    setSimEnabled(checked)
    simToggle.save({ enabled: checked }).then(res => {
      setSimStatus(res.data?.enabled ? (res.data.running ? `● running on :${res.data.port}` : '● starting…') : '')
    }).catch(err => { setSimEnabled(!checked); setSimStatus('Error: ' + err.message) })
  }

  return (
    <SettingsCard title="Grenton" badge={{ label: gt('common.optional', 'Optional') }}
      desc={<>{tr('Grenton CLU controllers via the GATE HTTP module running the companion Lua script (')}<code>docs/grenton-gate-lsh.lua</code>{tr('). Add each object by its Object Manager name. Advanced per-object options live in')}{' '}<code>config.json</code>{' '}{tr('and are preserved on save.')}</>}>
      <Field label="GATE Host / IP" value={host} onChange={setHost} placeholder="192.168.1.x"/>
      <Field label="Port" type="number" value={port} onChange={setPort} placeholder="80" style={{ maxWidth: 120 }}/>
      <Field label="Path" value={path} onChange={setPath} placeholder="/lsh" style={{ maxWidth: 160 }}/>
      <Field label="Poll (s)" type="number" value={pollInterval} onChange={setPollInterval} style={{ maxWidth: 120 }}/>
      <Field label="Token" hint="(optional — must match the Lua script)" type="password" value={token} onChange={setToken}/>
      <Toggle label="Run local simulator" hint="(off by default; disable when using a real GATE module)" checked={simEnabled} onChange={toggleSim}/>
      {simStatus && <span className="stg-hint">{simStatus}</span>}

      <h4 className="stg-subheading">{tr('Sync the Grenton GATE to LSH')}</h4>
      <p className="stg-hint">{tr('Scan with your phone camera (not the myGrenton app) to copy the LSH address and API token into the GATE Lua script, so the GATE can call LSH and drive its objects as a vCLU.')}</p>
      <Field label={tr('LSH URL')} hint={tr('(as reachable from the GATE on your LAN)')} value={syncUrl} onChange={setSyncUrl} placeholder="http://192.168.1.50:3001"/>
      <div className="stg-actions">
        <Button variant="secondary" busy={syncBusy} onClick={generateSync}>{tr('Generate QR & token')}</Button>
      </div>
      {syncToken && (
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap', marginTop: 8 }}>
          <div ref={qrRef} style={{ width: 180, height: 180, background: '#161b22', borderRadius: 12, flexShrink: 0 }}/>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="stg-hint" style={{ textTransform: 'uppercase', fontWeight: 700, fontSize: 11 }}>{tr('LSH URL')}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <code style={{ wordBreak: 'break-all' }}>{syncUrl.replace(/\/+$/, '')}</code>
              <Button variant="secondary" onClick={() => copy(syncUrl.replace(/\/+$/, ''), 'url')}>{copied === 'url' ? tr('Copied') : tr('Copy')}</Button>
            </div>
            <div className="stg-hint" style={{ textTransform: 'uppercase', fontWeight: 700, fontSize: 11, marginTop: 10 }}>{tr('API token')}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <code style={{ wordBreak: 'break-all' }}>{syncToken}</code>
              <Button variant="secondary" onClick={() => copy(syncToken, 'token')}>{copied === 'token' ? tr('Copied') : tr('Copy')}</Button>
            </div>
            <p className="stg-hint" style={{ marginTop: 10 }}>{tr('Shown once — a new token saved under Users & API tokens. The myGrenton app will not accept this code; scan it with a plain camera or QR reader.')}</p>
          </div>
        </div>
      )}
      {syncErr && <p className="stg-banner err">{tr('QR error: {syncErr}', { syncErr })}</p>}

      <h4 className="stg-subheading">{tr('Objects')}</h4>
      <ListEditor rows={devices} onChange={setDevices} fields={GRENTON_FIELDS} addLabel="+ Add Object"/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy}
          onClick={() => save.save({ host, port: Number(port), path, token, pollInterval: Number(pollInterval), devices }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}
