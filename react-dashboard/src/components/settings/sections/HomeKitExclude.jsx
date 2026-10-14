import { useEffect, useMemo, useState } from 'react'
import { Button, ResultBanner } from '../primitives'
import { tr } from '../../../i18n'

const api = (url, method = 'GET', body) => fetch(url, {
  method, credentials: 'include',
  ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
}).then((r) => r.json())

// HomeKit kind ('light-rw', 'somfy-cover', 'battery-level'…) → icon, by keyword
const icon = (k) => Object.entries(KIND).find(([w]) => String(k).toLowerCase().includes(w.toLowerCase()))?.[1] || '•'
const KIND = { cover: '🪟', mower: '🌱', garage: '🚗', doorbell: '🔔', camera: '📷', speaker: '🔊', valve: '🚿', security: '🛡️', co2: '🫧',  temperature: '🌡️', humidity: '💧', motion: '🏃', contact: '🚪', light: '💡', switch: '🔌', lock: '🔒', windowCovering: '🪟', thermostat: '🔥', outlet: '🔌', fan: '🌀', battery: '🔋', leak: '💦', smoke: '🔥', airQuality: '🌫️' }

// Settings → HomeKit → Not in HomeKit: untick what shouldn't show up in the
// Home app — single devices, whole integrations (types), cameras, scenes,
// relays. Applied live (src/homekit-bridge.js applyExclude).
export default function HomeKitExclude() {
  const [d, setD] = useState(null)
  const [ex, setEx] = useState(null)
  const [q, setQ] = useState('')
  const [onlyOff, setOnlyOff] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const load = () => api('/api/homekit/accessories').then((j) => { if (j.success) { setD(j.data); setEx(j.data.exclude) } }).catch(() => {})
  useEffect(() => { load() }, [])

  const toggle = (k, id) => setEx((e) => ({ ...e, [k]: e[k].includes(id) ? e[k].filter((x) => x !== id) : [...e[k], id] }))
  const typeOff = (t) => ex?.types.includes(t)
  const devices = useMemo(() => (d?.devices || [])
    .filter((x) => !q || `${x.label} ${x.key} ${x.type} ${x.room || ''}`.toLowerCase().includes(q.toLowerCase()))
    .filter((x) => !onlyOff || ex.devices.includes(x.key) || typeOff(x.type))
    .sort((a, b) => String(a.type).localeCompare(String(b.type)) || String(a.label).localeCompare(String(b.label))), [d, q, onlyOff, ex])

  if (!d || !ex) return <p className="stg-hint">{tr('Loading…')}</p>
  const offCount = (d.devices || []).filter((x) => ex.devices.includes(x.key) || typeOff(x.type)).length
  const dirty = JSON.stringify(ex) !== JSON.stringify(d.exclude)
  const save = async () => {
    setBusy(true); setMsg(null)
    try { const j = await api('/api/settings/homekit-exclude', 'POST', ex); setMsg({ ok: j.success, message: j.message || j.error }); if (j.success) await load() }
    finally { setBusy(false) }
  }

  return (
    <div className="hk-ex">
      <p className="stg-hint">{tr('Untick what shouldn’t appear in the Home app. Changes apply right away — no restart. A device you take out and later put back comes back as a new accessory (Home app room and name reset).')}</p>

      {d.types.length > 1 && (
        <>
          <div className="hk-ex-h">{tr('Whole integrations')}</div>
          <div className="hk-ex-chips">
            {d.types.map((t) => {
              const n = d.devices.filter((x) => x.type === t).length
              return <button key={t} type="button" className={`hk-ex-chip${typeOff(t) ? ' off' : ''}`} onClick={() => toggle('types', t)}>{typeOff(t) ? '✕' : '✓'} {t} <small>{n}</small></button>
            })}
          </div>
        </>
      )}

      <div className="hk-ex-h">{tr('Devices')}{' '}<small>{tr('{v} of {devicesCount} in HomeKit', { v: d.devices.length - offCount, devicesCount: d.devices.length })}</small></div>
      <div className="hk-ex-tools">
        <input className="stg-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Filter by name, room, type…')}/>
        <label className="hk-ex-small"><input type="checkbox" checked={onlyOff} onChange={(e) => setOnlyOff(e.target.checked)}/>{' '}{tr('only excluded')}</label>
      </div>
      <div className="hk-ex-list">
        {devices.map((x) => {
          const byType = typeOff(x.type)
          const on = !byType && !ex.devices.includes(x.key)
          return (
            <label key={x.key} className={`hk-ex-row${on ? '' : ' off'}`} title={x.key}>
              <input type="checkbox" checked={on} disabled={byType} onChange={() => toggle('devices', x.key)}/>
              <span className="hk-ex-name">{x.label}{x.room ? <small> · {x.room}</small> : null}</span>
              <span className="hk-ex-kinds">{[...new Set(x.kinds.map(icon))].join(' ')}</span>
              <span className="hk-ex-type">{byType ? `${x.type} — off` : x.type}</span>
            </label>
          )
        })}
        {!devices.length && <p className="stg-hint">{tr('Nothing matches.')}</p>}
      </div>

      {[['cameras', 'Cameras', (c) => c.name, (c) => `${c.name}${c.standalone ? ' (standalone — applies after restart)' : ''}`],
        ['scenes', 'Scenes', (s) => String(s.id), (s) => s.name],
        ['relays', 'GX relays', (r) => String(r.index), (r) => r.name]].map(([k, title, id, label]) => (d[k] || []).length > 0 && (
        <div key={k}>
          <div className="hk-ex-h">{title}</div>
          <div className="hk-ex-list">
            {d[k].map((x) => {
              const on = !ex[k].includes(id(x))
              return (
                <label key={id(x)} className={`hk-ex-row${on ? '' : ' off'}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(k, id(x))}/>
                  <span className="hk-ex-name">{label(x)}</span>
                </label>
              )
            })}
          </div>
        </div>
      ))}

      <div className="stg-actions">
        <Button variant="primary" busy={busy} disabled={!dirty} onClick={save}>{tr('Apply')}</Button>
        {dirty && <Button onClick={() => setEx(d.exclude)}>{tr('Undo')}</Button>}
        <ResultBanner result={msg}/>
      </div>
      {!d.running && <p className="stg-hint">{tr('HomeKit isn’t running — the choice applies when it starts.')}</p>}
    </div>
  )
}
