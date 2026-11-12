import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { gt } from '../i18n'
import { CAT_COLOR, assignDevices, isOn, stateText } from '../planModelSlots'
import { layoutModel, PX_PER_M } from '../planHtmlLayout'
import '../styles/plan-html-model.css'
import '../styles/plan-html-textures.css'

// The imported floor-plan model drawn in plain HTML: the server reduces the
// GLB to boxes (/api/plan-model/boxes), planHtmlLayout turns them into faces,
// and CSS 3D transforms do the rest — no WebGL, no three.js. Devices sit on
// the same slots as in the WebGL viewer (PlanModelViewer), so a placement
// made there shows up here.
//
// Drag orbits, wheel / pinch zooms, shift-drag or a two-finger drag pans,
// double-click resets. The camera lives in CSS custom properties written
// straight to the element, so moving it never re-renders React.

const load = (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const save = (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d)

const ISO = { yaw: -45, tilt: 55 }
const TILT_MAX = 82

// Walls, floors and furniture — static for a given model and cut, so it is
// kept out of the device-state render path
const Geometry = memo(function Geometry({ layout, tex }) {
  const cls = (base, t) => (tex && t ? `${base} phm-t-${t}` : base)
  return (
    <>
      <div className="phm-ground" />
      {layout.solids.map((s, i) => (
        <div key={i} className="phm-box" data-round={s.round || undefined} data-glass={s.glass || undefined}
          style={{ left: s.left, top: s.top, width: s.w, height: s.d, opacity: s.glass ? undefined : s.o,
            transform: `translateZ(${s.z}px)${s.r ? ` rotate(${s.r}deg)` : ''}` }}>
          {s.sides && <>
            <div className={cls('phm-face phm-n', s.tex)} style={{ height: s.h, backgroundColor: s.sides.n }} />
            <div className={cls('phm-face phm-s', s.tex)} style={{ height: s.h, backgroundColor: s.sides.s }} />
            <div className={cls('phm-face phm-w', s.tex)} style={{ width: s.h, backgroundColor: s.sides.w }} />
            <div className={cls('phm-face phm-e', s.tex)} style={{ width: s.h, backgroundColor: s.sides.e }} />
          </>}
          {s.under && <div className="phm-face phm-top" style={{ backgroundColor: s.under, transform: `translateZ(${s.h / 2}px)` }} />}
          <div className={cls('phm-face phm-top', s.capTex)} style={{ backgroundColor: s.cap, transform: `translateZ(${s.h}px)` }} />
        </div>
      ))}
    </>
  )
})

const Floor = memo(function Floor({ layout, glows, tex }) {
  return (
    <div className="phm-floor" style={{ transform: `translateZ(${layout.floorZ}px)` }}>
      {layout.flats.map((f, i) => (
        <div key={i} className={tex && f.tex ? `phm-flat phm-t-${f.tex}` : 'phm-flat'} data-kind={f.kind}
          style={{ left: f.left, top: f.top, width: f.w, height: f.d,
            // textured: the class paints the material over the plain colour; otherwise a drawn pattern
            ...(tex && f.tex ? { backgroundColor: f.c } : { background: f.bg }),
            borderRadius: f.round ? '50%' : undefined, transform: f.r ? `rotate(${f.r}deg)` : undefined }} />
      ))}
      {glows.length > 0 && <div className="phm-dim" />}
      {glows.map((g) => (
        <div key={g.id} className="phm-glow" style={{ left: g.x - g.r, top: g.y - g.r, width: g.r * 2, height: g.r * 2, opacity: g.o }} />
      ))}
    </div>
  )
})

export default function PlanHtmlModel({ model, devices = [], groupOf, onOpen, filter = null }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [cut, setCut] = useState(() => num(load('planHtmlCut', '1.3'), 1.3)) // metres; ≥ model height = whole model
  const [labels, setLabels] = useState(() => load('planHtmlLabels', '0') === '1')
  const [tex, setTex] = useState(() => load('planHtmlTex', '1') === '1')
  const [preset, setPreset] = useState(null) // highlights Iso / Top until the camera is dragged away
  const el = useRef(null)
  const cam = useRef({ yaw: num(load('planHtmlYaw', null), ISO.yaw), tilt: clamp(num(load('planHtmlTilt', null), ISO.tilt), 0, TILT_MAX), zoom: 1, x: 0, y: 0, fit: 1 })
  const flyTimer = useRef(0)

  useEffect(() => {
    let dead = false
    setData(null); setError(null)
    fetch('/api/plan-model/boxes', { credentials: 'include' })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => { if (dead) return; if (ok && d.success) setData(d); else setError(d.error || 'Failed to load the model') })
      .catch((e) => { if (!dead) setError(e.message) })
    return () => { dead = true }
  }, [model?.url, model?.scale, model?.rotationX, model?.rotationY])

  const whole = data ? cut >= data.h - 0.05 : false
  const layout = useMemo(() => (data ? layoutModel(data, { cut: whole ? null : cut }) : null), [data, cut, whole])

  // ── camera ──
  const apply = () => {
    const n = el.current, c = cam.current
    if (!n) return
    n.style.setProperty('--phm-yaw', `${c.yaw}deg`)
    n.style.setProperty('--phm-tilt', `${c.tilt}deg`)
    n.style.setProperty('--phm-zoom', String(c.fit * c.zoom))
    n.style.setProperty('--phm-x', `${c.x}px`)
    n.style.setProperty('--phm-y', `${c.y}px`)
  }
  const persist = () => { save('planHtmlYaw', String(Math.round(cam.current.yaw))); save('planHtmlTilt', String(Math.round(cam.current.tilt))) }
  const fly = (patch) => { // animate to a camera position
    const n = el.current
    if (!n) return
    Object.assign(cam.current, patch)
    n.setAttribute('data-fly', '')
    clearTimeout(flyTimer.current)
    flyTimer.current = setTimeout(() => n.removeAttribute('data-fly'), 700)
    apply(); persist()
  }
  useEffect(() => () => clearTimeout(flyTimer.current), [])

  // fit the model to the viewport (its widest silhouette, so orbiting never clips it)
  useLayoutEffect(() => {
    const n = el.current
    if (!n || !layout) return
    const fit = () => {
      const { width, height } = n.getBoundingClientRect()
      if (!width || !height) return
      const diag = Math.hypot(layout.width, layout.depth)
      const t = (ISO.tilt * Math.PI) / 180
      // the whole model's height, not the cut one — sliding the walls must not rescale the view
      cam.current.fit = 0.86 * Math.min(width / diag, (height - 60) / (diag * Math.cos(t) + data.h * PX_PER_M * Math.sin(t)))
      apply()
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(n)
    return () => ro.disconnect()
  }, [layout?.width, layout?.depth, data?.h]) // eslint-disable-line react-hooks/exhaustive-deps

  // pointer orbit / pan / pinch and wheel zoom
  useEffect(() => {
    const n = el.current
    if (!n) return
    const pts = new Map()
    let pinch = null
    const ui = (t) => t.closest?.('.phm-pin, .phm-bar')
    const down = (e) => {
      if (ui(e.target) || (e.pointerType === 'mouse' && e.button > 1)) return
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 1 })
      try { n.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
      n.removeAttribute('data-fly')
      n.setAttribute('data-dragging', '')
      if (pts.size === 2) {
        const [a, b] = [...pts.values()]
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: cam.current.zoom, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }
      }
    }
    const move = (e) => {
      const p = pts.get(e.pointerId)
      if (!p) return
      const dx = e.clientX - p.x, dy = e.clientY - p.y
      p.x = e.clientX; p.y = e.clientY
      const c = cam.current
      if (pts.size >= 2 && pinch) {
        const [a, b] = [...pts.values()]
        c.zoom = clamp(pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.dist)), 0.5, 5)
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2
        c.x += cx - pinch.cx; c.y += cy - pinch.cy
        pinch.cx = cx; pinch.cy = cy
      } else if (p.pan) {
        c.x += dx; c.y += dy
      } else {
        c.yaw -= dx * 0.35
        c.tilt = clamp(c.tilt - dy * 0.3, 0, TILT_MAX)
        setPreset(null)
      }
      apply()
    }
    const up = (e) => {
      if (!pts.delete(e.pointerId)) return
      if (pts.size < 2) pinch = null
      if (!pts.size) { n.removeAttribute('data-dragging'); persist() }
    }
    const wheel = (e) => {
      if (ui(e.target)) return
      e.preventDefault()
      const c = cam.current
      const next = clamp(c.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), 0.5, 5)
      // zoom toward the pointer: keep what is under it where it is
      const r = n.getBoundingClientRect()
      const px = e.clientX - r.left - r.width / 2 - c.x, py = e.clientY - r.top - r.height / 2 - c.y
      const k = next / c.zoom
      c.x -= px * (k - 1); c.y -= py * (k - 1)
      c.zoom = next
      if (next <= 1.001) { c.x *= 0.6; c.y *= 0.6 } // drifting back to centre as it zooms out
      apply()
    }
    const reset = (e) => { if (!ui(e.target)) { setPreset('iso'); fly({ ...ISO, zoom: 1, x: 0, y: 0 }) } }
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

  // ── devices ──
  const { placed } = useMemo(
    () => (groupOf && layout?.slots.length ? assignDevices(devices, layout.slots, model?.bindings || {}, groupOf) : { placed: [] }),
    [devices, layout?.slots, model?.bindings, groupOf])
  const shown = placed.filter((p) => !filter || p.slot.cat === filter)
  const lightsOn = placed.filter((p) => p.slot.cat === 'Lighting' && isOn(p.device))
  // a pool of light on the floor under every lamp that is on, sized by its level
  const glowKey = lightsOn.map((p) => `${p.slot.id}:${p.device.readings?.level?.value ?? ''}`).join('|')
  const glows = useMemo(() => lightsOn.map(({ slot, device }) => {
    const level = clamp(num(device.readings?.level?.value, 100) / 100, 0.15, 1)
    return { id: slot.id, x: slot.x, y: slot.y, r: PX_PER_M * (1.2 + 1.3 * level), o: 0.45 + 0.5 * level }
  }), [glowKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const pickCut = (v) => { setCut(v); save('planHtmlCut', String(v)) }
  const toggleTex = () => setTex((t) => { save('planHtmlTex', t ? '0' : '1'); return !t })
  const toggleLabels = () => setLabels((l) => { save('planHtmlLabels', l ? '0' : '1'); return !l })
  const turn = (dir) => { setPreset(null); fly({ yaw: Math.round((cam.current.yaw + dir * 90) / 45) * 45 }) }

  return (
    <div className="phm" ref={el} data-labels={labels || undefined} data-tex={tex || undefined}>
      {!layout && <div className="phm-msg">{error || '…'}</div>}
      {layout && (
        <div className="phm-stage">
          <div className="phm-scene" style={{ width: layout.width, height: layout.depth, left: -layout.width / 2, top: -layout.depth / 2 }}>
            <Geometry layout={layout} tex={tex} />
            <Floor layout={layout} glows={glows} tex={tex} />
          </div>
          {/* pins in a scene of their own, painted after the building: sharing its 3D
              context would let a wall slice through a label standing behind it */}
          <div className="phm-scene phm-pins" style={{ width: layout.width, height: layout.depth, left: -layout.width / 2, top: -layout.depth / 2 }}>
            {shown.map(({ slot, device }) => (
              <div key={slot.id} className="phm-pin-pos" style={{ left: slot.x, top: slot.y, '--z': `${slot.z}px` }}>
                <button type="button" className="phm-pin" data-on={isOn(device) || undefined} style={{ '--c': CAT_COLOR[slot.cat] }}
                  title={`${device.label} ${stateText(device, gt)}`} onClick={() => onOpen?.(device.key)}>
                  <i /><span className="phm-pin-text">{device.label}<small>{stateText(device, gt)}</small></span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {layout && placed.length > 0 && (
        <div className="phm-status">
          {lightsOn.length > 0 && <><b>● {lightsOn.length}</b>{gt('phm_lights_on', 'lights on')}<span>·</span></>}
          {shown.length} <span>{gt('phm_devices', 'devices on the model')}</span>
        </div>
      )}
      {layout && <div className="phm-hint">{gt('phm_hint', 'Drag to orbit · Scroll to zoom · Shift-drag to pan · Double-click to reset')}</div>}
      {layout && (
        <div className="phm-bar">
          <div className="phm-seg" role="group" aria-label={gt('plan_cam', 'Camera')}>
            <button type="button" data-active={preset === 'iso' || undefined}
              onClick={() => { setPreset('iso'); fly({ yaw: Math.round((cam.current.yaw - ISO.yaw) / 90) * 90 + ISO.yaw, tilt: ISO.tilt, zoom: 1, x: 0, y: 0 }) }}>
              {gt('plan_cam_iso', 'Iso')}
            </button>
            <button type="button" data-active={preset === 'top' || undefined}
              onClick={() => { setPreset('top'); fly({ yaw: Math.round(cam.current.yaw / 360) * 360, tilt: 0, zoom: 1, x: 0, y: 0 }) }}>
              {gt('plan_cam_top', 'Top')}
            </button>
            <button type="button" className="phm-turn" onClick={() => turn(1)} title={gt('phm_turn_left', 'Turn left')} aria-label={gt('phm_turn_left', 'Turn left')}>↺</button>
            <button type="button" className="phm-turn" onClick={() => turn(-1)} title={gt('phm_turn_right', 'Turn right')} aria-label={gt('phm_turn_right', 'Turn right')}>↻</button>
          </div>
          <div className="phm-seg">
            <label title={gt('phm_walls_hint', 'Slice the walls lower to look into the rooms')}>
              {gt('phm_walls', 'Walls')}
              <input type="range" min="0.4" max={data.h} step="0.05" value={Math.min(cut, data.h)}
                aria-label={gt('phm_walls', 'Walls')} onChange={(e) => pickCut(Number(e.target.value))} />
            </label>
          </div>
          <div className="phm-seg">
            <button type="button" data-active={tex || undefined} onClick={toggleTex}
              title={gt('phm_textures_hint', 'Wood, tile, stone and fabric finishes on the model')}>{gt('textures', 'Textures')}</button>
            <button type="button" data-active={labels || undefined} onClick={toggleLabels}>{gt('phm_labels', 'Labels')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
