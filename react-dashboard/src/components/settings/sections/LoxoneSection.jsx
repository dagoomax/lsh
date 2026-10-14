import { useEffect, useState } from 'react'
import { SettingsCard, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { LoxoneIcon } from '../../Icons'
import { gt, tr } from '../../../i18n'

export default function LoxoneSection({ config, reload }) {
  return (
    <>
      <MiniserverCard loxone={config.loxone} reload={reload}/>
      <OutboundPushCard loxoneOut={config.loxoneOut} reload={reload}/>
      <WeatherEmulatorCard loxoneWeather={config.loxoneWeather} reload={reload}/>
    </>
  )
}

function MiniserverCard({ loxone, reload }) {
  const [host, setHost] = useState(loxone?.host || '')
  const [port, setPort] = useState(loxone?.port || 80)
  const [username, setUsername] = useState(loxone?.username || 'admin')
  const [password, setPassword] = useState(loxone?.password || '')
  const test = useSettingsSave('/api/settings/test-loxone')
  const save = useSettingsSave('/api/settings/loxone')
  const payload = () => ({ host, port: Number(port), username, password })

  return (
    <SettingsCard icon={LoxoneIcon} title={gt('s.loxone_title', 'Loxone Miniserver')} badge={{ label: gt('common.optional', 'Optional') }}
      desc={gt('sdesc.d14', 'Connects to a Loxone Miniserver via WebSocket. All rooms, switches, dimmers, blinds, thermostats, and sensors are auto-discovered.')}>
      <Field label={gt('s.loxone_host', 'Miniserver Host / IP')} value={host} onChange={setHost} placeholder="192.168.1.100"/>
      <Field label={gt('s.loxone_port', 'Port')} hint="(default 80)" type="number" value={port} onChange={setPort}/>
      <Field label={gt('s.loxone_user', 'Username')} value={username} onChange={setUsername} placeholder="admin"/>
      <Field label={gt('s.loxone_pass', 'Password')} type="password" value={password} onChange={setPassword}/>
      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy} onClick={() => test.save(payload())}>{gt('common.test', 'Test Connection')}</Button>
        <Button variant="primary" busy={save.busy} onClick={() => save.save(payload()).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={test.result || save.result}/>
      </div>
    </SettingsCard>
  )
}

function OutboundPushCard({ loxoneOut, reload }) {
  const [host, setHost] = useState(loxoneOut?.host || '')
  const [port, setPort] = useState(loxoneOut?.port || 80)
  const [username, setUsername] = useState(loxoneOut?.username || 'admin')
  const [password, setPassword] = useState(loxoneOut?.password || '')
  const [mappingsText, setMappingsText] = useState(
    (loxoneOut?.mappings || []).map(m => `${m.storeKey} = ${m.virtualInput}`).join('\n'))
  const save = useSettingsSave('/api/settings/loxone-out')

  const parseMappings = () => mappingsText.split('\n').map(l => l.trim()).filter(Boolean)
    .map(l => { const [k, v] = l.split('=').map(s => s.trim()); return k && v ? { storeKey: k, virtualInput: v } : null })
    .filter(Boolean)

  return (
    <SettingsCard icon={LoxoneIcon} title="Loxone Outbound Push" badge={{ label: gt('common.optional', 'Optional') }}
      desc={<>{tr('Pushes sensor values from LSH to Loxone Virtual Inputs in real time. One mapping per line:')}{' '}<code>storeKey = VirtualInputName</code>.</>}>
      <Field label="Miniserver Host / IP" value={host} onChange={setHost} placeholder="192.168.1.100"/>
      <Field label="Port" hint="(default 80)" type="number" value={port} onChange={setPort}/>
      <Field label="Username" value={username} onChange={setUsername}/>
      <Field label="Password" type="password" value={password} onChange={setPassword}/>
      <Field label="Mappings" hint="(storeKey = VirtualInputName, one per line)" type="textarea" value={mappingsText} onChange={setMappingsText}
        placeholder={'bayrol/19048/ph = PoolPH\nbayrol/19048/orp = PoolORP'}/>
      <MediaTexts mappingsText={mappingsText} setMappingsText={setMappingsText} />
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy}
          onClick={() => save.save({ host, port: Number(port), username, password, mappings: parseMappings() }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}

function WeatherEmulatorCard({ loxoneWeather, reload }) {
  const [port, setPort] = useState(loxoneWeather?.port || 6066)
  const [lat, setLat] = useState(loxoneWeather?.lat ?? 50.2649)
  const [lon, setLon] = useState(loxoneWeather?.lon ?? 19.0238)
  const [asl, setAsl] = useState(loxoneWeather?.asl ?? 266)
  const [name, setName] = useState(loxoneWeather?.name || '')
  const [country, setCountry] = useState(loxoneWeather?.country || '')
  const [timezone, setTimezone] = useState(loxoneWeather?.timezone || '')
  const [pictoMode, setPictoMode] = useState(loxoneWeather?.pictoMode || 'meteoblue')
  const test = useSettingsSave('/api/settings/test-loxone-weather')
  const save = useSettingsSave('/api/settings/loxone-weather')
  const payload = () => ({ port: Number(port), lat: Number(lat), lon: Number(lon), asl: Number(asl), name, country, timezone, pictoMode })

  return (
    <SettingsCard icon={LoxoneIcon} title="Loxone Weather Emulator" badge={{ label: gt('common.optional', 'Optional') }}
      desc={<>{tr("Stands in for Loxone's cloud weather service using Open-Meteo. Point")}{' '}<code>weather.loxone.com</code>{' '}{tr('at this host via DNS override — the Miniserver will fetch its hourly forecast from here on port')}{' '}{port || 6066}{' '}{tr('instead. Not yet verified against a real Miniserver.')}</>}>
      <Field label="Listen Port" hint="(default 6066)" type="number" value={port} onChange={setPort}/>
      <Field label="Latitude" type="number" value={lat} onChange={setLat}/>
      <Field label="Longitude" type="number" value={lon} onChange={setLon}/>
      <Field label="Altitude" hint="(meters above sea level)" type="number" value={asl} onChange={setAsl}/>
      <Field label="Station Name" value={name} onChange={setName} placeholder="Katowice"/>
      <Field label="Country Code" value={country} onChange={setCountry} placeholder="PL"/>
      <Field label="Timezone" value={timezone} onChange={setTimezone} placeholder="Europe/Warsaw"/>
      <Field label="Weather pictures" hint="(what the Loxone app animates from)" type="select" value={pictoMode} onChange={setPictoMode}
        options={[{ value: 'meteoblue', label: 'meteoblue codes, like Loxone’s weather service (recommended)' }, { value: 'loxone', label: 'Miniserver weather types (older emulator behaviour)' }]}/>
      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy} onClick={() => test.save(payload())}>{gt('common.test', 'Test Connection')}</Button>
        <Button variant="primary" busy={save.busy} onClick={() => save.save(payload()).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={test.result || save.result}/>
      </div>
    </SettingsCard>
  )
}

// The media player's "now playing" text (and station numbers) → Loxone: ready-made
// mappings to add, the Virtual (Text) Inputs to create, and a test push for each
function MediaTexts({ mappingsText, setMappingsText }) {
  const [list, setList] = useState(null)
  const [images, setImages] = useState([])
  const [pick, setPick] = useState({})
  const [test, setTest] = useState({})
  useEffect(() => {
    fetch('/api/settings/loxone-out/suggestions', { credentials: 'include' }).then(r => r.json())
      .then(j => { setList(j.success ? j.data : []); setImages(j.images || []) }).catch(() => setList([]))
  }, [])
  if (!list?.length) return null
  const mapped = new Set(mappingsText.split('\n').map(l => l.split('=')[0].trim()).filter(Boolean))
  const fresh = list.filter(x => !mapped.has(x.storeKey))
  const chosen = (x) => pick[x.storeKey] ?? x.kind === 'text'
  const add = () => {
    const lines = fresh.filter(chosen).map(x => `${x.storeKey} = ${x.virtualInput}`)
    if (lines.length) setMappingsText([mappingsText.trim(), ...lines].filter(Boolean).join('\n'))
  }
  const send = async (x) => {
    setTest(t => ({ ...t, [x.virtualInput]: { busy: true } }))
    const j = await fetch('/api/settings/loxone-out/test', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ virtualInput: x.virtualInput }) }).then(r => r.json()).catch(e => ({ error: e.message }))
    setTest(t => ({ ...t, [x.virtualInput]: { ok: !!j.success, message: j.success ? j.message : j.error } }))
  }
  return (
    <div className="stg-field">
      <label>{tr('Media player → Loxone')}</label>
      <p className="stg-hint" style={{ margin: '0 0 8px' }}>{tr('In Loxone Config create a Virtual Text Input (text) or a Virtual Input (number) for each line, named exactly as shown, then add the lines here and save. Loxone then shows what plays on each speaker and on Spotify, updated as it changes.')}</p>
      <div className="lox-media">
        {list.map(x => {
          const done = mapped.has(x.storeKey), t = test[x.virtualInput]
          return (
            <div key={x.storeKey} className={`lox-media-row${done ? ' done' : ''}`}>
              {done ? <span className="lox-media-ok" title={tr('Mapped')}>✓</span>
                : <input type="checkbox" className="stg-checkbox" checked={chosen(x)} onChange={e => setPick(p => ({ ...p, [x.storeKey]: e.target.checked }))} aria-label={x.virtualInput} />}
              <div className="lox-media-main">
                <b>{x.virtualInput}</b> <span className={`lox-media-kind ${x.kind}`}>{x.kind === 'text' ? tr('Virtual Text Input') : tr('Virtual Input')}</span>
                <small><code>{x.storeKey}</code> — {x.what}</small>
                {t?.message && <small style={{ color: t.ok ? 'var(--green)' : 'var(--red)' }}>{t.ok ? '✓ ' : '✗ '}{t.message}</small>}
              </div>
              <button type="button" className="lox-media-btn" onClick={() => navigator.clipboard?.writeText(x.virtualInput)} title={tr('Copy')}>⧉</button>
              {done && <button type="button" className="lox-media-btn" disabled={t?.busy} onClick={() => send(x)}>{tr('Send test')}</button>}
            </div>
          )
        })}
      </div>
      {fresh.length > 0 && <div className="stg-actions"><Button onClick={add}>{tr('+ Add the ticked lines')}</Button></div>}
      {images.length > 0 && (
        <>
          <label style={{ marginTop: 12 }}>{tr('Cover and station logo')}</label>
          <p className="stg-hint" style={{ margin: '0 0 8px' }}>{tr('Pictures can’t be pushed into a Virtual Input — Loxone fetches them. Put one of these addresses as the image URL of an Intercom (custom) / Camera block, or in a Webpage block: it always shows the current album cover or station logo as a square JPEG. Replace the token placeholder with an API token.')}</p>
          <div className="lox-media">
            {images.map(x => {
              const u = `http://${window.location.host}${x.path}?token=<API token>`
              return (
                <div key={x.path} className="lox-media-row">
                  <img src={x.path} alt="" width="40" height="40" style={{ borderRadius: 6, flex: 'none' }} />
                  <div className="lox-media-main"><b>{x.label}</b><small><code>{u}</code></small></div>
                  <button type="button" className="lox-media-btn" onClick={() => navigator.clipboard?.writeText(u)} title={tr('Copy')}>⧉</button>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
