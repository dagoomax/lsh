import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { gt } from '../i18n'
import { resolveIcon } from './Icons'
import { homeKitModel } from './HomeKitControl'

// Apple-Home-style scenes for the home view: a row of scene tiles (tap runs,
// ⋯ edits, + creates) and the scene editor sheet. A scene is stored by the
// automation engine as { id, name, icon, actions }, where the dashboard
// writes { type: 'device', deviceKey, sensor, value } actions; any other
// action types (relay, notify, page, nested scene — from Flows or the API)
// are kept untouched. Each scene can be published to Apple Home, where the
// HomeKit bridge shows it as a switch that runs it (src/homekit-bridge.js).

const SCENE_ICONS = ['🎬', '🌅', '☀️', '🌙', '🛋️', '🍽️', '🎉', '🛏️', '🏠', '🚪', '💡', '📺', '🎵', '🧘', '🔥', '❄️', '🌿', '🚗']

const isOnValue = v => v === 1 || v === true || v === 'on'

async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(path, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.success === false) throw new Error(j.error || `HTTP ${r.status}`)
  return j
}

// What a scene can set on a device: the hero control's switch / level /
// cover position, or the first controllable on/off sensor.
function sceneModel(device) {
  const hk = homeKitModel(device)
  if (hk) return { sw: hk.sw, level: hk.level, cover: hk.cover }
  const sw = (device.sensors || []).find(s => !s.hidden && s.controllable && s.type === 'toggle'
    && !['up', 'down', 'stop', 'my'].includes(s.path))
  return sw ? { sw, level: null, cover: false } : null
}

// device → { on, level } as the editor shows it, from live readings
function captureState(device, m) {
  const r = device.readings || {}
  const lv = m.level ? r[m.level.path]?.value : undefined
  return {
    on: m.sw ? isOnValue(r[m.sw.path]?.value) : true,
    level: typeof lv === 'number' ? Math.round(lv) : (m.level?.max ?? 100),
  }
}

// editor rows → engine actions (cover: position only; light: on + level, or just off)
function toActions(rows, byKey) {
  const out = []
  for (const row of rows) {
    const d = byKey.get(row.deviceKey)
    const m = d && sceneModel(d)
    if (!m) continue
    if (m.cover && m.level) { out.push({ type: 'device', deviceKey: row.deviceKey, sensor: m.level.path, value: row.level }); continue }
    if (m.sw) out.push({ type: 'device', deviceKey: row.deviceKey, sensor: m.sw.path, value: row.on ? 1 : 0 })
    if (m.level && row.on) out.push({ type: 'device', deviceKey: row.deviceKey, sensor: m.level.path, value: row.level })
  }
  return out
}

// engine actions → editor rows (grouped per device) + the actions the editor doesn't model
function fromActions(actions, byKey) {
  const rows = new Map(), other = []
  for (const a of actions || []) {
    const d = a.type === 'device' && byKey.get(a.deviceKey)
    const m = d && sceneModel(d)
    if (!m || (a.sensor !== m.sw?.path && a.sensor !== m.level?.path)) { other.push(a); continue }
    const row = rows.get(a.deviceKey) || { deviceKey: a.deviceKey, on: true, level: m.level?.max ?? 100 }
    if (a.sensor === m.sw?.path) row.on = isOnValue(a.value)
    if (a.sensor === m.level?.path) { row.level = Number(a.value); if (m.cover) row.on = true }
    rows.set(a.deviceKey, row)
  }
  return { rows: [...rows.values()], other }
}

function Switch({ on, onChange, label }) {
  return (
    <div role="switch" aria-checked={on} aria-label={label} tabIndex={0}
      onClick={() => onChange(!on)}
      onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onChange(!on) } }}
      style={{ padding: 6, margin: -6, cursor: 'pointer', flexShrink: 0 }}>
      <div className="ios-switch" data-on={String(on)} />
    </div>
  )
}

function SceneDeviceRow({ device, m, row, onChange, onRemove }) {
  const I = resolveIcon(device)
  const showLevel = m.level && (m.cover || row.on)
  return (
    <div className="sc-dev">
      <div className="sc-dev-top">
        <span className="he-icon"><I size={18} color="currentColor" /></span>
        <span className="he-label">{device.label}</span>
        {m.sw && !m.cover && <Switch on={row.on} label={device.label} onChange={on => onChange({ ...row, on })} />}
        <button type="button" className="sc-x" onClick={onRemove} aria-label={gt('scene_remove_dev', 'Remove from scene')}>✕</button>
      </div>
      {showLevel && (
        <div className="sc-dev-level" data-cover={m.cover || undefined}>
          <input type="range" min={m.level.min ?? 0} max={m.level.max ?? 100} step={m.level.step || 1} value={row.level}
            onChange={e => onChange({ ...row, level: Number(e.target.value) })}
            style={{ '--p': `${((row.level - (m.level.min ?? 0)) / Math.max(1, (m.level.max ?? 100) - (m.level.min ?? 0))) * 100}%` }} />
          <span className="sc-dev-val">
            {m.cover ? (row.level <= 0 ? gt('closed', 'Closed') : row.level >= 100 ? gt('open', 'Open') : `${row.level}%`) : `${row.level}%`}
          </span>
        </div>
      )}
    </div>
  )
}

function DevicePicker({ devices, chosen, onPick, onClose }) {
  const [q, setQ] = useState('')
  const list = devices.filter(d => !chosen.has(d.key) && (!q || d.label.toLowerCase().includes(q.toLowerCase())
    || (d.room || '').toLowerCase().includes(q.toLowerCase())))
  return (
    <div className="sc-picker">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input className="sc-input" autoFocus placeholder={gt('scene_search', 'Search devices…')} value={q} onChange={e => setQ(e.target.value)} />
        <button type="button" className="he-text-btn" onClick={onClose}>{gt('dash_edit_done', 'Done')}</button>
      </div>
      <div className="he-list" style={{ marginTop: 8, maxHeight: 280, overflowY: 'auto' }}>
        {list.map(d => {
          const I = resolveIcon(d)
          return (
            <button key={d.key} type="button" className="he-row sc-pick-row" onClick={() => onPick(d)}>
              <span className="he-icon"><I size={17} color="currentColor" /></span>
              <span className="he-label" style={{ textAlign: 'left' }}>{d.label}{d.room ? <span className="sc-room"> · {d.room}</span> : null}</span>
              <span style={{ color: 'var(--accent)', fontSize: 20, lineHeight: 1 }}>+</span>
            </button>
          )
        })}
        {list.length === 0 && <div className="he-empty">{gt('scene_no_match', 'No matching devices')}</div>}
      </div>
    </div>
  )
}

export function SceneEditor({ scene, devices, onClose, onSaved }) {
  const controllable = useMemo(() => devices.filter(d => sceneModel(d))
    .sort((a, b) => (a.room || '').localeCompare(b.room || '') || a.label.localeCompare(b.label)), [devices])
  const byKey = useMemo(() => new Map(controllable.map(d => [d.key, d])), [controllable])
  const initial = useMemo(() => fromActions(scene?.actions, byKey), [scene?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const [name, setName] = useState(scene?.name || '')
  const [icon, setIcon] = useState(scene?.icon || '🎬')
  const [rows, setRows] = useState(initial.rows)
  const [homekit, setHomekit] = useState(scene ? scene.homekit !== false : true)
  const [picking, setPicking] = useState(!scene)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [confirmDel, setConfirmDel] = useState(false)

  const addDevice = d => {
    const m = sceneModel(d)
    setRows(r => [...r, { deviceKey: d.key, ...captureState(d, m) }])
  }
  const save = async (andRun) => {
    if (!name.trim()) { setErr(gt('scene_need_name', 'Give the scene a name')); return }
    setBusy(true); setErr(null)
    try {
      const body = { ...(scene || {}), name: name.trim(), icon, enabled: scene?.enabled ?? true,
        actions: [...toActions(rows, byKey), ...initial.other] }
      const { data } = await api('/api/automation/scenes', { method: 'POST', body })
      if ((scene ? scene.homekit !== false : true) !== homekit || !scene) {
        await api(`/api/automation/scenes/${encodeURIComponent(data.id)}/homekit`, { method: 'POST', body: { on: homekit } })
      }
      if (andRun) await api(`/api/automation/scenes/${encodeURIComponent(data.id)}/run`, { method: 'POST' })
      await onSaved?.()
      if (!andRun) onClose()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  const del = async () => {
    if (!confirmDel) { setConfirmDel(true); return }
    setBusy(true)
    try { await api(`/api/automation/scenes/${encodeURIComponent(scene.id)}`, { method: 'DELETE' }); await onSaved?.(); onClose() }
    catch (e) { setErr(e.message); setBusy(false) }
  }

  return (
    <motion.div className="dm-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 320, background: 'var(--hk-backdrop)',
        backdropFilter: 'blur(26px) saturate(1.5)', WebkitBackdropFilter: 'blur(26px) saturate(1.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
      <motion.div className="dm-card" onClick={e => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.92, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 12 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        style={{ position: 'relative', width: 'min(560px, 100%)', maxHeight: '88vh', display: 'flex', flexDirection: 'column',
          background: 'var(--modal-grad)', borderRadius: 'var(--sheet-radius)', overflow: 'hidden' }}>
        <div className="dm-handle" aria-hidden="true" />
        <div className="he-head">
          <button type="button" className="he-text-btn" onClick={onClose}>{gt('cancel', 'Cancel')}</button>
          <div className="he-title">{scene ? gt('scene_edit', 'Edit Scene') : gt('scene_new', 'New Scene')}</div>
          <button type="button" className="he-text-btn he-done" disabled={busy} onClick={() => save(false)}>{busy ? '…' : gt('save', 'Save')}</button>
        </div>

        <div className="he-body">
          <div className="sc-namebox">
            <span className="sc-big-icon">{icon}</span>
            <input className="sc-input sc-name" placeholder={gt('scene_name_ph', 'Scene name, e.g. Movie night')} value={name}
              maxLength={60} onChange={e => setName(e.target.value)} />
          </div>
          <div className="sc-icons">
            {SCENE_ICONS.map(e => (
              <button key={e} type="button" data-active={icon === e || undefined} onClick={() => setIcon(e)}>{e}</button>
            ))}
          </div>

          <div className="he-group-label">{gt('scene_devices', 'Accessories')}</div>
          {rows.length > 0 && (
            <div className="he-list">
              {rows.map(row => {
                const d = byKey.get(row.deviceKey)
                return d && (
                  <SceneDeviceRow key={row.deviceKey} device={d} m={sceneModel(d)} row={row}
                    onChange={next => setRows(rs => rs.map(x => (x.deviceKey === row.deviceKey ? next : x)))}
                    onRemove={() => setRows(rs => rs.filter(x => x.deviceKey !== row.deviceKey))} />
                )
              })}
            </div>
          )}
          {picking
            ? <DevicePicker devices={controllable} chosen={new Set(rows.map(r => r.deviceKey))} onPick={addDevice} onClose={() => setPicking(false)} />
            : <button type="button" className="sc-add" onClick={() => setPicking(true)}>+ {gt('scene_add_devices', 'Add accessories')}</button>}
          <div className="he-hint">{gt('scene_capture_hint', 'Added accessories start at their current state — adjust them, then save.')}</div>
          {initial.other.length > 0 && (
            <div className="he-hint">{gt('scene_other_actions', '+ {n} other action(s) from Flows / API, kept as they are.', { n: initial.other.length })}</div>
          )}

          <div className="he-group-label">Apple Home</div>
          <div className="he-list">
            <div className="he-row">
              <span className="he-icon"><HomeAppIcon /></span>
              <span className="he-label">{gt('scene_in_apple_home', 'Show in Apple Home')}</span>
              <Switch on={homekit} label={gt('scene_in_apple_home', 'Show in Apple Home')} onChange={setHomekit} />
            </div>
          </div>
          <div className="he-hint">{gt('scene_apple_hint', 'Appears in the Home app as a switch named after the scene: add it to Favourites, say “Hey Siri, turn on {name}”, or use it in Home-app scenes and automations.', { name: name || gt('scene', 'scene') })}</div>

          {err && <div className="sc-err">{err}</div>}

          <div className="sc-actions">
            <button type="button" className="home-edit-btn" disabled={busy || rows.length === 0} onClick={() => save(true)}>▶ {gt('scene_save_test', 'Save & test')}</button>
            {scene && (
              <button type="button" className="home-edit-btn sc-del" data-confirm={confirmDel || undefined} disabled={busy} onClick={del} onBlur={() => setConfirmDel(false)}>
                {confirmDel ? gt('home_reset_confirm', 'Tap again') : gt('scene_delete', 'Delete scene')}
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

function HomeAppIcon({ size = 17 }) {
  // Apple-Home-ish house glyph (not the Home app's logo)
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-5h4v5" />
    </svg>
  )
}

// Home-view section: scene tiles + "+" tile, and Apple Home publish status.
export default function ScenesSection({ scenes, runScene, reloadScenes, devices }) {
  const [editing, setEditing] = useState(null) // scene object, 'new', or null
  const [running, setRunning] = useState(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const shown = (scenes || []).filter(s => s.enabled !== false)
  const inHome = shown.filter(s => s.inHomekit).length
  const notInHome = shown.filter(s => s.homekit === false)

  // keep the open editor's scene object fresh after a reload (e.g. Apple Home toggled)
  useEffect(() => {
    if (editing && editing !== 'new') setEditing(e => scenes.find(s => s.id === e.id) || e)
  }, [scenes]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (s) => {
    setRunning(s.id)
    try { await runScene(s.id) } finally { setTimeout(() => setRunning(r => (r === s.id ? null : r)), 900) }
  }
  const addAllToHome = async () => {
    setBulkBusy(true)
    try {
      for (const s of notInHome) await api(`/api/automation/scenes/${encodeURIComponent(s.id)}/homekit`, { method: 'POST', body: { on: true } })
      await reloadScenes?.()
    } finally { setBulkBusy(false) }
  }

  return (
    <div>
      <div className="sc-head">
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text2)' }}>{gt('scenes', 'Scenes')}</span>
        <span className="badge badge-gray">{shown.length}</span>
        {shown.length > 0 && (
          <span className="sc-hk-status" title={gt('scene_hk_status', 'Scenes published to Apple Home')}>
            <HomeAppIcon size={13} /> {inHome}/{shown.length}
          </span>
        )}
        {notInHome.length > 0 && (
          <button type="button" className="he-text-btn" style={{ marginLeft: 'auto', fontSize: 13 }} disabled={bulkBusy} onClick={addAllToHome}>
            {bulkBusy ? '…' : gt('scene_add_all_home', 'Add all to Apple Home')}
          </button>
        )}
      </div>
      <div className="sc-grid">
        {shown.map(s => (
          <div key={s.id} className="sc-tile" data-running={running === s.id || undefined}
            role="button" tabIndex={0} onClick={() => run(s)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(s) } }}>
            <span className="sc-tile-ic">{running === s.id ? '✓' : (s.icon || '🎬')}</span>
            <span className="sc-tile-name">{s.name}</span>
            {s.inHomekit && <span className="sc-tile-hk" title="Apple Home"><HomeAppIcon size={12} /></span>}
            <button type="button" className="sc-tile-more" aria-label={gt('scene_edit', 'Edit Scene')}
              onClick={e => { e.stopPropagation(); setEditing(s) }}>⋯</button>
          </div>
        ))}
        <button type="button" className="sc-tile sc-tile-new" onClick={() => setEditing('new')}>
          <span className="sc-tile-ic">+</span>
          <span className="sc-tile-name">{gt('scene_new', 'New Scene')}</span>
        </button>
      </div>
      <AnimatePresence>
        {editing && (
          <SceneEditor key={editing === 'new' ? 'new' : editing.id} scene={editing === 'new' ? null : editing} devices={devices}
            onClose={() => setEditing(null)} onSaved={reloadScenes} />
        )}
      </AnimatePresence>
    </div>
  )
}
