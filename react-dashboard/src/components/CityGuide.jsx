import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence } from 'framer-motion'
import { motion, useReducedMotion } from 'framer-motion'
import { gt, getLang } from '../i18n'
import { MapPinIcon } from './Icons'
import { useForecast } from './WeatherForecast'

// Onboarding: a welcome card on the home view and the full city guide
// (dashboard menu → Guide) — getting around, where to eat and what to see,
// nearest first, on a radar map around the home. Data: GET /api/guide
// (src/routes/guide.js); renders nothing while the guide is off
// (Settings → Onboarding).

let cache = { lang: null, data: undefined, at: 0, pending: null }
const listeners = new Set()

function fetchGuide(force = false) {
  const lang = getLang() === 'pl' ? 'pl' : 'en'
  if (!force && cache.lang === lang && cache.data !== undefined && Date.now() - cache.at < 10 * 60 * 1000) return Promise.resolve(cache.data)
  if (cache.pending && cache.lang === lang) return cache.pending
  cache.lang = lang
  cache.pending = fetch(`/api/guide?lang=${lang}`, { credentials: 'same-origin' })
    .then(r => (r.ok ? r.json() : { data: null }))
    .then(j => { cache = { lang, data: j?.data || null, at: Date.now(), pending: null }; listeners.forEach(f => f(cache.data)); return cache.data })
    .catch(() => { cache.pending = null; return null })
  return cache.pending
}

export function useGuide() {
  const [data, setData] = useState(cache.lang && cache.data !== undefined ? cache.data : null)
  useEffect(() => {
    listeners.add(setData)
    fetchGuide().then(setData)
    const onLang = () => fetchGuide(true)
    window.addEventListener('lsh-lang-changed', onLang)
    return () => { listeners.delete(setData); window.removeEventListener('lsh-lang-changed', onLang) }
  }, [])
  return data
}

// ── categories ──────────────────────────────────────────────

const CAT = {
  places:      { color: 'var(--gd-places)', label: () => gt('guide_places', 'Places to visit') },
  activities:  { color: 'var(--gd-fun)', label: () => gt('guide_activities', 'Things to do') },
  restaurants: { color: 'var(--gd-food)', label: () => gt('guide_food', 'Restaurants') },
  transport:   { color: 'var(--gd-move)', label: () => gt('guide_transport', 'Getting around') },
}
const ORDER = ['places', 'activities', 'restaurants', 'transport']

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }
const ICONS = {
  places: <><path {...P} d="M3 21h18M5 21V10M19 21V10M9 21v-7M15 21v-7"/><path {...P} d="M2.5 10 12 4l9.5 6z"/></>,
  restaurants: <><path {...P} d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10"/><path {...P} d="M17 21V3c-2 1.5-3 4-3 7 0 1.5 1 2.5 3 2.5"/></>,
  activities: <><path {...P} d="M4 8a2 2 0 0 0 0 4v0a2 2 0 0 1 0 4v2h16v-2a2 2 0 0 1 0-4 2 2 0 0 0 0-4V6H4z"/><path {...P} d="M14 6v2M14 11v2M14 16v2"/></>,
  tram: <><rect {...P} x="6" y="5" width="12" height="13" rx="3"/><path {...P} d="M9 2h6M12 2v3M6 12h12M9 18l-2 3M15 18l2 3"/><circle cx="9" cy="15" r=".8" fill="currentColor"/><circle cx="15" cy="15" r=".8" fill="currentColor"/></>,
  train: <><rect {...P} x="5" y="3" width="14" height="14" rx="4"/><path {...P} d="M5 10h14M8 21l2-4M16 21l-2-4"/><circle cx="9" cy="13.5" r=".8" fill="currentColor"/><circle cx="15" cy="13.5" r=".8" fill="currentColor"/></>,
  plane: <path {...P} d="M10.5 20 12 15l6.5 3.5 1-1.5-6-6 .5-6.5c0-1-.5-1.5-1-1.5s-1 .5-1 1.5l-.5 6.5-6 6 1 1.5L12 15"/>,
  bike: <><circle {...P} cx="6" cy="16" r="3.5"/><circle {...P} cx="18" cy="16" r="3.5"/><path {...P} d="M6 16l4-7h5l3 7M10 9l2 7h-6M14 6h3"/></>,
  car: <><path {...P} d="M4 16V12l2-5h12l2 5v4z"/><path {...P} d="M4 12h16"/><circle {...P} cx="7.5" cy="16.5" r="1.5"/><circle {...P} cx="16.5" cy="16.5" r="1.5"/></>,
  route: <><circle {...P} cx="6" cy="18" r="2.5"/><circle {...P} cx="18" cy="6" r="2.5"/><path {...P} d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/></>,
}
const iconFor = (cat, it) => (cat === 'transport' ? ICONS[it.icon] || ICONS.route : ICONS[cat])
const Ico = ({ cat, it, size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">{iconFor(cat, it)}</svg>

// ── helpers ─────────────────────────────────────────────────

const dec = (n) => String(n).replace('.', getLang() === 'pl' ? ',' : '.')
const kmText = (it) => (it.km == null ? null : it.km < 1 ? `${Math.round(it.km * 1000)} m` : `${dec(it.km)} km`)
const walkText = (it) => (it.walkMin != null ? gt('guide_walk', '{n} min walk', { n: it.walkMin }) : null)

// ── trip: places picked for a visit, in order ──────────────
// Kept in this browser (localStorage); Google allows 9 waypoints in a link,
// so a trip holds up to 10 stops.
const TRIP_KEY = 'lsh-guide-trip'
const MAX_STOPS = 10
let trip = (() => { try { const t = JSON.parse(localStorage.getItem(TRIP_KEY) || '{}'); return { stops: Array.isArray(t.stops) ? t.stops : [], mode: t.mode || 'walking' } } catch { return { stops: [], mode: 'walking' } } })()
const tripListeners = new Set()
function setTrip(next) {
  trip = typeof next === 'function' ? next(trip) : next
  try { localStorage.setItem(TRIP_KEY, JSON.stringify(trip)) } catch { /* private mode */ }
  tripListeners.forEach(f => f(trip))
}
function useTrip() {
  const [t, setT] = useState(trip)
  useEffect(() => { tripListeners.add(setT); return () => tripListeners.delete(setT) }, [])
  return t
}
const stopKey = (cat, it) => `${cat}:${it.id}`
const toggleStop = (cat, it) => setTrip(t => {
  const key = stopKey(cat, it)
  if (t.stops.some(x => x.key === key)) return { ...t, stops: t.stops.filter(x => x.key !== key) }
  if (t.stops.length >= MAX_STOPS || it.lat == null) return t
  return { ...t, stops: [...t.stops, { key, cat, name: it.name, lat: it.lat, lon: it.lon }] }
})
const ll = (p) => `${(+p.lat).toFixed(6)},${(+p.lon).toFixed(6)}`
function kmBetween(a, b) {
  const R = 6371, r = (d) => (d * Math.PI) / 180
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
// nearest stop next, starting at the home
function optimise(home, stops) {
  const left = [...stops], out = []
  let at = home
  while (left.length) {
    let bi = 0
    left.forEach((s, i) => { if (kmBetween(at, s) < kmBetween(at, left[bi])) bi = i })
    at = left.splice(bi, 1)[0]; out.push(at)
  }
  return out
}
const MODES = { walking: { g: 'walking', legacy: 'w' }, transit: { g: 'transit', legacy: 'r' }, driving: { g: 'driving', legacy: 'd' } }
// Google Maps app / website: home → stops (the last is the destination)
function routeUrl(home, stops, mode) {
  if (!stops.length) return null
  const dest = stops[stops.length - 1]
  const way = stops.slice(0, -1).map(ll).join('|')
  return `https://www.google.com/maps/dir/?api=1&origin=${ll(home)}&destination=${ll(dest)}${way ? `&waypoints=${encodeURIComponent(way)}` : ''}&travelmode=${MODES[mode].g}`
}
// the on-screen map: Maps Embed API with a key, else Google's keyless embed
function embedUrl({ home, stops, mode, focus, key, lang }) {
  const hl = lang === 'pl' ? 'pl' : 'en'
  if (stops.length) {
    // Google can't route public transport through waypoints — walk them instead
    const m = mode === 'transit' && stops.length > 1 ? 'walking' : mode
    if (key) {
      const dest = stops[stops.length - 1]
      const way = stops.slice(0, -1).map(ll).join('|')
      return `https://www.google.com/maps/embed/v1/directions?key=${encodeURIComponent(key)}&origin=${ll(home)}&destination=${ll(dest)}${way ? `&waypoints=${encodeURIComponent(way)}` : ''}&mode=${MODES[m].g}&language=${hl}`
    }
    return `https://maps.google.com/maps?saddr=${ll(home)}&daddr=${stops.map(ll).join('+to:')}&dirflg=${MODES[m].legacy}&hl=${hl}&output=embed`
  }
  const at = focus || home
  if (key) return `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(key)}&q=${ll(at)}&zoom=${focus ? 16 : 14}&language=${hl}`
  return `https://maps.google.com/maps?q=${ll(at)}&z=${focus ? 16 : 14}&hl=${hl}&output=embed`
}

// admins get an Edit button that opens Settings → Onboarding
let adminCache = null
function useIsAdmin() {
  const [admin, setAdmin] = useState(adminCache ?? false)
  useEffect(() => {
    if (adminCache != null) return
    fetch('/api/auth/me', { credentials: 'same-origin' }).then(r => r.json())
      .then(j => { adminCache = j.data?.role === 'admin'; setAdmin(adminCache) }).catch(() => {})
  }, [])
  return admin
}

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t) }, [])
  return now
}

// bearing + distance from the home → a point on the radar (log scale so the
// street corner and the airport both fit)
const scale = (d, maxKm, R) => R * Math.sqrt(Math.min(d, maxKm) / maxKm)
function project(home, it, maxKm, R) {
  const rad = (d) => (d * Math.PI) / 180
  const dy = (it.lat - home.lat) * 111.32
  const dx = (it.lon - home.lon) * 111.32 * Math.cos(rad(home.lat))
  const d = Math.hypot(dx, dy)
  const far = d > maxKm
  const r = far ? R + 1 : scale(d, maxKm, R)
  const a = Math.atan2(dx, dy)
  return { x: Math.sin(a) * r, y: -Math.cos(a) * r, far, a }
}

// ── skyline (hero) ──────────────────────────────────────────

// tiny seeded random, so a city's skyline and its lit windows stay put
const seeded = (seed) => { let s = 0; for (const c of String(seed)) s = (s * 31 + c.charCodeAt(0)) >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) }

function Windows({ x, y, w, h, rnd, cols = 3, gap = 6 }) {
  const out = []
  for (let yy = y + 8; yy < y + h - 6; yy += gap + 3) {
    for (let c = 0; c < cols; c++) {
      if (rnd() < 0.42) continue
      const xx = x + 5 + c * ((w - 10) / cols)
      out.push(<rect key={`${xx}-${yy}`} className="gd-win" x={xx} y={yy} width={Math.max(2, (w - 10) / cols - 3)} height="3" style={{ animationDelay: `${(rnd() * 9).toFixed(2)}s` }}/>)
    }
  }
  return out
}

const SkyDefs = () => (
  <defs>
    <linearGradient id="gd-sky-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1d2b46"/><stop offset="1" stopColor="#0a1020"/></linearGradient>
  </defs>
)

function Skyline({ city }) {
  const rnd = seeded(city || 'city')
  if (city === 'katowice') {
    return (
      <svg className="gd-skyline" viewBox="0 0 1200 170" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
        <SkyDefs/>
        <g fill="url(#gd-sky-fill)">
          <rect x="0" y="118" width="70" height="52"/><rect x="60" y="100" width="46" height="70"/><rect x="110" y="126" width="60" height="44"/>
          {/* Spodek — the saucer on slanted legs */}
          <path d="M168 112 Q260 92 352 112 L330 132 L190 132 Z"/>
          <path d="M200 132 L186 170 M320 132 L334 170" stroke="#0e1628" strokeWidth="8"/>
          <rect x="196" y="132" width="128" height="38"/>
          {/* International Congress Centre — the walkable roof ramp */}
          <path d="M352 170 L352 138 L520 112 L530 170 Z"/>
          {/* NOSPR */}
          <rect x="540" y="104" width="104" height="66"/>
          {/* Silesian Museum — the old mine's shaft tower */}
          <path d="M682 170 L696 66 L712 66 L726 170 Z"/>
          <rect x="690" y="58" width="28" height="10"/>
          <circle cx="704" cy="52" r="9" fill="none" stroke="#1d2b46" strokeWidth="3"/>
          <rect x="652" y="136" width="32" height="34"/><rect x="728" y="132" width="34" height="38"/>
          {/* Altus */}
          <path d="M800 170 L800 40 L842 26 L842 170 Z"/>
          {/* Superjednostka */}
          <rect x="868" y="114" width="190" height="56"/>
          {/* the cathedral's dome */}
          <path d="M1078 170 L1078 120 Q1112 74 1146 120 L1146 170 Z"/><rect x="1108" y="70" width="8" height="18"/>
          <rect x="1150" y="128" width="50" height="42"/>
        </g>
        <g className="gd-wins">
          <Windows x={60} y={100} w={46} h={70} rnd={rnd} cols={3}/>
          <Windows x={540} y={104} w={104} h={66} rnd={rnd} cols={7}/>
          <Windows x={800} y={40} w={42} h={130} rnd={rnd} cols={3}/>
          <Windows x={868} y={114} w={190} h={56} rnd={rnd} cols={14} gap={4}/>
          <Windows x={1150} y={128} w={50} h={42} rnd={rnd} cols={3}/>
        </g>
        <path className="gd-spodek-ring" d="M176 112 Q260 94 344 112" fill="none"/>
      </svg>
    )
  }
  // any other city: a seeded skyline of towers and blocks
  const blocks = []
  let x = 0
  while (x < 1200) {
    const w = 30 + rnd() * 70, h = 40 + rnd() * (rnd() < 0.15 ? 120 : 70)
    blocks.push({ x, w, h }); x += w + 2 + rnd() * 6
  }
  return (
    <svg className="gd-skyline" viewBox="0 0 1200 170" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <SkyDefs/>
      <g fill="url(#gd-sky-fill)">{blocks.map((b, i) => <rect key={i} x={b.x} y={170 - b.h} width={b.w} height={b.h}/>)}</g>
      <g className="gd-wins">{blocks.map((b, i) => <Windows key={i} x={b.x} y={170 - b.h} w={b.w} h={b.h} rnd={rnd} cols={Math.max(2, Math.round(b.w / 14))}/>)}</g>
    </svg>
  )
}

// ── hero ────────────────────────────────────────────────────

function Hero({ g, compact = false, onOpen }) {
  const now = useClock()
  const admin = useIsAdmin()
  const days = useForecast()
  const today = days?.[0]
  const temp = today?.now?.temp ?? today?.tempMax
  const counts = ORDER.filter(k => g[k]).map(k => ({ k, n: g[k].length }))
  return (
    <section className={`gd-hero${compact ? ' gd-hero-compact' : ''}`}>
      <div className="gd-aurora" aria-hidden="true"><i/><i/><i/></div>
      <div className="gd-dots" aria-hidden="true"/>
      <Skyline city={g.skyline || g.city}/>
      {admin && (
        <a className="gd-edit" href="/react/settings/onboarding" title={gt('guide_edit_hint', 'City, welcome message, your own tips, sections')}>
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
          {gt('guide_edit', 'Edit')}
        </a>
      )}
      <div className="gd-hero-body">
        <div className="gd-eyebrow"><MapPinIcon size={14} color="currentColor"/> {g.cityName}</div>
        <h2 className="gd-title">{g.title || gt('guide_welcome_to', 'Welcome to {city}', { city: g.cityName })}</h2>
        <p className="gd-welcome">{g.welcome}</p>
        <div className="gd-chips">
          <span className="gd-chip"><b className="gd-tnum">{now.toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit' })}</b> {now.toLocaleDateString(getLang(), { weekday: 'long' })}</span>
          {temp != null && <span className="gd-chip"><span aria-hidden="true">{today?.now?.icon || today?.icon}</span> <b className="gd-tnum">{Math.round(temp)}°</b></span>}
          {g.home && <span className="gd-chip"><b className="gd-tnum">{dec(g.home.centreKm)} km</b> {gt('guide_to_centre', 'to the centre')}</span>}
          {g.phrases?.length > 0 && (() => { const p = g.phrases[dayIndex(g.phrases.length)]; return <span className="gd-chip" title={gt('guide_word_day', 'Silesian word of the day')}><span aria-hidden="true">💬</span> <b>{p.sl}</b> = {p.meaning}</span> })()}
          {!compact && counts.map(({ k, n }) => <span key={k} className="gd-chip" style={{ '--c': CAT[k].color }}><i className="gd-dot"/> <b className="gd-tnum">{n}</b> {CAT[k].label().toLowerCase()}</span>)}
        </div>
        {compact && onOpen && <button className="gd-cta" onClick={onOpen}>{gt('guide_open', 'Full guide')} <span aria-hidden="true">→</span></button>}
      </div>
    </section>
  )
}

// ── popups: nothing opens a new tab — places, routes, websites and photos
// show here, with a QR code to take them to a phone ─────────

let popup = null
const popupListeners = new Set()
const openPopup = (p) => { popup = p; popupListeners.forEach(f => f(p)) }
const closePopup = () => openPopup(null)
function usePopup() {
  const [p, setP] = useState(popup)
  useEffect(() => { popupListeners.add(setP); return () => popupListeners.delete(setP) }, [])
  return p
}
const qrSrc = (url) => `/api/guide/qr?url=${encodeURIComponent(url)}`
const placeUrl = (it) => (it.lat != null ? `https://www.google.com/maps/search/?api=1&query=${it.lat},${it.lon}` : null)

function Qr({ url, text }) {
  const [ok, setOk] = useState(true)
  if (!url || !ok) return null
  return (
    <div className="gd-qr">
      <img src={qrSrc(url)} alt={gt('guide_qr_alt', 'QR code')} width="132" height="132" onError={() => setOk(false)}/>
      <span>{text || gt('guide_qr_text', 'Scan with your phone’s camera to take it along.')}</span>
    </div>
  )
}

function PlacePopup({ g, cat, it, t }) {
  const inTrip = t.stops.some(x => x.key === stopKey(cat, it))
  const route = g.home && it.lat != null ? routeUrl(g.home, [it], it.km != null && it.km <= 2 ? 'walking' : 'transit') : null
  return (
    <>
      {it.image && (
        <div className="gd-pop-hero">
          <img src={it.image.src} alt={it.name} referrerPolicy="no-referrer"/>
          <button className="gd-pop-credit" onClick={() => openPopup({ kind: 'photo', cat, it, back: { kind: 'place', cat, it } })}>
            {[it.image.author, it.image.license].filter(Boolean).join(' · ') || 'Wikimedia Commons'}
          </button>
        </div>
      )}
      <div className="gd-pop-body" style={{ '--c': CAT[cat]?.color }}>
        <div className="gd-pop-head">
          <span className="gd-card-ic"><Ico cat={cat in CAT ? cat : 'places'} it={it}/></span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 className="gd-pop-title">{it.name}</h2>
            <div className="gd-card-sub">{[it.kind, typeof it.tag === 'string' ? it.tag : null, it.price].filter(Boolean).join(' · ')}</div>
          </div>
          {it.km != null && <div className="gd-dist"><b className="gd-tnum">{kmText(it)}</b>{walkText(it) && <span>{walkText(it)}</span>}</div>}
        </div>
        {it.text && <p className="gd-card-text">{it.text}</p>}
        {it.address && <div className="gd-addr">📍 {it.address}</div>}
        {g.home && it.lat != null && (
          <div className="gd-gmap gd-gmap-pop">
            <iframe title={it.name} src={embedUrl({ home: g.home, stops: [it], mode: it.km != null && it.km <= 2 ? 'walking' : 'transit', key: g.mapsKey, lang: getLang() })} loading="lazy" referrerPolicy="no-referrer-when-downgrade" sandbox="allow-scripts allow-same-origin"/>
          </div>
        )}
        <div className="gd-trip-actions">
          {it.lat != null && (
            <button className={`gd-btn gd-btn-trip${inTrip ? ' on' : ''}`} disabled={!inTrip && t.stops.length >= MAX_STOPS} onClick={() => toggleStop(cat, it)}>
              {inTrip ? `✓ ${gt('guide_in_trip', 'In the trip')}` : `+ ${gt('guide_add_trip', 'Add to trip')}`}
            </button>
          )}
          {it.url && <button className="gd-btn gd-btn-ghost" onClick={() => openPopup({ kind: 'site', url: it.url, title: it.name, back: { kind: 'place', cat, it } })}>{gt('guide_site', 'Website')}</button>}
        </div>
        <Qr url={route || placeUrl(it)} text={gt('guide_qr_route', 'Scan to take the route to this place on your phone.')}/>
        <Nearby g={g} cat={cat} it={it}/>
        <button className="gd-btn gd-btn-ghost gd-close-wide" onClick={closePopup}>{gt('close', 'Close')}</button>
      </div>
    </>
  )
}

// what else is close to this place — sights, food, transport, nearest first
function Nearby({ g, cat, it }) {
  if (it.lat == null) return null
  const near = ORDER.flatMap(k => (g[k] || []).filter(x => x.lat != null && !(k === cat && x.id === it.id)).map(x => ({ k, x, d: kmBetween(it, x) })))
    .filter(n => n.d <= 3).sort((a, b) => a.d - b.d).slice(0, 6)
  if (!near.length) return null
  return (
    <div className="gd-nearby">
      <div className="gd-col-title" style={{ '--c': 'var(--text3)' }}>{gt('guide_nearby', 'Close by')}</div>
      <div className="gd-nearby-grid">
        {near.map(({ k, x, d }) => (
          <button key={`${k}:${x.id}`} className="gd-near" style={{ '--c': CAT[k].color }} onClick={() => openPopup({ kind: 'place', cat: k, it: x, back: { kind: 'place', cat, it } })}>
            {x.image ? <img src={x.image.src} alt="" loading="lazy" referrerPolicy="no-referrer"/> : <span className="gd-near-ic"><Ico cat={k} it={x} size={18}/></span>}
            <span className="gd-near-txt">
              <b>{x.name}</b>
              <span className="gd-tnum">{d < 1 ? `${Math.round(d * 1000)} m` : `${dec(Math.round(d * 10) / 10)} km`} · {d <= 2 ? gt('guide_walk', '{n} min walk', { n: Math.max(1, Math.round((d * 1.3 / 4.8) * 60)) }) : CAT[k].label().toLowerCase()}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

// A website inside the popup — straight in a frame when the site allows it,
// else through LSH's sandboxed copy (/api/guide/page). Links inside it keep
// navigating here; pages on other sites show their address and a QR code.
function SitePopup({ url: start, title, back }) {
  const [hist, setHist] = useState([start])
  const [canFrame, setCanFrame] = useState(null)
  const [outside, setOutside] = useState(null)
  const frame = useRef(null)
  const url = hist[hist.length - 1]
  useEffect(() => {
    let live = true
    fetch(`/api/guide/frameable?url=${encodeURIComponent(start)}`, { credentials: 'same-origin' }).then(r => r.json())
      .then(j => { if (live) setCanFrame(!!j.data?.frameable) }).catch(() => { if (live) setCanFrame(false) })
    return () => { live = false }
  }, [start])
  useEffect(() => {
    const onMsg = (e) => {
      if (!frame.current || e.source !== frame.current.contentWindow || e.data?.lshGuide !== 'nav') return
      let next
      try { next = new URL(e.data.href) } catch { return }
      const bare = (h) => h.replace(/^www\./, '')
      if (next.protocol === 'https:' && bare(next.hostname) === bare(new URL(start).hostname)) { setOutside(null); setHist(h => [...h, next.href]) }
      else setOutside(next.href)
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [start])
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } })()
  const src = canFrame ? url : `/api/guide/page?url=${encodeURIComponent(url)}&lang=${getLang()}`
  return (
    <div className="gd-pop-body gd-site-body">
      <div className="gd-browser">
        <button className="gd-pop-btn gd-pop-btn-sm" disabled={hist.length < 2 && !back}
          onClick={() => { setOutside(null); if (hist.length < 2) openPopup(back); else setHist(h => h.slice(0, -1)) }} aria-label={gt('back', 'Back')}>←</button>
        <div className="gd-browser-url"><span className="gd-browser-lock">🔒</span> <b>{host}</b><span className="gd-browser-path">{(() => { try { const u = new URL(url); return u.pathname + u.search } catch { return '' } })()}</span></div>
      </div>
      <h2 className="gd-pop-title gd-sr">{title}</h2>
      <div className="gd-site">
        {canFrame === null
          ? <div className="gd-site-wait"><span className="gd-spin"/></div>
          : <iframe key={src} ref={frame} title={title} src={src} referrerPolicy="no-referrer"
              sandbox={canFrame ? 'allow-scripts allow-same-origin allow-forms' : 'allow-scripts'}/>}
      </div>
      {outside && (
        <div className="gd-outside">
          <span>{gt('guide_outside', 'That link leads to another website:')}</span>
          <span className="gd-site-url">{outside}</span>
          <button className="gd-pop-btn gd-pop-btn-sm" onClick={() => setOutside(null)} aria-label="✕">✕</button>
        </div>
      )}
      <Qr url={hist.length === 1 ? start : null} text={gt('guide_qr_site', 'Scan to open it on your phone.')}/>
    </div>
  )
}

function PhotoPopup({ it }) {
  return (
    <div className="gd-pop-photo">
      <img src={it.image.src} alt={it.name} referrerPolicy="no-referrer"/>
      <div className="gd-pop-body">
        <h2 className="gd-pop-title">{it.name}</h2>
        <div className="gd-card-text">{gt('guide_photo_by', 'Photo: {who}', { who: it.image.author || '—' })} · {it.image.license} · Wikimedia Commons</div>
        {it.image.page && <div className="gd-site-url">{decodeURIComponent(it.image.page)}</div>}
        {it.image.page && <Qr url={it.image.page} text={gt('guide_qr_photo', 'Scan to see the photo and its licence on Wikimedia Commons.')}/>}
      </div>
    </div>
  )
}

function TripPopup({ g, t }) {
  const url = routeUrl(g.home, t.stops, t.mode)
  return (
    <div className="gd-pop-body">
      <h2 className="gd-pop-title">{gt('guide_trip', 'Your trip')}</h2>
      <div className="gd-card-sub">{t.stops.map((s, i) => `${i + 1}. ${s.name}`).join('  →  ')}</div>
      <div className="gd-gmap gd-gmap-pop gd-gmap-tall">
        <iframe title={gt('guide_trip', 'Your trip')} src={embedUrl({ home: g.home, stops: t.stops, mode: t.mode, key: g.mapsKey, lang: getLang() })} loading="lazy" referrerPolicy="no-referrer-when-downgrade" sandbox="allow-scripts allow-same-origin"/>
      </div>
      <Qr url={url} text={gt('guide_qr_text', 'Scan with your phone’s camera to take the route along.')}/>
    </div>
  )
}

function GuidePopups({ g }) {
  const p = usePopup()
  const t = useTrip()
  const reduce = useReducedMotion()
  useEffect(() => {
    if (!p) return
    const onKey = (e) => { if (e.key === 'Escape') closePopup() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [p])
  useEffect(() => () => closePopup(), [])
  return createPortal(
    <AnimatePresence>
      {p && (
        <motion.div className="gd-pop-wrap" onClick={closePopup} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className={`gd-pop gd-pop-${p.kind}`} role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}
            initial={reduce ? false : { opacity: 0, y: 30, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}>
            <div className="gd-pop-bar">
              {p.back && p.kind !== 'site' && <button className="gd-pop-btn" onClick={() => openPopup(p.back)} aria-label={gt('back', 'Back')}>←</button>}
              <span style={{ flex: 1 }}/>
              <button className="gd-pop-btn" onClick={closePopup} aria-label={gt('close', 'Close')}>✕</button>
            </div>
            <div className="gd-pop-scroll">
              {p.kind === 'place' && <PlacePopup g={g} cat={p.cat} it={p.it} t={t}/>}
              {p.kind === 'site' && <SitePopup key={p.url} url={p.url} title={p.title} back={p.back}/>}
              {p.kind === 'photo' && <PhotoPopup it={p.it}/>}
              {p.kind === 'trip' && <TripPopup g={g} t={t}/>}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

// ── radar ───────────────────────────────────────────────────

function Radar({ g, active, hover, setHover, onPick, size = 'full', tripStops }) {
  const reduce = useReducedMotion()
  const R = 88
  const pts = useMemo(() => {
    if (!g.home) return null
    const all = ORDER.flatMap(k => (g[k] || []).filter(it => it.lat != null).map(it => ({ ...it, cat: k })))
    if (!all.length) return null
    // the map spans most places; the odd far one (the airport) waits on the rim
    const ds = all.map(it => it.km || 0).sort((a, b) => a - b)
    const maxKm = Math.max(3, ds[Math.min(ds.length - 1, Math.floor(ds.length * 0.9))] * 1.12)
    return { maxKm, list: all.map((it, i) => ({ ...it, i, ...project(g.home, it, maxKm, R) })) }
  }, [g])
  if (!pts) return null
  const ring = (d) => scale(d, pts.maxKm, R)
  const cand = [0.5, 1, 2, 3, 5, 10, 20].filter(d => d < pts.maxKm * 0.95)
  const rings = cand.length > 2 ? [cand[Math.floor(cand.length / 2) - 1], cand[cand.length - 1]] : cand
  const hov = pts.list.find(p => `${p.cat}:${p.id}` === hover)
  const stops = (tripStops || []).map(s => pts.list.find(p => `${p.cat}:${p.id}` === s.key)).filter(Boolean)
  return (
    <div className={`gd-radar gd-radar-${size}`}>
      <div className="gd-radar-sweep" aria-hidden="true"/>
      <svg viewBox="-100 -100 200 200" role="img" aria-label={gt('guide_map_label', 'Map of places around your stay')}>
        <defs>
          <radialGradient id={`gd-radar-bg-${size}`}><stop offset="0" stopColor="rgba(94,224,197,0.16)"/><stop offset="1" stopColor="rgba(94,224,197,0)"/></radialGradient>
        </defs>
        <circle r={R + 4} fill={`url(#gd-radar-bg-${size})`}/>
        {rings.map(d => (
          <g key={d}>
            <circle r={ring(d)} className="gd-ring"/>
            {size === 'full' && <text x={ring(d) - 1.5} y="-2" textAnchor="end" className="gd-ring-label">{dec(d)} km</text>}
          </g>
        ))}
        <circle r={R} className="gd-ring gd-ring-outer"/>
        <text x="0" y={-R - 4} className="gd-north" textAnchor="middle">N</text>
        {pts.list.map(p => {
          const key = `${p.cat}:${p.id}`
          const on = !active || active === p.cat
          const isHov = key === hover
          return (
            <g key={key} transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}>
              {p.far && <path className="gd-far" d="M0 -4.5 L3.2 1.5 L-3.2 1.5 Z" transform={`rotate(${(p.a * 180) / Math.PI})`} style={{ '--c': CAT[p.cat].color }}/>}
              <g className={`gd-pin${on ? '' : ' gd-pin-off'}${isHov ? ' gd-pin-hov' : ''}${p.far ? ' gd-pin-far' : ''}`}
                style={{ '--c': CAT[p.cat].color, animationDelay: reduce ? '0s' : `${0.25 + p.i * 0.05}s` }}
                onMouseEnter={() => setHover(key)} onMouseLeave={() => setHover(null)} onClick={() => onPick?.(p.cat, key)}>
                <circle r="9" className="gd-pin-halo"/>
                <circle r={isHov ? 4.6 : 3.4} className="gd-pin-dot"/>
              </g>
            </g>
          )
        })}
        {stops.length > 0 && (
          <polyline className="gd-route" points={[{ x: 0, y: 0 }, ...stops].map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}/>
        )}
        {stops.map((p, n) => (
          <g key={`n-${p.cat}:${p.id}`} transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`} className="gd-stop-n" style={{ '--c': CAT[p.cat].color }}>
            <circle r="5.4"/><text y="2.1" textAnchor="middle">{n + 1}</text>
          </g>
        ))}
        <g className="gd-home">
          <circle r="7" className="gd-home-pulse"/>
          <circle r="4.2" className="gd-home-dot"/>
        </g>
        {hov && (
          <g transform={`translate(${hov.x.toFixed(1)} ${hov.y.toFixed(1)})`} className="gd-tip">
            <text y="-9" textAnchor="middle">{hov.name.length > 26 ? hov.name.slice(0, 25) + '…' : hov.name}</text>
          </g>
        )}
      </svg>
      {size === 'full' && (
        <div className="gd-legend">
          <span><i className="gd-dot gd-dot-home"/> {gt('guide_you', 'You')}</span>
          {ORDER.filter(k => g[k]?.some(it => it.lat != null)).map(k => <span key={k} style={{ '--c': CAT[k].color }}><i className="gd-dot"/> {CAT[k].label()}</span>)}
        </div>
      )}
    </div>
  )
}

// ── cards ───────────────────────────────────────────────────

function Photo({ image, alt, onOpen, onCredit }) {
  const [ok, setOk] = useState(true)
  if (!image || !ok) return null
  return (
    <figure className="gd-photo">
      <img src={image.src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setOk(false)} onClick={onOpen}/>
      <figcaption>
        <button onClick={onCredit}>{[image.author, image.license].filter(Boolean).join(' · ') || 'Wikimedia Commons'}</button>
      </figcaption>
    </figure>
  )
}

function Card({ it, cat, hovered, setHover, refCb, index, inTrip, stopNo, tripFull }) {
  const reduce = useReducedMotion()
  const key = `${cat}:${it.id}`
  const go = it.directions || it.map
  return (
    <motion.article ref={refCb} className={`gd-card${hovered ? ' gd-card-hov' : ''}`} style={{ '--c': CAT[cat].color }}
      initial={reduce ? false : { opacity: 0, y: 18, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26, delay: reduce ? 0 : Math.min(index, 12) * 0.045 }}
      onMouseEnter={() => setHover(key)} onMouseLeave={() => setHover(null)}>
      <Photo image={it.image} alt={it.name} onOpen={() => openPopup({ kind: 'place', cat, it })} onCredit={() => openPopup({ kind: 'photo', cat, it })}/>
      {stopNo && <span className="gd-card-stop">{stopNo}</span>}
      <div className="gd-card-top">
        <span className="gd-card-ic"><Ico cat={cat} it={it}/></span>
        <div className="gd-card-head">
          <h3><button className="gd-linkish" onClick={() => openPopup({ kind: 'place', cat, it })}>{it.name}</button></h3>
          <div className="gd-card-sub">{[it.kind, typeof it.tag === 'string' ? it.tag : null].filter(Boolean).join(' · ')}</div>
        </div>
        {it.km != null && (
          <div className="gd-dist">
            <b className="gd-tnum">{kmText(it)}</b>
            {walkText(it) && <span>{walkText(it)}</span>}
          </div>
        )}
      </div>
      {it.custom && <span className="gd-pick">★ {gt('guide_host_pick', 'Host’s pick')}</span>}
      {it.text && <p className="gd-card-text">{it.text}</p>}
      <div className="gd-card-foot">
        {it.address && <span className="gd-addr">{it.address}</span>}
        {it.price && <span className="gd-price">{it.price}</span>}
        <span className="gd-grow"/>
        {it.url && <button className="gd-btn gd-btn-ghost" onClick={() => openPopup({ kind: 'site', url: it.url, title: it.name, back: { kind: 'place', cat, it } })}>{gt('guide_site', 'Website')}</button>}
        {it.lat != null && (
          <button className={`gd-btn gd-btn-trip${inTrip ? ' on' : ''}`} disabled={!inTrip && tripFull} onClick={() => toggleStop(cat, it)}
            title={!inTrip && tripFull ? gt('guide_trip_full', 'A trip holds up to {n} stops', { n: MAX_STOPS }) : undefined}>
            {inTrip ? `✓ ${gt('guide_in_trip', 'In the trip')}` : `+ ${gt('guide_add_trip', 'Add to trip')}`}
          </button>
        )}
        {go && <button className="gd-btn" onClick={() => openPopup({ kind: 'place', cat, it })}>{it.directions ? gt('guide_route', 'Route') : gt('guide_map', 'Map')}</button>}
      </div>
    </motion.article>
  )
}

// ── the full guide (dashboard menu → Guide) ─────────────────

function GoogleMap({ g, stops, mode, focus }) {
  const src = embedUrl({ home: g.home, stops, mode, focus, key: g.mapsKey, lang: getLang() })
  return (
    <div className="gd-gmap">
      <iframe key={src} title={gt('guide_map_label', 'Map of places around your stay')} src={src} loading="lazy" referrerPolicy="no-referrer-when-downgrade" sandbox="allow-scripts allow-same-origin"/>
    </div>
  )
}

function PlaceSearch() {
  const [q, setQ] = useState('')
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const t = useRef(null)
  const run = (v) => {
    setQ(v); clearTimeout(t.current)
    if (v.trim().length < 3) { setRes(null); return }
    t.current = setTimeout(async () => {
      setBusy(true)
      try { const j = await (await fetch(`/api/guide/search?q=${encodeURIComponent(v.trim())}&lang=${getLang()}`, { credentials: 'same-origin' })).json(); setRes(j.data || []) }
      catch { setRes([]) }
      setBusy(false)
    }, 600)
  }
  return (
    <div className="gd-search">
      <input className="gd-input" value={q} onChange={e => run(e.target.value)} placeholder={gt('guide_search_ph', 'Add any place: a café, a street, a museum…')} aria-label={gt('guide_search_ph', 'Add any place')}/>
      {busy && <div className="gd-search-note">{gt('guide_searching', 'Searching OpenStreetMap…')}</div>}
      {res && !busy && res.length === 0 && <div className="gd-search-note">{gt('guide_no_results', 'Nothing found nearby')}</div>}
      {res && res.length > 0 && (
        <div className="gd-results">
          {res.map(r => (
            <button key={r.id} className="gd-result" onClick={() => { toggleStop('search', r); setRes(null); setQ('') }}>
              <span className="gd-result-name">{r.name}</span>
              <span className="gd-result-meta">{[r.address, r.km != null ? `${dec(r.km)} km` : null].filter(Boolean).join(' · ')}</span>
              <span className="gd-result-add">+</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function TripPanel({ g, t }) {
  const [qr, setQr] = useState(false)
  const url = routeUrl(g.home, t.stops, t.mode)
  const move = (i, d) => setTrip(x => { const s = [...x.stops]; const j = i + d; if (j < 0 || j >= s.length) return x; [s[i], s[j]] = [s[j], s[i]]; return { ...x, stops: s } })
  let total = 0
  t.stops.forEach((s, i) => { total += kmBetween(i ? t.stops[i - 1] : g.home, s) })
  return (
    <div className="gd-trip">
      <div className="gd-trip-head">
        <div>
          <div className="gd-trip-title">{gt('guide_trip', 'Your trip')}</div>
          <div className="gd-trip-sub">{t.stops.length ? gt('guide_trip_sum', '{n} stops · about {km} km in a line', { n: t.stops.length, km: dec(Math.round(total * 10) / 10) }) : gt('guide_trip_empty', 'Pick places with “+ Add to trip” — several become a route with stops.')}</div>
        </div>
        <div className="gd-modes" role="group">
          {Object.keys(MODES).map(m => (
            <button key={m} className="gd-mode" data-active={String(t.mode === m)} onClick={() => setTrip(x => ({ ...x, mode: m }))} title={gt(`guide_mode_${m}`, m)}>
              {m === 'walking' ? '🚶' : m === 'transit' ? '🚋' : '🚗'}
            </button>
          ))}
        </div>
      </div>
      {t.stops.length > 0 && (
        <ol className="gd-stops">
          <li className="gd-stop gd-stop-home"><span className="gd-stop-n0">⌂</span><span className="gd-stop-name">{gt('guide_start', 'Start: your stay')}</span></li>
          {t.stops.map((s, i) => (
            <li key={s.key} className="gd-stop" style={{ '--c': CAT[s.cat]?.color || 'var(--gd-violet, #b18cff)' }}>
              <span className="gd-stop-num">{i + 1}</span>
              <span className="gd-stop-name">{s.name}</span>
              <span className="gd-stop-km gd-tnum">{dec(Math.round(kmBetween(i ? t.stops[i - 1] : g.home, s) * 10) / 10)} km</span>
              <span className="gd-stop-ctl">
                <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="▲">▲</button>
                <button onClick={() => move(i, 1)} disabled={i === t.stops.length - 1} aria-label="▼">▼</button>
                <button onClick={() => setTrip(x => ({ ...x, stops: x.stops.filter(z => z.key !== s.key) }))} aria-label="✕">✕</button>
              </span>
            </li>
          ))}
        </ol>
      )}
      {t.mode === 'transit' && t.stops.length > 1 && <div className="gd-search-note">{gt('guide_transit_note', 'Google routes public transport to one destination at a time — the map shows the stops on foot; Google Maps plans each leg.')}</div>}
      <PlaceSearch/>
      {t.stops.length > 0 && (
        <div className="gd-trip-actions">
          <button className="gd-btn gd-btn-go" onClick={() => openPopup({ kind: 'trip' })}>{gt('guide_show_route', 'Show the route')}</button>
          {t.stops.length > 2 && <button className="gd-btn gd-btn-ghost" onClick={() => setTrip(x => ({ ...x, stops: optimise(g.home, x.stops) }))}>{gt('guide_optimise', 'Shortest order')}</button>}
          <button className="gd-btn gd-btn-ghost" onClick={() => setQr(!qr)}>{gt('guide_to_phone', 'To phone')}</button>
          <button className="gd-btn gd-btn-ghost" onClick={() => setTrip(x => ({ ...x, stops: [] }))}>{gt('guide_clear', 'Clear')}</button>
        </div>
      )}
      {qr && url && (
        <div className="gd-qr">
          <img src={`/api/guide/qr?url=${encodeURIComponent(url)}`} alt={gt('guide_qr_alt', 'QR code of the route')} width="168" height="168"/>
          <span>{gt('guide_qr_text', 'Scan with your phone’s camera to take the route along.')}</span>
        </div>
      )}
    </div>
  )
}

// ── ready-made walks: one tap fills the trip ────────────────

const walkStops = (g, w) => w.stops.map((key) => {
  const [cat, id] = key.split(':')
  const it = (g[cat] || []).find(x => x.id === id)
  return it?.lat != null ? { key, cat, name: it.name, lat: it.lat, lon: it.lon } : null
}).filter(Boolean)

function Walks({ g, t }) {
  const current = t.stops.map(s => s.key).join('|')
  return (
    <div className="gd-walks">
      <div className="gd-trip-title">{gt('guide_walks', 'Ready-made walks')}</div>
      {g.walks.map(w => {
        const stops = walkStops(g, w)
        const loaded = current === stops.map(s => s.key).join('|')
        return (
          <div key={w.id} className="gd-walk" data-on={String(loaded)}>
            <span className="gd-walk-ic" aria-hidden="true">{w.icon || '🚶'}</span>
            <div className="gd-walk-body">
              <div className="gd-walk-name">{w.name}</div>
              <div className="gd-walk-text">{w.text}</div>
              <div className="gd-walk-stops">{stops.map((s, i) => <span key={s.key} style={{ '--c': CAT[s.cat]?.color }}><b>{i + 1}</b> {s.name}</span>)}</div>
            </div>
            <button className={`gd-btn${loaded ? ' gd-btn-ghost' : ' gd-btn-go'}`} disabled={loaded}
              onClick={() => setTrip({ mode: w.mode, stops })} title={gt(`guide_mode_${w.mode}`, w.mode)}>
              {loaded ? `✓ ${gt('guide_walk_loaded', 'In your trip')}` : `${w.mode === 'transit' ? '🚋' : '🚶'} ${gt('guide_walk_go', 'Take this walk')}`}
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ── filters for a tab: its tags, vegetarian, cheap, the host's picks ──

function filtersOf(items) {
  const out = []
  const tags = [...new Set(items.map(it => (typeof it.tag === 'string' ? it.tag : null)).filter(Boolean))]
  if (items.some(it => it.custom)) out.push({ id: 'custom', label: `★ ${gt('guide_host_pick', 'Host’s pick')}`, test: it => it.custom })
  if (tags.length > 1) for (const tag of tags) out.push({ id: `tag:${tag}`, label: tag, test: it => it.tag === tag })
  if (items.some(it => it.veg)) out.push({ id: 'veg', label: `🌱 ${gt('guide_veg', 'Vegetarian')}`, test: it => it.veg })
  const cheap = items.filter(it => it.price === '€').length
  if (cheap && cheap < items.length) out.push({ id: 'cheap', label: `€ ${gt('guide_cheap', 'Cheap eats')}`, test: it => it.price === '€' })
  return out.map(f => ({ ...f, n: items.filter(f.test).length })).filter(f => f.n > 0 && f.n < items.length)
}

// a random pick, nearby first (within 5 km when there are enough)
function surprise(items) {
  const near = items.filter(it => it.km == null || it.km <= 5)
  const pool = near.length >= 3 ? near : items
  return pool[Math.floor(Math.random() * pool.length)] || null
}

// ── Po śląsku: tap a word for its meaning ───────────────────

const dayIndex = (n) => { const d = new Date(); return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000) % n }

function Phrasebook({ phrases }) {
  const [open, setOpen] = useState(() => new Set())
  const flip = (i) => setOpen(o => { const n = new Set(o); n.has(i) ? n.delete(i) : n.add(i); return n })
  return (
    <section className="gd-phrases">
      <div className="gd-phrases-head">
        <div className="gd-trip-title">{gt('guide_phrases', 'Speak Silesian')}</div>
        <div className="gd-trip-sub">{gt('guide_phrases_hint', 'Words you’ll hear around here. Tap one for its meaning.')}</div>
      </div>
      <div className="gd-phrase-grid">
        {phrases.map((p, i) => (
          <button key={p.sl} className="gd-phrase" data-open={String(open.has(i))} onClick={() => flip(i)} aria-expanded={open.has(i)}>
            <span className="gd-phrase-sl">{p.sl}</span>
            <span className="gd-phrase-m">{open.has(i) ? p.meaning : '···'}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

// the place a card points at, for the map when there's no trip yet
function focusOf(g, key) {
  if (!key) return null
  const [cat, id] = key.split(':')
  const it = (g[cat] || []).find(x => x.id === id)
  return it?.lat != null ? it : null
}

export function CityGuidePage() {
  const g = useGuide()
  const t = useTrip()
  const [tab, setTab] = useState('places')
  const [filter, setFilter] = useState(null)
  const [hover, setHover] = useState(null)
  const [view, setView] = useState(() => (trip.stops.length ? 'map' : 'radar'))
  const refs = useRef({})
  const prevCount = useRef(t.stops.length)
  const [hoverStick, setHoverStick] = useState(null) // the map follows the last card you pointed at
  useEffect(() => { if (t.stops.length > prevCount.current) setView('map'); prevCount.current = t.stops.length }, [t.stops.length])
  if (!g) return <div className="gd-off">{gt('guide_off', 'The guide is off — turn it on in Settings → Onboarding.')}</div>
  const tabs = ORDER.filter(k => g[k]?.length)
  const cur = g[tab]?.length ? tab : tabs[0]
  const idx = tabs.indexOf(cur)
  const filters = filtersOf(g[cur] || [])
  const active = filters.find(f => f.id === filter)
  const shown = (g[cur] || []).filter(it => !active || active.test(it))
  const showTab = (k) => { setTab(k); setFilter(null) }
  const pick = (cat, key) => {
    if (cat !== cur) setFilter(null)
    setTab(cat); setHover(key)
    setTimeout(() => refs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120)
  }
  return (
    <div className="gd">
      <GuidePopups g={g}/>
      <Hero g={g}/>
      <div className="gd-main">
        <aside className="gd-side">
          {g.home && (
            <div className="gd-views" role="tablist">
              <button role="tab" className="gd-view" data-active={String(view === 'radar')} onClick={() => setView('radar')}>{gt('guide_radar', 'Radar')}</button>
              <button role="tab" className="gd-view" data-active={String(view === 'map')} onClick={() => setView('map')}>{gt('guide_gmap', 'Google map')}</button>
            </div>
          )}
          {view === 'map' && g.home
            ? <GoogleMap g={g} stops={t.stops} mode={t.mode} focus={!t.stops.length ? focusOf(g, hoverStick) : null}/>
            : <Radar g={g} active={cur} hover={hover} setHover={setHover} onPick={pick} tripStops={t.stops}/>}
          {g.home && <TripPanel g={g} t={t}/>}
          {g.home && g.walks?.length > 0 && <Walks g={g} t={t}/>}
        </aside>
        <div className="gd-list">
          <div className="gd-tabs" role="tablist" style={{ '--n': tabs.length, '--i': idx, '--c': CAT[cur]?.color }}>
            <span className="gd-tab-ind" aria-hidden="true"/>
            {tabs.map(k => (
              <button key={k} role="tab" aria-selected={cur === k} className="gd-tab" data-active={String(cur === k)} onClick={() => showTab(k)}>
                <Ico cat={k} it={{ icon: 'tram' }} size={16}/> <span className="gd-tab-label">{CAT[k].label()}</span> <span className="gd-tab-n gd-tnum">{g[k].length}</span>
              </button>
            ))}
          </div>
          {(filters.length > 0 || cur !== 'transport') && (
            <div className="gd-filters" role="group" style={{ '--c': CAT[cur]?.color }}>
              {filters.length > 0 && <button className="gd-filter" data-active={String(!active)} onClick={() => setFilter(null)}>{gt('guide_all', 'All')}</button>}
              {filters.map(f => (
                <button key={f.id} className="gd-filter" data-active={String(active?.id === f.id)} onClick={() => setFilter(active?.id === f.id ? null : f.id)}>
                  {f.label} <span className="gd-tnum">{f.n}</span>
                </button>
              ))}
              {cur !== 'transport' && shown.length > 1 && (
                <button className="gd-filter gd-dice" onClick={() => { const it = surprise(shown); if (it) { setHover(`${cur}:${it.id}`); openPopup({ kind: 'place', cat: cur, it }) } }}
                  title={gt('guide_surprise_hint', 'Can’t decide? Pick one for me')}>
                  <span aria-hidden="true">🎲</span> {gt('guide_surprise', 'Surprise me')}
                </button>
              )}
            </div>
          )}
          <div className="gd-cards" key={`${cur}|${filter || ''}`}>
            {shown.map((it, i) => (
              <Card key={it.id} it={it} cat={cur} index={i} hovered={hover === `${cur}:${it.id}`} setHover={(k) => { setHover(k); if (k) setHoverStick(k) }}
                inTrip={t.stops.some(s => s.key === `${cur}:${it.id}`)} stopNo={(t.stops.findIndex(s => s.key === `${cur}:${it.id}`) + 1) || null}
                tripFull={t.stops.length >= MAX_STOPS} refCb={(el) => { refs.current[`${cur}:${it.id}`] = el }}/>
            ))}
          </div>
          {g.phrases?.length > 0 && <Phrasebook phrases={g.phrases}/>}
          {g.sources?.length > 0 && (
            <div className="gd-sources">
              {gt('guide_sources', 'Sources')}: {g.sources.map((s, i) => (
                <span key={s.url}>{i > 0 && ' · '}<button className="gd-linkish gd-src" onClick={() => openPopup({ kind: 'site', url: s.url, title: s.name })}>{s.name}</button></span>
              ))}
              {g.generated && <> · {gt('guide_generated', 'written by Claude on {date} — check opening hours before you go', { date: new Date(g.generated.at).toLocaleDateString(getLang()) })}</>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── the welcome card on the home view ───────────────────────

export default function CityGuideCard({ onOpen }) {
  const g = useGuide()
  const tripNow = useTrip()
  const [hover, setHover] = useState(null)
  if (!g) return null
  const col = (k, n) => g[k]?.length > 0 && (
    <div className="gd-col" style={{ '--c': CAT[k].color }}>
      <div className="gd-col-title"><Ico cat={k} it={{ icon: 'tram' }} size={14}/> {CAT[k].label()}</div>
      {g[k].slice(0, n).map(it => (
        <button key={it.id} className={`gd-mini${hover === `${k}:${it.id}` ? ' gd-mini-hov' : ''}`} onClick={() => openPopup({ kind: 'place', cat: k, it })}
          onMouseEnter={() => setHover(`${k}:${it.id}`)} onMouseLeave={() => setHover(null)}>
          {it.image && <img className="gd-mini-img" src={it.image.src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none' }}/>}
          <span className="gd-mini-name">{it.name}</span>
          {kmText(it) && <span className="gd-mini-dist gd-tnum">{kmText(it)}</span>}
        </button>
      ))}
    </div>
  )
  return (
    <div className="gd gd-home-card">
      <GuidePopups g={g}/>
      <Hero g={g} compact onOpen={onOpen}/>
      <div className="gd-home-body">
        <Radar g={g} hover={hover} setHover={setHover} size="mini" tripStops={tripNow.stops}
          onPick={(cat, key) => { const it = (g[cat] || []).find(x => `${cat}:${x.id}` === key); if (it) openPopup({ kind: 'place', cat, it }) }}/>
        <div className="gd-cols">
          {col('places', 3)}
          {col('activities', 3)}
          {col('restaurants', 3)}
          {col('transport', 3)}
        </div>
      </div>
    </div>
  )
}
