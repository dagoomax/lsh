import { useEffect, useState } from 'react'
import { SettingsCard, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { SolarPanelIcon, DinRailIcon, GWagenIcon } from '../../Icons'
import { gt } from '../../../i18n'

export default function EnergySection({ config, reload }) {
  return (
    <>
      <MongoCard mongo={config.mongo} reload={reload}/>
      <SolarEdgeCard solaredge={config.solaredge} reload={reload}/>
      <EvVisualCard evVisual={config.evVisual} reload={reload}/>
    </>
  )
}

function MongoCard({ mongo, reload }) {
  const [uri, setUri] = useState(mongo?.uri || '')
  const [db, setDb] = useState(mongo?.db || 'lsh')
  const test = useSettingsSave('/api/settings/test-mongo')
  const save = useSettingsSave('/api/settings/mongo')

  return (
    <SettingsCard icon={DinRailIcon} title="MongoDB Storage" badge={{ label: gt('common.optional', 'Optional') }}
      desc={<>Persist the sensor DataStore (live values + history) to <strong>MongoDB</strong> instead of the local gzipped file. The file stays as a shutdown-safe fallback, so leaving this blank keeps the default behavior. Restart to apply.</>}>
      <Field label={gt('s.mongo_uri', 'Connection URI')} type="password" value={uri} onChange={setUri}
        placeholder="mongodb://host:27017" autoComplete="off"/>
      <Field label={gt('s.mongo_db', 'Database')} hint="(default lsh)" value={db} onChange={setDb} placeholder="lsh"/>
      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy} onClick={() => test.save({ uri, db })}>{gt('common.test', 'Test Connection')}</Button>
        <Button variant="primary" busy={save.busy} onClick={() => save.save({ uri, db }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={test.result || save.result}/>
      </div>
    </SettingsCard>
  )
}

function SolarEdgeCard({ solaredge, reload }) {
  const [siteId, setSiteId] = useState(solaredge?.siteId || '')
  const [apiKey, setApiKey] = useState(solaredge?.apiKey || '')
  const test = useSettingsSave('/api/settings/test-solaredge')
  const save = useSettingsSave('/api/settings/solaredge')

  return (
    <SettingsCard icon={SolarPanelIcon} title={gt('s.se_title', 'SolarEdge')} badge={{ label: gt('common.optional', 'Optional') }}
      desc={gt('sdesc.d2', 'Adds real-time solar production data from the SolarEdge Monitoring API. Runs alongside Victron data sources.')}>
      <Field label={gt('s.se_site_id', 'Site ID')} value={siteId} onChange={setSiteId} placeholder="12345"/>
      <Field label={gt('s.se_api_key', 'API Key')} type="password" value={apiKey} onChange={setApiKey} placeholder="••••••••••••••••••••••••••••••••"/>
      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy} onClick={() => test.save({ siteId, apiKey })}>{gt('common.test', 'Test Connection')}</Button>
        <Button variant="primary" busy={save.busy} onClick={() => save.save({ siteId, apiKey }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={test.result || save.result}/>
      </div>
    </SettingsCard>
  )
}

const DEFAULT_EV_MODEL_OPTION = { value: '', label: '— Default (2025 Mercedes-Benz G-Class AMG G63) —' }
const USE_DEFAULT_OPTION = { value: '', label: '— Use default above —' }

function EvVisualCard({ evVisual, reload }) {
  const [models, setModels] = useState([])
  const [chargers, setChargers] = useState([])
  const [modelId, setModelId] = useState(evVisual?.modelId || '')
  // Per-charger overrides, keyed by device key — '' means "use default above".
  const [perDevice, setPerDevice] = useState(
    () => Object.fromEntries(Object.entries(evVisual?.devices || {}).map(([k, v]) => [k, v.modelId || '']))
  )
  const save = useSettingsSave('/api/settings/ev-visual')

  // The car list (592 Sketchfab models, name + license) is a static asset
  // rather than bundled JS, since it's only needed on this one settings card.
  useEffect(() => {
    fetch('/react/vehicle-models.json').then(r => r.json()).then(setModels).catch(() => {})
    fetch('/api/settings/ev-charger-devices', { credentials: 'include' })
      .then(r => r.json()).then(d => setChargers(d.success ? d.devices : [])).catch(() => {})
  }, [])

  const carOptions = models.map(m => ({ value: m.uid, label: `${m.name} (${m.license})` }))
  const nameFor = (id) => models.find(m => m.uid === id)?.name || ''

  const setDeviceModel = (key, val) => setPerDevice(prev => ({ ...prev, [key]: val }))

  return (
    <SettingsCard icon={GWagenIcon} title="EV Charging Visualization" badge={{ label: gt('common.optional', 'Optional') }}
      desc={<>Pick which 3D car model shows on the Energy tab while charging — embedded live from Sketchfab (needs internet on the viewing device). With more than one EV charger registered, each gets its own model (up to 10); anything left on "Use default" follows the one below.</>}>
      <Field label="Default car model" type="select" value={modelId} onChange={setModelId}
        options={[DEFAULT_EV_MODEL_OPTION, ...carOptions]}/>

      {chargers.length > 1 && chargers.slice(0, 10).map(c => (
        <Field key={c.key} label={c.label} type="select" value={perDevice[c.key] || ''}
          onChange={v => setDeviceModel(c.key, v)} options={[USE_DEFAULT_OPTION, ...carOptions]}/>
      ))}

      <div className="stg-actions">
        <Button variant="primary" busy={save.busy}
          onClick={() => save.save({
            default: { modelId, modelName: nameFor(modelId) },
            devices: Object.fromEntries(
              Object.entries(perDevice).filter(([, id]) => id).map(([key, id]) => [key, { modelId: id, modelName: nameFor(id) }])
            ),
          }).then(reload)}>
          {gt('common.save', 'Save')}
        </Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}
