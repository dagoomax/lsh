import { useEffect, useState } from 'react'
import { SettingsCard, ListEditor, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { tr, trn } from '../../../i18n'

// Settings for the "device list / account" integrations served by
// src/routes/integration-settings.js: each card edits config[id], can Test the
// entered values (one poll, nothing saved) and Save (applied live).

const AC = [
  { id: 'daikin', title: 'Daikin', desc: 'Daikin air conditioners through the local API of their Wi-Fi adapter (BRP069 / BRP072A, or BRP072C with the key printed on it). No cloud. Newer units that only work with the Onecta app have no local API.',
    list: [
      { key: 'host', label: 'IP / host', placeholder: '192.168.1.60' },
      { key: 'name', label: 'Name', placeholder: 'Living room AC' },
      { key: 'key', label: 'Adapter key (BRP072C only)', placeholder: '0123456789012', type: 'password' },
    ], add: 'Add unit' },
  { id: 'gree', title: 'Gree & rebrands', desc: 'Gree and the brands on the Gree+ / EWPE Smart apps (Sinclair, Cooper&Hunter, Tosot, Bulex, Daitsu…) over their local UDP protocol. Set the unit up on Wi-Fi with the app once; LSH finds its MAC and pairing key by itself.',
    list: [
      { key: 'host', label: 'IP / host', placeholder: '192.168.1.61' },
      { key: 'name', label: 'Name', placeholder: 'Bedroom AC' },
      { key: 'encryption', label: 'Encryption', type: 'select', default: '', options: [{ value: '', label: 'Detect' }, { value: 'ecb', label: 'ECB (older firmware)' }, { value: 'gcm', label: 'GCM (newer firmware)' }] },
    ], add: 'Add unit' },
  { id: 'midea', title: 'Midea & brands', desc: 'Midea-made units (Midea, Comfee, Carrier, newer Toshiba, Electrolux, Pioneer, Qlima…) over the local LAN protocol. Newer units need their token and key, fetched once from the Midea cloud: pip install msmart-ng && msmart-ng discover <ip> prints id, token and key.',
    list: [
      { key: 'host', label: 'IP / host', placeholder: '192.168.1.62' },
      { key: 'id', label: 'Device ID', placeholder: '151732605161920' },
      { key: 'token', label: 'Token (V3 units)', placeholder: '128 hex characters', type: 'password' },
      { key: 'key', label: 'Key (V3 units)', placeholder: '64 hex characters', type: 'password' },
      { key: 'name', label: 'Name', placeholder: 'Office AC' },
    ], add: 'Add unit' },
  { id: 'melcloud', title: 'Mitsubishi Electric (MELCloud)', desc: 'Mitsubishi Electric air conditioners through MELCloud, with the MELCloud app account. MELCloud limits how often it can be asked — keep the interval at a minute or more. MELCloud Home accounts use a different service and are not supported.',
    top: [
      { key: 'email', label: 'Email', placeholder: 'you@example.com' },
      { key: 'password', label: 'Password', type: 'password' },
      { key: 'pollInterval', label: 'Poll interval', hint: '(seconds, min 30)', type: 'number', placeholder: '60' },
    ] },
  { id: 'sensibo', title: 'Sensibo', desc: 'Sensibo Sky / Air / Air Pro / Elements through the official Sensibo API — the way to control any air conditioner with an IR remote (Fujitsu, Panasonic, Toshiba, Hitachi, Haier…). Create an API key at home.sensibo.com/me/api.',
    top: [
      { key: 'apiKey', label: 'API key', type: 'password' },
      { key: 'pollInterval', label: 'Poll interval', hint: '(seconds, min 30)', type: 'number', placeholder: '60' },
    ] },
]

const BATTERIES = [
  { id: 'zendure', title: 'Zendure SolarFlow', desc: 'Zendure SolarFlow batteries and the SmartMeter 3CT through the official local API (zenSDK). Newer firmware keeps it off until a HEMS is added in the Zendure app — add one, then leave the HEMS screen.',
    list: [
      { key: 'host', label: 'IP / host', placeholder: '192.168.1.70' },
      { key: 'name', label: 'Name', placeholder: 'Balcony battery' },
    ], add: 'Add unit' },
  { id: 'ankerSolix', title: 'Anker SOLIX', desc: 'Anker SOLIX Solarbank Max / E5000 Pro / XE and the Smart Meter / Smart Plug Gen 2 through local Modbus TCP. Turn it on in the Anker app: device → Settings → Three-Party Control Settings → Modbus TCP.',
    list: [
      { key: 'host', label: 'IP / host', placeholder: '192.168.1.71' },
      { key: 'port', label: 'Port', placeholder: '502' },
      { key: 'unitId', label: 'Unit ID', placeholder: '1' },
      { key: 'name', label: 'Name', placeholder: 'Solarbank' },
    ], add: 'Add unit' },
  { id: 'ugreen', title: 'UGREEN PowerRoam', desc: 'UGREEN PowerRoam portable power stations through the UGREEN cloud, with the UGREEN app account. The units have no local API, so this needs internet.',
    top: [
      { key: 'email', label: 'Email', placeholder: 'you@example.com' },
      { key: 'password', label: 'Password', type: 'password' },
    ] },
]

export function AirConditionersSection({ config, reload }) {
  return <>{AC.map((s) => <IntegrationCard key={s.id} spec={s} saved={config[s.id]} reload={reload} />)}</>
}

export function BatteriesSection({ config, reload }) {
  return <>{BATTERIES.map((s) => <IntegrationCard key={s.id} spec={s} saved={config[s.id]} reload={reload} />)}</>
}

function IntegrationCard({ spec, saved = {}, reload }) {
  const [rows, setRows] = useState(() => (saved.devices || []).map((d) => Object.fromEntries((spec.list || []).map((f) => [f.key, d[f.key] ?? '']))))
  const [top, setTop] = useState(() => Object.fromEntries((spec.top || []).map((f) => [f.key, saved[f.key] ?? ''])))
  const [status, setStatus] = useState(null)
  const save = useSettingsSave(`/api/settings/integration/${spec.id}`)
  const test = useSettingsSave(`/api/integration/${spec.id}/test`)

  const load = () => fetch(`/api/integration/${spec.id}/status`, { credentials: 'include' }).then((r) => r.json()).then((j) => j.success && Array.isArray(j.data?.devices) && setStatus(j.data)).catch(() => {})
  useEffect(() => { load() }, [])

  const config = () => ({ ...top, ...(spec.list ? { devices: rows } : {}) })
  const doSave = () => save.save({ config: config() }).then(() => { load(); reload?.() }).catch(() => {})
  const doTest = () => test.save({ config: config() }).catch(() => {})
  const configured = spec.list ? rows.some((r) => r.host) : Object.values(top).some((v) => v)

  return (
    <SettingsCard title={spec.title} badge={{ label: 'Optional' }} desc={spec.desc}>
      {spec.list && <ListEditor rows={rows} onChange={setRows} fields={spec.list} addLabel={spec.add} />}
      {(spec.top || []).map((f) => (
        <Field key={f.key} label={f.label} hint={f.hint} type={f.type} placeholder={f.placeholder} value={top[f.key]}
          onChange={(v) => setTop((t) => ({ ...t, [f.key]: v }))} />
      ))}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button variant="secondary" busy={test.busy} disabled={!configured} onClick={doTest}>{tr('Test')}</Button>
        <Button variant="primary" busy={save.busy} onClick={doSave}>{tr('Save')}</Button>
        <ResultBanner result={test.result || save.result} />
      </div>
      {status && (status.running || status.devices.length > 0) && (
        <div className="stg-hint">
          {status.connected ? '● ' : '○ '}
          {status.connected ? tr('Connected') : status.running ? tr('Not connected yet') : tr('Not running')}
          {' · '}{trn('{n} device|{n} devices', status.devices.length)}
          {status.devices.length > 0 && ` — ${status.devices.map((d) => d.label).join(', ')}`}
        </div>
      )}
    </SettingsCard>
  )
}
