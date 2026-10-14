import { useEffect, useState, useSyncExternalStore } from 'react'
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
    gridW != null && { k: 'grid', icon: <PylonIcon size={18} color={exporting ? 'var(--green)' : 'var(--red)'} />, tint: exporting ? 'var(--green)' : 'var(--red)', value: fmtKw(gridW), label: exporting ? gt('hero_export', 'To the grid') : gt('hero_import', 'From the grid') },
    s?.power != null && { k: 'solar', icon: <SunIcon size={18} color="var(--orange)" />, tint: 'var(--orange)', value: fmtKw(s.power), label: gt('hero_solar', 'Solar') },
    soc != null && { k: 'batt', icon: <BatteryRing pct={soc} />, tint: soc > 50 ? 'var(--green)' : soc > 20 ? 'var(--orange)' : 'var(--red)', value: `${Math.round(soc)}%`, label: gt('hero_battery', 'Battery') },
    homeW != null && { k: 'home', icon: <HomeIcon size={18} color="var(--accent-lt)" />, tint: 'var(--accent-lt)', value: fmtKw(homeW), label: gt('hero_home', 'Home uses') },
    { k: 'on', icon: <BulbIcon size={18} color="var(--yellow, #ffd60a)" />, tint: 'var(--yellow, #ffd60a)', value: String(onCount), label: gt('hero_on', 'Devices on') },
  ].filter(Boolean)

  return (
    <section className={`hero hero-${tone}`} aria-label={gt(key, fallback)}>
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
        {chips.map((c) => (
          <div key={c.k} className="hero-chip" style={{ '--tint': c.tint }}>
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
