import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { gt, getLang } from '../i18n'
import { weatherIconFor } from '../weatherIcons'
import { weatherText } from '../weatherConditions'
import { useForecast } from './WeatherForecast'
import { musicNow, openMusic } from './MusicHub'
import { SunIcon, PylonIcon, BatteryCellIcon, HomeIcon, BulbIcon } from './Icons'

// The top of the overview: a greeting for the time of day, the date and the
// weather now, then the house at a glance — grid, solar, battery, what the
// home uses, devices on, and what's playing (opens the music popup).
// Each chip shows only when there's data for it.

const fmtKw = (w) => (w == null || isNaN(w) ? null : Math.abs(w) >= 1000 ? `${(Math.abs(w) / 1000).toFixed(Math.abs(w) >= 10000 ? 0 : 1)} kW` : `${Math.round(Math.abs(w))} W`)
const sum3 = (o) => (o == null ? null : ['power', 'powerL2', 'powerL3'].reduce((a, k) => a + (Number(o[k]) || 0), 0))

// ── The living sky ──────────────────────────────────────────────────────────
// The hero is a window on the sky outside: the sun (or the moon) sits where it
// really is between sunrise and sunset, the colours follow dawn, day, dusk and
// night, and the weather now adds clouds, rain or snow. Decorative only.

const secOfDay = (d) => d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()
const CLOUDY = new Set(['☁️', '⛅', '🌤️', '🌦️', '🌧️', '⛈️', '🌫️'])
const OVERCAST = new Set(['☁️', '🌧️', '⛈️', '🌫️', '❄️'])
const RAINY = new Set(['🌧️', '🌦️', '⛈️'])

function skyNow(now, today, icon) {
  const n = secOfDay(now)
  const rise = today?.sunrise ? secOfDay(new Date(today.sunrise * 1000)) : 6.5 * 3600
  const set = today?.sunset ? secOfDay(new Date(today.sunset * 1000)) : 17.5 * 3600
  const up = n >= rise && n <= set
  const p = up ? (n - rise) / Math.max(1, set - rise) : ((n - set + 86400) % 86400) / Math.max(1, 86400 - (set - rise))
  const EDGE = 45 * 60
  const phase = Math.abs(n - rise) < EDGE ? 'dawn' : Math.abs(n - set) < EDGE ? 'dusk' : up ? 'day' : 'night'
  const wx = icon === '❄️' ? 'snow' : RAINY.has(icon) ? (icon === '⛈️' ? 'storm' : 'rain') : CLOUDY.has(icon) ? 'cloud' : 'clear'
  return {
    up, phase, wx, overcast: OVERCAST.has(icon),
    // the orb rides an arc over the right half, clear of the greeting
    x: 46 + p * 40, y: 74 - Math.sin(p * Math.PI) * 58,
  }
}

// the same sky every render: positions from a tiny seeded generator
function seeded(n, seed) {
  let a = seed
  const rnd = () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296 }
  return Array.from({ length: n }, () => [rnd(), rnd(), rnd(), rnd()])
}

function HeroSky({ now, today, icon }) {
  const sky = skyNow(now, today, icon)
  const stars = useMemo(() => seeded(46, 7), [])
  const drops = useMemo(() => seeded(22, 31), [])
  const dark = sky.phase === 'night' || sky.phase === 'dusk' || sky.phase === 'dawn'
  return (
    <div className="hero-sky" data-phase={sky.phase} data-wx={sky.wx} data-overcast={sky.overcast || undefined} aria-hidden="true">
      {dark && (
        <div className="hero-stars">
          {stars.map(([x, y, r, d], i) => (
            <i key={i} style={{ left: `${x * 100}%`, top: `${y * 72}%`, '--s': `${1 + r * 1.6}px`, '--d': `${-d * 6}s`, '--t': `${2.4 + r * 3.6}s` }} />
          ))}
          {sky.phase === 'night' && sky.wx === 'clear' && <b className="hero-shoot" />}
        </div>
      )}
      <div className={`hero-orb ${sky.up ? 'hero-sun' : 'hero-moon'}`} style={{ left: `${sky.x}%`, top: `${sky.y}%` }}><i /></div>
      {sky.wx !== 'clear' && <div className="hero-clouds"><i /><i /><i /></div>}
      {(sky.wx === 'rain' || sky.wx === 'storm' || sky.wx === 'snow') && (
        <div className={sky.wx === 'snow' ? 'hero-snow' : 'hero-rain'}>
          {drops.map(([x, , r, d], i) => <i key={i} style={{ left: `${x * 100}%`, '--d': `${-d * 3}s`, '--t': `${sky.wx === 'snow' ? 5 + r * 5 : 0.7 + r * 0.6}s`, '--s': `${0.6 + r * 0.8}` }} />)}
        </div>
      )}
      {sky.wx === 'storm' && <div className="hero-flash" />}
      <div className="hero-haze" />
    </div>
  )
}

// A number that glides to its new value instead of jumping.
function Num({ value, fmt }) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    const a = from.current
    if (value == null || isNaN(value) || a == null || isNaN(a) || a === value || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      from.current = value; setShown(value); return
    }
    let raf; const t0 = performance.now()
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / 800), e = 1 - Math.pow(1 - k, 3)
      const cur = a + (value - a) * e
      from.current = cur; setShown(cur)
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return fmt(shown)
}

function partOfDay(h) {
  if (h >= 5 && h < 12) return ['hero_morning', 'Good morning', 'morning']
  if (h >= 12 && h < 18) return ['hero_afternoon', 'Good afternoon', 'day']
  if (h >= 18 && h < 22) return ['hero_evening', 'Good evening', 'evening']
  return ['hero_night', 'Good night', 'night']
}

export default function HomeHero({ energy, onCount = 0, liveCount = 0 }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t) }, [])
  const days = useForecast()
  const music = useSyncExternalStore(musicNow.subscribe, musicNow.get)

  const [key, fallback, tone] = partOfDay(now.getHours())
  const date = now.toLocaleDateString(getLang(), { weekday: 'long', day: 'numeric', month: 'long' })
  const today = days[0]
  const hour = today?.hours?.[0]
  const temp = hour?.temp ?? today?.tempMax
  const { Icon: WxIcon, anim } = weatherIconFor(hour?.icon || today?.icon)

  const { battery: b, solar: s, grid: g, loads: l } = energy || {}
  const gridW = sum3(g)
  const exporting = (gridW ?? 0) < 0
  const homeW = sum3(l)
  const soc = b?.soc
  const chips = [
    gridW != null && { k: 'grid', icon: <PylonIcon size={18} color={exporting ? 'var(--green)' : 'var(--red)'} />, tint: exporting ? 'var(--green)' : 'var(--red)', value: <Num value={gridW} fmt={fmtKw} />, label: exporting ? gt('hero_export', 'To the grid') : gt('hero_import', 'From the grid') },
    s?.power != null && { k: 'solar', icon: <SunIcon size={18} color="var(--orange)" />, tint: 'var(--orange)', value: <Num value={s.power} fmt={fmtKw} />, label: gt('hero_solar', 'Solar') },
    soc != null && { k: 'batt', icon: <BatteryRing pct={soc} />, tint: soc > 50 ? 'var(--green)' : soc > 20 ? 'var(--orange)' : 'var(--red)', value: <Num value={soc} fmt={(v) => `${Math.round(v)}%`} />, label: gt('hero_battery', 'Battery') },
    homeW != null && { k: 'home', icon: <HomeIcon size={18} color="var(--accent-lt)" />, tint: 'var(--accent-lt)', value: <Num value={homeW} fmt={fmtKw} />, label: gt('hero_home', 'Home uses') },
    { k: 'on', icon: <BulbIcon size={18} color="var(--yellow, #ffd60a)" />, tint: 'var(--yellow, #ffd60a)', value: <Num value={onCount} fmt={(v) => String(Math.round(v))} />, label: gt('hero_on', 'Devices on') },
  ].filter(Boolean)

  return (
    <section className={`hero hero-${tone} hero-live`} aria-label={gt(key, fallback)}>
      <HeroSky now={now} today={today} icon={hour?.icon || today?.icon} />
      <div className="hero-top">
        <div className="hero-hello">
          <h1>{gt(key, fallback)}</h1>
          <p>{date}{today?.condition ? <span className="hero-cond"> · {weatherText(today.condition)}</span> : null}</p>
        </div>
        {temp != null && (
          <div className="hero-wx" title={today?.condition ? weatherText(today.condition) : ''}>
            <span className={anim}><WxIcon size={40} /></span>
            <b>{Math.round(temp)}°</b>
          </div>
        )}
      </div>
      <div className="hero-chips">
        {chips.map((c, i) => (
          <div key={c.k} className="hero-chip" style={{ '--tint': c.tint, '--i': i }}>
            <span className="hero-chip-ico">{c.icon}</span>
            <span className="hero-chip-txt"><b>{c.value}</b><small>{c.label}{c.sub ? ` · ${c.sub}` : ''}</small></span>
          </div>
        ))}
        {music?.playing && (
          <button type="button" className="hero-chip hero-music" style={{ '--tint': music.color || 'var(--accent)' }} onClick={() => openMusic('popup')} title={gt('music', 'Music')}>
            <span className="hero-chip-ico"><span className="mp-eq" aria-hidden="true"><i /><i /><i /></span></span>
            <span className="hero-chip-txt"><b>{music.line || gt('music', 'Music')}</b><small>{gt('hero_playing', 'Playing now')}</small></span>
          </button>
        )}
      </div>
    </section>
  )
}

function BatteryRing({ pct }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0))
  const c = p > 50 ? 'var(--green)' : p > 20 ? 'var(--orange)' : 'var(--red)'
  const r = 8, len = 2 * Math.PI * r
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <circle cx="11" cy="11" r={r} fill="none" stroke="currentColor" strokeOpacity=".18" strokeWidth="3" />
      <circle cx="11" cy="11" r={r} fill="none" stroke={c} strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(p / 100) * len} ${len}`} transform="rotate(-90 11 11)" />
    </svg>
  )
}
