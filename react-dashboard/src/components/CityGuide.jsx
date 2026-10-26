import { useEffect, useMemo, useRef, useState } from 'react'
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
  restaurants: { color: 'var(--gd-food)', label: () => gt('guide_food', 'Restaurants') },
  transport:   { color: 'var(--gd-move)', label: () => gt('guide_transport', 'Getting around') },
}
const ORDER = ['places', 'restaurants', 'transport']

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }
const ICONS = {
  places: <><path {...P} d="M3 21h18M5 21V10M19 21V10M9 21v-7M15 21v-7"/><path {...P} d="M2.5 10 12 4l9.5 6z"/></>,
  restaurants: <><path {...P} d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10"/><path {...P} d="M17 21V3c-2 1.5-3 4-3 7 0 1.5 1 2.5 3 2.5"/></>,
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
  const days = useForecast()
  const today = days?.[0]
  const temp = today?.now?.temp ?? today?.tempMax
  const counts = ORDER.filter(k => g[k]).map(k => ({ k, n: g[k].length }))
  return (
    <section className={`gd-hero${compact ? ' gd-hero-compact' : ''}`}>
      <div className="gd-aurora" aria-hidden="true"><i/><i/><i/></div>
      <div className="gd-dots" aria-hidden="true"/>
      <Skyline city={g.skyline || g.city}/>
      <div className="gd-hero-body">
        <div className="gd-eyebrow"><MapPinIcon size={14} color="currentColor"/> {g.cityName}</div>
        <h2 className="gd-title">{g.title || gt('guide_welcome_to', 'Welcome to {city}', { city: g.cityName })}</h2>
        <p className="gd-welcome">{g.welcome}</p>
        <div className="gd-chips">
          <span className="gd-chip"><b className="gd-tnum">{now.toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit' })}</b> {now.toLocaleDateString(getLang(), { weekday: 'long' })}</span>
          {temp != null && <span className="gd-chip"><span aria-hidden="true">{today?.now?.icon || today?.icon}</span> <b className="gd-tnum">{Math.round(temp)}°</b></span>}
          {g.home && <span className="gd-chip"><b className="gd-tnum">{dec(g.home.centreKm)} km</b> {gt('guide_to_centre', 'to the centre')}</span>}
          {!compact && counts.map(({ k, n }) => <span key={k} className="gd-chip" style={{ '--c': CAT[k].color }}><i className="gd-dot"/> <b className="gd-tnum">{n}</b> {CAT[k].label().toLowerCase()}</span>)}
        </div>
        {compact && onOpen && <button className="gd-cta" onClick={onOpen}>{gt('guide_open', 'Full guide')} <span aria-hidden="true">→</span></button>}
      </div>
    </section>
  )
}

// ── radar ───────────────────────────────────────────────────

function Radar({ g, active, hover, setHover, onPick, size = 'full' }) {
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

function Card({ it, cat, hovered, setHover, refCb, index }) {
  const reduce = useReducedMotion()
  const key = `${cat}:${it.id}`
  const go = it.directions || it.map
  return (
    <motion.article ref={refCb} className={`gd-card${hovered ? ' gd-card-hov' : ''}`} style={{ '--c': CAT[cat].color }}
      initial={reduce ? false : { opacity: 0, y: 18, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26, delay: reduce ? 0 : Math.min(index, 12) * 0.045 }}
      onMouseEnter={() => setHover(key)} onMouseLeave={() => setHover(null)}>
      <div className="gd-card-top">
        <span className="gd-card-ic"><Ico cat={cat} it={it}/></span>
        <div className="gd-card-head">
          <h3>{it.name}</h3>
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
        {it.url && <a className="gd-btn gd-btn-ghost" href={it.url} target="_blank" rel="noopener noreferrer">{gt('guide_site', 'Website')}</a>}
        {go && <a className="gd-btn" href={go} target="_blank" rel="noopener noreferrer">{it.directions ? gt('guide_route', 'Route') : gt('guide_map', 'Map')} <span aria-hidden="true">↗</span></a>}
      </div>
    </motion.article>
  )
}

// ── the full guide (dashboard menu → Guide) ─────────────────

export function CityGuidePage() {
  const g = useGuide()
  const [tab, setTab] = useState('places')
  const [hover, setHover] = useState(null)
  const refs = useRef({})
  if (!g) return <div className="gd-off">{gt('guide_off', 'The guide is off — turn it on in Settings → Onboarding.')}</div>
  const tabs = ORDER.filter(k => g[k]?.length)
  const cur = g[tab]?.length ? tab : tabs[0]
  const idx = tabs.indexOf(cur)
  const pick = (cat, key) => {
    setTab(cat); setHover(key)
    setTimeout(() => refs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120)
  }
  return (
    <div className="gd">
      <Hero g={g}/>
      <div className="gd-main">
        <aside className="gd-side">
          <Radar g={g} active={cur} hover={hover} setHover={setHover} onPick={pick}/>
        </aside>
        <div className="gd-list">
          <div className="gd-tabs" role="tablist" style={{ '--n': tabs.length, '--i': idx, '--c': CAT[cur]?.color }}>
            <span className="gd-tab-ind" aria-hidden="true"/>
            {tabs.map(k => (
              <button key={k} role="tab" aria-selected={cur === k} className="gd-tab" data-active={String(cur === k)} onClick={() => setTab(k)}>
                <Ico cat={k} it={{ icon: 'tram' }} size={16}/> <span className="gd-tab-label">{CAT[k].label()}</span> <span className="gd-tab-n gd-tnum">{g[k].length}</span>
              </button>
            ))}
          </div>
          <div className="gd-cards" key={cur}>
            {(g[cur] || []).map((it, i) => (
              <Card key={it.id} it={it} cat={cur} index={i} hovered={hover === `${cur}:${it.id}`} setHover={setHover}
                refCb={(el) => { refs.current[`${cur}:${it.id}`] = el }}/>
            ))}
          </div>
          {g.sources?.length > 0 && (
            <div className="gd-sources">
              {gt('guide_sources', 'Sources')}: {g.sources.map((s, i) => (
                <span key={s.url}>{i > 0 && ' · '}<a href={s.url} target="_blank" rel="noopener noreferrer">{s.name}</a></span>
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
  const [hover, setHover] = useState(null)
  if (!g) return null
  const col = (k, n) => g[k]?.length > 0 && (
    <div className="gd-col" style={{ '--c': CAT[k].color }}>
      <div className="gd-col-title"><Ico cat={k} it={{ icon: 'tram' }} size={14}/> {CAT[k].label()}</div>
      {g[k].slice(0, n).map(it => (
        <a key={it.id} className={`gd-mini${hover === `${k}:${it.id}` ? ' gd-mini-hov' : ''}`} href={it.directions || it.map || it.url || undefined} target="_blank" rel="noopener noreferrer"
          onMouseEnter={() => setHover(`${k}:${it.id}`)} onMouseLeave={() => setHover(null)}>
          <span className="gd-mini-name">{it.name}</span>
          {kmText(it) && <span className="gd-mini-dist gd-tnum">{kmText(it)}</span>}
        </a>
      ))}
    </div>
  )
  return (
    <div className="gd gd-home-card">
      <Hero g={g} compact onOpen={onOpen}/>
      <div className="gd-home-body">
        <Radar g={g} hover={hover} setHover={setHover} size="mini" onPick={() => onOpen?.()}/>
        <div className="gd-cols">
          {col('places', 3)}
          {col('restaurants', 3)}
          {col('transport', 3)}
        </div>
      </div>
    </div>
  )
}
