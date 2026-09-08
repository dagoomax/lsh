import { useEffect, useState } from 'react'
import { SettingsCard, ListEditor, Field, Toggle, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { BoltIcon } from '../../Icons'
import { gt } from '../../../i18n'

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
    <>
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
      <TauronTariffCard tauronTariff={config?.tauronTariff}/>
    </>
  )
}

function TauronTariffCard({ tauronTariff }) {
  const [enabled, setEnabled] = useState(!!tauronTariff?.enabled)
  const [markupPlnKwh, setMarkupPlnKwh] = useState(tauronTariff?.markupPlnKwh ?? 0)
  const [vatRate, setVatRate] = useState(tauronTariff?.vatRate ?? 0.23)
  const test = useSettingsSave('/api/settings/test-tauron-tariff')
  const save = useSettingsSave('/api/settings/tauron-tariff')

  useEffect(() => {
    setEnabled(!!tauronTariff?.enabled)
    setMarkupPlnKwh(tauronTariff?.markupPlnKwh ?? 0)
    setVatRate(tauronTariff?.vatRate ?? 0.23)
  }, [tauronTariff])

  return (
    <SettingsCard icon={BoltIcon} title="TAURON Dynamic Tariff (Poland)" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Tracks Poland's public PSE RCE price index — the same day-ahead market rate TAURON's G14dynamic tariff settles against — for a live, hourly electricity price. Free, no account or API key needed. Feeds the Energy tab's current electricity-cost reading and solar-gain chart, alongside the fixed windows above. The markup and VAT below approximate your retail rate; distribution charges aren't public data, so treat this as an estimate rather than an exact bill match.">
      <Toggle label={gt('common.enabled', 'Enabled')} checked={enabled} onChange={setEnabled}/>
      <Field label="Markup" hint="(PLN/kWh, added to the raw market price — your supplier's margin)" type="number" value={markupPlnKwh} onChange={setMarkupPlnKwh} placeholder="0" min={0}/>
      <Field label="VAT rate" hint="(e.g. 0.23 for 23%)" type="number" value={vatRate} onChange={setVatRate} placeholder="0.23" min={0} max={1}/>
      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy} onClick={() => test.save({})}>{gt('common.test', 'Test Connection')}</Button>
        <Button variant="primary" busy={save.busy} onClick={() => save.save({ enabled, markupPlnKwh, vatRate })}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={test.result || save.result}/>
      </div>
    </SettingsCard>
  )
}
