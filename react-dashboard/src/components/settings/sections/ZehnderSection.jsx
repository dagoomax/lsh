import { useEffect, useState } from 'react'
import { SettingsCard, ListEditor, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { gt } from '../../../i18n'

const api = (url, method = 'GET', body) => fetch(url, {
  method, credentials: 'include',
  ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
}).then((r) => r.json())

const TYPES = [
  { value: 'lanc', label: 'LAN C (ComfoAir Q)' },
  { value: 'pro', label: 'Pro / Modbus (ComfoAir Q)' },
  { value: 'ca350', label: 'RS232 (ComfoAir 350/550)' },
]
const FIELDS = [
  { key: 'type', label: 'Unit / interface', type: 'select', default: 'lanc', options: TYPES },
  { key: 'host', label: 'IP / host', placeholder: '192.168.1.70' },
  { key: 'port', label: 'Port', placeholder: 'LAN C 56747 · Pro 502 · bridge port' },
  { key: 'pin', label: 'PIN (LAN C)', placeholder: '0000' },
  { key: 'serialPort', label: 'Serial port (RS232, instead of a bridge)', placeholder: '/dev/ttyUSB0' },
  { key: 'name', label: 'Name', placeholder: 'Rekuperator' },
]
const SPEED = ['Away', 'Low', 'Medium', 'High']
const fmt = (v, unit = '') => (v === undefined || v === null ? '—' : `${v}${unit}`)

// Zehnder heat-recovery ventilation. Server: src/zehnder-client.js (+ src/zehnder/*).
export default function ZehnderSection({ config, reload }) {
  const z = config.zehnder || {}
  const [units, setUnits] = useState((z.units || z.devices || []).map((u) => ({ ...u, port: u.port ?? '', pin: u.pin ?? '' })))
  const [boostMinutes, setBoost] = useState(z.boostMinutes || 60)
  const [awayHours, setAway] = useState(z.awayHours || 0)
  const [status, setStatus] = useState([])
  const save = useSettingsSave('/api/settings/zehnder')
  const test = useSettingsSave('/api/zehnder/test')
  const disc = useSettingsSave('/api/zehnder/discover')

  const load = () => api('/api/zehnder/status').then((j) => j.success && setStatus(j.data || [])).catch(() => {})
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [])

  const discover = async () => {
    const r = await disc.save({}).catch(() => null)
    const found = r?.data || []
    const have = new Set(units.map((u) => u.host))
    const add = found.filter((g) => !have.has(g.host)).map((g) => ({ type: 'lanc', host: g.host, port: '', pin: '', name: '' }))
    if (add.length) setUnits([...units, ...add])
  }
  const runTest = async () => {
    for (const u of units.filter((x) => x.host || x.serialPort)) await test.save(u).catch(() => {})
  }
  const doSave = () => save.save({ units, boostMinutes, awayHours }).then(() => { load(); reload?.() }).catch(() => {})

  return (
    <SettingsCard title="Zehnder Ventilation" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Zehnder heat-recovery ventilation (rekuperacja). ComfoAir Q / Flex through the ComfoConnect LAN C gateway (LSH registers like the ComfoControl app, with the gateway PIN — default 0000; the gateway holds one session, so opening the Zehnder app pauses LSH for 5 minutes), ComfoAir Q through ComfoConnect Pro (Modbus TCP — enable it on the Pro, port 502), or a ComfoAir 350 / 550 (WHR930…) via its RS232 port through a serial-to-TCP bridge (ser2net, USR-TCP232, ESP-Link) or a local serial port. Each unit becomes one device: level away / low / medium / high, auto, boost, away, temperature profile, bypass, temperatures, humidity, flows, power, filter and errors — in HomeKit as a fan with temperature and humidity.">
      <ListEditor rows={units} onChange={setUnits} fields={FIELDS} addLabel="Add unit"/>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0 12px' }}>
        <Field label="Boost lasts" hint="(minutes)" type="number" value={boostMinutes} onChange={setBoost}/>
        <Field label="Away lasts" hint="(hours, 0 = until switched off)" type="number" value={awayHours} onChange={setAway}/>
      </div>
      <div className="stg-actions">
        <Button variant="secondary" busy={disc.busy} onClick={discover}>Find LAN C gateways</Button>
        <Button variant="secondary" busy={test.busy} onClick={runTest}>Test</Button>
        <Button variant="primary" busy={save.busy} onClick={doSave}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result || test.result || disc.result}/>
      </div>

      {status.length > 0 && <>
        <h4 className="stg-subheading">Units</h4>
        <div style={{ overflowX: 'auto' }}>
          <table className="stg-table" style={{ width: '100%', fontSize: 12.5 }}>
            <thead><tr><th>Unit</th><th>State</th><th>Level</th><th>Outdoor</th><th>Supply</th><th>Room</th><th>Humidity</th><th>Filter</th><th>Messages</th></tr></thead>
            <tbody>
              {status.map((s) => {
                const v = s.values || {}
                return (
                  <tr key={s.id}>
                    <td><b>{s.label}</b><div className="stg-hint">{s.typeLabel} · {s.host || s.serialPort}</div></td>
                    <td style={{ color: s.connected ? 'var(--green)' : 'var(--red)' }}>{s.connected ? '● connected' : `● ${s.error || 'offline'}`}</td>
                    <td>{v.speed != null ? SPEED[v.speed] : '—'}{v.auto ? ' · auto' : ''}{v.boost ? ' · boost' : ''}{v.away ? ' · away' : ''}</td>
                    <td>{fmt(v.outdoorTemp, ' °C')}</td>
                    <td>{fmt(v.supplyTemp, ' °C')}</td>
                    <td>{fmt(v.extractTemp ?? v.roomTemp, ' °C')}</td>
                    <td>{fmt(v.extractHumidity ?? v.roomHumidity, ' %')}</td>
                    <td style={{ color: v.filterAlarm ? 'var(--red)' : 'inherit' }}>{v.filterDays != null ? `${v.filterDays} d` : v.filterAlarm ? 'replace' : '—'}</td>
                    <td>{v.errors && v.errors !== 'OK' ? v.errors : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </>}
    </SettingsCard>
  )
}
