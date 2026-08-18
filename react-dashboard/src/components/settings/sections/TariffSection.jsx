import { useEffect, useState } from 'react'
import { SettingsCard, ListEditor, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { BoltIcon } from '../../Icons'

const WINDOW_FIELDS = [
  { key: 'label', label: 'Label' },
  { key: 'price', label: 'Price/kWh', type: 'number', default: 0 },
  { key: 'start', label: 'Start (HH:MM)', default: '00:00' },
  { key: 'end', label: 'End (HH:MM)', default: '00:00' },
]

export default function TariffSection({ config }) {
  const [currency, setCurrency] = useState(config?.tariff?.currency || '£')
  const [windows, setWindows] = useState(config?.tariff?.windows || [])
  const save = useSettingsSave('/api/settings/tariff')

  useEffect(() => {
    setCurrency(config?.tariff?.currency || '£')
    setWindows(config?.tariff?.windows || [])
  }, [config])

  return (
    <SettingsCard icon={BoltIcon} title="Electricity Tariff" badge={{ label: 'Optional' }}
      desc="Peak/off-peak pricing windows, shown on the Home Plan's live power-flow overlay. Windows may wrap midnight (e.g. Off-Peak 23:00–16:00).">
      <Field label="Currency symbol" value={currency} onChange={setCurrency} placeholder="£"/>

      <h4 className="stg-subheading">Windows</h4>
      <ListEditor rows={windows} onChange={setWindows} fields={WINDOW_FIELDS} addLabel="+ Add Window"/>

      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} onClick={() => save.save({ currency, windows })}>Save Tariff</Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}
