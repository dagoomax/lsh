import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { getLang } from '../i18n'
import { localAudio } from '../localAudio'

// Media player: internet radio, streams and audio file URLs on this screen (the
// browser), a Chromecast (Google Home, Nest, Chromecast-built-in) or an AirPlay
// speaker (HomePod, Apple TV, AirPlay 2) — now playing with artwork and the live
// song title, a "Play on" output picker, favourites and a station directory.
// Server: src/routes/media.js; this screen: src/localAudio.js.
//   compact — Wall Dashboard: now playing, controls, favourites strip
//   fill    — a widget in the custom dashboard grid (fills its box, scrolls)
const COUNTRY = { pl: 'PL', de: 'DE', fr: 'FR', es: 'ES', it: 'IT', uk: 'UA' }
const LAST_KEY = 'lsh-media-last'
const PREF_KEY = 'lsh-media-pref-volume' // AirPlay speaker → level to start at

export default function MediaPlayer({ compact = false, fill = false, embedded = false }) {
  const [data, setData] = useState(null)
  const [sel, setSel] = useState(() => store.get('lsh-media-target') || '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [hold, setHold] = useState({}) // target id → { v, muted, until }: what the user just set, until the server catches up
  const [tab, setTab] = useState('fav')
  const [song, setSong] = useState('')
  const [last, setLast] = useState(() => { try { return JSON.parse(store.get(LAST_KEY) || 'null') } catch { return null } })
  const [browse, setBrowse] = useState({ q: '', list: null, loading: false, error: null })
  const volTimers = useRef({})
  const [prefs, setPrefs] = useState(() => { try { return JSON.parse(store.get(PREF_KEY) || '{}') } catch { return {} } })
  const local = useSyncExternalStore(localAudio.subscribe, localAudio.get)

  const load = useCallback(() => fetch('/api/media/targets', { credentials: 'include' })
    .then((r) => r.json()).then((j) => { if (j.success && Array.isArray(j.data?.targets)) setData(j.data) }).catch(() => {}), [])
  useEffect(() => {
    load()
    const t = setInterval(() => { if (!document.hidden) load() }, 5000)
    return () => clearInterval(t)
  }, [load])

  const here = { id: 'local', kind: 'browser', name: T('thisScreen'), state: local.status, title: local.title, url: local.url, volume: local.volume, muted: local.muted }
  const targets = [here, ...(data?.targets || [])]
  const target = targets.find((t) => t.id === sel) || targets.find((t) => t.kind !== 'browser') || here
  const isHere = target.kind === 'browser'
  const stations = data?.stations || []
  const playing = ['playing', 'buffering'].includes(target.state)
  const paused = target.state === 'paused'
  const active = playing || paused
  const canPause = target.kind !== 'airplay' // an AirPlay stream can only be stopped

  // what's on: the station (from favourites / directory / last played) and the live song
  const known = useMemo(() => {
    const m = new Map()
    for (const s of [...(browse.list || []), ...stations, ...(last ? [last] : [])]) if (s?.url) m.set(s.url, s)
    return m
  }, [browse.list, stations, last])
  const station = active ? (known.get(target.url) || { name: target.title, url: target.url }) : null
  useEffect(() => {
    setSong('')
    if (!playing || !target.url) return
    let stop = false
    const get = () => fetch(`/api/media/nowplaying?url=${encodeURIComponent(target.url)}`, { credentials: 'include' })
      .then((r) => r.json()).then((j) => { if (!stop && j.success) setSong(j.data?.title || '') }).catch(() => {})
    get()
    const t = setInterval(() => { if (!document.hidden) get() }, 20000)
    return () => { stop = true; clearInterval(t) }
  }, [playing, target.url])

  // directory: top stations of the dashboard language's country, or a search
  const country = COUNTRY[getLang()] || ''
  const runSearch = useCallback((q) => {
    setBrowse((b) => ({ ...b, q, loading: true, error: null }))
    fetch(`/api/media/radio?q=${encodeURIComponent(q)}&country=${q ? '' : country}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => setBrowse((b) => (b.q !== q ? b : { ...b, loading: false, list: j.success ? j.data : [], error: j.success ? null : j.error })))
      .catch((err) => setBrowse((b) => ({ ...b, loading: false, error: err.message })))
  }, [country])
  useEffect(() => { if (tab === 'browse' && browse.list === null && !browse.loading) runSearch('') }, [tab])
  const searchTimer = useRef(null)
  const onSearch = (q) => {
    setBrowse((b) => ({ ...b, q }))
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => runSearch(q.trim()), 400)
  }

  const pick = (id) => { setSel(id); store.set('lsh-media-target', id) }
  const post = async (path, body) => {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch(`/api/media/${path}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!j.success) setMsg(j.error || `HTTP ${r.status}`)
      setTimeout(load, 800)
      return j.success
    } catch (err) { setMsg(err.message); return false } finally { setBusy(false) }
  }
  const play = (st) => {
    const remembered = { name: st.name, url: st.url, ...(st.favicon ? { favicon: st.favicon } : {}) }
    setLast(remembered); store.set(LAST_KEY, JSON.stringify(remembered))
    if (isHere) { setMsg(null); return localAudio.play(st.url, st.name, `/api/media/stream?url=${encodeURIComponent(st.url)}`) }
    const start = target.kind === 'airplay' && !active ? prefs[target.id] : undefined
    const eq = target.kind === 'airplay' && local.eq?.on && local.eq.gains.some((g) => g) ? { eq: local.eq.gains } : {} // AirPlay plays through ffmpeg, which can equalize
    return post('play', { target: target.id, url: st.url, title: st.name, ...(start != null ? { volume: start } : {}), ...eq })
  }
  const act = (action) => {
    if (isHere) {
      setMsg(null)
      return { pause: () => localAudio.pause(), resume: () => localAudio.resume(), stop: () => localAudio.stop() }[action]()
    }
    return post(action, { target: target.id })
  }
  const mainButton = () => {
    if (playing) return canPause ? act('pause') : act('stop')
    if (paused) return act('resume')
    if (last) return play(last)
    setTab('browse')
  }
  // ── volume ──
  const isLive = (t) => ['playing', 'buffering', 'paused'].includes(t.state)
  const volumeOf = (t) => {
    const h = hold[t.id]
    if (h && h.until > Date.now()) return h
    if (t.kind === 'airplay' && !isLive(t)) return { v: prefs[t.id] ?? 60, muted: false, pref: true } // level it will start at
    return t.volume == null ? null : { v: t.volume, muted: !!t.muted }
  }
  const keep = (t, patch) => {
    setHold((h) => ({ ...h, [t.id]: { ...(volumeOf(t) || { v: 50, muted: false }), ...patch, until: Date.now() + 4000 } }))
    setTimeout(() => setHold((h) => (h[t.id]?.until <= Date.now() ? (({ [t.id]: _, ...rest }) => rest)(h) : h)), 4100)
  }
  const setVolume = (t, v) => {
    v = Math.max(0, Math.min(100, Math.round(v)))
    keep(t, { v, muted: false })
    if (t.kind === 'browser') return localAudio.setVolume(v)
    if (t.kind === 'airplay' && !isLive(t)) {
      const next = { ...prefs, [t.id]: v }
      setPrefs(next); store.set(PREF_KEY, JSON.stringify(next))
      return
    }
    clearTimeout(volTimers.current[t.id])
    volTimers.current[t.id] = setTimeout(() => post('volume', { target: t.id, volume: v }), 300)
  }
  const setMuted = (t, muted) => {
    keep(t, { muted })
    if (t.kind === 'browser') return localAudio.setMuted(muted)
    if (t.kind === 'airplay' && !isLive(t)) return
    post('mute', { target: t.id, muted })
  }
  const vol = volumeOf(target)

  const isFav = (st) => stations.some((s) => s.url === st.url)
  const toggleFav = (st) => post('stations', {
    stations: isFav(st) ? stations.filter((s) => s.url !== st.url) : [...stations, { name: st.name, url: st.url, ...(st.favicon ? { favicon: st.favicon } : {}) }],
  }).then(load)

  const error = msg || (isHere && local.error ? T(local.error) : null)
  const tint = station ? hue(station.name || station.url) : 211
  const meta = station && [T('live'), known.get(target.url)?.codec, known.get(target.url)?.bitrate ? `${known.get(target.url).bitrate} kbps` : ''].filter(Boolean).join(' · ')

  return (
    <div className={`${embedded ? '' : 'card '}mp${compact ? ' mp-compact' : ''}${fill ? ' mp-fill' : ''}${embedded ? ' mp-embedded' : ''}${active ? ' mp-active' : ''}`} style={{ '--mp-hue': tint }}>
      <div className="mp-now">
        <Artwork station={station} size={compact ? 64 : 96} playing={playing} />
        <div className="mp-info">
          <div className="mp-kicker">{active ? (paused ? T('paused') : meta) : T('title')}</div>
          <div className="mp-name">{station?.name || T('idle')}</div>
          <div className="mp-song">
            {active ? (song || (playing ? T('playingOn', { name: target.name }) : target.name)) : (last ? T('lastPlayed', { name: last.name }) : T('pickStation'))}
          </div>
        </div>
        {!compact && <OutputPicker targets={targets} target={target} ready={data !== null || sel === 'local'} onPick={pick} volumeOf={volumeOf} setVolume={setVolume} setMuted={setMuted} />}
      </div>

      <div className="mp-controls">
        <button className="mp-main" onClick={mainButton} disabled={busy} aria-label={playing ? (canPause ? T('pause') : T('stop')) : T('play')} title={playing ? (canPause ? T('pause') : T('stop')) : T('play')}>
          {playing ? (canPause ? <PauseIcon /> : <StopIcon />) : <PlayIcon />}
        </button>
        {active && canPause && <button className="mp-round" onClick={() => act('stop')} disabled={busy} aria-label={T('stop')} title={T('stop')}><StopIcon /></button>}
        {vol && <VolumeControl value={vol.v} muted={vol.muted} hint={vol.pref ? T('startsAt') : ''} steps={!compact}
          onChange={(v) => setVolume(target, v)} onMute={(m) => setMuted(target, m)} />}
        {compact && <OutputPicker targets={targets} target={target} ready={data !== null || sel === 'local'} onPick={pick} small volumeOf={volumeOf} setVolume={setVolume} setMuted={setMuted} />}
      </div>
      {error && <div className="mp-error">{error}</div>}

      {compact ? (
        <div className="mp-strip">
          {(stations.length ? stations : []).map((st) => (
            <button key={st.url} className="mp-strip-item" data-on={String(active && st.url === target.url)} onClick={() => play(st)} disabled={busy} title={st.name}>
              <Logo station={st} size={44} />
              <span>{st.name}</span>
            </button>
          ))}
          {!stations.length && <div className="mp-empty">{T('noStations')}</div>}
        </div>
      ) : (
        <>
          <div className="mp-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'fav'} onClick={() => setTab('fav')}>{T('favourites')}{stations.length ? ` · ${stations.length}` : ''}</button>
            <button role="tab" aria-selected={tab === 'browse'} onClick={() => setTab('browse')}>{T('browse')}</button>
          </div>
          {tab === 'fav' && (
            <div className="mp-grid">
              {stations.map((st) => <StationTile key={st.url} st={st} on={active && st.url === target.url} fav onPlay={play} onFav={toggleFav} busy={busy} />)}
              <AddUrlTile onAdd={(st) => post('stations', { stations: [...stations.filter((s) => s.url !== st.url), st] }).then(load)} onPlay={play} busy={busy} />
            </div>
          )}
          {tab === 'browse' && (
            <>
              <div className="mp-search">
                <SearchIcon />
                <input value={browse.q} onChange={(e) => onSearch(e.target.value)} placeholder={T('searchPh')} aria-label={T('searchPh')} />
              </div>
              {browse.loading && !browse.list && <div className="mp-empty">{T('loading')}</div>}
              {browse.error && <div className="mp-error">{browse.error}</div>}
              {browse.list && (
                <div className="mp-grid">
                  {browse.list.map((st) => <StationTile key={st.url} st={st} on={active && st.url === target.url} fav={isFav(st)} onPlay={play} onFav={toggleFav} busy={busy} />)}
                  {!browse.list.length && !browse.loading && <div className="mp-empty">{T('noResults')}</div>}
                </div>
              )}
              <div className="mp-credit">{T('directory')} <a href="https://www.radio-browser.info" target="_blank" rel="noreferrer">radio-browser.info</a></div>
            </>
          )}
        </>
      )}
    </div>
  )
}

function OutputPicker({ targets, target, ready, onPick, small, volumeOf, setVolume, setMuted }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  const Icon = (t) => (t.kind === 'airplay' ? <AirPlayIcon /> : t.kind === 'chromecast' ? <CastIcon /> : <ScreenIcon />)
  return (
    <div className={`mp-output${small ? ' small' : ''}`} ref={ref}>
      <button className="mp-output-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} title={`${T('playOn')}: ${target.name}`}>
        {Icon(target)}
        <span className="mp-output-label">{!small && <small>{T('playOn')}</small>}{ready ? target.name : '…'}</span>
        <ChevronIcon />
      </button>
      {open && (
        <div className="mp-output-menu" role="listbox">
          {targets.map((t) => {
            const v = volumeOf(t)
            return (
              <div key={t.id} className="mp-output-row" data-on={String(t.id === target.id)}>
                <button role="option" aria-selected={t.id === target.id} onClick={() => { onPick(t.id); setOpen(false) }}>
                  {Icon(t)}
                  <span className="mp-output-name">{t.name}<small>{t.kind === 'browser' ? T('thisScreenHint') : t.kind === 'airplay' ? 'AirPlay' : 'Chromecast'}{t.title && ['playing', 'buffering', 'paused'].includes(t.state) ? ` · ${t.title}` : ''}</small></span>
                  {['playing', 'buffering'].includes(t.state) && <span className="mp-eq" aria-hidden="true"><i /><i /><i /></span>}
                  {t.id === target.id && <CheckIcon />}
                </button>
                {v && <VolumeControl value={v.v} muted={v.muted} hint={v.pref ? T('startsAt') : ''} small onChange={(x) => setVolume(t, x)} onMute={(m) => setMuted(t, m)} />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StationTile({ st, on, fav, onPlay, onFav, busy }) {
  const meta = [st.country, st.codec, st.bitrate ? `${st.bitrate}k` : ''].filter(Boolean).join(' · ') || (st.tags || []).join(', ')
  return (
    <div className="mp-tile" data-on={String(on)}>
      <button className="mp-tile-play" onClick={() => onPlay(st)} disabled={busy} title={st.url}>
        <Logo station={st} size={42} />
        <span className="mp-tile-text"><b>{st.name}</b>{meta && <small>{meta}</small>}</span>
        {on && <span className="mp-eq" aria-hidden="true"><i /><i /><i /></span>}
      </button>
      <button className="mp-star" data-on={String(!!fav)} onClick={() => onFav(st)} disabled={busy}
        aria-label={fav ? T('unfavourite') : T('favourite')} title={fav ? T('unfavourite') : T('favourite')}>{fav ? '★' : '☆'}</button>
    </div>
  )
}

function AddUrlTile({ onAdd, onPlay, busy }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const ok = /^https?:\/\/\S+$/i.test(url.trim())
  if (!open) return <button className="mp-tile mp-add" onClick={() => setOpen(true)}><span>＋</span>{T('addUrl')}</button>
  const st = () => ({ name: name.trim() || url.trim(), url: url.trim() })
  return (
    <div className="mp-tile mp-add-form">
      <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder={T('urlPh')} onKeyDown={(e) => { if (e.key === 'Enter' && ok) onPlay(st()) }} />
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={T('namePh')} />
      <div>
        <button disabled={!ok || busy} onClick={() => onPlay(st())}>{T('play')}</button>
        <button disabled={!ok || busy} className="primary" onClick={() => { onAdd(st()); setOpen(false); setUrl(''); setName('') }}>{T('save')}</button>
        <button onClick={() => setOpen(false)}>✕</button>
      </div>
    </div>
  )
}

function Artwork({ station, size, playing }) {
  return (
    <div className="mp-art" style={{ width: size, height: size }}>
      {station ? <Logo station={station} size={size} plain /> : <NoteIcon size={size * 0.38} />}
      {playing && <span className="mp-art-eq" aria-hidden="true"><i /><i /><i /></span>}
    </div>
  )
}

// station logo, or a coloured monogram when there's none (or it won't load)
function Logo({ station, size, plain }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [station?.favicon])
  const h = hue(station?.name || station?.url || '')
  if (station?.favicon && !broken) {
    return <img className={plain ? 'mp-logo plain' : 'mp-logo'} src={station.favicon} alt="" width={size} height={size} referrerPolicy="no-referrer" loading="lazy" onError={() => setBroken(true)} />
  }
  const initials = String(station?.name || '♪').replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '♪'
  return (
    <span className={plain ? 'mp-mono plain' : 'mp-mono'} style={{ width: size, height: size, fontSize: size * 0.36, background: `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 40) % 360} 70% 42%))` }}>{initials}</span>
  )
}

function hue(s) {
  let h = 0
  for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) % 360
  return h
}

const store = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } },
}

const svg = (d, fill) => ({ size = 18, ...p }) => <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>{d}</svg>
const NoteIcon = svg(<><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>)
const PlayIcon = svg(<path d="M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5z" />, true)
const PauseIcon = svg(<><rect x="6" y="4.5" width="4" height="15" rx="1.2" /><rect x="14" y="4.5" width="4" height="15" rx="1.2" /></>, true)
const StopIcon = svg(<rect x="6" y="6" width="12" height="12" rx="2" />, true)
const CastIcon = svg(<><path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" /><line x1="2" y1="20" x2="2.01" y2="20" /></>)
const AirPlayIcon = svg(<><path d="M5 17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-1" /><polygon points="12 15 17 21 7 21 12 15" /></>)
const ScreenIcon = svg(<><rect x="5" y="2" width="14" height="20" rx="2" /><path d="M11 18h2" /></>)
const ChevronIcon = svg(<path d="M6 9l6 6 6-6" />)
const CheckIcon = svg(<path d="M20 6L9 17l-5-5" />)
const SearchIcon = svg(<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>)
// Volume: tap the speaker to mute, − / + in 5 % steps, drag (a bubble shows the
// level), mouse wheel or arrow keys on the slider
export function VolumeControl({ value, muted, onChange, onMute, steps = false, small = false, hint = '' }) {
  const [drag, setDrag] = useState(null)
  const ref = useRef(null)
  const shown = drag ?? value
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const wheel = (e) => { e.preventDefault(); onChange(Math.max(0, Math.min(100, (drag ?? value) + (e.deltaY < 0 ? 2 : -2)))) }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [value, drag, onChange])
  const level = muted ? 0 : shown
  return (
    <div className={`mp-vol${small ? ' small' : ''}${muted ? ' muted' : ''}`} onClick={(e) => e.stopPropagation()}>
      <button className="mp-vol-icon" onClick={() => onMute(!muted)} aria-label={muted ? T('unmute') : T('mute')} title={muted ? T('unmute') : T('mute')} aria-pressed={muted}>
        <VolumeIcon level={level} muted={muted} />
      </button>
      {steps && <button className="mp-vol-step" onClick={() => onChange(Math.max(0, value - 5))} aria-label={T('quieter')} title={T('quieter')}>−</button>}
      <div className="mp-vol-track" ref={ref}>
        <input type="range" min="0" max="100" value={shown} aria-label={T('volume')} aria-valuetext={muted ? T('mute') : `${shown}%`}
          style={{ '--mp-vol': `${muted ? 0 : shown}%` }}
          onChange={(e) => { const v = Number(e.target.value); setDrag(v); onChange(v) }}
          onPointerUp={() => setDrag(null)} onBlur={() => setDrag(null)} onKeyUp={() => setDrag(null)} />
        {drag != null && <span className="mp-vol-bubble" style={{ left: `calc(${drag}% + ${(50 - drag) * 0.18}px)` }}>{drag}</span>}
      </div>
      {steps && <button className="mp-vol-step" onClick={() => onChange(Math.min(100, value + 5))} aria-label={T('louder')} title={T('louder')}>+</button>}
      <span className="mp-vol-value" title={hint}>{muted ? '—' : `${shown}%`}{hint && <small>{hint}</small>}</span>
    </div>
  )
}

function VolumeIcon({ level, muted }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor" />
      {muted ? <path d="M16 9l5 6M21 9l-5 6" /> : <>
        {level > 0 && <path d="M15.5 8.5a5 5 0 0 1 0 7" />}
        {level > 50 && <path d="M19 5a10 10 0 0 1 0 14" />}
      </>}
    </svg>
  )
}

const TX = {
  en: { show: 'Show media player', hide: 'Hide media player', hidden: 'hidden', mute: 'Mute', unmute: 'Unmute', quieter: 'Quieter', louder: 'Louder', startsAt: 'starts at', title: 'Media player', idle: 'Nothing playing', paused: 'Paused', live: 'Live', play: 'Play', pause: 'Pause', stop: 'Stop', volume: 'Volume', playOn: 'Play on', playingOn: 'Playing on {name}', lastPlayed: 'Last played: {name}', pickStation: 'Pick a station below',
    favourites: 'Favourites', browse: 'Browse', searchPh: 'Search radio stations…', loading: 'Loading stations…', noResults: 'No stations found', directory: 'Station directory:', favourite: 'Add to favourites', unfavourite: 'Remove from favourites',
    addUrl: 'Add stream URL', urlPh: 'https://… stream or audio file', namePh: 'Name (optional)', save: 'Save', thisScreen: 'This screen', thisScreenHint: 'This device', noStations: 'No favourites yet — star stations on the main dashboard.',
    "This browser can't play that stream": "This browser can't play that stream", 'Tap play to start sound on this screen': 'Tap play to start sound on this screen' },
  pl: { show: 'Pokaż odtwarzacz', hide: 'Ukryj odtwarzacz', hidden: 'ukryty', mute: 'Wycisz', unmute: 'Włącz dźwięk', quieter: 'Ciszej', louder: 'Głośniej', startsAt: 'na start', title: 'Odtwarzacz', idle: 'Nic nie gra', paused: 'Pauza', live: 'Na żywo', play: 'Odtwórz', pause: 'Pauza', stop: 'Stop', volume: 'Głośność', playOn: 'Odtwarzaj na', playingOn: 'Gra na: {name}', lastPlayed: 'Ostatnio: {name}', pickStation: 'Wybierz stację poniżej',
    favourites: 'Ulubione', browse: 'Przeglądaj', searchPh: 'Szukaj stacji radiowych…', loading: 'Wczytywanie stacji…', noResults: 'Nie znaleziono stacji', directory: 'Katalog stacji:', favourite: 'Dodaj do ulubionych', unfavourite: 'Usuń z ulubionych',
    addUrl: 'Dodaj adres strumienia', urlPh: 'https://… strumień lub plik audio', namePh: 'Nazwa (opcjonalnie)', save: 'Zapisz', thisScreen: 'Ten ekran', thisScreenHint: 'To urządzenie', noStations: 'Brak ulubionych — oznacz stacje gwiazdką na głównym panelu.',
    "This browser can't play that stream": 'Ta przeglądarka nie odtworzy tego strumienia', 'Tap play to start sound on this screen': 'Dotknij odtwarzania, aby włączyć dźwięk na tym ekranie' },
  de: { show: 'Mediaplayer zeigen', hide: 'Mediaplayer ausblenden', hidden: 'ausgeblendet', mute: 'Stumm', unmute: 'Ton an', quieter: 'Leiser', louder: 'Lauter', startsAt: 'beim Start', title: 'Mediaplayer', idle: 'Keine Wiedergabe', paused: 'Pausiert', live: 'Live', play: 'Abspielen', pause: 'Pause', stop: 'Stopp', volume: 'Lautstärke', playOn: 'Wiedergabe auf', playingOn: 'Läuft auf {name}', lastPlayed: 'Zuletzt: {name}', pickStation: 'Unten einen Sender wählen',
    favourites: 'Favoriten', browse: 'Entdecken', searchPh: 'Radiosender suchen…', loading: 'Sender werden geladen…', noResults: 'Keine Sender gefunden', directory: 'Senderverzeichnis:', favourite: 'Zu Favoriten', unfavourite: 'Aus Favoriten entfernen',
    addUrl: 'Stream-URL hinzufügen', urlPh: 'https://… Stream oder Audiodatei', namePh: 'Name (optional)', save: 'Speichern', thisScreen: 'Dieser Bildschirm', thisScreenHint: 'Dieses Gerät', noStations: 'Noch keine Favoriten — Sender im Haupt-Dashboard markieren.',
    "This browser can't play that stream": 'Dieser Browser kann den Stream nicht abspielen', 'Tap play to start sound on this screen': 'Auf Abspielen tippen, um hier Ton zu starten' },
  fr: { show: 'Afficher le lecteur', hide: 'Masquer le lecteur', hidden: 'masqué', mute: 'Couper le son', unmute: 'Rétablir le son', quieter: 'Moins fort', louder: 'Plus fort', startsAt: 'au démarrage', title: 'Lecteur multimédia', idle: 'Rien en lecture', paused: 'En pause', live: 'En direct', play: 'Lire', pause: 'Pause', stop: 'Arrêt', volume: 'Volume', playOn: 'Lire sur', playingOn: 'En lecture sur {name}', lastPlayed: 'Dernière écoute : {name}', pickStation: 'Choisissez une station ci-dessous',
    favourites: 'Favoris', browse: 'Parcourir', searchPh: 'Rechercher des radios…', loading: 'Chargement des stations…', noResults: 'Aucune station trouvée', directory: 'Annuaire des stations :', favourite: 'Ajouter aux favoris', unfavourite: 'Retirer des favoris',
    addUrl: 'Ajouter une URL de flux', urlPh: 'https://… flux ou fichier audio', namePh: 'Nom (facultatif)', save: 'Enregistrer', thisScreen: 'Cet écran', thisScreenHint: 'Cet appareil', noStations: 'Aucun favori — ajoutez des étoiles depuis le tableau de bord principal.',
    "This browser can't play that stream": 'Ce navigateur ne peut pas lire ce flux', 'Tap play to start sound on this screen': 'Touchez lecture pour lancer le son sur cet écran' },
  es: { show: 'Mostrar reproductor', hide: 'Ocultar reproductor', hidden: 'oculto', mute: 'Silenciar', unmute: 'Activar sonido', quieter: 'Más bajo', louder: 'Más alto', startsAt: 'al empezar', title: 'Reproductor', idle: 'No suena nada', paused: 'En pausa', live: 'En directo', play: 'Reproducir', pause: 'Pausa', stop: 'Detener', volume: 'Volumen', playOn: 'Reproducir en', playingOn: 'Sonando en {name}', lastPlayed: 'Último: {name}', pickStation: 'Elige una emisora abajo',
    favourites: 'Favoritas', browse: 'Explorar', searchPh: 'Buscar emisoras…', loading: 'Cargando emisoras…', noResults: 'No se encontraron emisoras', directory: 'Directorio de emisoras:', favourite: 'Añadir a favoritas', unfavourite: 'Quitar de favoritas',
    addUrl: 'Añadir URL de stream', urlPh: 'https://… stream o archivo de audio', namePh: 'Nombre (opcional)', save: 'Guardar', thisScreen: 'Esta pantalla', thisScreenHint: 'Este dispositivo', noStations: 'Aún no hay favoritas — márcalas con estrella en el panel principal.',
    "This browser can't play that stream": 'Este navegador no puede reproducir ese stream', 'Tap play to start sound on this screen': 'Pulsa reproducir para activar el sonido en esta pantalla' },
  it: { show: 'Mostra lettore', hide: 'Nascondi lettore', hidden: 'nascosto', mute: 'Muto', unmute: 'Riattiva audio', quieter: 'Più piano', louder: 'Più forte', startsAt: 'all’avvio', title: 'Lettore multimediale', idle: 'Niente in riproduzione', paused: 'In pausa', live: 'In diretta', play: 'Riproduci', pause: 'Pausa', stop: 'Stop', volume: 'Volume', playOn: 'Riproduci su', playingOn: 'In riproduzione su {name}', lastPlayed: 'Ultimo: {name}', pickStation: 'Scegli una stazione qui sotto',
    favourites: 'Preferiti', browse: 'Sfoglia', searchPh: 'Cerca stazioni radio…', loading: 'Caricamento stazioni…', noResults: 'Nessuna stazione trovata', directory: 'Elenco stazioni:', favourite: 'Aggiungi ai preferiti', unfavourite: 'Rimuovi dai preferiti',
    addUrl: 'Aggiungi URL di stream', urlPh: 'https://… stream o file audio', namePh: 'Nome (facoltativo)', save: 'Salva', thisScreen: 'Questo schermo', thisScreenHint: 'Questo dispositivo', noStations: 'Nessun preferito — aggiungi le stelle dalla dashboard principale.',
    "This browser can't play that stream": 'Questo browser non può riprodurre lo stream', 'Tap play to start sound on this screen': 'Tocca play per avviare l’audio su questo schermo' },
  uk: { show: 'Показати плеєр', hide: 'Сховати плеєр', hidden: 'приховано', mute: 'Вимкнути звук', unmute: 'Увімкнути звук', quieter: 'Тихіше', louder: 'Гучніше', startsAt: 'на старті', title: 'Медіаплеєр', idle: 'Нічого не грає', paused: 'Пауза', live: 'Наживо', play: 'Відтворити', pause: 'Пауза', stop: 'Стоп', volume: 'Гучність', playOn: 'Відтворювати на', playingOn: 'Грає на: {name}', lastPlayed: 'Останнє: {name}', pickStation: 'Оберіть станцію нижче',
    favourites: 'Обране', browse: 'Огляд', searchPh: 'Пошук радіостанцій…', loading: 'Завантаження станцій…', noResults: 'Станцій не знайдено', directory: 'Каталог станцій:', favourite: 'Додати в обране', unfavourite: 'Прибрати з обраного',
    addUrl: 'Додати URL потоку', urlPh: 'https://… потік або аудіофайл', namePh: 'Назва (необов’язково)', save: 'Зберегти', thisScreen: 'Цей екран', thisScreenHint: 'Цей пристрій', noStations: 'Обраного ще немає — позначте станції зірочкою на головній панелі.',
    "This browser can't play that stream": 'Цей браузер не може відтворити потік', 'Tap play to start sound on this screen': 'Торкніться відтворення, щоб увімкнути звук на цьому екрані' },
}
function T(k, vars) {
  let s = (TX[getLang()] || TX.en)[k] || TX.en[k] || k
  if (vars) for (const [n, v] of Object.entries(vars)) s = s.split(`{${n}}`).join(v)
  return s
}
