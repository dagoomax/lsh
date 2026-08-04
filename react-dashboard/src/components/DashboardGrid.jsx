import { useState, useMemo, useCallback } from 'react'
import GridLayout, { WidthProvider } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { DeviceTile } from './DeviceList'
import { gt } from '../i18n'

const ReactGridLayout = WidthProvider(GridLayout)
const STORAGE_KEY = 'lsh-dashboard-layout'
const COLS = 12
const ROW_H = 150

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed?.layout) || !Array.isArray(parsed?.pinned)) return null
    return parsed
  } catch { return null }
}
function save(layout, pinned) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ layout, pinned: [...pinned] }))
}

// Exported so DeviceList can decide, without rendering it, whether a custom
// layout exists at all — the "All" view falls back to its plain auto-fill
// CSS grid (unchanged default behaviour) until someone actually saves one.
export function hasCustomLayout() {
  return !!loadSaved()
}

// Seeds a starting layout from whatever's currently visible, so switching
// into the editor for the first time doesn't dump the user on an empty
// canvas — 3 tiles per row, filled top-to-bottom in the same order they're
// already showing in.
export function seedLayoutFromDevices(deviceKeys) {
  const layout = deviceKeys.map((key, i) => ({
    i: key, x: (i % 3) * 4, y: Math.floor(i / 3), w: 4, h: 1,
  }))
  save(layout, new Set(deviceKeys))
}

function nextSlot(layout, w, h) {
  // Simple bottom-of-grid placement — react-grid-layout's own collision
  // handling takes it from there once the user drags it.
  const maxY = layout.reduce((m, l) => Math.max(m, l.y + l.h), 0)
  return { x: 0, y: maxY, w, h }
}

// Custom draggable/resizable widget grid — the "dashboard editor". Devices
// not yet pinned to the layout are reachable via the "+ Add widget" picker;
// removing a tile only unpins it (hides it from this view), it doesn't touch
// the underlying device. Layout persists to localStorage (same scoping as
// theme/language), not synced across browsers/devices — a server-side/
// per-user version would be the natural next step if that's ever needed.
export default function DashboardGrid({ devices, onCommand, onOpen }) {
  const [editing, setEditing] = useState(false)
  const [saved, setSaved]     = useState(loadSaved)
  const [picking, setPicking] = useState(false)

  const pinnedSet = useMemo(() => new Set(saved?.pinned || []), [saved])
  const byKey     = useMemo(() => new Map(devices.map(d => [d.key, d])), [devices])
  const layout    = saved?.layout || []
  const tiles     = layout.filter(l => byKey.has(l.i))

  const commit = useCallback((nextLayout, nextPinned) => {
    save(nextLayout, nextPinned)
    setSaved({ layout: nextLayout, pinned: [...nextPinned] })
  }, [])

  const onLayoutChange = useCallback((nextLayout) => {
    if (!editing) return // react-grid-layout also fires this on mount — ignore outside edit mode
    // Preserve item order/shape from react-grid-layout's own output, just persist it.
    commit(nextLayout.map(l => ({ i: l.i, x: l.x, y: l.y, w: l.w, h: l.h })), pinnedSet)
  }, [editing, commit, pinnedSet])

  const removeTile = (key) => {
    const nextPinned = new Set(pinnedSet)
    nextPinned.delete(key)
    commit(layout.filter(l => l.i !== key), nextPinned)
  }

  const addTile = (key) => {
    const nextPinned = new Set(pinnedSet)
    nextPinned.add(key)
    commit([...layout, { i: key, ...nextSlot(layout, 1, 1) }], nextPinned)
    setPicking(false)
  }

  const resetLayout = () => {
    if (!confirm(gt('dash_edit_reset_confirm', 'Reset to the default automatic layout? This clears your custom arrangement.'))) return
    localStorage.removeItem(STORAGE_KEY)
    setSaved(null)
    setEditing(false)
  }

  const addable = devices.filter(d => !pinnedSet.has(d.key))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <button
          onClick={() => setEditing(e => !e)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600,
            padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
            border: `1px solid ${editing ? 'var(--accent)' : 'var(--border)'}`,
            background: editing ? 'var(--accent-dim)' : 'var(--white-04)',
            color: editing ? 'var(--accent-lt)' : 'var(--text2)',
          }}
        >
          {editing ? `✓ ${gt('dash_edit_done', 'Done')}` : `🎛 ${gt('dash_edit_layout', 'Edit Layout')}`}
        </button>
        {editing && (
          <>
            <button onClick={() => setPicking(true)} style={pillBtnStyle}>
              + {gt('dash_edit_add_widget', 'Add widget')}
            </button>
            <button onClick={resetLayout} style={{ ...pillBtnStyle, marginLeft: 'auto', color: 'var(--red)' }}>
              {gt('dash_edit_reset', 'Reset to default')}
            </button>
          </>
        )}
      </div>

      <ReactGridLayout
        className="dashboard-grid"
        layout={tiles}
        cols={COLS}
        rowHeight={ROW_H}
        margin={[10, 10]}
        isDraggable={editing}
        isResizable={editing}
        onLayoutChange={onLayoutChange}
        draggableCancel=".device-tile-nodrag"
      >
        {tiles.map(l => {
          const device = byKey.get(l.i)
          return (
            <div key={l.i} style={{ position: 'relative' }}>
              {editing && (
                <button
                  onClick={() => removeTile(l.i)}
                  title={gt('dash_edit_remove', 'Remove from dashboard')}
                  className="device-tile-nodrag"
                  style={{
                    position: 'absolute', top: -8, right: -8, zIndex: 5,
                    width: 22, height: 22, borderRadius: '50%', border: '1px solid var(--border)',
                    background: 'var(--red)', color: '#fff', cursor: 'pointer',
                    fontSize: 12, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >✕</button>
              )}
              <div style={{ width: '100%', height: '100%', pointerEvents: editing ? 'none' : 'auto' }}>
                <DeviceTile device={device} onCommand={onCommand} onOpen={onOpen} />
              </div>
            </div>
          )
        })}
      </ReactGridLayout>

      {picking && (
        <div
          onClick={() => setPicking(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(5,7,15,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{
            width: 'min(480px, 92vw)', maxHeight: '70vh', overflowY: 'auto',
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 16,
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{gt('dash_edit_pick_title', 'Add a widget')}</div>
            {addable.length === 0 && (
              <div style={{ color: 'var(--text3)', fontSize: 13 }}>{gt('dash_edit_pick_empty', 'Every device is already on the dashboard.')}</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {addable.map(d => (
                <button key={d.key} onClick={() => addTile(d.key)} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 10,
                  border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text)', fontSize: 13.5, textAlign: 'left',
                }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--white-04)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ flex: 1 }}>{d.label || d.key}</span>
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>{d.type}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const pillBtnStyle = {
  fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
  border: '1px solid var(--border)', background: 'var(--white-04)', color: 'var(--text2)',
}
