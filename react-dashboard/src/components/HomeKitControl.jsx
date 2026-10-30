import { useEffect, useRef, useState } from 'react'
import { gt } from '../i18n'
import { MyIcon } from './Icons'

// Apple-Home-style primary control for the device popup: one tall rounded
// pill in the middle of the sheet. Dimmers and covers get a vertical slider
// (drag anywhere, fill grows from the bottom; a tap without dragging toggles
// when the device also has a switch), plain switches get a tall tap-to-toggle
// pill. Lights add a row of colour-temperature / colour swatches underneath.

const SWITCH_PATHS = ['switch', 'onoff', 'state', 'power', 'on']
const LEVEL_PATHS = ['level', 'dim', 'brightness', 'position', 'cover_position', 'volume']
const COVER_PATHS = new Set(['position', 'cover_position'])

const COVER_ACTIONS = [{ path: 'up' }, { path: 'stop' }, { path: 'my' }, { path: 'down' }]
const ACTION_GLYPH = {
  up:   <svg width="22" height="22" viewBox="0 0 22 22"><path d="M5 14l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  down: <svg width="22" height="22" viewBox="0 0 22 22"><path d="M5 8l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  stop: <svg width="22" height="22" viewBox="0 0 22 22"><rect x="6" y="6" width="10" height="10" rx="2.5" fill="currentColor"/></svg>,
}

const isOnValue = v => v === 1 || v === true || v === 'on'

// Picks the sensors the hero control drives. Returns null when the device has
// nothing that fits (read-only sensors, media players, …) — the popup then
// falls back to HeroState.
export function homeKitModel(device) {
  const sensors = (device?.sensors || []).filter(s => !s.hidden && s.controllable)
  const sw = SWITCH_PATHS.map(p => sensors.find(s => s.path === p
    && s.type !== 'range' && s.type !== 'trigger' && s.type !== 'text' && s.unit !== 'W')).find(Boolean)
  const level = LEVEL_PATHS.map(p => sensors.find(s => s.path === p && s.type === 'range')).find(Boolean)
  if (!sw && !level) return null
  const ct = sensors.find(s => s.path === 'colorTemperature' && (s.type === 'color-temp' || s.type === 'range'))
  const color = sensors.find(s => s.type === 'color')
  // Somfy-style blinds expose level + ▲/▼ rather than a 'position' path (a TV's remote arrows aren't blinds)
  const hasUpDown = device.type !== 'lgwebos' && sensors.some(s => s.path === 'up' || s.path === 'down')
  const cover = hasUpDown || (!!level && (COVER_PATHS.has(level.path)
    || /cover|blind|shutter/i.test(`${level.homekit || ''} ${level.sensorType || ''}`)))
  // momentary ▲ / ■ / My / ▼ commands, drawn as round buttons under the pill
  const actions = cover ? COVER_ACTIONS.map(a => sensors.find(s => s.path === a.path)).filter(Boolean) : []
  return { sw, level, ct, color, cover, actions,
    paths: new Set([sw?.path, level?.path, ct?.path, ...actions.map(a => a.path)].filter(Boolean)) }
}

// Kelvin → approximate sRGB, enough to tint the fill like a real bulb.
function kelvinRgb(k) {
  const t = Math.max(1000, Math.min(12000, k)) / 100
  const r = t <= 66 ? 255 : 329.7 * (t - 60) ** -0.1332
  const g = t <= 66 ? 99.47 * Math.log(t) - 161.1 : 288.1 * (t - 60) ** -0.0755
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5 * Math.log(t - 10) - 305.0
  const c = x => Math.round(Math.max(0, Math.min(255, x)))
  return `rgb(${c(r)}, ${c(g)}, ${c(b)})`
}

// Some integrations report colour temperature in mireds, others in kelvin.
const toKelvin = v => (v > 0 && v < 1000 ? 1e6 / v : v)

export function statusText(model, val) {
  const on = model.sw ? isOnValue(val(model.sw.path)) : true
  const lv = model.level ? val(model.level.path) : undefined
  if (model.cover) {
    if (typeof lv !== 'number') return model.sw ? (on ? gt('open', 'Open') : gt('closed', 'Closed')) : '—'
    if (lv <= 0) return gt('closed', 'Closed')
    if (lv >= 100) return gt('open', 'Open')
    return `${gt('open', 'Open')} · ${Math.round(lv)}%`
  }
  if (!on) return gt('off', 'Off')
  return typeof lv === 'number' && model.level.path !== 'volume'
    ? `${gt('on', 'On')} · ${Math.round(lv)}%` : gt('on', 'On')
}

function VerticalSlider({ sensor, value, on, fill, cover, Icon, onCommit, onToggle }) {
  const min = sensor.min ?? 0, max = sensor.max ?? 100, step = sensor.step || 1
  const [local, setLocal] = useState(value ?? min)
  const [dragging, setDragging] = useState(false)
  const ref = useRef(null)
  const start = useRef(null)
  const tRef = useRef(null)
  useEffect(() => { if (!dragging) setLocal(value ?? min) }, [value])
  useEffect(() => () => clearTimeout(tRef.current), [])

  const set = (raw, immediate) => {
    const v = Number((Math.max(min, Math.min(max, Math.round((raw - min) / step) * step + min))).toFixed(4))
    setLocal(v)
    clearTimeout(tRef.current)
    if (immediate) onCommit(v)
    else tRef.current = setTimeout(() => onCommit(v), 300)
  }
  // Relative drag (like iOS): the value follows finger travel rather than
  // jumping to where the finger first landed.
  const onDown = e => {
    if (e.button > 0) return
    e.preventDefault() // no text-selection / native drag in WebKit
    e.currentTarget.focus({ preventScroll: true })
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = { y: e.clientY, v: on ? local : min, moved: false }
    setDragging(true)
  }
  const onMove = e => {
    if (!dragging || !start.current) return
    const dy = start.current.y - e.clientY
    if (!start.current.moved && Math.abs(dy) < 4) return
    start.current.moved = true
    const h = ref.current.getBoundingClientRect().height
    set(start.current.v + (dy / h) * (max - min))
  }
  const onUp = e => {
    setDragging(false)
    if (start.current && !start.current.moved) {
      // tap: toggle when there's a switch, otherwise jump to the tapped height
      if (onToggle) onToggle()
      else {
        const r = ref.current.getBoundingClientRect()
        set(min + (1 - (e.clientY - r.top) / r.height) * (max - min), true)
      }
    }
    start.current = null
  }
  const onKey = e => {
    const big = (max - min) / 10
    const d = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: big, PageDown: -big }[e.key]
    if (d != null) { e.preventDefault(); set((on ? local : min) + d) }
    else if (e.key === 'Home') { e.preventDefault(); set(min, true) }
    else if (e.key === 'End') { e.preventDefault(); set(max, true) }
    else if ((e.key === 'Enter' || e.key === ' ') && onToggle) { e.preventDefault(); onToggle() }
  }

  const shown = on ? local : min
  const pct = Math.max(0, Math.min(100, ((shown - min) / Math.max(1e-9, max - min)) * 100))
  const lit = pct > 0
  return (
    <div ref={ref} className="hk-pill" data-dragging={dragging || undefined} data-cover={cover || undefined}
      role="slider" tabIndex={0} aria-label={sensor.name || sensor.label || sensor.path}
      aria-valuemin={min} aria-valuemax={max} aria-valuenow={shown} aria-valuetext={`${Math.round(shown)}${sensor.unit || '%'}`}
      onKeyDown={onKey} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
      onPointerCancel={() => { setDragging(false); start.current = null }}
      onDragStart={e => e.preventDefault()}
      style={{ '--hk-fill': fill }}>
      {/* covers fill from the top, like a blind coming down: closed = full */}
      <div className="hk-pill-fill" style={cover
        ? { top: 0, height: `${100 - pct}%` }
        : { bottom: 0, height: `${pct}%` }} />
      <div className="hk-pill-icon" data-lit={(cover ? pct < 100 : lit) || undefined}>
        <Icon size={30} color="currentColor" />
      </div>
    </div>
  )
}

function TogglePill({ on, fill, Icon, onToggle, label }) {
  return (
    <button type="button" className="hk-pill hk-pill-toggle" role="switch" aria-checked={on} aria-label={label}
      onClick={onToggle} style={{ '--hk-fill': fill }}>
      <div className="hk-pill-fill" style={{ bottom: 0, height: on ? '100%' : '0%' }} />
      <div className="hk-pill-icon" data-lit={on || undefined}><Icon size={30} color="currentColor" /></div>
    </button>
  )
}

const CT_PRESETS = [2200, 2700, 3200, 4000, 5000, 6500]
const HUE_PRESETS = [0, 30, 55, 120, 200, 280]

function Swatches({ model, val, cmd }) {
  const { ct, color } = model
  if (!ct && !color) return null
  const ctMin = ct?.min ?? 2200, ctMax = ct?.max ?? 6500
  const mired = ct && (ct.max ?? 0) < 1000 // sensor ranges in mireds
  const ctNow = ct ? val(ct.path) : undefined
  const hueNow = val('hue'), satNow = val('saturation')
  const ctItems = ct ? CT_PRESETS.map(k => {
    const raw = mired ? Math.round(1e6 / k) : k
    return Math.max(Math.min(ctMin, ctMax), Math.min(Math.max(ctMin, ctMax), raw))
  }).filter((v, i, a) => a.indexOf(v) === i) : []
  return (
    <div className="hk-swatches">
      {ctItems.map(v => (
        <button key={`ct${v}`} type="button" title={`${Math.round(toKelvin(v))}K`}
          data-active={typeof ctNow === 'number' && Math.abs(ctNow - v) <= (mired ? 8 : 120) || undefined}
          style={{ background: kelvinRgb(toKelvin(v)) }} onClick={() => cmd(ct.path, v)} />
      ))}
      {color && HUE_PRESETS.map(h => (
        <button key={`h${h}`} type="button" title={`${h}°`}
          data-active={typeof hueNow === 'number' && Math.abs(hueNow * 3.6 - h) < 8 && satNow > 60 || undefined}
          style={{ background: `hsl(${h}, 95%, 55%)` }}
          onClick={() => cmd(color.path, { hue: Math.round(h / 3.6), saturation: 100 })} />
      ))}
    </div>
  )
}

export default function HomeKitControl({ device, model, val, cmd, Icon }) {
  const { sw, level, ct, cover } = model
  const on = sw ? isOnValue(val(sw.path)) : true
  // a blind's slider always shows its real position, open or not
  const showOn = cover || on
  const toggle = sw ? () => cmd(sw.path, on ? 0 : 1) : null

  // Fill colour: the bulb's own colour for lights, cool blue for covers,
  // the neutral iOS fill for everything else.
  let fill = 'var(--hk-fill-default)'
  if (cover) fill = 'var(--hk-fill-cover)'
  else if (model.color && typeof val('hue') === 'number' && val('saturation') > 15) fill = `hsl(${val('hue') * 3.6}, ${Math.min(100, val('saturation'))}%, 62%)`
  else if (ct && typeof val(ct.path) === 'number') fill = kelvinRgb(toKelvin(val(ct.path)))
  else if (level && level.path !== 'volume') fill = 'var(--hk-fill-light)'

  return (
    <div className="hk-control">
      {level ? (
        <VerticalSlider sensor={level} value={typeof val(level.path) === 'number' ? val(level.path) : undefined}
          on={showOn} fill={fill} cover={cover} Icon={Icon} onToggle={toggle}
          onCommit={v => {
            cmd(level.path, v)
            // dragging a dimmer up from off turns it on, down to 0 turns it off — as in Apple Home
            if (sw && !cover) {
              if (v > (level.min ?? 0) && !on) cmd(sw.path, 1)
              else if (v <= (level.min ?? 0) && on) cmd(sw.path, 0)
            }
          }} />
      ) : (
        <TogglePill on={on} fill={fill} Icon={Icon} onToggle={toggle} label={device.label} />
      )}
      {on && !cover && <Swatches model={model} val={val} cmd={cmd} />}
      {model.actions.length > 0 && (
        <div className="hk-actions">
          {model.actions.map(a => (
            <button key={a.path} type="button" title={a.name || a.label || a.path} aria-label={a.name || a.label || a.path}
              onClick={() => cmd(a.path, 1)}>
              {ACTION_GLYPH[a.path] || <MyIcon size={20} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
