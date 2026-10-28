import { useState } from 'react'
import { SettingsCard, ListEditor, Field, Toggle, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { KnxBusIcon } from '../../Icons'
import { gt, tr } from '../../../i18n'

const DPTS = ['DPT1', 'DPT5', 'DPT9', 'DPT14']
const HK_TYPES = ['', 'Switch', 'TemperatureSensor', 'HumiditySensor', 'LightSensor', 'OccupancySensor', 'ContactSensor']

const FIELDS = [
  { key: 'address', label: 'Group Address', placeholder: '1/1/1' },
  { key: 'name', label: 'Name' },
  { key: 'dpt', label: 'DPT', type: 'select', default: 'DPT1', options: DPTS.map(d => ({ value: d, label: d })) },
  { key: 'unit', label: 'Unit', placeholder: '(optional)' },
  { key: 'readable', label: 'Readable', type: 'checkbox', default: true },
  { key: 'writable', label: 'Writable', type: 'checkbox' },
  { key: 'homekitType', label: 'HomeKit type', type: 'select', options: HK_TYPES.map(h => ({ value: h, label: h || '(none)' })) },
]

const KIND_LABELS = { switch: () => tr('Switching'), dim: () => tr('Dimming'), value: () => tr('Values'), state: () => tr('States'), scene: () => tr('Scenes') }

// LSH devices and scenes as group addresses for ETS (src/knx-ets.js)
function EtsExport({ config, reload }) {
  const [mainGroup, setMainGroup] = useState(config.knx?.ets?.mainGroup ?? 20)
  const [bridge, setBridge] = useState(!!config.knx?.lshBridge)
  const [scenes, setScenes] = useState(true)
  const [types, setTypes] = useState('')
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const save = useSettingsSave('/api/settings/knx-ets')
  const query = () => new URLSearchParams({ mainGroup: String(mainGroup), ...(scenes ? {} : { scenes: '0' }), ...(types.trim() ? { type: types.replace(/\s+/g, '') } : {}) })

  const load = () => {
    setError('')
    fetch(`/api/knx/ets?${query()}`, { credentials: 'include' }).then(r => r.json())
      .then(j => { if (j.success) setPreview(j.data); else { setPreview(null); setError(j.error) } })
      .catch(err => setError(err.message))
  }

  return (
    <SettingsCard title="Export to ETS"
      desc="LSH devices and scenes as KNX group addresses, in the XML that ETS 5/6 imports (Group Addresses → Import…). Switches and dimmers get a command and a status address, measurements and states a status address, each scene a trigger. An address stays the same in later exports, so what you link in ETS keeps working. Turn on the bridge so LSH answers on these addresses through the gateway above.">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0 12px' }}>
        <Field label="First main group" hint="(0-27; uses five)" type="number" value={mainGroup} onChange={v => setMainGroup(Number(v))}/>
        <Field label="Only these platforms" hint="(e.g. shelly, netatmo; empty = all)" value={types} onChange={setTypes} placeholder="shelly, smartthings"/>
      </div>
      <Toggle label="Include scenes" checked={scenes} onChange={setScenes}/>
      <Toggle label="LSH bridge on the bus" hint="(commands from KNX drive LSH, LSH sends status)" checked={bridge} onChange={setBridge}/>
      <div className="stg-actions">
        <Button variant="secondary" onClick={load}>{tr('Preview')}</Button>
        <Button variant="primary" onClick={() => { window.location.href = `/api/knx/ets.xml?${query()}` }}>{tr('⬇ Group addresses for ETS (XML)')}</Button>
        <Button busy={save.busy} onClick={() => save.save({ mainGroup, lshBridge: bridge }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result || (error ? { ok: false, message: error } : null)}/>
      </div>
      {preview && <>
        <p className="stg-hint">
          {tr('{total} addresses from {first}/0/0 to {last}/7/255', { total: preview.total, first: preview.mainGroup, last: preview.mainGroup + 4 })}
          {' · '}{Object.entries(preview.counts).map(([k, n]) => `${KIND_LABELS[k]?.() || k} ${n}`).join(' · ')}
        </p>
        {preview.full?.length > 0 && <p className="stg-hint" style={{ color: 'var(--red)' }}>{tr('Some groups are full; those sensors were left out')}</p>}
        <div style={{ overflowX: 'auto', maxHeight: 360 }}>
          <table className="stg-table" style={{ width: '100%', fontSize: 12.5 }}>
            <thead><tr><th>{tr('Name')}</th><th>{tr('Command')}</th><th>{tr('Status')}</th><th>DPT</th></tr></thead>
            <tbody>
              {preview.entries.map(e => (
                <tr key={e.key}>
                  <td>{e.name}<div className="stg-hint">{e.key}</div></td>
                  <td><code>{e.cmd || '—'}</code></td>
                  <td><code>{e.status || '—'}</code></td>
                  <td>{e.dpt.replace('DPT', '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}
    </SettingsCard>
  )
}

export default function KnxSection({ config, reload }) {
  const [host, setHost] = useState(config.knx?.host || '')
  const [port, setPort] = useState(config.knx?.port || 3671)
  const [gas, setGas] = useState((config.knx?.groupAddresses || []).map(ga => ({ ...ga, readable: ga.readable !== false })))
  const test = useSettingsSave('/api/settings/test-knx')
  const save = useSettingsSave('/api/settings/knx')

  return (<>
    <SettingsCard icon={KnxBusIcon} title="KNX" badge={{ label: gt('common.optional', 'Optional') }}
      desc={<>{tr('Connects to a KNXnet/IP gateway or IP router over TCP/IP. Group addresses are mapped to dashboard device cards with read/write support. Requires')}{' '}<code>npm install knx</code>.</>}>
      <Field label="Gateway Host / IP" value={host} onChange={setHost} placeholder="192.168.1.100"/>
      <Field label="Port" hint="(default 3671)" type="number" value={port} onChange={setPort} style={{ maxWidth: 160 }}/>
      <h4 className="stg-subheading">{tr('Group Addresses')}</h4>
      <ListEditor rows={gas} onChange={setGas} fields={FIELDS} addLabel="+ Add Group Address"/>
      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy} onClick={() => test.save({ host, port: Number(port) })}>{gt('common.test', 'Test Connection')}</Button>
        <Button variant="primary" busy={save.busy} onClick={() => save.save({ host, port: Number(port), groupAddresses: gas }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={test.result || save.result}/>
      </div>
    </SettingsCard>
    <EtsExport config={config} reload={reload}/>
  </>)
}
