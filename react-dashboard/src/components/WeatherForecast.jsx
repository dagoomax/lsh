import { useEffect, useState } from 'react'
import { weatherText } from '../weatherConditions'
import { motion, AnimatePresence } from 'framer-motion'
import { gt, getLang } from '../i18n'
import { weatherIconFor, weatherSceneFor, moonPhaseFor } from '../weatherIcons'
import { DropletIcon } from './Icons'

// 5-day forecast strip (OpenWeatherMap's free tier caps at 5 days — see the
// honesty note in openweather-client.js for why this isn't 7). Self-fetching
// and self-hiding: renders nothing until /api/openweather/forecast actually
// has data, so DeviceList can mount it unconditionally.
const POLL_MS = 10 * 60 * 1000
const WIND_DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
const compass = (deg) => deg == null ? null : WIND_DIRS[Math.round(deg / 22.5) % 16]

function useForecast() {
  const [days, setDays] = useState([])
  useEffect(() => {
    let stop = false
    const load = () => {
      fetch('/api/openweather/forecast', { credentials: 'same-origin' })
        .then(r => r.ok ? r.json() : { data: [] })
        .then(j => { if (!stop) setDays(j?.data || []) })
        .catch(() => {})
    }
    load()
    const iv = setInterval(load, POLL_MS)
    return () => { stop = true; clearInterval(iv) }
  }, [])
  return days
}

function dayLabel(dateStr, index) {
  if (index === 0) return gt('weather_today', 'Today')
  if (index === 1) return gt('weather_tomorrow', 'Tomorrow')
  const d = new Date(`${dateStr}T12:00:00`)
  return d.toLocaleDateString(getLang(), { weekday: 'short' })
}

function fullDayLabel(dateStr, index) {
  const d = new Date(`${dateStr}T12:00:00`)
  const weekday = d.toLocaleDateString(getLang(), { weekday: 'long', month: 'long', day: 'numeric' })
  if (index === 0) return `${gt('weather_today', 'Today')} · ${weekday}`
  if (index === 1) return `${gt('weather_tomorrow', 'Tomorrow')} · ${weekday}`
  return weekday
}

function DayCard({ day, index, onOpen }) {
  const { Icon: DayIcon, anim: dayAnim } = weatherIconFor(day.icon)
  return (
    <button
      onClick={() => onOpen(day, index)}
      className="detail-card"
      style={{
        flex: '1 1 0', minWidth: 84, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        padding: '14px 8px', transition: 'border-color 0.15s, transform 0.15s',
        cursor: 'pointer', font: 'inherit', color: 'inherit', appearance: 'none',
      }}
      onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.96)' }}
      onMouseUp={e => { e.currentTarget.style.transform = 'none' }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'none' }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)' }}>
        {dayLabel(day.date, index)}
      </div>
      <div className={dayAnim} style={{ lineHeight: 1 }}><DayIcon size={34}/></div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
          {day.tempMax != null ? Math.round(day.tempMax) : '—'}°
        </span>
        <span style={{ fontSize: 13, color: 'var(--text3)', fontVariantNumeric: 'tabular-nums' }}>
          {day.tempMin != null ? Math.round(day.tempMin) : '—'}°
        </span>
      </div>
      {day.pop > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600,
          color: 'var(--accent-lt)', fontVariantNumeric: 'tabular-nums',
        }}>
          <DropletIcon size={11} color="var(--accent-lt)"/> {day.pop}%
        </div>
      )}
    </button>
  )
}

// Realistic phase-shaded moon disc: a lit disc with a couple of soft maria
// (mare) patches, overlaid by a same-size dark disc shifted horizontally so
// the visible sliver matches the actual illumination fraction — the classic
// two-circle technique, driven by real astronomical math (moonPhaseFor).
function MoonDisc({ phase, size = 40 }) {
  const illum = (1 - Math.cos(2 * Math.PI * phase)) / 2
  const dir = phase <= 0.5 ? -1 : 1
  const shiftPct = illum * 2 * dir * 50 // -100%..100% of the disc's own width
  return (
    <div style={{
      position: 'relative', width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
      background: 'radial-gradient(circle at 35% 30%, #f7f4ec 0%, #d7dbe2 55%, #a9afba 85%)',
      boxShadow: 'inset -3px -2px 6px rgba(0,0,0,0.35), 0 0 16px 3px rgba(200,212,235,0.35)',
    }}>
      <div style={{ position: 'absolute', width: '26%', height: '20%', top: '24%', left: '20%', borderRadius: '50%', background: 'rgba(110,118,135,0.35)', filter: 'blur(1px)' }} />
      <div style={{ position: 'absolute', width: '16%', height: '14%', top: '54%', left: '58%', borderRadius: '50%', background: 'rgba(110,118,135,0.3)', filter: 'blur(1px)' }} />
      <div style={{
        position: 'absolute', inset: 0, borderRadius: '50%', background: '#0b1020',
        transform: `translateX(${shiftPct}%)`, transition: 'transform 0.4s ease',
      }} />
    </div>
  )
}

function Stars({ count = 18, opacity = 1 }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="wx-scene-star" style={{
          top: `${(i * 37) % 90}%`, left: `${(i * 61) % 100}%`,
          width: 1 + (i % 3) * 0.6, height: 1 + (i % 3) * 0.6, opacity,
          animationDuration: `${2 + (i % 4)}s`, animationDelay: `${-(i % 5) * 0.6}s`,
        }} />
      ))}
    </>
  )
}

// The full-bleed atmosphere color behind every scene — dark and desaturated
// enough to stay legible under the popup's own text, but enough to make the
// card actually feel like "inside a sunny/rainy/snowy sky" rather than a
// dark app panel with some icons floating on it.
const MOOD = {
  sun:      'linear-gradient(180deg, rgba(18,42,78,0.5) 0%, rgba(55,100,155,0.28) 45%, rgba(255,170,90,0.18) 100%)',
  partly:   'linear-gradient(180deg, rgba(18,42,78,0.46) 0%, rgba(65,95,135,0.26) 50%, rgba(255,190,110,0.12) 100%)',
  cloud:    'linear-gradient(180deg, rgba(26,32,46,0.5) 0%, rgba(58,68,88,0.32) 55%, rgba(88,98,116,0.18) 100%)',
  rain:     'linear-gradient(180deg, rgba(8,12,24,0.6) 0%, rgba(18,26,44,0.42) 50%, rgba(30,42,64,0.26) 100%)',
  storm:    'linear-gradient(180deg, rgba(8,12,24,0.62) 0%, rgba(28,20,46,0.44) 50%, rgba(46,34,68,0.28) 100%)',
  snow:     'linear-gradient(180deg, rgba(16,26,44,0.5) 0%, rgba(58,78,102,0.3) 55%, rgba(180,200,220,0.18) 100%)',
  fog:      'linear-gradient(180deg, rgba(38,44,54,0.45) 0%, rgba(68,74,84,0.3) 55%, rgba(108,114,122,0.16) 100%)',
  night:    'linear-gradient(180deg, rgba(2,4,10,0.62) 0%, rgba(9,15,30,0.42) 55%, rgba(19,27,48,0.24) 100%)',
}
const Mood = ({ tone }) => <div className="wx-scene-mood" style={{ background: MOOD[tone] }} />

// Full-bleed animated backdrop for the day-detail popup, picked by condition
// (and, for clear/partly/cloudy scenes, by whether it's actually day or
// night). Deterministic (index-seeded, not Math.random) so it doesn't
// reshuffle if the popup re-renders while open.
function WeatherScene({ icon, isDay = true, moonPhase = 0 }) {
  const { scene } = weatherSceneFor(icon)
  const night = isDay === false

  if (scene === 'sun' || scene === 'partly' || scene === 'cloud') {
    if (night) {
      return (
        <div className="wx-scene">
          <Mood tone="night" />
          <div className="wx-scene-night-sky" />
          <Stars count={scene === 'cloud' ? 16 : 24} />
          <div style={{ position: 'absolute', top: '9%', right: '11%' }}>
            <MoonDisc phase={moonPhase} size={scene === 'sun' ? 72 : 60} />
          </div>
          {scene !== 'sun' && [0, 1, scene === 'cloud' ? 2 : null].filter(i => i != null).map(i => (
            <div key={i} className="wx-scene-cloud" style={{
              top: `${10 + i * 32}%`, left: `${-16 + i * 15}%`,
              width: 150 + i * 65, height: 56 + i * 22, opacity: 0.55 - i * 0.08,
              filter: `blur(${5 + i * 2}px)`,
              animationDuration: `${24 + i * 9}s`, animationDelay: `${-i * 8}s`,
            }} />
          ))}
        </div>
      )
    }
    if (scene === 'sun' || scene === 'partly') {
      return (
        <div className="wx-scene">
          <Mood tone={scene} />
          <div className="wx-scene-sky" style={{ opacity: scene === 'sun' ? 1 : 0.6 }} />
          <div className="wx-scene-sun-wrap" style={{ opacity: scene === 'sun' ? 1 : 0.65 }}>
            <div className="wx-scene-sun-rays" />
            <div className="wx-scene-sun-rays-2" />
            <div className="wx-scene-sun-disc" />
          </div>
          <div className="wx-scene-flare" style={{ width: 34, height: 34, top: '18%', right: '42%', animationDuration: '5.6s' }} />
          <div className="wx-scene-flare" style={{ width: 20, height: 20, top: '32%', right: '33%', animationDuration: '4.6s', animationDelay: '-1.6s' }} />
          <div className="wx-scene-flare" style={{ width: 11, height: 11, top: '44%', right: '26%', animationDuration: '3.8s', animationDelay: '-2.4s' }} />
          {scene === 'partly' && [0, 1].map(i => (
            <div key={i} className="wx-scene-cloud" style={{
              top: `${28 + i * 34}%`, left: `${-12 + i * 18}%`,
              width: 160 + i * 60, height: 60 + i * 20, opacity: 0.85 - i * 0.15,
              animationDuration: `${26 + i * 10}s`, animationDelay: `${-i * 9}s`,
            }} />
          ))}
        </div>
      )
    }
    // scene === 'cloud', daytime — four depth layers (far/blurrier & slow at
    // the back, near/crisper & faster up front) instead of one flat row.
    return (
      <div className="wx-scene">
        <Mood tone="cloud" />
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="wx-scene-cloud" style={{
            top: `${2 + i * 24}%`, left: `${-20 + i * 12}%`,
            width: 130 + i * 55, height: 48 + i * 22, opacity: 0.92 - i * 0.14,
            filter: `blur(${3 + (3 - i) * 2}px)`,
            animationDuration: `${18 + i * 8}s`, animationDelay: `${-i * 6}s`,
          }} />
        ))}
      </div>
    )
  }
  if (scene === 'rain' || scene === 'storm') {
    const drops = Array.from({ length: 38 }, (_, i) => i)
    const puddles = Array.from({ length: 7 }, (_, i) => i)
    return (
      <div className="wx-scene">
        <Mood tone={scene} />
        {night && <Stars count={8} opacity={0.5} />}
        <div className="wx-scene-overcast" />
        {[0, 1].map(i => (
          <div key={i} className="wx-scene-cloud" style={{
            top: `${-14 + i * 6}%`, left: `${-20 + i * 30}%`,
            width: `${150 - i * 20}%`, height: 90 - i * 15, opacity: 0.75 - i * 0.25,
            filter: `blur(${5 + i * 3}px)`,
            animationDuration: `${30 + i * 10}s`,
          }} />
        ))}
        <div className="wx-scene-rain-layer">
          {drops.map(i => (
            <div key={i} className="wx-scene-rain-drop" style={{
              left: `${(i * 113) % 130 - 15}%`, height: `${14 + (i % 5) * 5}%`,
              width: i % 4 === 0 ? 2.4 : 1.6,
              opacity: 0.5 + (i % 3) * 0.2,
              animationDuration: `${0.45 + (i % 5) * 0.12}s`, animationDelay: `${-(i % 9) * 0.22}s`,
            }} />
          ))}
        </div>
        <div className="wx-scene-ground-wet" />
        {puddles.map(i => (
          <div key={i} className="wx-scene-puddle" style={{
            left: `${4 + i * 14}%`, width: `${16 + (i % 3) * 6}px`,
            animationDuration: `${1.5 + (i % 3) * 0.4}s`, animationDelay: `${-(i % 5) * 0.35}s`,
          }} />
        ))}
        {scene === 'storm' && <div className="wx-scene-flash" />}
      </div>
    )
  }
  if (scene === 'snow') {
    const flakes = Array.from({ length: 28 }, (_, i) => i)
    return (
      <div className="wx-scene">
        <Mood tone="snow" />
        {night && <Stars count={14} opacity={0.6} />}
        {flakes.map(i => (
          <div key={i} className="wx-scene-snowflake" style={{
            left: `${(i * 41) % 100}%`, width: 2.5 + (i % 4) * 0.9, height: 2.5 + (i % 4) * 0.9,
            opacity: 0.45 + (i % 4) * 0.14,
            animationDuration: `${5 + (i % 6)}s`, animationDelay: `${-(i % 7) * 0.8}s`,
          }} />
        ))}
        <div className="wx-scene-ground-snow" />
      </div>
    )
  }
  if (scene === 'fog') {
    return (
      <div className="wx-scene">
        <Mood tone="fog" />
        {[0, 1, 2].map(i => (
          <div key={i} className="wx-scene-fog-band" style={{
            top: `${16 + i * 28}%`, animationDuration: `${16 + i * 6}s`, animationDelay: `${-i * 5}s`,
          }} />
        ))}
      </div>
    )
  }
  return null
}

// ── Day popup (Homey / iOS-weather style) ───────────────────────────────────
const round = (n) => (n == null ? '—' : Math.round(n))
// Location-local clock time for a UTC epoch (seconds) + the city's offset.
const localTime = (epoch, tz = 0) => epoch == null ? null : new Date((epoch + tz) * 1000).toISOString().slice(11, 16)

function WxTile({ icon, label, children, wide = false, delay = 0 }) {
  return (
    <motion.div className="wx-tile" style={wide ? { gridColumn: '1 / -1' } : undefined}
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.25 }}>
      <div className="wx-tile-label">{icon}{label}</div>
      {children}
    </motion.div>
  )
}

function Meter({ pct, color = 'var(--accent)' }) {
  return (
    <div className="wx-meter"><div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} /></div>
  )
}

// Wind compass: ticks + cardinal letters, arrow points where the wind blows
// TO (meteorological degrees are where it comes FROM, hence +180).
function Compass({ deg, size = 84 }) {
  const c = size / 2, r = c - 6
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="wx-compass">
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--white-14)" strokeWidth="1.5" />
      {Array.from({ length: 24 }, (_, i) => {
        const a = (i * 15) * Math.PI / 180, long = i % 6 === 0
        return <line key={i} x1={c + Math.sin(a) * (r - (long ? 7 : 4))} y1={c - Math.cos(a) * (r - (long ? 7 : 4))}
          x2={c + Math.sin(a) * r} y2={c - Math.cos(a) * r} stroke="var(--text3)" strokeWidth={long ? 1.6 : 1} />
      })}
      {['N', 'E', 'S', 'W'].map((l, i) => {
        const a = i * Math.PI / 2
        return <text key={l} x={c + Math.sin(a) * (r - 15)} y={c - Math.cos(a) * (r - 15) + 3.5}
          textAnchor="middle" fontSize="10" fontWeight="700" fill={l === 'N' ? 'var(--red)' : 'var(--text2)'}>{l}</text>
      })}
      {deg != null && (
        <g style={{ transform: `rotate(${deg + 180}deg)`, transformOrigin: `${c}px ${c}px`, transition: 'transform .6s cubic-bezier(.34,1.3,.64,1)' }}>
          <line x1={c} y1={c + r - 20} x2={c} y2={c - r + 22} stroke="var(--text)" strokeWidth="2.5" strokeLinecap="round" />
          <path d={`M ${c} ${c - r + 14} l -6 10 h 12 z`} fill="var(--text)" />
          <circle cx={c} cy={c} r="3.5" fill="var(--text)" />
        </g>
      )}
    </svg>
  )
}

// Pressure gauge: 960–1060 hPa over a 240° arc, needle at the reading.
function PressureGauge({ hpa, size = 84 }) {
  const c = size / 2, r = c - 8
  const lo = 960, hi = 1060, sweep = 240, start = -120
  const t = hpa == null ? 0.5 : Math.max(0, Math.min(1, (hpa - lo) / (hi - lo)))
  const pt = (deg, rad = r) => [c + Math.sin(deg * Math.PI / 180) * rad, c - Math.cos(deg * Math.PI / 180) * rad]
  const [x1, y1] = pt(start), [x2, y2] = pt(start + sweep), [xv, yv] = pt(start + sweep * t)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <path d={`M ${x1} ${y1} A ${r} ${r} 0 1 1 ${x2} ${y2}`} fill="none" stroke="var(--white-14)" strokeWidth="6" strokeLinecap="round" />
      <path d={`M ${x1} ${y1} A ${r} ${r} 0 ${sweep * t > 180 ? 1 : 0} 1 ${xv} ${yv}`} fill="none" stroke="var(--accent)" strokeWidth="6" strokeLinecap="round" />
      <circle cx={xv} cy={yv} r="5" fill="#fff" stroke="var(--accent)" strokeWidth="2" />
      <text x={c} y={c + 4} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--text2)">hPa</text>
    </svg>
  )
}

// Sun arc for today: sunrise → sunset along a half-ellipse, sun dot at now.
function SunArc({ sunrise, sunset, tz }) {
  const W = 200, H = 70, now = Date.now() / 1000
  const t = Math.max(0, Math.min(1, (now - sunrise) / Math.max(1, sunset - sunrise)))
  const up = now >= sunrise && now <= sunset
  const x = 10 + t * (W - 20), y = H - 8 - Math.sin(t * Math.PI) * (H - 20)
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', maxWidth: 260 }}>
        <line x1="4" y1={H - 8} x2={W - 4} y2={H - 8} stroke="var(--white-14)" strokeWidth="1.5" />
        <path d={`M 10 ${H - 8} Q ${W / 2} ${-(H - 30)} ${W - 10} ${H - 8}`} fill="none" stroke="var(--white-18)" strokeWidth="2" strokeDasharray="3 5" />
        {up && <circle cx={x} cy={y} r="7" fill="var(--gold)" />}
      </svg>
      <div className="wx-sun-times">
        <span>↑ {localTime(sunrise, tz)}</span><span>↓ {localTime(sunset, tz)}</span>
      </div>
    </div>
  )
}

// Hourly strip: 3-hour steps with a smooth temperature curve drawn above.
function HourlyStrip({ hours, nowFirst = false }) {
  if (!hours?.length) return null
  const COL = 60, H = 44
  const temps = hours.map(h => h.temp).filter(n => n != null)
  const lo = Math.min(...temps), hi = Math.max(...temps)
  const y = (t) => (hi === lo ? H / 2 : 6 + (1 - (t - lo) / (hi - lo)) * (H - 12))
  const pts = hours.map((h, i) => [i * COL + COL / 2, y(h.temp ?? lo)])
  const d = pts.reduce((acc, [px, py], i) => {
    if (!i) return `M ${px} ${py}`
    const [qx, qy] = pts[i - 1], mx = (qx + px) / 2
    return `${acc} C ${mx} ${qy}, ${mx} ${py}, ${px} ${py}`
  }, '')
  const w = hours.length * COL
  return (
    <div className="wx-hourly">
      <div style={{ position: 'relative', width: w, minWidth: '100%' }}>
        <svg width={w} height={H} style={{ display: 'block' }}>
          <path d={`${d} L ${pts.at(-1)[0]} ${H} L ${pts[0][0]} ${H} Z`} fill="color-mix(in srgb, var(--orange) 14%, transparent)" />
          <path d={d} fill="none" stroke="var(--orange)" strokeWidth="2.5" strokeLinecap="round" />
          {pts.map(([px, py], i) => <circle key={i} cx={px} cy={py} r="3" fill="var(--orange)" />)}
        </svg>
        <div style={{ display: 'flex' }}>
          {hours.map((h, i) => {
            const { Icon } = weatherIconFor(h.icon)
            return (
              <div key={`${i}-${h.time}`} className="wx-hour" style={{ width: COL }}>
                <span className="wx-hour-temp">{round(h.temp)}°</span>
                <Icon size={24} />
                <span className="wx-hour-pop" style={{ visibility: h.pop > 0 ? 'visible' : 'hidden' }}>{h.pop}%</span>
                <span className="wx-hour-time" style={nowFirst && i === 0 ? { color: 'var(--text)', fontWeight: 700 } : undefined}>
                  {nowFirst && i === 0 ? gt('weather_now', 'Now') : h.time}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function DayDetailModal({ days, index: startIndex, onClose }) {
  const [index, setIndex] = useState(startIndex)
  useEffect(() => {
    const key = e => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') setIndex(i => Math.min(days.length - 1, i + 1))
      else if (e.key === 'ArrowLeft') setIndex(i => Math.max(0, i - 1))
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose, days.length])

  const day = days[index]
  if (!day) return null
  // Today usually has only a few 3-hour steps left — continue into the
  // following days so the strip always covers roughly the next 24 hours.
  const hours = index === 0
    ? days.slice(0, 3).flatMap(d => d.hours || []).slice(0, 9)
    : day.hours || []
  const dir = compass(day.windDeg)
  const { Icon: DetailIcon, anim: detailAnim } = weatherIconFor(day.icon)
  const isDay = day.isDay !== false
  const moon = moonPhaseFor(new Date(`${day.date}T12:00:00`))
  // Week-wide temperature scale so each day's low–high bar is comparable.
  const weekLo = Math.min(...days.map(d => d.tempMin ?? Infinity))
  const weekHi = Math.max(...days.map(d => d.tempMax ?? -Infinity))
  const span = Math.max(1, weekHi - weekLo)
  const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
  const cardMotion = isMobile
    ? { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' }, transition: { type: 'spring', stiffness: 360, damping: 34 } }
    : { initial: { opacity: 0, scale: 0.9, y: 24 }, animate: { opacity: 1, scale: 1, y: 0 }, exit: { opacity: 0, scale: 0.94, y: 12 }, transition: { type: 'spring', stiffness: 360, damping: 30 } }

  return (
    <AnimatePresence>
      <motion.div key="wx-backdrop" className="dm-backdrop"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
        }}>
        <motion.div key="wx-card" {...cardMotion}
          onClick={e => e.stopPropagation()}
          className="device-modal-glow dm-card"
          style={{
            position: 'relative', width: 'min(clamp(420px, 52vw, 720px), 100%)', maxHeight: '90vh',
            display: 'flex', flexDirection: 'column',
            background: 'var(--modal-grad)', borderRadius: 'var(--sheet-radius)', overflow: 'hidden',
          }}>
          <div className="dm-handle" aria-hidden="true" />

          {/* condition-specific living backdrop behind the hero only */}
          <div className="wx-hero-scene"><WeatherScene icon={day.icon} isDay={isDay} moonPhase={moon.phase} /></div>

          {/* day tabs (scrolling) + close button (fixed at the end) */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, padding: '18px 16px 8px 0', flexShrink: 0 }}>
          <div className="wx-days">
            {days.map((d, i) => {
              const { Icon } = weatherIconFor(d.icon)
              return (
                <button key={d.date} className="wx-day-tab" data-active={i === index || undefined} onClick={() => setIndex(i)}>
                  <span>{dayLabel(d.date, i)}</span>
                  <Icon size={20} />
                  <b>{round(d.tempMax)}°</b>
                </button>
              )
            })}
          </div>
            <button onClick={onClose} title={gt('close', 'Close')} aria-label={gt('close', 'Close')} className="icon-btn" style={{ flexShrink: 0 }}>✕</button>
          </div>

          <div style={{ position: 'relative', overflowY: 'auto', padding: '0 20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* hero */}
            <motion.div key={day.date} className="wx-hero"
              initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.22 }}>
              <div style={{ minWidth: 0 }}>
                <div className="wx-hero-date">{fullDayLabel(day.date, index)}</div>
                <div className="wx-hero-temp">{round(day.tempMax)}°</div>
                <div className="wx-hero-cond">{weatherText(day.condition) || '—'}</div>
                <div className="wx-hero-range">
                  <span>{gt('weather_low', 'L')} {round(day.tempMin)}°</span>
                  <div className="wx-range-bar">
                    <div style={{
                      left: `${((day.tempMin - weekLo) / span) * 100}%`,
                      width: `${((day.tempMax - day.tempMin) / span) * 100}%`,
                    }} />
                  </div>
                  <span>{gt('weather_high', 'H')} {round(day.tempMax)}°</span>
                </div>
                {day.feelsLike != null && (
                  <div className="wx-hero-feels">{gt('weather_feels_like', 'Feels like')} {round(day.feelsLike)}°</div>
                )}
              </div>
              <motion.div className={detailAnim} style={{ lineHeight: 1, flexShrink: 0 }}
                initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 260, damping: 16, delay: 0.05 }}>
                <DetailIcon size={96} />
              </motion.div>
            </motion.div>

            {/* hourly */}
            {hours.length > 0 && (
              <div className="wx-section">
                <div className="wx-tile-label">{gt('weather_hourly', 'Hourly')}</div>
                <HourlyStrip hours={hours} nowFirst={index === 0} />
              </div>
            )}

            {/* tiles */}
            <div className="wx-grid">
              <WxTile delay={0.04} label={gt('weather_wind', 'Wind')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Compass deg={day.windDeg} />
                  <div>
                    <div className="wx-big">{day.windSpeed != null ? day.windSpeed.toFixed(1) : '—'}<small> {day.windUnit || 'm/s'}</small></div>
                    {dir && <div className="wx-sub">{dir} · {round(day.windDeg)}°</div>}
                    {day.gustMax != null && <div className="wx-sub">{gt('weather_gusts', 'Gusts')} {day.gustMax.toFixed(1)} {day.windUnit || 'm/s'}</div>}
                  </div>
                </div>
              </WxTile>
              <WxTile delay={0.08} label={gt('weather_precip', 'Precipitation')}>
                <div className="wx-big">{day.pop ?? 0}<small>%</small></div>
                <Meter pct={day.pop ?? 0} color="var(--blue)" />
                <div className="wx-sub">{day.rainMm > 0 ? `${day.rainMm} mm ${gt('weather_expected', 'expected')}` : gt('weather_no_rain', 'No rain expected')}</div>
              </WxTile>
              <WxTile delay={0.12} label={gt('weather_humidity', 'Humidity')}>
                <div className="wx-big">{day.humidity ?? '—'}<small>%</small></div>
                <Meter pct={day.humidity ?? 0} color="var(--teal)" />
              </WxTile>
              <WxTile delay={0.16} label={gt('weather_pressure', 'Pressure')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <PressureGauge hpa={day.pressure} />
                  <div className="wx-big">{day.pressure ?? '—'}</div>
                </div>
              </WxTile>
              <WxTile delay={0.20} label={gt('weather_clouds', 'Cloudiness')}>
                <div className="wx-big">{day.clouds ?? '—'}<small>%</small></div>
                <Meter pct={day.clouds ?? 0} color="var(--text2)" />
                {day.visibility != null && <div className="wx-sub">{gt('weather_visibility', 'Visibility')} {(day.visibility / 1000).toFixed(day.visibility < 10000 ? 1 : 0)} km</div>}
              </WxTile>
              <WxTile delay={0.24} label={gt('weather_moon_phase', 'Moon phase')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <MoonDisc phase={moon.phase} size={48} />
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{gt(moon.nameKey, moon.nameFallback)}</div>
                    <div className="wx-sub">{Math.round(moon.illumination * 100)}% {gt('weather_illuminated', 'lit')}</div>
                  </div>
                </div>
              </WxTile>
              {day.sunrise != null && day.sunset != null && (
                <WxTile wide delay={0.28} label={gt('weather_sun', 'Sunrise & sunset')}>
                  <SunArc sunrise={day.sunrise} sunset={day.sunset} tz={day.tzOffset} />
                </WxTile>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

export default function WeatherForecast() {
  const days = useForecast()
  const [selected, setSelected] = useState(null) // { day, index } | null
  if (!days.length) return null
  const { Icon: HeaderIcon } = weatherIconFor(days[0]?.icon)

  return (
    <div className="card" style={{
      margin: '8px 0 12px', borderRadius: 'var(--radius-lg)', overflow: 'hidden', padding: '12px 14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <HeaderIcon size={15}/>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{gt('weather_forecast', 'Forecast')}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
        {days.map((day, i) => <DayCard key={day.date} day={day} index={i} onOpen={(d, idx) => setSelected({ day: d, index: idx })} />)}
      </div>
      {selected && <DayDetailModal days={days} index={selected.index} onClose={() => setSelected(null)} />}
    </div>
  )
}
