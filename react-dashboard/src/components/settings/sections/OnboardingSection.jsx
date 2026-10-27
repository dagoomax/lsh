import { useEffect, useRef, useState } from 'react'
import { SettingsCard, ListEditor, Field, Toggle, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { gt, tr } from '../../../i18n'

// Settings → Onboarding: the welcome guide on the dashboard (home card +
// Guide view) — city, the host's words, the home's location, own tips, and
// new city guides written by LSH's Claude. Server: src/routes/guide.js,
// src/guide-generator.js, src/city-guides/*.js.

const EXTRA_FIELDS = [
  { key: 'name', label: 'Name', placeholder: 'Café Kattowitz' },
  { key: 'category', label: 'Category', type: 'select', default: 'restaurant', options: [
    { value: 'restaurant', label: 'Restaurant' }, { value: 'place', label: 'Place to visit' }, { value: 'activity', label: 'Thing to do' }, { value: 'shop', label: 'Shop' }, { value: 'transport', label: 'Getting around' },
  ] },
  { key: 'note', label: 'Note', placeholder: 'Our favourite breakfast, 5 minutes away' },
  { key: 'address', label: 'Address', placeholder: 'ul. Mariacka 1' },
  { key: 'lat', label: 'Latitude', placeholder: '50.2575' },
  { key: 'lon', label: 'Longitude', placeholder: '19.0271' },
  { key: 'url', label: 'Link', placeholder: 'https://…' },
]

const api = (url, opts = {}) => fetch(url, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...opts })
  .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok || j.success === false) throw new Error(j.error || `HTTP ${r.status}`); return j })

export default function OnboardingSection({ config, reload }) {
  const o = config.onboarding || {}
  const [enabled, setEnabled] = useState(!!o.enabled)
  const [city, setCity] = useState(o.city || 'katowice')
  const [welcome, setWelcome] = useState(o.welcome || '')
  const [lat, setLat] = useState(o.lat ?? '')
  const [lon, setLon] = useState(o.lon ?? '')
  const [sections, setSections] = useState({ transport: true, restaurants: true, places: true, activities: true, shopping: true, ...(o.sections || {}) })
  const [extras, setExtras] = useState(o.extras || [])
  const [mapsKey, setMapsKey] = useState(o.mapsKey || '')
  const [cities, setCities] = useState([])
  const save = useSettingsSave('/api/settings/onboarding')

  const loadCities = () => api('/api/guide/cities').then((j) => setCities(j.data || [])).catch(() => {})
  useEffect(() => { loadCities() }, [])

  const weather = config.openweather?.lat != null ? `${config.openweather.lat.toFixed?.(4) ?? config.openweather.lat}, ${config.openweather.lon.toFixed?.(4) ?? config.openweather.lon}` : null
  const doSave = () => save.save({ enabled, city, welcome, lat, lon, sections, extras, mapsKey }).then(() => reload?.()).catch(() => {})
  const cityLabel = (c) => c.generated ? tr('{name} — written by Claude, {date}', { name: c.name, date: new Date(c.generated.at).toLocaleDateString() }) : tr('{name} — checked guide', { name: c.name })

  return (
    <>
      <SettingsCard title="Onboarding" badge={{ label: gt('common.optional', 'Optional') }}
        desc="A welcome guide on the dashboard for guests and new residents: a card on the home view and a Guide view in the menu, with getting around, restaurants, places to visit, things to do and shopping, nearest first, each with a route link. Katowice has a checked guide; Claude can write one for any other city.">
        <Toggle label="Show the guide on the dashboard" checked={enabled} onChange={setEnabled}/>
        <Field label="City" type="select" value={city} onChange={setCity}
          options={cities.length ? cities.map((c) => ({ value: c.id, label: cityLabel(c), raw: true })) : [{ value: 'katowice', label: 'Katowice', raw: true }]}/>
        <Field label="Welcome message" hint="(optional — replaces the city's)" type="textarea" value={welcome} onChange={setWelcome}
          placeholder="Hi! The door code is on your booking. Trams stop 3 minutes away…"/>
        <div className="stg-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          <Field label="Home latitude" placeholder={config.openweather?.lat != null ? String(config.openweather.lat) : '50.2597'} value={lat} onChange={setLat}/>
          <Field label="Home longitude" placeholder={config.openweather?.lon != null ? String(config.openweather.lon) : '19.0217'} value={lon} onChange={setLon}/>
        </div>
        <p className="stg-hint">{weather ? tr('Empty: distances are measured from the weather location ({x}).', { x: weather }) : tr('Set the home’s location to sort places by distance.')}</p>
        <Field label="Google Maps Embed API key" hint="(optional)" value={mapsKey} onChange={setMapsKey} placeholder="AIza…"/>
        <p className="stg-hint">{tr('The guide shows a Google map with your trip without a key. With a Maps Embed API key (free, Google Cloud Console — restrict it to this site’s address) the map and routes use Google’s official embed.')}</p>
        <h4 className="stg-subheading">{tr('Sections')}</h4>
        <Toggle label="Getting around" checked={sections.transport} onChange={(v) => setSections({ ...sections, transport: v })}/>
        <Toggle label="Restaurants" checked={sections.restaurants} onChange={(v) => setSections({ ...sections, restaurants: v })}/>
        <Toggle label="Places to visit" checked={sections.places} onChange={(v) => setSections({ ...sections, places: v })}/>
        <Toggle label="Things to do" checked={sections.activities} onChange={(v) => setSections({ ...sections, activities: v })}/>
        <Toggle label="Shopping" checked={sections.shopping} onChange={(v) => setSections({ ...sections, shopping: v })}/>
        <h4 className="stg-subheading">{tr('Your own tips')}</h4>
        <p className="stg-hint">{tr('Shown first, marked as your pick. With latitude and longitude they get a distance and a route link.')}</p>
        <ListEditor rows={extras} onChange={setExtras} fields={EXTRA_FIELDS} addLabel="Add a tip"/>
        <div className="stg-actions">
          <Button variant="secondary" href="/react/?cat=Guide">{tr('Open the guide')}</Button>
          <Button variant="primary" busy={save.busy} onClick={doSave}>{gt('common.save', 'Save')}</Button>
          <ResultBanner result={save.result}/>
        </div>
      </SettingsCard>
      <GenerateCard cities={cities} onDone={(id) => { loadCities(); setCity(id) }} current={o.city}/>
    </>
  )
}

function GenerateCard({ cities, onDone, current }) {
  const [name, setName] = useState('')
  const [job, setJob] = useState(null)
  const [msg, setMsg] = useState(null)
  const timer = useRef(null)
  useEffect(() => () => clearInterval(timer.current), [])

  const start = async () => {
    setMsg(null)
    try {
      const j = await api('/api/guide/generate', { method: 'POST', body: JSON.stringify({ city: name }) })
      setJob({ state: 'running', searches: 0, seconds: 0, city: name })
      clearInterval(timer.current)
      timer.current = setInterval(async () => {
        try {
          const s = (await api(`/api/guide/generate/${j.data.job}`)).data
          setJob(s)
          if (s.state !== 'running') {
            clearInterval(timer.current)
            if (s.state === 'done') {
              setMsg({ ok: true, message: tr('Guide for {city} ready: {p} places, {r} restaurants, {t} transport tips. Choose it above and save.', { city: s.city, p: s.counts.places, r: s.counts.restaurants, t: s.counts.transport }) })
              onDone(s.guideId)
            } else setMsg({ ok: false, message: s.error })
          }
        } catch (err) { clearInterval(timer.current); setMsg({ ok: false, message: err.message }) }
      }, 2500)
    } catch (err) { setMsg({ ok: false, message: err.message }) }
  }
  const remove = async (id) => {
    try { await api(`/api/guide/cities/${id}`, { method: 'DELETE' }); onDone(current || 'katowice') }
    catch (err) { setMsg({ ok: false, message: err.message }) }
  }
  const running = job?.state === 'running'
  const generated = cities.filter((c) => c.generated)
  return (
    <SettingsCard title="Generate a guide with Claude"
      desc="LSH's Claude (the API key from Settings → Claude Code) looks up the city on the web and writes a guide in Polish and English: public transport and tickets, the airport and station, restaurants and sights with their locations and source links. It takes a minute or two and uses your Anthropic account. Read it before guests do: opening hours and prices change.">
      <Field label="City" placeholder="Kraków" value={name} onChange={setName} disabled={running}/>
      <div className="stg-actions">
        <Button variant="primary" busy={running} disabled={!name.trim() || running} onClick={start}>{tr('Generate')}</Button>
        {running && <span className="stg-hint">{tr('Researching {city}… {n} web searches, {s} s', { city: job.city, n: job.searches || 0, s: job.seconds || 0 })}</span>}
        <ResultBanner result={msg}/>
      </div>
      {generated.length > 0 && <>
        <h4 className="stg-subheading">{tr('Guides written by Claude')}</h4>
        <div className="stg-mod-list">
          {generated.map((c) => (
            <div key={c.id} className="stg-mod-row">
              <div className="stg-mod-main">
                <div className="stg-mod-name">{c.name}{c.id === current && <span className="stg-mod-chip ok">{tr('in use')}</span>}</div>
                <div className="stg-hint stg-mod-meta">{tr('{date} · {n} web searches', { date: new Date(c.generated.at).toLocaleString(), n: c.generated.searches })}</div>
              </div>
              {c.id !== current && <Button variant="secondary" onClick={() => remove(c.id)}>{tr('Delete')}</Button>}
            </div>
          ))}
        </div>
      </>}
    </SettingsCard>
  )
}
