import { useState } from 'react'
import { SettingsCard, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { AirCondIcon, PoolIcon, SunIcon, ThermostatIcon, WindIcon } from '../../Icons'
import { gt } from '../../../i18n'

const THERMOMIX_COUNTRIES = [
  ['pl', 'Poland (cookidoo.pl)'], ['de', 'Germany (cookidoo.de)'], ['at', 'Austria (cookidoo.at)'],
  ['ch', 'Switzerland (cookidoo.ch)'], ['gb', 'United Kingdom (cookidoo.co.uk)'], ['fr', 'France (cookidoo.fr)'],
  ['it', 'Italy (cookidoo.it)'], ['es', 'Spain (cookidoo.es)'], ['pt', 'Portugal (cookidoo.pt)'],
  ['nl', 'Netherlands (cookidoo.nl)'], ['us', 'USA (cookidoo.com)'], ['au', 'Australia (cookidoo.com.au)'],
]

export default function ClimateSection({ config, reload }) {
  return (
    <>
      <AuxAirCard auxair={config.auxair} reload={reload}/>
      <BayrolCard bayrol={config.bayrol} reload={reload}/>
      <OpenWeatherCard openweather={config.openweather} reload={reload}/>
      <AirlyCard airly={config.airly} reload={reload}/>
      <ViCareCard vicare={config.vicare} reload={reload}/>
      <ThermomixCard thermomix={config.thermomix} reload={reload}/>
    </>
  )
}

function AuxAirCard({ auxair, reload }) {
  const [region, setRegion] = useState(auxair?.region || 'eu')
  const [email, setEmail] = useState(auxair?.email || '')
  const [password, setPassword] = useState(auxair?.password || '')
  const [pollInterval, setPollInterval] = useState(auxair?.pollInterval ?? 30)
  const save = useSettingsSave('/api/settings/auxair')

  return (
    <SettingsCard icon={AirCondIcon} title="AuxAir / AC Freedom" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Controls AUX air conditioners via the AC Freedom cloud API. Supports on/off, temperature, mode, and fan speed.">
      <Field label="Region" type="select" value={region} onChange={setRegion}
        options={[{ value: 'eu', label: 'Europe (EU)' }, { value: 'usa', label: 'USA' }, { value: 'cn', label: 'China (CN)' }, { value: 'rus', label: 'Russia (RUS)' }]}/>
      <Field label="AC Freedom Account Email" type="email" value={email} onChange={setEmail}/>
      <Field label="Password" type="password" value={password} onChange={setPassword}/>
      <Field label="Poll Interval" hint="(seconds, min 10)" type="number" value={pollInterval} onChange={setPollInterval}/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} onClick={() => save.save({ region, email, password, pollInterval: Number(pollInterval) }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}

function BayrolCard({ bayrol, reload }) {
  const [poolName, setPoolName] = useState(bayrol?.poolName || '')
  const [username, setUsername] = useState(bayrol?.username || '')
  const [password, setPassword] = useState(bayrol?.password || '')
  const [pollInterval, setPollInterval] = useState(bayrol?.pollInterval ?? 60)
  const test = useSettingsSave('/api/settings/test-bayrol')
  const save = useSettingsSave('/api/settings/bayrol')

  return (
    <SettingsCard icon={PoolIcon} title="Bayrol Pool Manager Connect" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Connects to the Bayrol Pool Access cloud to read pH, ORP (redox), temperature, and free chlorine.">
      <Field label="Pool Name" value={poolName} onChange={setPoolName} placeholder="My Pool"/>
      <Field label="Bayrol Pool Access Email" type="email" value={username} onChange={setUsername}/>
      <Field label="Password" type="password" value={password} onChange={setPassword}/>
      <Field label="Poll Interval" hint="(seconds, min 30)" type="number" value={pollInterval} onChange={setPollInterval}/>
      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy} onClick={() => test.save({ username, password })}>{gt('common.test', 'Test Connection')}</Button>
        <Button variant="primary" busy={save.busy} onClick={() => save.save({ poolName, username, password, pollInterval: Number(pollInterval) }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={test.result || save.result}/>
      </div>
    </SettingsCard>
  )
}

function OpenWeatherCard({ openweather, reload }) {
  const [apiKey, setApiKey] = useState(openweather?.apiKey || '')
  const [lat, setLat] = useState(openweather?.lat ?? '')
  const [lon, setLon] = useState(openweather?.lon ?? '')
  const [name, setName] = useState(openweather?.name || '')
  const [units, setUnits] = useState(openweather?.units || 'metric')
  const [pollInterval, setPollInterval] = useState(openweather?.pollInterval ?? 600)
  const test = useSettingsSave('/api/settings/test-openweather')
  const save = useSettingsSave('/api/settings/openweather')
  const payload = () => ({ apiKey, lat, lon, name, units, pollInterval: Number(pollInterval) })

  return (
    <SettingsCard icon={SunIcon} title="OpenWeatherMap" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Current weather + a 5-day forecast for one location.">
      <Field label="API Key" type="password" value={apiKey} onChange={setApiKey}/>
      <Field label="Latitude" hint="(required)" value={lat} onChange={setLat} placeholder="e.g. 52.2297"/>
      <Field label="Longitude" hint="(required)" value={lon} onChange={setLon} placeholder="e.g. 21.0122"/>
      <Field label="Display Name" hint="(optional)" value={name} onChange={setName} placeholder="Home"/>
      <Field label="Units" type="select" value={units} onChange={setUnits}
        options={[{ value: 'metric', label: 'Metric (°C, m/s)' }, { value: 'imperial', label: 'Imperial (°F, mph)' }]}/>
      <Field label="Poll Interval" hint="(seconds, minimum 60)" type="number" value={pollInterval} onChange={setPollInterval}/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} onClick={() => save.save(payload()).then(reload)}>{gt('common.save', 'Save')}</Button>
        <Button variant="secondary" busy={test.busy} onClick={() => test.save(payload())}>Test connection</Button>
        <ResultBanner result={save.result || test.result}/>
      </div>
    </SettingsCard>
  )
}

function AirlyCard({ airly, reload }) {
  const [apiKey, setApiKey] = useState(airly?.apiKey || '')
  const [lat, setLat] = useState(airly?.lat ?? '')
  const [lon, setLon] = useState(airly?.lon ?? '')
  const [name, setName] = useState(airly?.name || '')
  const [pollInterval, setPollInterval] = useState(airly?.pollInterval ?? 900)
  const test = useSettingsSave('/api/settings/test-airly')
  const save = useSettingsSave('/api/settings/airly')
  const payload = () => ({ apiKey, lat, lon, name, pollInterval: Number(pollInterval) })

  return (
    <SettingsCard icon={WindIcon} title="Airly" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Air quality (CAQI index, PM1/PM2.5/PM10, NO₂/O₃/SO₂/CO) plus temperature, humidity and pressure for one location.">
      <Field label="API Key" type="password" value={apiKey} onChange={setApiKey}/>
      <Field label="Latitude" hint="(required)" value={lat} onChange={setLat} placeholder="e.g. 52.2297"/>
      <Field label="Longitude" hint="(required)" value={lon} onChange={setLon} placeholder="e.g. 21.0122"/>
      <Field label="Display Name" hint="(optional)" value={name} onChange={setName} placeholder="Air Quality"/>
      <Field label="Poll Interval" hint="(seconds, minimum 300)" type="number" value={pollInterval} onChange={setPollInterval}/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} onClick={() => save.save(payload()).then(reload)}>{gt('common.save', 'Save')}</Button>
        <Button variant="secondary" busy={test.busy} onClick={() => test.save(payload())}>Test connection</Button>
        <ResultBanner result={save.result || test.result}/>
      </div>
    </SettingsCard>
  )
}

function ViCareCard({ vicare, reload }) {
  const [user, setUser] = useState(vicare?.user || '')
  const [password, setPassword] = useState(vicare?.password || '')
  const [clientId, setClientId] = useState(vicare?.clientId || '')
  const [redirectUri, setRedirectUri] = useState(vicare?.redirectUri || 'http://localhost:4200/')
  const [pollInterval, setPollInterval] = useState(vicare?.pollInterval ?? 120)
  const save = useSettingsSave('/api/settings/vicare')

  return (
    <SettingsCard icon={ThermostatIcon} title="Viessmann ViCare" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Viessmann heating (boilers / heat pumps) via the Viessmann IoT cloud.">
      <Field label="ViCare Account Email" type="email" value={user} onChange={setUser}/>
      <Field label="ViCare Account Password" type="password" value={password} onChange={setPassword}/>
      <Field label="API Client ID" value={clientId} onChange={setClientId}/>
      <Field label="Redirect URI" hint="(must match the API client)" value={redirectUri} onChange={setRedirectUri}/>
      <Field label="Poll interval" hint="(seconds, min 60 — API is rate-limited)" type="number" value={pollInterval} onChange={setPollInterval}/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy}
          onClick={() => save.save({ user, password, clientId, redirectUri, pollInterval: Number(pollInterval) }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}

function ThermomixCard({ thermomix, reload }) {
  const [email, setEmail] = useState(thermomix?.email || '')
  const [password, setPassword] = useState(thermomix?.password || '')
  const [country, setCountry] = useState(thermomix?.country || 'pl')
  const [pollSeconds, setPollSeconds] = useState(thermomix?.pollSeconds ?? 300)
  const save = useSettingsSave('/api/settings/thermomix')

  return (
    <SettingsCard title="Thermomix (Cookidoo)" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Vorwerk Thermomix (TM6 / TM7) via your Cookidoo account — shopping-list size, this week's meal plan and the next planned recipe.">
      <Field label="Cookidoo Account Email" type="email" value={email} onChange={setEmail}/>
      <Field label="Cookidoo Account Password" type="password" value={password} onChange={setPassword}/>
      <Field label="Country" type="select" value={country} onChange={setCountry}
        options={THERMOMIX_COUNTRIES.map(([v, l]) => ({ value: v, label: l }))}/>
      <Field label="Poll interval" hint="(seconds, min 60)" type="number" value={pollSeconds} onChange={setPollSeconds}/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} onClick={() => save.save({ email, password, country, pollSeconds: Number(pollSeconds) }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}
