import { useState } from 'react'
import { SettingsCard, ListEditor, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { ShieldIcon } from '../../Icons'
import { gt } from '../../../i18n'

const NAME_FIELDS = [
  { key: 'num', label: '#', type: 'number' },
  { key: 'name', label: 'Name' },
]

function toRows(namesObj) {
  return Object.entries(namesObj || {}).sort((a, b) => Number(a[0]) - Number(b[0])).map(([num, name]) => ({ num, name }))
}
function toObj(rows) {
  const out = {}
  for (const r of rows) { const n = parseInt(r.num); if (n && r.name) out[n] = r.name }
  return out
}

function NamesEditor({ title, rows, onChange }) {
  return (
    <div className="names-section">
      <h4 className="stg-subheading">{title}</h4>
      <ListEditor rows={rows} onChange={onChange} fields={NAME_FIELDS} addLabel="+ Add"/>
    </div>
  )
}

export default function SatelSection({ config, reload }) {
  const satel = config.satel || {}
  const [host, setHost] = useState(satel.host || '')
  const [port, setPort] = useState(satel.port || 7094)
  const [armCode, setArmCode] = useState(satel.armCode || '')
  const [zoneCount, setZoneCount] = useState(satel.zoneCount || 32)
  const [partitions, setPartitions] = useState((satel.partitions || [1]).join(','))
  const [zoneNames, setZoneNames] = useState(toRows(satel.zoneNames))
  const [partitionNames, setPartitionNames] = useState(toRows(satel.partitionNames))
  const [outputCount, setOutputCount] = useState(satel.outputCount || 0)
  const [outputNames, setOutputNames] = useState(toRows(satel.outputNames))
  const test = useSettingsSave('/api/settings/test-satel')
  const save = useSettingsSave('/api/settings/satel')

  const doSave = () => save.save({
    host, port, armCode, zoneCount, partitions,
    zoneNames: toObj(zoneNames), partitionNames: toObj(partitionNames),
    outputCount: Number(outputCount) || 0, outputNames: toObj(outputNames),
  }).then(reload)

  return (
    <SettingsCard icon={ShieldIcon} title={gt('s.satel_title', 'Satel INTEGRA')} badge={{ label: gt('common.optional', 'Optional') }}
      desc={gt('sdesc.d12', 'Connect to a Satel INTEGRA alarm panel via ETHM-1 Plus module (TCP port 7094). Zone sensors, partition arm state, and programmable output relays appear as individual dashboard devices.')}>
      <Field label={gt('s.satel_host', 'ETHM-1 Plus Host / IP')} value={host} onChange={setHost} placeholder="192.168.1.100"/>
      <Field label={gt('s.satel_port', 'Port')} hint={gt('s.satel_port_hint', '(default 7094)')} type="number" value={port} onChange={setPort}/>
      <Field label={gt('s.satel_code', 'Arm / Disarm Code')} hint={gt('s.satel_code_hint', '(PIN for arming/disarming partitions)')} type="password" value={armCode} onChange={setArmCode}/>
      <Field label={gt('s.satel_zone_count', 'Zone count')} hint={gt('s.satel_zone_count_hint', '(how many zones to monitor)')} type="number" value={zoneCount} onChange={setZoneCount}/>
      <Field label={gt('s.satel_partitions', 'Partitions')} hint={gt('s.satel_partitions_hint', '(comma-separated, e.g. 1,2)')} value={partitions} onChange={setPartitions} placeholder="1"/>

      <NamesEditor title={gt('s.satel_zone_names', 'Zone Names')} rows={zoneNames} onChange={setZoneNames}/>
      <NamesEditor title={gt('s.satel_partition_names', 'Partition Names')} rows={partitionNames} onChange={setPartitionNames}/>

      <Field label="Output / Relay count" hint="(how many programmable outputs to monitor and control, 0 = disabled)" type="number" value={outputCount} onChange={setOutputCount} style={{ maxWidth: 160 }}/>
      <NamesEditor title="Output / Relay Names" rows={outputNames} onChange={setOutputNames}/>

      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy} onClick={() => test.save({ host, port })}>{gt('common.test', 'Test Connection')}</Button>
        <Button variant="primary" busy={save.busy} onClick={doSave}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={test.result || save.result}/>
      </div>
    </SettingsCard>
  )
}
