import { useCallback, useEffect, useState } from 'react'
import { Button, Toggle, Field } from './primitives'

// Saved LAN devices (Settings → System → LAN scan → Devices): everything the
// scans have seen, with tags (new / ip-changed / offline are automatic),
// custom names, notes and monitoring. Server: src/lsh-lan-inventory.js +
// src/lsh-lan-monitor.js.

const SYSTEM = { new: 'tag-new', 'ip-changed': 'tag-warn', offline: 'tag-bad', permanent: 'tag-perm' }
const ago = (iso) => {
  if (!iso) return 'never'
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 90) return 'just now'
  if (s < 5400) return `${Math.round(s / 60)} min ago`
  if (s < 172800) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}
const api = (url, method = 'GET', body) => fetch(url, {
  method, credentials: 'include', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined,
}).then((r) => r.json()).catch((e) => ({ success: false, error: e.message }))

export function TagChips({ tags, onRemove }) {
  return (tags || []).map((t) => (
    <span key={t} className={`lan-tag ${SYSTEM[t] || ''}`}>
      {t}{onRemove && <button onClick={(e) => { e.stopPropagation(); onRemove(t) }} title="Remove tag">×</button>}
    </span>
  ))
}

export default function LanDevices({ onInspect, refreshKey }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState(null)

  const load = useCallback(() => api('/api/lsh-lan/devices').then((j) => {
    if (!j.success) return setError(j.error)
    setError(null); setData(j)
  }), [])
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [load, refreshKey])

  if (error) return <div className="stg-banner err" style={{ marginTop: 8 }}>✗ {error}</div>
  if (!data) return <div className="stg-hint" style={{ marginTop: 8 }}>Loading saved devices…</div>

  const devices = data.data
  const userTags = data.tags
  const counts = {
    new: devices.filter((d) => d.tags.includes('new')).length,
    'ip-changed': devices.filter((d) => d.tags.includes('ip-changed')).length,
    monitored: devices.filter((d) => d.monitored).length,
    permanent: devices.filter((d) => d.permanent).length,
    offline: devices.filter((d) => d.tags.includes('offline')).length,
  }
  const usedTags = [...new Set(devices.flatMap((d) => d.tags))].filter((t) => !SYSTEM[t]).sort()
  const filters = ['all', 'new', 'ip-changed', 'monitored', 'permanent', 'offline', ...usedTags]
  const shown = devices.filter((d) => {
    if (filter === 'monitored' && !d.monitored) return false
    if (filter !== 'all' && filter !== 'monitored' && !d.tags.includes(filter)) return false
    const s = q.trim().toLowerCase()
    return !s || [d.label, d.name, d.ip, d.mac, d.vendor, d.kindLabel, d.notes, d.tags.join(' ')].some((x) => String(x || '').toLowerCase().includes(s))
  })

  const patch = async (key, body) => {
    const j = await api(`/api/lsh-lan/devices/${encodeURIComponent(key)}`, 'PATCH', body)
    if (!j.success) setError(j.error)
    await load()
  }

  return (
    <div className="lan-devices">
      {!devices.length && <p className="stg-hint">No saved devices yet — run a scan. The first scan becomes the baseline; devices that appear in later scans are tagged <b>new</b>.</p>}
      {devices.length > 0 && (
        <>
          <div className="lan-filters">
            {filters.map((f) => (
              <button key={f} className={`lan-filter${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
                {f}{counts[f] != null ? ` (${counts[f]})` : f === 'all' ? ` (${devices.length})` : ''}
              </button>
            ))}
            <input className="stg-input" style={{ maxWidth: 220, padding: '6px 10px', fontSize: 13 }} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)}/>
            {(counts.new > 0 || counts['ip-changed'] > 0) && (
              <Button variant="secondary" onClick={() => api('/api/lsh-lan/devices/acknowledge', 'POST', {}).then(load)}>✓ Mark all known</Button>
            )}
          </div>
          <div className="stg-ble-scan">
            {shown.map((d) => (
              <div key={d.key}>
                <div className={`stg-ble-row${edit === d.key ? ' open' : ''}`} onClick={() => setEdit(edit === d.key ? null : d.key)}>
                  <span className={`lan-dot ${d.status?.online === true ? 'on' : d.status?.online === false ? 'off' : ''}`}
                    title={d.monitored ? (d.status?.online == null ? 'checking…' : d.status.online ? 'online' : 'offline') : 'not monitored'}/>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="stg-ble-name">
                      {d.label || d.name || d.ip}
                      {d.monitored && <span title={d.permanent ? 'Permanent — always monitored' : 'Monitored'}>{d.permanent ? '📌' : '🔔'}</span>}
                      <TagChips tags={d.tags} onRemove={(t) => patch(d.key, t === 'permanent' ? { permanent: false } : { tags: d.tags.filter((x) => x !== t && x !== 'offline') })}/>
                    </div>
                    <div className="stg-hint">
                      {d.ip}{d.mac ? ` · ${d.mac}` : ''}{d.vendor ? ` · ${d.vendor}` : ''}{d.kindLabel ? ` · ${d.kindLabel}` : ''}
                      {' · '}seen {ago(d.lastSeen)}
                      {d.monitored && d.status?.latency != null && ` · ${d.status.latency} ms`}
                    </div>
                  </div>
                  <span className="stg-ble-caret">{edit === d.key ? '▾' : '▸'}</span>
                </div>
                {edit === d.key && <DeviceEditor d={d} suggestions={userTags} onSave={(body) => patch(d.key, body).then(() => setEdit(null))}
                  onDelete={() => api(`/api/lsh-lan/devices/${encodeURIComponent(d.key)}`, 'DELETE').then(() => { setEdit(null); load() })}
                  onInspect={() => onInspect?.(d.ip)}/>}
              </div>
            ))}
          </div>
        </>
      )}
      <MonitorSettings settings={data.settings} running={data.monitorRunning} onSaved={load}/>
    </div>
  )
}

function DeviceEditor({ d, suggestions, onSave, onDelete, onInspect }) {
  const [label, setLabel] = useState(d.label || '')
  const [tags, setTags] = useState(d.tags.filter((t) => t !== 'offline' && t !== 'permanent'))
  const [tagInput, setTagInput] = useState('')
  const [notes, setNotes] = useState(d.notes || '')
  const [monitored, setMonitored] = useState(!!d.monitored)
  const [permanent, setPermanent] = useState(!!d.permanent)
  const addTag = (t) => {
    const v = String(t).trim().toLowerCase()
    if (v === 'permanent') { setPermanent(true); setMonitored(true) } else if (v && !tags.includes(v)) setTags([...tags, v])
    setTagInput('')
  }
  return (
    <div className="ble-dd lan-editor" onClick={(e) => e.stopPropagation()}>
      <Field label="Name" value={label} onChange={setLabel} placeholder={d.name || d.ip}/>
      <div>
        <label className="stg-hint">Tags</label>
        <div className="lan-tag-edit">
          <TagChips tags={tags} onRemove={(t) => setTags(tags.filter((x) => x !== t))}/>
          <input className="stg-input" list="lan-tag-suggestions" value={tagInput} placeholder="add tag…"
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput) } }}/>
          <datalist id="lan-tag-suggestions">{suggestions.map((s) => <option key={s} value={s}/>)}</datalist>
        </div>
        <div className="lan-tag-suggest">
          {suggestions.filter((s) => !tags.includes(s)).slice(0, 10).map((s) => (
            <button key={s} onClick={() => addTag(s)}>+ {s}</button>
          ))}
        </div>
      </div>
      <Field label="Notes" type="textarea" value={notes} onChange={setNotes} placeholder="Where it is, who owns it…"/>
      <Toggle label="Permanent device" checked={permanent} onChange={(v) => { setPermanent(v); if (v) setMonitored(true) }}
        hint="always monitored, always on the dashboard, offline = critical alert, can't be forgotten"/>
      <Toggle label="Monitor this device" checked={monitored || permanent} onChange={(v) => !permanent && setMonitored(v)}
        hint={permanent ? 'on — permanent devices are always monitored' : 'online/offline + latency, shown as an LSH device (lan/…) for Flows and automations'}/>
      <div className="stg-hint">
        First seen {new Date(d.firstSeen).toLocaleString()} · last seen {new Date(d.lastSeen).toLocaleString()}
        {d.ipHistory?.length > 1 && ` · IPs: ${d.ipHistory.join(', ')}`}
        {d.integration && ` · LSH integration: ${d.integration}`}
      </div>
      <div className="stg-actions">
        <Button variant="primary" onClick={() => onSave({ label, tags: tagInput ? [...tags, tagInput] : tags, notes, monitored: monitored || permanent, permanent })}>Save</Button>
        <Button variant="secondary" onClick={onInspect}>Deep dive</Button>
        <Button variant="danger" disabled={d.permanent} title={d.permanent ? 'Permanent — remove the permanent tag first' : undefined}
          onClick={() => { if (window.confirm(`Forget ${d.label || d.name || d.ip}?`)) onDelete() }}>Forget</Button>
      </div>
    </div>
  )
}

function MonitorSettings({ settings, running, onSaved }) {
  const [s, setS] = useState(settings)
  const [msg, setMsg] = useState(null)
  useEffect(() => setS(settings), [settings.enabled, settings.checkSeconds, settings.autoScanMinutes])
  const save = async () => {
    const j = await api('/api/settings/lsh-lan', 'POST', s)
    setMsg(j.success ? { ok: true, text: j.message } : { ok: false, text: j.error })
    onSaved()
  }
  return (
    <div className="lan-monitor-settings">
      <div className="ble-dd-title">Monitoring {running ? <span className="lan-tag tag-ok">running</span> : <span className="lan-tag">off</span>}</div>
      <Toggle label="Enable monitoring" checked={!!s.enabled} onChange={(v) => setS({ ...s, enabled: v })}
        hint="checks monitored devices; switching a device's Monitor on enables this automatically"/>
      <div className="lan-settings-row">
        <Field label="Check every (s)" type="number" value={s.checkSeconds} onChange={(v) => setS({ ...s, checkSeconds: v })}/>
        <Field label="Background scan every (min, 0 = off)" type="number" value={s.autoScanMinutes} onChange={(v) => setS({ ...s, autoScanMinutes: v })}/>
      </div>
      <Toggle label="Notify on new devices" checked={s.notifyNew !== false} onChange={(v) => setS({ ...s, notifyNew: v })} hint="background scans"/>
      <Toggle label="Notify when a monitored device goes offline / comes back" checked={s.notifyOffline !== false} onChange={(v) => setS({ ...s, notifyOffline: v })}/>
      <div className="stg-actions">
        <Button variant="primary" onClick={save}>Save monitoring</Button>
        {msg && <span className={`stg-banner ${msg.ok ? 'ok' : 'err'}`}>{msg.ok ? '✓' : '✗'} {msg.text}</span>}
      </div>
    </div>
  )
}
