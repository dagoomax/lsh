import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { gt } from '../i18n'
import { CAT_COLOR, isOn, stateText } from '../planModelSlots'
import '../styles/plan-html-model.css'

// A picture as the floor-plan model: a render or photo of the home (PNG, JPG
// or WebP — Plan → Import model) with the devices pinned onto it. A picture
// has no geometry to find a lamp in, so pins are placed by hand: "Place
// devices" lists what is not on the picture yet — pick one, tap where it is.
// Positions are fractions of the picture (model.pins, /api/plan-model/pins),
// so they hold at any size.
//
// Drag pans, wheel / pinch zooms, double-click resets. As in PlanHtmlModel the
// camera lives in CSS custom properties, so moving it never re-renders React.

const load = (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const save = (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const TRAY_MAX = 60

export default function PlanImageModel({ model, devices = [], groupOf, onOpen, filter = null, kiosk = false, onSavePins }) {
  const [nat, setNat] = useState(null) // the picture's own size, once loaded
  const [error, setError] = useState(false)
  const [box, setBox] = useState(null) // the picture's size fitted to the viewport
  const [labels, setLabels] = useState(() => load('planHtmlLabels', '0') === '1')
  const [edit, setEdit] = useState(false)
  const [armed, setArmed] = useState(null) // device key waiting for a tap on the picture
  const [query, setQuery] = useState('')
  const [pins, setPins] = useState(model?.pins || {})
  const el = useRef(null)
  const canvas = useRef(null)
  const cam = useRef({ zoom: 1, x: 0, y: 0 })
  const live = useRef({}) // what the pointer handlers need without re-binding
  live.current = { edit, armed, pins }

  useEffect(() => { setPins(model?.pins || {}) }, [model?.pins])
  useEffect(() => { setNat(null); setError(false); cam.current = { zoom: 1, x: 0, y: 0 } }, [model?.url])

  const apply = () => {
    const n = el.current, c = cam.current
    if (!n) return
    n.style.setProperty('--phm-zoom', String(c.zoom))
    n.style.setProperty('--phm-x', `${c.x}px`)
    n.style.setProperty('--phm-y', `${c.y}px`)
  }

  // fit the picture inside the viewport, leaving room for the bar underneath
  useLayoutEffect(() => {
    const n = el.current
    if (!n || !nat) return
    const fit = () => {
      const { width, height } = n.getBoundingClientRect()
      if (!width || !height) return
      const k = Math.min((width - 24) / nat.w, (height - 84) / nat.h)
      setBox({ w: Math.round(nat.w * k), h: Math.round(nat.h * k) })
      apply()
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(n)
    return () => ro.disconnect()
  }, [nat])

  const commit = async (patch) => {
    const before = live.current.pins
    const next = { ...before }
    for (const [k, v] of Object.entries(patch)) { if (v === null) delete next[k]; else next[k] = v }
    setPins(next)
    if ((await onSavePins?.(patch)) === false) setPins(before) // refused or cancelled: put it back
  }

  // pointer pan / pinch, wheel zoom, tap-to-place and pin dragging
  useEffect(() => {
    const n = el.current
    if (!n) return
    const pts = new Map()
    let pinch = null
    let moved = 0
    let grab = null // a pin being dragged in edit mode: { key, node }
    const ui = (t) => t.closest?.('.phm-bar, .phi-tray')
    const frac = (e) => { // pointer position as fractions of the picture
      const r = canvas.current.getBoundingClientRect()
      return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
    }
    const down = (e) => {
      if (ui(e.target) || (e.pointerType === 'mouse' && e.button > 1)) return
      const pin = e.target.closest?.('.phi-pin-pos')
      if (pin && !live.current.edit) return // an ordinary pin: let the click open the device
      if (e.target.closest?.('.phi-pin-x')) return
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      try { n.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
      moved = 0
      grab = pin && pts.size === 1 ? { key: pin.dataset.key, node: pin } : null
      n.setAttribute('data-dragging', '')
      if (pts.size === 2) {
        const [a, b] = [...pts.values()]
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: cam.current.zoom, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }
        grab = null
      }
    }
    const move = (e) => {
      const p = pts.get(e.pointerId)
      if (!p) return
      const dx = e.clientX - p.x, dy = e.clientY - p.y
      p.x = e.clientX; p.y = e.clientY
      moved += Math.abs(dx) + Math.abs(dy)
      const c = cam.current
      if (pts.size >= 2 && pinch) {
        const [a, b] = [...pts.values()]
        c.zoom = clamp(pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.dist)), 1, 8)
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2
        c.x += cx - pinch.cx; c.y += cy - pinch.cy
        pinch.cx = cx; pinch.cy = cy
        apply()
      } else if (grab) {
        const f = frac(e)
        grab.node.style.left = `${clamp(f.x, 0, 1) * 100}%`
        grab.node.style.top = `${clamp(f.y, 0, 1) * 100}%`
      } else {
        c.x += dx; c.y += dy
        apply()
      }
    }
    const up = (e) => {
      if (!pts.delete(e.pointerId)) return
      if (pts.size < 2) pinch = null
      if (pts.size) return
      n.removeAttribute('data-dragging')
      const f = canvas.current ? frac(e) : null
      const inside = f && f.x >= 0 && f.x <= 1 && f.y >= 0 && f.y <= 1
      if (grab) {
        if (moved > 4 && f) commit({ [grab.key]: { x: clamp(f.x, 0, 1), y: clamp(f.y, 0, 1) } })
      } else if (live.current.armed && moved <= 6 && inside) { // a tap, not a pan
        commit({ [live.current.armed]: f })
        setArmed(null)
      }
      grab = null
    }
    const wheel = (e) => {
      if (ui(e.target)) return
      e.preventDefault()
      const c = cam.current
      const next = clamp(c.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), 1, 8)
      // zoom toward the pointer: keep what is under it where it is
      const r = n.getBoundingClientRect()
      const px = e.clientX - r.left - r.width / 2 - c.x, py = e.clientY - r.top - r.height / 2 - c.y
      const k = next / c.zoom
      c.x -= px * (k - 1); c.y -= py * (k - 1)
      c.zoom = next
      if (next <= 1.001) { c.x = 0; c.y = 0 }
      apply()
    }
    const reset = (e) => { if (!ui(e.target) && !live.current.edit) { cam.current = { zoom: 1, x: 0, y: 0 }; apply() } }
    n.addEventListener('pointerdown', down)
    n.addEventListener('pointermove', move)
    n.addEventListener('pointerup', up)
    n.addEventListener('pointercancel', up)
    n.addEventListener('wheel', wheel, { passive: false })
    n.addEventListener('dblclick', reset)
    return () => {
      n.removeEventListener('pointerdown', down)
      n.removeEventListener('pointermove', move)
      n.removeEventListener('pointerup', up)
      n.removeEventListener('pointercancel', up)
      n.removeEventListener('wheel', wheel)
      n.removeEventListener('dblclick', reset)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const catOf = (d) => (groupOf && groupOf(d)) || 'Other'
  const byKey = useMemo(() => new Map(devices.map((d) => [d.key, d])), [devices])
  const placed = useMemo(() => Object.entries(pins).map(([key, pos]) => ({ device: byKey.get(key), pos })).filter((p) => p.device), [pins, byKey])
  const shown = placed.filter((p) => !filter || catOf(p.device) === filter)
  const lightsOn = placed.filter((p) => catOf(p.device) === 'Lighting' && isOn(p.device))
  const unplaced = useMemo(() => {
    const q = query.trim().toLowerCase()
    return devices.filter((d) => !pins[d.key] && (!q || `${d.label} ${d.room || ''} ${d.key}`.toLowerCase().includes(q)))
  }, [devices, pins, query])
  const armedDevice = armed ? byKey.get(armed) : null

  const toggleLabels = () => setLabels((l) => { save('planHtmlLabels', l ? '0' : '1'); return !l })
  const toggleEdit = () => { setEdit((v) => !v); setArmed(null) }

  return (
    <div className="phm phi" ref={el} data-labels={labels || edit || undefined} data-edit={edit || undefined} data-armed={armed ? '' : undefined}>
      {!nat && <div className="phm-msg">{error ? gt('phi_load_failed', 'Could not load the picture') : '…'}</div>}
      <div className="phi-stage">
        <div className="phi-canvas" ref={canvas} style={box ? { width: box.w, height: box.h, marginLeft: -box.w / 2, marginTop: -box.h / 2 } : { visibility: 'hidden' }}>
          <img src={model.url} alt={model.name || ''} draggable={false}
            onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth || 1, h: e.currentTarget.naturalHeight || 1 })}
            onError={() => setError(true)} />
          {/* a pool of light under every lamp that is on */}
          {lightsOn.map(({ device, pos }) => (
            <div key={device.key} className="phi-glow" style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%` }} />
          ))}
          {shown.map(({ device, pos }) => (
            <div key={device.key} className="phi-pin-pos" data-key={device.key} style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%` }}>
              <button type="button" className="phm-pin" data-on={isOn(device) || undefined} style={{ '--c': CAT_COLOR[catOf(device)] || CAT_COLOR.Other }}
                title={`${device.label} ${stateText(device, gt)}`} onClick={() => { if (!edit) onOpen?.(device.key) }}>
                <i /><span className="phm-pin-text">{device.label}{!edit && <small>{stateText(device, gt)}</small>}</span>
                {edit && (
                  <span className="phi-pin-x" role="button" tabIndex={0} title={gt('plan_remove_dev', 'Remove from the model')}
                    aria-label={gt('plan_remove_dev', 'Remove from the model')}
                    onClick={(e) => { e.stopPropagation(); commit({ [device.key]: null }) }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); commit({ [device.key]: null }) } }}>×</span>
                )}
              </button>
            </div>
          ))}
        </div>
      </div>
      {nat && (placed.length > 0 || edit) && (
        <div className="phm-status">
          {lightsOn.length > 0 && <><b>● {lightsOn.length}</b>{gt('phm_lights_on', 'lights on')}<span>·</span></>}
          {shown.length} <span>{gt('phm_devices', 'devices on the model')}</span>
        </div>
      )}
      {nat && (
        <div className="phm-hint">
          {armedDevice ? gt('phi_tap_to_place', 'Tap the picture where {name} is').replace('{name}', armedDevice.label)
            : edit ? gt('phi_edit_hint', 'Pick a device, then tap the picture · Drag a pin to move it')
              : gt('phi_hint', 'Drag to pan · Scroll to zoom · Double-click to reset')}
        </div>
      )}
      {edit && (
        <div className="phi-tray">
          <input type="search" value={query} placeholder={gt('scene_search', 'Search devices…')} aria-label={gt('scene_search', 'Search devices…')}
            onChange={(e) => setQuery(e.target.value)} />
          <div className="phi-tray-list">
            {unplaced.slice(0, TRAY_MAX).map((d) => (
              <button type="button" key={d.key} data-active={armed === d.key || undefined} style={{ '--c': CAT_COLOR[catOf(d)] || CAT_COLOR.Other }}
                onClick={() => setArmed((a) => (a === d.key ? null : d.key))}>
                <i />{d.label}{d.room ? <small>{d.room}</small> : null}
              </button>
            ))}
            {unplaced.length === 0 && <div className="phi-tray-empty">{query ? gt('scene_no_match', 'No matching devices') : gt('phi_all_placed', 'Every device is on the picture')}</div>}
            {unplaced.length > TRAY_MAX && <div className="phi-tray-empty">+{unplaced.length - TRAY_MAX} — {gt('phi_search_more', 'search to narrow the list')}</div>}
          </div>
        </div>
      )}
      {nat && (
        <div className="phm-bar">
          <div className="phm-seg">
            {!kiosk && onSavePins && (
              <button type="button" data-active={edit || undefined} onClick={toggleEdit}>
                {edit ? gt('dash_edit_done', 'Done') : gt('phi_place', 'Place devices')}
              </button>
            )}
            <button type="button" data-active={labels || edit || undefined} disabled={edit} onClick={toggleLabels}>{gt('phm_labels', 'Labels')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
