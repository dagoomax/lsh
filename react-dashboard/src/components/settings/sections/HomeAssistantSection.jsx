import { useEffect, useMemo, useState } from 'react'
import { SettingsCard, Field, Toggle, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { HomeIcon } from '../../Icons'
import { gt } from '../../../i18n'

const api = (url, method = 'GET', body) => fetch(url, {
  method, credentials: 'include',
  ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
}).then((r) => r.json())

const chip = (on) => ({
  padding: '3px 10px', borderRadius: 999, border: '1px solid var(--border)', cursor: 'pointer', fontSize: 12,
  background: on ? 'var(--green)' : 'transparent', color: on ? '#fff' : 'inherit', borderColor: on ? 'var(--green)' : 'var(--border)', fontWeight: on ? 600 : 400,
})

// Home Assistant both ways: HA entities → LSH devices (WebSocket API) and LSH
// devices → HA entities (MQTT Discovery). Server: src/homeassistant-client.js.
export default function HomeAssistantSection({ reload }) {
  const [s, setS] = useState(null)
  const [status, setStatus] = useState(null)
  const [entities, setEntities] = useState([])
  const [plan, setPlan] = useState([])
  const [filter, setFilter] = useState('')
  const [msg, setMsg] = useState(null)
  const save = useSettingsSave('/api/settings/homeassistant')
  const set = (part, k) => (v) => setS((p) => (part ? { ...p, [part]: { ...p[part], [k]: v } } : { ...p, [k]: v }))
  const toggleIn = (part, k, v) => setS((p) => {
    const cur = p[part][k] || []
    return { ...p, [part]: { ...p[part], [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] } }
  })

  const loadSettings = () => api('/api/settings/homeassistant').then((j) => j.success && setS(j.data)).catch(() => {})
  const loadLists = () => {
    api('/api/homeassistant/entities').then((j) => j.success && setEntities(j.data)).catch(() => {})
    api('/api/homeassistant/export-plan').then((j) => j.success && setPlan(j.data)).catch(() => {})
  }
  useEffect(() => { loadSettings(); loadLists() }, [])
  useEffect(() => {
    const load = () => api('/api/homeassistant/status').then((j) => setStatus(j.data)).catch(() => {})
    load()
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [])

  const domains = s?.import.domains?.length ? s.import.domains : s?.defaultDomains || []
  const shown = useMemo(() => entities
    .filter((e) => domains.includes(e.domain))
    .filter((e) => !filter || `${e.entity_id} ${e.name}`.toLowerCase().includes(filter.toLowerCase())), [entities, domains, filter])

  if (!s) return <SettingsCard icon={HomeIcon} title="Home Assistant"><p className="stg-hint">Loading…</p></SettingsCard>

  const picked = s.import.entities || []
  const imp = status?.import, exp = status?.export
  const unpublish = async () => {
    const j = await api('/api/homeassistant/unpublish', 'POST', {})
    setMsg({ ok: j.success, message: j.success ? `Removed ${j.data.removed} LSH entities from Home Assistant` : j.error })
  }

  return (
    <SettingsCard icon={HomeIcon} title="Home Assistant" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Both ways: Home Assistant entities show up as LSH devices (dashboard, flows, HomeKit, Loxone), and LSH devices show up in Home Assistant through MQTT Discovery. Entities LSH exported are never imported back, so nothing loops.">

      <h4 className="stg-subheading">Import from Home Assistant</h4>
      <Field label="Home Assistant URL" value={s.url} onChange={set(null, 'url')} placeholder="http://homeassistant.local:8123"/>
      <Field label="Long-lived access token" type="password" value={s.token} onChange={set(null, 'token')} autoComplete="off"
        hint="Home Assistant → your profile → Security → Long-lived access tokens → Create token"/>
      <Toggle label="Import entities" checked={s.import.enabled} onChange={set('import', 'enabled')}/>
      {s.import.enabled && (
        <>
          <div className="stg-hint" style={{ margin: '6px 0' }}>Domains</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {s.defaultDomains.map((d) => (
              <button type="button" key={d} style={chip(domains.includes(d))}
                onClick={() => setS((p) => {
                  const cur = p.import.domains?.length ? p.import.domains : p.defaultDomains
                  return { ...p, import: { ...p.import, domains: cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d] } }
                })}>{d}</button>
            ))}
          </div>
          {entities.length > 0 && (
            <details className="stg-hint" open={picked.length > 0}>
              <summary>Entities — {picked.length ? `${picked.length} chosen` : `all ${shown.length} in these domains`}</summary>
              <Field label="" value={filter} onChange={setFilter} placeholder="Filter…"/>
              <div style={{ maxHeight: 260, overflowY: 'auto', display: 'grid', gap: 2 }}>
                {shown.map((e) => (
                  <label key={e.entity_id} style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                    <input type="checkbox" checked={picked.includes(e.entity_id)} onChange={() => toggleIn('import', 'entities', e.entity_id)}/>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.name} <span style={{ opacity: 0.6, fontFamily: 'monospace', fontSize: 11 }}>{e.entity_id}</span>
                    </span>
                    <span style={{ opacity: 0.7 }}>{e.state}{e.unit ? ` ${e.unit}` : ''}</span>
                  </label>
                ))}
              </div>
              {picked.length > 0 && <Button onClick={() => set('import', 'entities')([])}>Import all instead</Button>}
            </details>
          )}
        </>
      )}

      <h4 className="stg-subheading">Export to Home Assistant</h4>
      <Toggle label="Publish LSH devices to Home Assistant (MQTT Discovery)" checked={s.export.enabled} onChange={set('export', 'enabled')}
        hint="needs the MQTT integration in Home Assistant, connected to the same broker"/>
      {s.export.enabled && (
        <>
          <Field label="MQTT broker" value={s.export.mqttUrl} onChange={set('export', 'mqttUrl')} placeholder="mqtt://192.168.1.10:1883"/>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 160 }}><Field label="Username" value={s.export.username} onChange={set('export', 'username')} autoComplete="off"/></div>
            <div style={{ flex: 1, minWidth: 160 }}><Field label="Password" type="password" value={s.export.password} onChange={set('export', 'password')} autoComplete="off"/></div>
          </div>
          <details className="stg-hint">
            <summary>Topics</summary>
            <Field label="Discovery prefix" value={s.export.prefix} onChange={set('export', 'prefix')} hint="Home Assistant's default is homeassistant"/>
            <Field label="State / command base topic" value={s.export.base} onChange={set('export', 'base')}/>
            <Field label="Node id" value={s.export.node} onChange={set('export', 'node')} hint="prefix of every unique_id — change it when running two LSH hubs"/>
          </details>
          <div className="stg-hint" style={{ margin: '6px 0' }}>Device types to export {s.export.types.length ? '' : '(none chosen = all)'}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {s.types.map((t) => <button type="button" key={t} style={chip(s.export.types.includes(t))} onClick={() => toggleIn('export', 'types', t)}>{t}</button>)}
          </div>
        </>
      )}

      <h4 className="stg-subheading">Status</h4>
      {!status ? <p className="stg-hint">Not running — fill in the URL and token (or enable export) and save.</p> : (
        <>
          <p className="stg-hint">
            Import: {imp?.connected
              ? <span style={{ color: 'var(--green)' }}>✓ connected to Home Assistant {imp.version} · {imp.entities} entities</span>
              : <span>not connected{imp?.error ? <span style={{ color: 'var(--red)' }}> — {imp.error}</span> : ''}</span>}
          </p>
          <p className="stg-hint">
            Export: {exp?.connected
              ? <span style={{ color: 'var(--green)' }}>✓ broker connected · {exp.published} entities published</span>
              : <span>{s.export.enabled ? 'broker not connected' : 'off'}{exp?.error ? <span style={{ color: 'var(--red)' }}> — {exp.error}</span> : ''}</span>}
          </p>
          {plan.length > 0 && (
            <details className="stg-hint">
              <summary>{exp?.connected ? `Published entities (${plan.length})` : `Would be published (${plan.length})`}</summary>
              <table className="stg-table" style={{ width: '100%' }}>
                <thead><tr><th>Device</th><th>Value</th><th>As</th></tr></thead>
                <tbody>{plan.map((p) => <tr key={p.objectId}><td>{p.device}</td><td>{p.label}</td><td>{p.component}</td></tr>)}</tbody>
              </table>
            </details>
          )}
          {exp?.connected && <Button onClick={unpublish}>Remove LSH entities from Home Assistant</Button>}
          <ResultBanner result={msg}/>
        </>
      )}

      <div className="stg-actions">
        <Button variant="primary" busy={save.busy}
          onClick={() => save.save(s).then(() => { reload?.(); loadSettings(); setTimeout(loadLists, 2500) }).catch(() => {})}>
          {gt('common.save', 'Save')}
        </Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}
