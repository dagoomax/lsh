import { useEffect, useRef, useState } from 'react'
import { gt } from '../i18n'

// ── HomeKit-style device-popup controls ─────────────────────────────────────
// Tall vertical pills (brightness / colour temp / volume / position), a tall
// vertical switch for plain on/off devices, and round "Control Center" buttons
// for secondary actions. Visuals live in global.css under `.hk-*`.

const ICON = {
  sun: (
    <><circle cx="12" cy="12" r="4.2" fill="currentColor" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map(a => (
        <line key={a} x1="12" y1="2.6" x2="12" y2="5.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          transform={`rotate(${a} 12 12)`} />
      ))}</>
  ),
  temp: (
    <><path d="M10 4.5a2 2 0 0 1 4 0v8.6a4 4 0 1 1-4 0z" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="16.4" r="1.9" fill="currentColor" /></>
  ),
  volume: (
    <><path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></>
  ),
  blind: (
    <><rect x="4" y="3.5" width="16" height="2.4" rx="1.2" fill="currentColor" />
      {[8, 11.5, 15].map(y => <rect key={y} x="5" y={y} width="14" height="2" rx="1" fill="currentColor" opacity="0.85" />)}
      <line x1="12" y1="17" x2="12" y2="20.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></>
  ),
  fan: (
    <><circle cx="12" cy="12" r="2" fill="currentColor" />
      {[0, 120, 240].map(a => (
        <path key={a} d="M12 10c-1-3 0-6.5 3-6.5 2.4 0 2.6 3.3-.6 5.6" fill="currentColor" transform={`rotate(${a} 12 12)`} />
      ))}</>
  ),
  power: (
    <><path d="M12 3.5v8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M7.2 6.6a7 7 0 1 0 9.6 0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></>
  ),
  play: <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />,
  dot: <circle cx="12" cy="12" r="5" fill="currentColor" />,
}

export function Glyph({ name, size = 24 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">{ICON[name] || ICON.dot}</svg>
}

// Pick a glyph from what the sensor is, not just its path.
export function sensorGlyph(s) {
  const p = String(s.path || '').toLowerCase()
  const n = String(s.name || s.label || '').toLowerCase()
  if (s.type === 'color-temp' || /colou?r ?temp/.test(n)) return 'temp'
  if (/volume/.test(p + n)) return 'volume'
  if (/cover|position|blind|shade|tilt|slat|roller|curtain/.test(p + n)) return 'blind'
  if (/fan|speed/.test(p + n)) return 'fan'
  if (/dim|level|bright/.test(p + n)) return 'sun'
  if (s.type === 'trigger') return 'play'
  return s.type === 'range' ? 'sun' : 'power'
}

const fmt = (v, unit) => `${Number.isInteger(v) ? v : Number(v).toFixed(1)}${unit === 'K' ? ' K' : unit || ''}`

// Tall vertical slider. Dragging is relative (like iOS): grab anywhere and
// move — the value follows the finger's travel, it doesn't jump to where you
// touched. A tap without movement does jump. Commits 350 ms after the last
// change; arrow/Page/Home/End keys work too.
//   kind 'fill' — white fill rising from the bottom (brightness, volume, …)
//   kind 'temp' — warm→cool gradient track with a white position bar
export function HKSlider({ sensor, value, onCommit, label, kind = 'fill', glyph }) {
  const min = sensor.min ?? 0, max = sensor.max ?? 100, step = sensor.step || 1
  const [local, setLocal] = useState(value ?? min)
  const [dragging, setDragging] = useState(false)
  const tRef = useRef(null)
  const trackRef = useRef(null)
  const drag = useRef(null)
  useEffect(() => { if (!dragging) setLocal(value ?? min) }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(tRef.current), [])

  const span = Math.max(1e-9, max - min)
  const frac = Math.max(0, Math.min(1, (local - min) / span))
  const set = (raw) => {
    const v = Math.max(min, Math.min(max, Math.round((raw - min) / step) * step + min))
    const clean = Number(v.toFixed(4))
    setLocal(clean)
    clearTimeout(tRef.current); tRef.current = setTimeout(() => onCommit(clean), 350)
  }
  const absolute = (e) => {
    const r = trackRef.current.getBoundingClientRect()
    set(min + Math.max(0, Math.min(1, (r.bottom - e.clientY) / r.height)) * span)
  }
  const onKey = (e) => {
    const big = span / 10
    const d = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: big, PageDown: -big }[e.key]
    if (d != null) { e.preventDefault(); set(local + d) }
    else if (e.key === 'Home') { e.preventDefault(); set(min) }
    else if (e.key === 'End') { e.preventDefault(); set(max) }
  }
  const unit = sensor.unit || ''
  const shown = kind === 'fill' && unit === '' && min === 0 && max === 100 ? `${Math.round(local)}%` : fmt(local, unit)

  return (
    <div className="hk-item">
      <div className="hk-value">{shown}</div>
      <div ref={trackRef} className="hk-pill" data-kind={kind} data-dragging={dragging || undefined}
        role="slider" tabIndex={0} aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={local}
        aria-valuetext={shown} onKeyDown={onKey}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { y: e.clientY, v: local, moved: false, h: e.currentTarget.getBoundingClientRect().height }
          setDragging(true)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const dy = d.y - e.clientY
          if (!d.moved && Math.abs(dy) < 4) return
          d.moved = true
          set(d.v + (dy / d.h) * span)
        }}
        onPointerUp={(e) => { if (drag.current && !drag.current.moved) absolute(e); drag.current = null; setDragging(false) }}
        onPointerCancel={() => { drag.current = null; setDragging(false) }}>
        {kind === 'fill'
          ? <div className="hk-fill" style={{ height: `${frac * 100}%` }} />
          : <div className="hk-thumb" style={{ bottom: `calc(${frac} * (100% - 22px) + 6px)` }} />}
        <span className="hk-glyph" data-covered={kind === 'fill' && frac > 0.12 ? true : undefined}>
          <Glyph name={glyph || sensorGlyph(sensor)} size={26} />
        </span>
      </div>
      <div className="hk-label">{label}</div>
    </div>
  )
}

// Tall vertical on/off switch — the HomeKit popup for a plain switch/outlet.
// Tap anywhere toggles; swiping up turns on, down turns off.
export function HKSwitch({ on, onChange, label, glyph = 'power' }) {
  const start = useRef(null)
  return (
    <div className="hk-item">
      <div className="hk-value">{on ? gt('on', 'On') : gt('off', 'Off')}</div>
      <button type="button" role="switch" aria-checked={on} aria-label={label}
        className="hk-pill hk-switch" data-on={on || undefined}
        onPointerDown={(e) => { start.current = e.clientY }}
        onPointerUp={(e) => {
          const dy = start.current == null ? 0 : start.current - e.clientY
          start.current = null
          if (dy > 24) { if (!on) onChange(true) }
          else if (dy < -24) { if (on) onChange(false) }
          else onChange(!on)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(!on) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); if (!on) onChange(true) }
          else if (e.key === 'ArrowDown') { e.preventDefault(); if (on) onChange(false) }
        }}>
        <span className="hk-knob"><Glyph name={glyph} size={28} /></span>
      </button>
      <div className="hk-label">{label}</div>
    </div>
  )
}

// Round Control-Center button with a caption — secondary toggles, run-scene
// triggers, power for dimmable lights, favourite position, …
export function HKRound({ active, onClick, label, children, title }) {
  return (
    <div className="hk-round-wrap">
      <button type="button" className="hk-round" data-active={active || undefined}
        aria-pressed={active == null ? undefined : !!active} aria-label={label} title={title || label} onClick={onClick}>
        {children}
      </button>
      <span className="hk-round-label">{label}</span>
    </div>
  )
}

// One-tap preset chips under a staged slider (sensor.presets: [{ value, label }]).
export function HKPresets({ sensor, value, onPick }) {
  if (!sensor.presets?.length) return null
  return (
    <div className="hk-presets" role="group" aria-label={sensor.name || sensor.label || sensor.path}>
      {sensor.presets.map(p => (
        <button key={p.value} type="button" data-active={value === p.value || undefined} onClick={() => onPick(p.value)}>
          {p.label}
        </button>
      ))}
    </div>
  )
}
