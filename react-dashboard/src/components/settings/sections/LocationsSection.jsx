import { useEffect, useState } from 'react'
import { SettingsCard, Field, Toggle, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { gt, tr } from '../../../i18n'

// Settings → Managed Instances: other LSH instances managed from this site through their
// REST API. Server: src/locations.js, src/routes/locations.js.

const api = (url, opts = {}) => fetch(url, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...opts })
  .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok || j.success === false) throw new Error(j.error || `HTTP ${r.status}`); return j })

const ago = (s) => (s == null ? '' : s < 3600 ? `${Math.round(s / 60)} min` : s < 172800 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} d`)

export default function LocationsSection() {
  const [isAdmin, setAdmin] = useState(false)
  const [site, setSite] = useState('')
  const [list, setList] = useState(null)
  const [open, setOpen] = useState(null)
  const siteSave = useSettingsSave('/api/locations/site')

  const load = () => api('/api/locations/overview').then((j) => setList(j.data || [])).catch(() => setList([]))
  useEffect(() => {
    api('/api/locations/site').then((j) => setSite(j.data?.name || '')).catch(() => {})
    api('/api/auth/me').then((j) => setAdmin(j.data?.role === 'admin')).catch(() => {})
    load()
    const t = setInterval(load, 20000)
    return () => clearInterval(t)
  }, [])

  return (
    <>
      <SettingsCard title="Managed Instances" badge={{ label: gt('common.optional', 'Optional') }}
        desc="Manage other LSH instances from this site — each through its own REST API. Pair an instance with its admin login: it then issues this site its own API token (the password isn't kept), or paste an API token made on the instance. What you may do here carries over: viewers can look, admins can also switch devices, and Open signs you in to the instance's dashboard as yourself, with the same role, without its password. An instance can manage instances of its own too.">
        <Field label="This site's name" placeholder="Casablanca" value={site} onChange={setSite}/>
        <div className="stg-actions">
          <Button variant="secondary" busy={siteSave.busy} onClick={() => siteSave.save({ name: site }).catch(() => {})}>{gt('common.save', 'Save')}</Button>
          <ResultBanner result={siteSave.result}/>
        </div>

        {list === null ? null : list.length === 0
          ? <p className="stg-hint">{tr('No managed instances yet.')}</p>
          : (
            <div className="stg-mod-list">
              {list.map((l) => (
                <LocationRow key={l.id} l={l} isAdmin={isAdmin} expanded={open === l.id} onToggle={() => setOpen(open === l.id ? null : l.id)} reload={load}/>
              ))}
            </div>
          )}
      </SettingsCard>
      {isAdmin && <AddLocation reload={load}/>}
    </>
  )
}

function LocationRow({ l, isAdmin, expanded, onToggle, reload }) {
  const s = l.summary || {}
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState(null)
  const [confirm, setConfirm] = useState(false)
  const state = { online: ['ok', tr('online')], offline: ['warn', tr('offline')], unauthorized: ['warn', tr('token rejected')], error: ['warn', tr('error')] }[s.state] || ['', '…']

  const openSite = async () => {
    setBusy('open')
    // a window opened before the await keeps the popup blocker quiet
    const w = window.open('', '_blank')
    try {
      const j = await api(`/api/locations/${l.id}/open`, { method: 'POST' })
      if (w) w.location = j.data.url; else window.location.href = j.data.url
    } catch (err) { w?.close(); setMsg({ ok: false, message: err.message }) }
    setBusy('')
  }
  const remove = async () => {
    setBusy('remove')
    try { const j = await api(`/api/locations/${l.id}?revoke=1`, { method: 'DELETE' }); setMsg({ ok: true, message: j.message }); reload() }
    catch (err) { setMsg({ ok: false, message: err.message }) }
    setBusy(''); setConfirm(false)
  }

  return (
    <div className="stg-mod-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="stg-mod-main" style={{ flex: '1 1 220px', minWidth: 0 }}>
          <div className="stg-mod-name">
            {l.name}
            <span className={`stg-mod-chip ${state[0]}`}>{state[1]}</span>
            {s.platforms?.down?.length > 0 && <span className="stg-mod-chip warn">{tr('{n} platform(s) down', { n: s.platforms.down.length })}</span>}
          </div>
          <div className="stg-hint stg-mod-meta" style={{ overflowWrap: 'anywhere' }}>
            {[l.url, s.version ? `v${s.version}` : null, s.devices != null ? tr('{n} device(s)', { n: s.devices }) : null,
              s.platforms ? tr('platforms {ok}/{total}', { ok: s.platforms.ok, total: s.platforms.total }) : null,
              s.uptime != null ? tr('up {x}', { x: ago(s.uptime) }) : null, s.ms != null && s.state === 'online' ? `${s.ms} ms` : null,
              s.state !== 'online' ? s.error : null].filter(Boolean).join(' · ')}
          </div>
          {s.platforms?.down?.length > 0 && <div className="stg-hint" style={{ overflowWrap: 'anywhere' }}>{tr('Down: {x}', { x: s.platforms.down.join(', ') })}</div>}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Button variant="secondary" busy={busy === 'open'} disabled={s.state !== 'online'} onClick={openSite}>{tr('Open')}</Button>
          <Button variant="secondary" disabled={s.state !== 'online'} onClick={onToggle}>{expanded ? tr('Hide devices') : tr('Devices')}</Button>
          {isAdmin && (confirm
            ? <Button variant="danger" busy={busy === 'remove'} onClick={remove}>{tr('Remove and revoke token')}</Button>
            : <Button variant="secondary" onClick={() => setConfirm(true)}>{tr('Remove')}</Button>)}
        </div>
      </div>
      {msg && <ResultBanner result={msg}/>}
      {expanded && <RemoteDevices id={l.id} isAdmin={isAdmin}/>}
    </div>
  )
}

// The location's devices, through the hub's proxy
function RemoteDevices({ id, isAdmin }) {
  const [devices, setDevices] = useState(null)
  const [q, setQ] = useState('')
  const [err, setErr] = useState(null)
  const load = () => api(`/api/locations/${id}/api/devices`).then((j) => setDevices(j.data || [])).catch((e) => setErr(e.message))
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [id])

  const send = async (key, sensor, value) => {
    setErr(null)
    try {
      await api(`/api/locations/${id}/api/device/${encodeURIComponent(key)}/command`, { method: 'POST', body: JSON.stringify({ sensor, value }) })
      setTimeout(load, 800)
    } catch (e) { setErr(e.message) }
  }

  if (err && !devices) return <p className="stg-hint">{err}</p>
  if (!devices) return <p className="stg-hint">{tr('Loading…')}</p>
  const needle = q.trim().toLowerCase()
  const shown = devices.filter((d) => !needle || `${d.label} ${d.key} ${d.room || ''}`.toLowerCase().includes(needle)).slice(0, 60)
  return (
    <div style={{ marginTop: 10 }}>
      <Field placeholder={tr('Search devices')} value={q} onChange={setQ}/>
      {err && <ResultBanner result={{ ok: false, message: err }}/>}
      <div className="stg-mod-list">
        {shown.map((d) => {
          const r = d.readings || {}
          const sw = Object.values(r).find((x) => x.controllable && x.type === 'toggle' && !x.hidden)
          const values = Object.values(r).filter((x) => !x.hidden && x !== sw && x.value != null && typeof x.value !== 'object').slice(0, 3)
          return (
            <div key={d.key} className="stg-mod-row">
              <div className="stg-mod-main" style={{ minWidth: 0 }}>
                <div className="stg-mod-name">{d.label}</div>
                <div className="stg-hint stg-mod-meta" style={{ overflowWrap: 'anywhere' }}>
                  {[d.room, ...values.map((x) => `${x.name || x.label || x.path}: ${typeof x.value === 'number' ? +x.value.toFixed(2) : x.value}${x.unit ? ` ${x.unit}` : ''}`)].filter(Boolean).join(' · ') || d.key}
                </div>
              </div>
              {sw && (isAdmin
                ? <Toggle label="" checked={!!sw.value} onChange={(v) => send(d.key, sw.path, v ? 1 : 0)}/>
                : <span className={`stg-mod-chip ${sw.value ? 'ok' : ''}`}>{sw.value ? tr('on') : tr('off')}</span>)}
            </div>
          )
        })}
      </div>
      {devices.length > shown.length && <p className="stg-hint">{tr('{n} more — narrow the search', { n: devices.length - shown.length })}</p>}
    </div>
  )
}

function AddLocation({ reload }) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [mode, setMode] = useState('login')
  const [username, setUser] = useState('')
  const [password, setPass] = useState('')
  const [token, setToken] = useState('')
  const [insecure, setInsecure] = useState(false)
  const add = useSettingsSave('/api/locations')
  const submit = () => add.save(mode === 'login' ? { name, url, insecure, username, password } : { name, url, insecure, token })
    .then(() => { setPass(''); setToken(''); setName(''); setUrl(''); reload() }).catch(() => {})
  return (
    <SettingsCard title="Add an instance">
      <Field label="Name" placeholder="Wrocław" value={name} onChange={setName}/>
      <Field label="Address" placeholder="https://qlsh21.example.ts.net or http://192.168.1.49:3000" value={url} onChange={setUrl}/>
      <Field label="Connect with" type="select" value={mode} onChange={setMode} options={[
        { value: 'login', label: 'Admin login — the instance issues this site a token' },
        { value: 'token', label: 'API token from the instance' },
      ]}/>
      {mode === 'login' ? <>
        <Field label="User name" value={username} onChange={setUser} autoComplete="off"/>
        <Field label="Password" type="password" value={password} onChange={setPass} autoComplete="new-password"/>
        <p className="stg-hint">{tr('Used once to create the token, never stored.')}</p>
      </> : <Field label="API token" type="password" value={token} onChange={setToken} autoComplete="off"/>}
      <Toggle label="Accept a self-signed certificate" checked={insecure} onChange={setInsecure}/>
      <div className="stg-actions">
        <Button variant="primary" busy={add.busy} onClick={submit}>{tr('Add instance')}</Button>
        <ResultBanner result={add.result}/>
      </div>
    </SettingsCard>
  )
}
