import { useEffect, useState } from 'react'
import { gt, getLang } from '../i18n'
import { MapPinIcon } from './Icons'

// Onboarding: a welcome card on the home view and the full city guide
// (dashboard menu → Guide) — getting around, where to eat and what to see,
// nearest first. Data: GET /api/guide (src/routes/guide.js); renders nothing
// while the guide is off (Settings → Onboarding).

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

const TRANSPORT_ICON = { tram: '🚋', route: '🧭', plane: '✈️', train: '🚆', bike: '🚲', car: '🚕' }

const distance = (it) => {
  if (it.km == null) return null
  const d = it.km < 1 ? `${Math.round(it.km * 1000)} m` : `${String(it.km).replace('.', getLang() === 'pl' ? ',' : '.')} km`
  return it.walkMin != null ? `${d} · ${gt('guide_walk', '{n} min walk', { n: it.walkMin })}` : d
}

function Links({ it }) {
  const a = (href, label) => href && (
    <a href={href} target="_blank" rel="noopener noreferrer" className="guide-link" onClick={e => e.stopPropagation()}>{label}</a>
  )
  return (
    <div className="guide-links">
      {a(it.directions, gt('guide_route', 'Route'))}
      {!it.directions && a(it.map, gt('guide_map', 'Map'))}
      {a(it.url, gt('guide_site', 'Website'))}
    </div>
  )
}

function Item({ it, transport }) {
  return (
    <div className="guide-item">
      <div className="guide-item-head">
        {transport && <span className="guide-emoji" aria-hidden="true">{TRANSPORT_ICON[it.icon] || '•'}</span>}
        <span className="guide-name">{it.name}</span>
        {it.custom && <span className="badge badge-blue">{gt('guide_host_pick', 'Host’s pick')}</span>}
        {it.tag && !transport && <span className="badge badge-gray">{it.tag}</span>}
        {it.price && <span className="guide-price">{it.price}</span>}
      </div>
      {(it.kind || distance(it)) && (
        <div className="guide-meta">{[it.kind, distance(it)].filter(Boolean).join(' · ')}</div>
      )}
      {it.text && <p className="guide-text">{it.text}</p>}
      {it.address && <div className="guide-addr">{it.address}</div>}
      <Links it={it} />
    </div>
  )
}

const TABS = [
  ['places', () => gt('guide_places', 'Places to visit')],
  ['restaurants', () => gt('guide_food', 'Restaurants')],
  ['transport', () => gt('guide_transport', 'Getting around')],
]

// The full guide (dashboard menu → Guide)
export function CityGuidePage() {
  const g = useGuide()
  const [tab, setTab] = useState('places')
  if (!g) return <div style={{ color: 'var(--text3)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>{gt('guide_off', 'The guide is off — turn it on in Settings → Onboarding.')}</div>
  const tabs = TABS.filter(([k]) => g[k])
  const cur = g[tab] ? tab : tabs[0]?.[0]
  return (
    <div className="guide-page">
      <div className="card guide-hero">
        <div className="guide-eyebrow">{g.title || gt('guide_welcome_to', 'Welcome to {city}', { city: g.cityName })}</div>
        <p className="guide-welcome">{g.welcome}</p>
        {g.home && <div className="guide-meta">{gt('guide_from_home', 'Distances from your stay · {km} km from the centre', { km: String(g.home.centreKm).replace('.', getLang() === 'pl' ? ',' : '.') })}</div>}
      </div>
      <div className="guide-tabs" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={cur === k} className="guide-tab" data-active={String(cur === k)} onClick={() => setTab(k)}>
            {label()} <span className="guide-tab-n">{g[k].length}</span>
          </button>
        ))}
      </div>
      <div className="guide-grid">
        {(g[cur] || []).map(it => <Item key={it.id} it={it} transport={cur === 'transport'} />)}
      </div>
      {g.sources?.length > 0 && (
        <div className="guide-sources">
          {gt('guide_sources', 'Sources')}: {g.sources.map((s, i) => (
            <span key={s.url}>{i > 0 && ' · '}<a href={s.url} target="_blank" rel="noopener noreferrer">{s.name}</a></span>
          ))}
          {g.generated && <> · {gt('guide_generated', 'written by Claude on {date} — check opening hours before you go', { date: new Date(g.generated.at).toLocaleDateString(getLang()) })}</>}
        </div>
      )}
    </div>
  )
}

// The welcome card on the home view: the nearest few of each
export default function CityGuideCard({ onOpen }) {
  const g = useGuide()
  if (!g) return null
  const col = (k, title, n) => g[k]?.length > 0 && (
    <div className="guide-col">
      <div className="guide-col-title">{title}</div>
      {g[k].slice(0, n).map(it => (
        <a key={it.id} className="guide-mini" href={it.directions || it.map || it.url || undefined} target="_blank" rel="noopener noreferrer">
          <span className="guide-mini-name">{k === 'transport' && <span aria-hidden="true">{TRANSPORT_ICON[it.icon] || '•'} </span>}{it.name}</span>
          {distance(it) && <span className="guide-mini-dist">{distance(it)}</span>}
        </a>
      ))}
    </div>
  )
  return (
    <div className="card guide-card">
      <div className="tile-sec-head" style={{ margin: '0 0 6px' }}>
        <span className="tile-sec-ic" style={{ '--cat-c': 'var(--teal)' }}><MapPinIcon size={15} color="var(--teal)" /></span>
        <span className="tile-sec-title">{g.title || gt('guide_welcome_to', 'Welcome to {city}', { city: g.cityName })}</span>
        {onOpen && <button className="guide-open" onClick={onOpen}>{gt('guide_open', 'Full guide')} ›</button>}
      </div>
      <p className="guide-welcome">{g.welcome}</p>
      <div className="guide-cols">
        {col('places', gt('guide_places', 'Places to visit'), 3)}
        {col('restaurants', gt('guide_food', 'Restaurants'), 3)}
        {col('transport', gt('guide_transport', 'Getting around'), 3)}
      </div>
    </div>
  )
}
