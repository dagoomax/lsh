import { useState } from 'react'
import { SettingsCard, ListEditor, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { RelayOutputIcon } from '../../Icons'
import { gt } from '../../../i18n'

const FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'host', label: 'Host / IP', placeholder: '192.168.1.x' },
  { key: 'port', label: 'Port', type: 'number', default: 502, placeholder: '502' },
  { key: 'slaveId', label: 'Slave ID', type: 'number', default: 1, placeholder: '1' },
  { key: 'relayCount', label: 'Relay Count', type: 'number', default: 8, placeholder: '8' },
]

export default function WaveshareSection({ config, reload }) {
  const [devices, setDevices] = useState(config.waveshare?.devices || [])
  const save = useSettingsSave('/api/settings/waveshare')
  const test = useSettingsSave('/api/settings/test-waveshare')
  const [testingIdx, setTestingIdx] = useState(null)

  return (
    <SettingsCard icon={RelayOutputIcon} title="Waveshare Modbus TCP" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Waveshare Modbus TCP relay boards — read/write relay states over the network.">
      <ListEditor rows={devices} onChange={setDevices} fields={FIELDS} addLabel="+ Add Board"
        renderExtra={(row, i) => (
          <Button variant="secondary" busy={test.busy && testingIdx === i}
            onClick={() => { setTestingIdx(i); test.save({ host: row.host, port: Number(row.port) || 502, slaveId: Number(row.slaveId) || 1 }).finally(() => setTestingIdx(null)) }}>
            {gt('common.test', 'Test')}
          </Button>
        )}/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} onClick={() => save.save(devices).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result || test.result}/>
      </div>
    </SettingsCard>
  )
}
