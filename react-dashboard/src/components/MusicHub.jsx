import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { getLang } from '../i18n'
import { localAudio, EQ_BANDS, EQ_PRESETS } from '../localAudio'
import { musicKit, artUrl } from '../musicKit'
import MediaPlayer, { VolumeControl } from './MediaPlayer'

// The dashboard's music hub: one full-width card with a spectrum visualizer on
// top, the radio player (MediaPlayer) on the left and Spotify / Apple Music /
// TIDAL / Equalizer on the right. Collapsible like the Energy panel.
//
//   visualizer  real spectrum: of what plays on this screen (Web Audio analyser in
//               localAudio.js), or of a radio station playing on a speaker (LSH
//               decodes the same stream: GET /api/media/spectrum, delayed by the
//               speaker's buffer); for Spotify and Apple Music — whose audio this
//               page can't read — an animation that follows the play state
//   Spotify     src/routes/spotify.js (status, playlists, search, devices, control)
//   Apple Music src/musicKit.js — plays in this browser
//   TIDAL       src/routes/tidal.js (search, library) — browse only: TIDAL has no
//               remote-control API, so Play opens the item in TIDAL
//   Equalizer   5 bands: live on this screen, AirPlay from the next station started
const SPOTIFY = '#1db954'
const APPLE = '#fa2d48'
const TIDAL = '#1ec8c8'
const api = (url, body) => fetch(url, {
  credentials: 'include',
  ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
}).then((r) => r.json())
const store = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } },
}
const fmt = (s) => (s == null || !Number.isFinite(s) ? '0:00' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`)

// ── shared state: what's playing where (the card, the popup, full screen) ──────
// One poll per mounted view; `enabled` false (the card collapsed) stops it.
const playingStore = { v: false, l: new Set(), set(v) { if (v !== this.v) { this.v = v; this.l.forEach((f) => f()) } } }
export const musicPlaying = { subscribe: (f) => { playingStore.l.add(f); return () => playingStore.l.delete(f) }, get: () => playingStore.v }
export const openMusic = (mode = 'popup') => window.dispatchEvent(new CustomEvent('lsh-music', { detail: mode }))

function useMusicState(enabled = true) {
  const [spotify, setSpotify] = useState(null)
  const [radio, setRadio] = useState({ playing: false, hue: 211, url: '', kind: '' })
  const local = useSyncExternalStore(localAudio.subscribe, localAudio.get)
  const am = useSyncExternalStore(musicKit.subscribe, musicKit.get)
  const loadSpotify = useCallback(() => api('/api/spotify/status').then((j) => j.success && setSpotify(j.data)).catch(() => {}), [])
  useEffect(() => {
    if (!enabled) return
    loadSpotify()
    const t = setInterval(() => { if (!document.hidden) loadSpotify() }, 5000)
    return () => clearInterval(t)
  }, [enabled, loadSpotify])
  // radio on speakers: the first one playing
  const loadRadio = useCallback(() => api('/api/media/targets').then((j) => {
    const p = (j.data?.targets || []).find((t) => t.state === 'playing' || t.state === 'buffering')
    const station = p ? (j.data?.stations || []).find((s) => s.url === p.url) : null
    setRadio({ playing: !!p, hue: p ? hueOf(p.title) : 211, url: p?.url || '', kind: p?.kind || '', title: p ? `${p.title} · ${p.name}` : '', target: p || null, station })
  }).catch(() => {}), [])
  useEffect(() => {
    if (!enabled) return
    loadRadio()
    const t = setInterval(() => { if (!document.hidden) loadRadio() }, 5000)
    return () => clearInterval(t)
  }, [enabled, loadRadio])

  const localPlaying = local.status === 'playing'
  const spPlaying = !!spotify?.player?.playing
  const amPlaying = am.playing
  // radio on a speaker: LSH analyses the station itself, delayed by the speaker's buffer
  const source = localPlaying ? { color: `hsl(${hueOf(local.title)} 75% 58%)`, live: 'local' }
    : radio.playing && radio.url ? { color: `hsl(${radio.hue} 75% 58%)`, live: 'server', url: radio.url, delay: radio.kind === 'airplay' ? 2000 : 4000 }
    : spPlaying ? { color: SPOTIFY } : amPlaying ? { color: APPLE }
    : radio.playing ? { color: `hsl(${radio.hue} 75% 58%)` } : { color: 'var(--accent)', idle: true }
  const nowLine = localPlaying ? local.title : radio.playing && radio.title ? radio.title : spPlaying ? `${spotify.player.item?.name || ''} · ${spotify.player.item?.artist || ''}` : amPlaying ? `${am.item?.name || ''} · ${am.item?.artistName || ''}` : ''
  useEffect(() => { if (enabled) playingStore.set(!source.idle) }, [enabled, source.idle])
  return { spotify, loadSpotify, radio, loadRadio, local, am, localPlaying, spPlaying, amPlaying, source, nowLine }
}

export default function MusicHub() {
  const [hidden, setHidden] = useState(() => store.get('lsh-music-hidden') === '1')
  const m = useMusicState(!hidden)
  const { source, nowLine } = m
  const toggle = () => { const h = !hidden; setHidden(h); store.set('lsh-music-hidden', h ? '1' : '0') }

  return (
    <div className="card hub" style={{ '--hub-color': source.color }}>
      <div className="hub-head" onClick={toggle} role="button" tabIndex={0} aria-expanded={!hidden}
        onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle() } }} title={hidden ? T('show') : T('hide')}>
        <NoteIcon size={15} style={{ color: source.idle ? '#30d158' : source.color }} />
        <span className="hub-title">{T('music')}</span>
        {nowLine && <span className="hub-now"><span className="hub-dot" />{nowLine}</span>}
        <span className="hub-right">
          {hidden && <span>{T('hidden')}</span>}
          <button type="button" className="hub-head-btn" title={T('fullScreen')} aria-label={T('fullScreen')} onClick={(e) => { e.stopPropagation(); openMusic('full') }}><ExpandIcon size={14} /></button>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: hidden ? 'rotate(-90deg)' : 'none', transition: 'transform .2s ease' }}><polyline points="6 9 12 15 18 9" /></svg>
        </span>
      </div>
      {!hidden && <HubBody m={m} />}
    </div>
  )
}

// visualizer + player + Spotify / Apple Music / TIDAL / EQ — the card's and the popup's content
function HubBody({ m }) {
  const [tab, setTab] = useState(() => store.get('lsh-music-tab') || 'spotify')
  const pickTab = (t) => { setTab(t); store.set('lsh-music-tab', t) }
  const { source, spotify, loadSpotify, spPlaying, amPlaying } = m
  return (
    <>
      <Visualizer color={source.color} active={!source.idle} live={source.live} url={source.url} delay={source.delay} />
      <div className="hub-cols">
        <div className="hub-col"><MediaPlayer embedded /></div>
        <div className="hub-col hub-side">
          <div className="hub-tabs" role="tablist">
            {[['spotify', 'Spotify', SPOTIFY, <SpotifyLogo key="s" />], ['apple', 'Apple Music', APPLE, <AppleLogo key="a" />], ['tidal', 'TIDAL', TIDAL, <TidalLogo key="t" />], ['eq', T('equalizer'), '#bf5af2', <EqIcon key="e" />]].map(([id, label, color, icon]) => (
              <button key={id} role="tab" aria-selected={tab === id} aria-label={label} title={label} onClick={() => pickTab(id)} style={{ '--tab-color': color }}>
                {icon}<span>{label}</span>
                {((id === 'spotify' && spPlaying) || (id === 'apple' && amPlaying)) && <span className="mp-eq" aria-hidden="true"><i /><i /><i /></span>}
              </button>
            ))}
          </div>
          {tab === 'spotify' && <SpotifyPanel status={spotify} reload={loadSpotify} />}
          {tab === 'apple' && <ApplePanel />}
          {tab === 'tidal' && <TidalPanel />}
          {tab === 'eq' && <EqualizerPanel />}
        </div>
      </div>
    </>
  )
}

// ── popup and full screen (mounted once, in App) ───────────────────────────────
export function MusicOverlay() {
  const [mode, setMode] = useState(null) // null | 'popup' | 'full'
  // stable callbacks: App re-renders on every live update (about once a second)
  const close = useCallback(() => setMode(null), [])
  const full = useCallback(() => setMode('full'), [])
  useEffect(() => {
    const on = (e) => setMode(e.detail || 'popup')
    window.addEventListener('lsh-music', on)
    return () => window.removeEventListener('lsh-music', on)
  }, [])
  if (!mode) return null
  return mode === 'full' ? <MusicFull onClose={close} /> : <MusicPopup onClose={close} onFull={full} />
}

function MusicPopup({ onClose, onFull }) {
  const m = useMusicState(true)
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  return (
    <div className="mpop-backdrop" onClick={onClose}>
      <div className="mpop card hub" role="dialog" aria-modal="true" aria-label={T('music')} style={{ '--hub-color': m.source.color }} onClick={(e) => e.stopPropagation()}>
        <div className="hub-head mpop-head">
          <NoteIcon size={15} style={{ color: m.source.idle ? '#30d158' : m.source.color }} />
          <span className="hub-title">{T('music')}</span>
          {m.nowLine && <span className="hub-now"><span className="hub-dot" />{m.nowLine}</span>}
          <span className="hub-right">
            <button type="button" className="hub-head-btn" title={T('fullScreen')} aria-label={T('fullScreen')} onClick={onFull}><ExpandIcon size={15} /></button>
            <button type="button" className="hub-head-btn" title={T('close')} aria-label={T('close')} onClick={onClose}><CloseIcon size={15} /></button>
          </span>
        </div>
        <HubBody m={m} />
      </div>
    </div>
  )
}

// Full screen "now playing": art, song, artist, where, big controls, the visualizer behind
function MusicFull({ onClose }) {
  const m = useMusicState(true)
  const { source, spotify, radio, local, am, localPlaying, spPlaying, amPlaying } = m
  const [song, setSong] = useState('')
  const [idle, setIdle] = useState(false)
  const [clock, setClock] = useState(() => new Date())
  const [vol, setVol] = useState(null)
  const root = useRef(null)
  const volTimer = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const artRef = useRef(null)
  // the visualizer as a band along the bottom, or filling the screen (Ring wraps the cover)
  const [vizFull, setVizFull] = useState(() => store.get('lsh-mfull-viz') !== 'band')
  const pickViz = (v) => { setVizFull(v); store.set('lsh-mfull-viz', v ? 'full' : 'band') }
  // the cover breathes with the bass — straight on the element, no re-render per frame
  const onBass = useCallback((b) => {
    const el = artRef.current
    if (el) { el.style.transform = `scale(${1 + b * 0.045})`; el.style.setProperty('--bass', b.toFixed(3)) }
  }, [])

  // what to show: this screen → radio on a speaker → Spotify → Apple Music
  const kind = localPlaying ? 'local' : radio.playing ? 'radio' : spPlaying ? 'spotify' : amPlaying ? 'apple' : spotify?.player?.item ? 'spotify' : radio.target ? 'radio' : 'none'
  const t = radio.target
  const radioKey = t ? (t.kind === 'airplay' ? `radio/airplay-${t.id.replace(/^airplay:/, '')}` : `radio/cast-${t.id.replace(/^cast:/, '').replace(/\./g, '_')}`) : ''
  const item = spotify?.player?.item
  const info = kind === 'local' ? { title: song || local.title, sub: song ? local.title : '', where: T('thisScreen'), art: null, playing: localPlaying, volume: Math.round(local.volume ?? 0) }
    : kind === 'radio' ? { title: song || t?.title || '', sub: song ? t?.title : '', where: `${T('radioOn')} ${t?.name || ''}`, art: radio.station?.favicon ? `/api/loxone/cover/${radioKey}.jpg?u=${encodeURIComponent(radio.station.favicon)}` : null, playing: radio.playing, volume: t?.volume }
    : kind === 'spotify' ? { title: item?.name || '', sub: [item?.artist, item?.album].filter(Boolean).join(' — '), where: `Spotify${spotify?.player?.device ? ' · ' + spotify.player.device.name : ''}`, art: item?.image, playing: spPlaying, volume: spotify?.player?.device?.volume }
    : kind === 'apple' ? { title: am.item?.name || '', sub: [am.item?.artistName, am.item?.albumName].filter(Boolean).join(' — '), where: 'Apple Music', art: am.item?.artwork ? artUrl(am.item.artwork, 800) : null, playing: amPlaying, volume: am.volume }
    : { title: T('nothing'), sub: '', where: '', art: null, playing: false, volume: null }
  const [artist, title] = /^(.+?)\s+[-–—]\s+(.+)$/.test(info.title) && kind !== 'spotify' && kind !== 'apple' ? info.title.split(/\s+[-–—]\s+/) : [null, info.title]

  // the station's current song (ICY), on this screen or a speaker
  const songUrl = kind === 'local' ? local.url : kind === 'radio' ? radio.url : ''
  useEffect(() => {
    if (!songUrl) { setSong(''); return }
    const get = () => api(`/api/media/nowplaying?url=${encodeURIComponent(songUrl)}`).then((j) => setSong(j.data?.title || '')).catch(() => {})
    get()
    const iv = setInterval(get, 10000)
    return () => clearInterval(iv)
  }, [songUrl])

  // real full screen, clock, idle pointer — set up once: re-running this would
  // leave full screen and couldn't re-enter it without a click
  useEffect(() => {
    const el = root.current
    let entered = false
    el?.requestFullscreen?.().then(() => { entered = true }).catch(() => {})
    // leaving the browser's full screen (Esc, the system gesture) closes the view too
    const onFs = () => { if (entered && !document.fullscreenElement) closeRef.current() }
    document.addEventListener('fullscreenchange', onFs)
    const tick = setInterval(() => setClock(new Date()), 10000)
    let idleT
    const wake = () => { setIdle(false); clearTimeout(idleT); idleT = setTimeout(() => setIdle(true), 3500) }
    wake()
    window.addEventListener('pointermove', wake)
    return () => {
      document.removeEventListener('fullscreenchange', onFs)
      clearInterval(tick); clearTimeout(idleT)
      window.removeEventListener('pointermove', wake)
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    }
  }, [])

  const cmd = (key, sensor, value) => fetch(`/api/device/${encodeURIComponent(key)}/command`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sensor, value }) }).then(() => setTimeout(() => { m.loadRadio(); m.loadSpotify() }, 700)).catch(() => {})
  const act = {
    prev: () => kind === 'radio' ? cmd(radioKey, 'prevStation', 1) : kind === 'spotify' ? cmd('spotify/player', 'prev', 1) : kind === 'apple' ? musicKit.prev() : null,
    next: () => kind === 'radio' ? cmd(radioKey, 'nextStation', 1) : kind === 'spotify' ? cmd('spotify/player', 'next', 1) : kind === 'apple' ? musicKit.next() : null,
    toggle: () => kind === 'radio' ? cmd(radioKey, 'playing', info.playing ? 0 : 1) : kind === 'spotify' ? cmd('spotify/player', 'playing', info.playing ? 0 : 1) : kind === 'apple' ? musicKit.toggle() : kind === 'local' ? (localPlaying ? localAudio.pause() : localAudio.resume()) : null,
    volume: (v) => {
      setVol(v)
      clearTimeout(volTimer.current)
      volTimer.current = setTimeout(() => {
        if (kind === 'radio') cmd(radioKey, 'volume', v)
        else if (kind === 'spotify') cmd('spotify/player', 'volume', v)
        else if (kind === 'apple') musicKit.setVolume(v)
        else if (kind === 'local') localAudio.setVolume(v)
        setTimeout(() => setVol(null), 1500)
      }, 250)
    },
  }
  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === ' ' && e.target === document.body) { e.preventDefault(); act.toggle() }
      else if (e.key === 'ArrowRight') act.next()
      else if (e.key === 'ArrowLeft') act.prev()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })
  const volume = vol ?? info.volume
  const canSkip = kind === 'radio' || kind === 'spotify' || kind === 'apple'

  return (
    <div ref={root} className={`mfull${idle ? ' idle' : ''}${vizFull ? ' vfull' : ''}`} style={{ '--hub-color': source.color }} role="dialog" aria-modal="true" aria-label={T('fullScreen')}>
      {info.art && <div className="mfull-bg" style={{ backgroundImage: `url("${info.art}")` }} />}
      <div className="mfull-viz"><Visualizer color={source.color} active={!source.idle} live={source.live} url={source.url} delay={source.delay} around={vizFull ? artRef : null} onBass={onBass} /></div>
      <div className="mfull-top">
        <span className="mfull-clock">{clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        <span className="mfull-top-r">
          <button type="button" className="mfull-close" onClick={() => pickViz(!vizFull)} title={vizFull ? T('vizBand') : T('vizFill')} aria-label={vizFull ? T('vizBand') : T('vizFill')} aria-pressed={vizFull}>{vizFull ? <BandIcon size={22} /> : <FillIcon size={22} />}</button>
          <button type="button" className="mfull-close" onClick={onClose} title={T('close')} aria-label={T('close')}><CloseIcon size={22} /></button>
        </span>
      </div>
      <div className="mfull-main">
        <div className="mfull-art" ref={artRef}>{info.art ? <img src={info.art} alt="" /> : <NoteIcon size={96} />}</div>
        <div className="mfull-meta">
          {info.where && <div className="mfull-where"><span className="hub-dot" />{info.where}</div>}
          <h1 className="mfull-title">{title || T('nothing')}</h1>
          {(artist || info.sub) && <div className="mfull-sub">{[artist, info.sub].filter(Boolean).join(' · ')}</div>}
          <div className="mfull-ctrl">
            <button type="button" onClick={act.prev} disabled={!canSkip} title={T('prev')} aria-label={T('prev')}><PrevIcon size={30} /></button>
            <button type="button" className="main" onClick={act.toggle} disabled={kind === 'none'} title={info.playing ? T('pause') : T('play')} aria-label={info.playing ? T('pause') : T('play')}>{info.playing ? <PauseIcon size={38} /> : <PlayIcon size={38} />}</button>
            <button type="button" onClick={act.next} disabled={!canSkip} title={T('next')} aria-label={T('next')}><NextIcon size={30} /></button>
          </div>
          {volume != null && kind !== 'none' && (
            <label className="mfull-vol"><VolIcon size={18} />
              <input type="range" min="0" max="100" value={volume} onChange={(e) => act.volume(Number(e.target.value))} style={{ '--pct': `${volume}%` }} aria-label={T('vol')} />
              <span>{volume}%</span>
            </label>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Visualizer ────────────────────────────────────────────────────────────────
const VIZ_MODES = ['bars', 'wave', 'ring']
// around: a ref to an element the Ring style wraps (full screen's cover); onBass(0…1) every frame
function Visualizer({ color, active, live, url, delay = 0, around = null, onBass = null }) {
  const canvas = useRef(null)
  const [mode, setMode] = useState(() => { const m = store.get('lsh-viz-mode'); return VIZ_MODES.includes(m) ? m : 'bars' })
  const state = useRef({ color, active, live, mode, bars: [], peaks: [], peakV: [], t: 0, frames: [], lastFrame: 0, bass: 0, trail: [], sparks: [] })
  Object.assign(state.current, { color, active, live, delay, mode, around, onBass, canvasEl: canvas })
  const pickMode = (m) => { setMode(m); store.set('lsh-viz-mode', m) }
  const [serverLive, setServerLive] = useState(false)
  // spectrum of a station on a speaker, from LSH — frames queued, shown `delay` ms later
  useEffect(() => {
    if (live !== 'server' || !url) return
    const st = state.current
    st.frames = []
    const es = new EventSource(`/api/media/spectrum?url=${encodeURIComponent(url)}`)
    es.onmessage = (e) => {
      const bin = atob(e.data), f = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) f[i] = bin.charCodeAt(i)
      st.frames.push({ t: performance.now(), f })
      if (st.frames.length > 400) st.frames.splice(0, st.frames.length - 400)
      st.lastFrame = performance.now()
    }
    const watch = setInterval(() => setServerLive(performance.now() - st.lastFrame < 2500), 1000)
    return () => { es.close(); clearInterval(watch); st.frames = []; setServerLive(false) }
  }, [live, url])
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let raf, freq = null, colorKey = '', hue = 210, sat = 75
    const draw = () => {
      const s = state.current
      const dpr = window.devicePixelRatio || 1
      const w = c.clientWidth, h = c.clientHeight
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr) }
      const g = c.getContext('2d')
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      // colour → hue / saturation (any CSS colour, resolved through the canvas)
      if (colorKey !== s.color) {
        colorKey = s.color
        g.fillStyle = s.color.startsWith('var(') ? getComputedStyle(c).getPropertyValue('--accent').trim() || '#0a84ff' : s.color
        ;[hue, sat] = hsOf(g.fillStyle)
      }
      const n = s.mode === 'ring' ? 72 : Math.max(24, Math.min(96, Math.floor(w / 11)))
      if (s.bars.length !== n) { s.bars = new Array(n).fill(0); s.peaks = new Array(n).fill(0); s.peakV = new Array(n).fill(0) }
      s.t += reduce ? 0 : 0.016
      const spectrum = readSpectrum(s, n, freq, (f) => { freq = f })
      // smoothing: fast attack, slow release; peak caps that hang then fall
      let bass = 0
      for (let i = 0; i < n; i++) {
        s.bars[i] += (spectrum[i] - s.bars[i]) * (spectrum[i] > s.bars[i] ? 0.5 : 0.13)
        if (s.bars[i] >= s.peaks[i]) { s.peaks[i] = s.bars[i]; s.peakV[i] = 0 } else { s.peakV[i] += 0.0009; s.peaks[i] = Math.max(s.bars[i], s.peaks[i] - s.peakV[i]) }
        if (i < n * 0.12) bass += s.bars[i]
      }
      bass /= Math.max(1, Math.floor(n * 0.12))
      s.bass += (bass - s.bass) * 0.25
      s.onBass?.(s.active ? s.bass : 0)
      // the element the ring wraps, in canvas coordinates
      s.ringAt = null
      if (s.around?.current) {
        const a = s.around.current.getBoundingClientRect(), b = c.getBoundingClientRect()
        s.ringAt = { x: a.left - b.left + a.width / 2, y: a.top - b.top + a.height / 2, r: Math.max(a.width, a.height) / 2 }
      }
      const col = (i, l = 60, a = 1) => `hsla(${(hue + (i / n) * 70) % 360} ${sat}% ${l}% / ${a})`
      // bass glow behind everything
      if (s.active) {
        const gx = s.ringAt ? s.ringAt.x : w / 2, gy = s.ringAt ? s.ringAt.y : h * 0.62
        const glow = g.createRadialGradient(gx, gy, 0, gx, gy, Math.max(w, h) * (0.35 + s.bass * 0.35))
        glow.addColorStop(0, `hsla(${hue} ${sat}% 55% / ${0.10 + s.bass * 0.22})`); glow.addColorStop(1, `hsla(${hue} ${sat}% 55% / 0)`)
        g.fillStyle = glow; g.fillRect(0, 0, w, h)
      }
      if (s.mode === 'wave') drawWave(g, s, w, h, n, col)
      else if (s.mode === 'ring') drawRing(g, s, w, h, n, col, hue, sat)
      else drawBars(g, s, w, h, n, col)
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <div className="hub-viz" title={live === 'local' ? T('vizLive') : live === 'server' && serverLive ? T('vizStation') : T('vizAnim')}>
      <canvas ref={canvas} aria-hidden="true" />
      {(live === 'local' || (live === 'server' && serverLive)) && <span className="hub-viz-badge">● {T('liveSpectrum')}</span>}
      <div className="hub-viz-modes" role="radiogroup" aria-label={T('vizStyle')}>
        {VIZ_MODES.map((m) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} title={T(`viz_${m}`)} onClick={() => pickMode(m)}>
            {m === 'bars' ? <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><rect x="1" y="7" width="3" height="8" rx="1"/><rect x="6.5" y="2" width="3" height="13" rx="1"/><rect x="12" y="5" width="3" height="10" rx="1"/></svg>
              : m === 'wave' ? <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M1 8c2-5 3-5 4.5 0S8.5 13 10 8s3-5 5 0"/></svg>
              : <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="8" cy="8" r="3.2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3" strokeLinecap="round"/></svg>}
          </button>
        ))}
      </div>
    </div>
  )
}

// n levels 0…1: from LSH's frames (a station on a speaker), this screen's analyser, or an animation
function readSpectrum(s, n, freq, keepFreq) {
  const out = new Array(n)
  const an = s.live === 'local' ? localAudio.analyser() : null
  if (an) {
    if (!freq || freq.length !== an.frequencyBinCount) { freq = new Uint8Array(an.frequencyBinCount); keepFreq(freq) }
    an.getByteFrequencyData(freq)
  }
  let srv = null
  if (s.live === 'server' && s.frames.length) {
    const due = performance.now() - (s.delay || 0)
    let k = -1
    for (let j = s.frames.length - 1; j >= 0; j--) if (s.frames[j].t <= due) { k = j; break }
    if (k >= 0) { srv = s.frames[k].f; if (k > 0) s.frames.splice(0, k) }
  }
  for (let i = 0; i < n; i++) {
    if (srv) {
      const pos = (i / Math.max(1, n - 1)) * (srv.length - 1), a = Math.floor(pos), frac = pos - a
      out[i] = ((srv[a] * (1 - frac) + srv[Math.min(srv.length - 1, a + 1)] * frac) / 255) * (1.05 - 0.15 * (i / n))
    } else if (an) {
      // log-spaced bins: more detail in the bass, as ears hear it
      const lo = Math.floor(Math.pow(freq.length * 0.7, i / n)), hi = Math.max(lo + 1, Math.floor(Math.pow(freq.length * 0.7, (i + 1) / n)))
      let sum = 0
      for (let k = lo; k < hi; k++) sum += freq[k]
      out[i] = sum / (hi - lo) / 255
    } else {
      // no audio to read: layered waves, a kick every half second and per-bar
      // variation — reads as music without pretending to be its spectrum
      const x = i / n
      const ph = (Math.sin(i * 12.9898) * 43758.5453) % 1
      const beat = 0.62 + 0.38 * Math.pow(Math.max(0, Math.sin(s.t * Math.PI * 4)), 6)
      const body = (0.5 + 0.5 * Math.sin(x * 7 + s.t * 2.3 + ph * 6)) * (0.6 + 0.4 * Math.sin(x * 19 - s.t * 3.4 + ph * 3))
      const flicker = 0.85 + 0.15 * Math.sin(s.t * 11 + ph * 40)
      out[i] = s.active
        ? Math.min(1, (0.12 + 0.88 * body * flicker) * (1.2 - 0.6 * x) * (x < 0.18 ? beat : 0.85 + 0.15 * beat))
        : 0.05 + 0.04 * (0.5 + 0.5 * Math.sin(x * 6 + s.t))
    }
  }
  return out
}

// bars rising from a floor, colour sweeping bass → treble, peak caps, a soft reflection
function drawBars(g, s, w, h, n, col) {
  const mid = h * 0.7, bw = w / n
  for (let i = 0; i < n; i++) {
    const v = s.bars[i], bh = Math.max(2, v * (mid - 10))
    const x0 = i * bw + bw * 0.16, bwid = bw * 0.68, r = Math.min(4, bwid / 2)
    const grad = g.createLinearGradient(0, mid - bh, 0, mid)
    grad.addColorStop(0, col(i, s.active ? 78 : 60))
    grad.addColorStop(1, col(i, 45, 0.55))
    g.fillStyle = grad
    g.shadowColor = col(i, 60, 0.8); g.shadowBlur = s.active ? 10 + s.bass * 14 : 0
    roundRect(g, x0, mid - bh, bwid, bh, r)
    g.shadowBlur = 0
    if (s.active) {
      const py = mid - Math.max(2, s.peaks[i] * (mid - 10)) - 5
      g.fillStyle = col(i, 85, 0.95)
      roundRect(g, x0, py, bwid, 2.5, 1.2)
    }
    const rg = g.createLinearGradient(0, mid + 3, 0, mid + 3 + bh * 0.4)
    rg.addColorStop(0, col(i, 55, 0.25)); rg.addColorStop(1, col(i, 55, 0))
    g.fillStyle = rg
    roundRect(g, x0, mid + 3, bwid, bh * 0.4, r)
  }
}

// a smooth mirrored waveform with a glow and fading echoes of the last frames
function drawWave(g, s, w, h, n, col) {
  const mid = h / 2, amp = h * 0.44
  // taper the first and last 6 % so the curve meets the midline instead of ending in a cliff
  const vals = s.bars.map((v, i) => { const x = i / (n - 1), e = Math.min(1, x / 0.06, (1 - x) / 0.06); return v * Math.sin((e * Math.PI) / 2) })
  s.trail.unshift(vals)
  if (s.trail.length > 5) s.trail.length = 5
  const path = (vals, k) => {
    g.beginPath()
    g.moveTo(0, mid)
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * w, y = mid - vals[i] * amp * k
      const px = ((i - 1) / (n - 1)) * w, py = mid - (vals[i - 1] ?? 0) * amp * k
      g.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2)
    }
    g.lineTo(w, mid)
  }
  const grad = g.createLinearGradient(0, 0, w, 0)
  for (let i = 0; i <= 4; i++) grad.addColorStop(i / 4, col((i / 4) * n, 62))
  // echoes
  for (let k = s.trail.length - 1; k >= 1; k--) {
    g.globalAlpha = 0.12 * (1 - k / s.trail.length)
    for (const dir of [1, -1]) { path(s.trail[k], dir); g.strokeStyle = grad; g.lineWidth = 1.5; g.stroke() }
  }
  g.globalAlpha = 1
  // filled body, top and mirrored bottom
  for (const dir of [1, -1]) {
    path(vals, dir)
    const fill = g.createLinearGradient(0, mid - amp * dir, 0, mid)
    fill.addColorStop(0, col(n * 0.3, 60, s.active ? 0.55 : 0.25)); fill.addColorStop(1, col(n * 0.3, 50, 0.02))
    g.fillStyle = fill; g.fill()
    path(vals, dir)
    g.strokeStyle = grad; g.lineWidth = 2.2
    g.shadowColor = col(n * 0.3, 60, 0.9); g.shadowBlur = s.active ? 12 + s.bass * 16 : 0
    g.stroke(); g.shadowBlur = 0
  }
  g.fillStyle = col(n * 0.3, 70, 0.35); g.fillRect(0, mid - 0.5, w, 1)
}

// a circular spectrum around a core that pulses with the bass; sparks fly out on kicks
function drawRing(g, s, w, h, n, col, hue, sat) {
  // around an element (full screen's cover): the ring hugs it; otherwise centred in the strip
  const at = s.ringAt
  const cx = at ? at.x : w / 2, cy = at ? at.y : h / 2
  const r0 = at ? at.r * 1.05 + 6 + s.bass * 10 : Math.min(h * 0.17, w * 0.2) * (1 + s.bass * 0.15)
  const len = at ? Math.min(h * 0.2, w * 0.16) : Math.min(h * 0.27, w * 0.25) // r0 · 1.15 + 4 + len stays inside the strip
  const rot = s.t * 0.15
  // core (hidden behind the cover when wrapping one)
  if (!at) {
  const core = g.createRadialGradient(cx, cy, 0, cx, cy, r0)
  core.addColorStop(0, `hsla(${hue} ${sat}% 70% / ${s.active ? 0.55 + s.bass * 0.3 : 0.2})`); core.addColorStop(1, `hsla(${hue} ${sat}% 45% / 0.05)`)
  g.fillStyle = core; g.beginPath(); g.arc(cx, cy, r0 * 0.92, 0, Math.PI * 2); g.fill()
  g.strokeStyle = `hsla(${hue} ${sat}% 70% / 0.5)`; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, r0, 0, Math.PI * 2); g.stroke()
  }
  // spokes: mirrored so the ring is symmetric left / right
  g.lineCap = 'round'
  for (let i = 0; i < n; i++) {
    const v = s.bars[i < n / 2 ? i * 2 : (n - 1 - i) * 2 + 1] ?? s.bars[i]
    const a = rot + (i / n) * Math.PI * 2 - Math.PI / 2
    const l = 3 + v * len
    g.strokeStyle = col(i < n / 2 ? i * 2 : (n - i) * 2, 66, 0.95)
    g.lineWidth = Math.max(2, (Math.PI * 2 * r0) / n * 0.55)
    g.shadowColor = g.strokeStyle; g.shadowBlur = s.active ? 8 : 0
    g.beginPath(); g.moveTo(cx + Math.cos(a) * (r0 + 4), cy + Math.sin(a) * (r0 + 4)); g.lineTo(cx + Math.cos(a) * (r0 + 4 + l), cy + Math.sin(a) * (r0 + 4 + l)); g.stroke()
  }
  g.shadowBlur = 0
  // orbit
  g.strokeStyle = `hsla(${(hue + 40) % 360} ${sat}% 70% / 0.18)`; g.lineWidth = 1
  g.beginPath(); g.ellipse(cx, cy, r0 + len + 14, at ? (r0 + len + 14) * 0.92 : Math.min((r0 + len + 14) * 0.92, h / 2 - 2), rot, 0, Math.PI * 2); g.stroke()
  // sparks on strong bass
  if (s.active && s.bass > 0.55 && Math.random() < s.bass * 0.5 && s.sparks.length < 60) {
    const a = Math.random() * Math.PI * 2
    s.sparks.push({ x: cx + Math.cos(a) * r0, y: cy + Math.sin(a) * r0, vx: Math.cos(a) * (1 + s.bass * 3), vy: Math.sin(a) * (1 + s.bass * 3), life: 1, hue: hue + Math.random() * 70 })
  }
  for (const p of s.sparks) { p.x += p.vx; p.y += p.vy; p.life -= 0.02 }
  s.sparks = s.sparks.filter((p) => p.life > 0 && p.x > -10 && p.x < w + 10 && p.y > -10 && p.y < h + 10)
  for (const p of s.sparks) { g.fillStyle = `hsla(${p.hue % 360} ${sat}% 72% / ${p.life})`; g.beginPath(); g.arc(p.x, p.y, 1.6 + p.life * 1.4, 0, Math.PI * 2); g.fill() }
  // side spectra fill the wide strip: bars fading out to the edges
  const side = Math.max(0, Math.min(cx, w - cx) - (r0 + len + 30))
  if (side > 60 && !at) {
    const m = Math.floor(side / 9)
    for (let k = 0; k < m; k++) {
      const v = s.bars[Math.floor((k / m) * n * 0.8)] * (1 - k / m)
      const bh = 2 + v * h * 0.7
      for (const dir of [-1, 1]) {
        const x = cx + dir * (r0 + len + 30 + k * 9)
        g.fillStyle = col((k / m) * n, 62, 0.35 + 0.5 * (1 - k / m))
        roundRect(g, x - 2, cy - bh / 2, 4, bh, 2)
      }
    }
  }
}

// "#rrggbb" / "rgb(…)" → [hue, saturation %]
function hsOf(c) {
  let r, gg, b
  if (c.startsWith('#')) { r = parseInt(c.slice(1, 3), 16); gg = parseInt(c.slice(3, 5), 16); b = parseInt(c.slice(5, 7), 16) }
  else { [r, gg, b] = (c.match(/\d+(\.\d+)?/g) || [0, 0, 0]).map(Number) }
  r /= 255; gg /= 255; b /= 255
  const max = Math.max(r, gg, b), min = Math.min(r, gg, b), d = max - min
  let h = 0
  if (d) h = max === r ? ((gg - b) / d) % 6 : max === gg ? (b - r) / d + 2 : (r - gg) / d + 4
  const l = (max + min) / 2, sat = d ? d / (1 - Math.abs(2 * l - 1)) : 0
  return [Math.round((h * 60 + 360) % 360), Math.round(Math.max(45, Math.min(90, sat * 100)))]
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath()
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r)
  g.closePath(); g.fill()
}
function withAlpha(c, a) {
  if (c.startsWith('#') && c.length === 7) return c + Math.round(a * 255).toString(16).padStart(2, '0')
  if (c.startsWith('rgb(')) return c.replace('rgb(', 'rgba(').replace(')', `, ${a})`)
  return c
}
function hueOf(s) { let h = 0; for (const ch of String(s || '')) h = (h * 31 + ch.codePointAt(0)) % 360; return h }

// ── Spotify ───────────────────────────────────────────────────────────────────
function SpotifyPanel({ status, reload }) {
  const [playlists, setPlaylists] = useState(null)
  const [devices, setDevices] = useState(null)
  const [q, setQ] = useState('')
  const [results, setResults] = useState(null)
  const [err, setErr] = useState(null)
  const [pos, setPos] = useState(0)
  const [vol, setVol] = useState(null)
  const timer = useRef(null)
  const p = status?.player, item = p?.item
  const ok = status?.configured && status?.connected

  useEffect(() => { if (ok && playlists === null) api('/api/spotify/playlists').then((j) => setPlaylists(j.success ? j.data : [])).catch(() => setPlaylists([])) }, [ok])
  // progress ticks between polls
  useEffect(() => {
    setPos(p?.progressMs ?? 0)
    if (!p?.playing) return
    const t = setInterval(() => setPos((x) => Math.min((item?.durationMs || 0), x + 1000)), 1000)
    return () => clearInterval(t)
  }, [p?.progressMs, p?.playing, item?.uri])
  useEffect(() => { if (vol === null || !timer.current) setVol(p?.device?.volume ?? null) }, [p?.device?.volume])

  const control = async (action, value) => {
    setErr(null)
    const j = await api('/api/spotify/control', { action, value }).catch((e) => ({ error: e.message }))
    if (!j.success) setErr(j.error || T('failed'))
    setTimeout(reload, 500)
  }
  const play = async (uri) => {
    setErr(null)
    const j = await api('/api/spotify/play', { uri }).catch((e) => ({ error: e.message }))
    if (!j.success) setErr(j.error || T('failed'))
    setTimeout(reload, 700)
  }
  const changeVolume = (v) => {
    setVol(v)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { timer.current = null; control('volume', v) }, 300)
  }
  const search = (text) => {
    setQ(text)
    clearTimeout(search.t)
    search.t = setTimeout(() => {
      if (!text.trim()) return setResults(null)
      api(`/api/spotify/search?q=${encodeURIComponent(text.trim())}`).then((j) => setResults(j.success ? j.data : [])).catch(() => setResults([]))
    }, 400)
  }
  const openDevices = () => api('/api/spotify/devices').then((j) => setDevices(j.success ? j.data : [])).catch(() => setDevices([]))

  if (!status) return <div className="hub-empty">{T('loading')}</div>
  if (!ok) return (
    <div className="hub-setup" style={{ '--brand': SPOTIFY }}>
      <SpotifyLogo size={40} />
      <b>{status.configured ? T('spConnect') : T('spSetup')}</b>
      <span>{T('spWhy')}</span>
      <a className="hub-btn" href="/react/settings/spotify">{T('openSettings')}</a>
    </div>
  )
  const dur = item?.durationMs || 0
  return (
    <div className="hub-panel">
      <div className="hub-np" style={{ '--brand': SPOTIFY }}>
        {item?.image && <div className="hub-np-backdrop" style={{ backgroundImage: `url("${item.image}")` }} />}
        <div className="hub-np-art">{item?.image ? <img src={item.image} alt="" /> : <SpotifyLogo size={34} />}</div>
        <div className="hub-np-meta">
          <b>{item?.name || T('nothing')}</b>
          <span>{item ? [item.artist, item.album].filter(Boolean).join(' — ') : T('spPick')}</span>
          {item && (
            <div className="hub-progress"><span>{fmt(pos / 1000)}</span><div><i style={{ width: `${dur ? Math.min(100, (pos / dur) * 100) : 0}%` }} /></div><span>{fmt(dur / 1000)}</span></div>
          )}
          <div className="hub-ctrl">
            <button className={`hub-icon${p?.shuffle ? ' on' : ''}`} onClick={() => control('shuffle', !p?.shuffle)} title={T('shuffle')} aria-pressed={!!p?.shuffle}><ShuffleIcon /></button>
            <button className="hub-icon" onClick={() => control('prev')} title={T('prev')}><PrevIcon /></button>
            <button className="hub-play" onClick={() => control(p?.playing ? 'pause' : 'play')} title={p?.playing ? T('pause') : T('play')}>{p?.playing ? <PauseIcon /> : <PlayIcon />}</button>
            <button className="hub-icon" onClick={() => control('next')} title={T('next')}><NextIcon /></button>
            <div className="hub-device">
              <button className="hub-icon" onClick={() => (devices ? setDevices(null) : openDevices())} title={T('devices')}><SpeakerIcon /></button>
              {devices && (
                <div className="hub-menu">
                  {devices.length === 0 && <div className="hub-empty">{T('noDevices')}</div>}
                  {devices.map((d) => (
                    <button key={d.id} disabled={d.restricted} onClick={() => { api('/api/spotify/transfer', { deviceId: d.id }).then(() => setTimeout(reload, 800)); setDevices(null) }}>
                      <span>{d.name}<small>{d.type}</small></span>{d.active && <CheckIcon />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {p?.device && <div className="hub-on">{T('playingOn')} <b>{p.device.name}</b></div>}
        </div>
      </div>
      {vol != null && <VolumeControl value={vol} muted={vol === 0} small onChange={changeVolume} onMute={(m) => changeVolume(m ? 0 : 50)} />}
      {err && <div className="mp-error">{err}</div>}
      <div className="mp-search"><SearchIcon /><input value={q} onChange={(e) => search(e.target.value)} placeholder={T('spSearch')} aria-label={T('spSearch')} /></div>
      {results ? (
        <ArtGrid items={results.map((r) => ({ key: r.uri, title: r.name, sub: [T(r.kind), r.sub].filter(Boolean).join(' · '), image: r.image, onPlay: () => play(r.uri), round: r.kind === 'artist' }))} empty={T('noResults')} />
      ) : (
        <>
          <div className="hub-sub">{T('yourPlaylists')}</div>
          <ArtGrid items={(playlists || []).map((pl) => ({ key: pl.uri, title: pl.name, sub: pl.tracks != null ? T('tracks', { n: pl.tracks }) : pl.owner, image: pl.image, onPlay: () => play(pl.uri) }))} empty={playlists === null ? T('loading') : T('noPlaylists')} />
        </>
      )}
    </div>
  )
}

// ── Apple Music ───────────────────────────────────────────────────────────────
function ApplePanel() {
  const am = useSyncExternalStore(musicKit.subscribe, musicKit.get)
  const [recent, setRecent] = useState(null)
  const [library, setLibrary] = useState(null)
  const [q, setQ] = useState('')
  const [results, setResults] = useState(null)
  useEffect(() => { musicKit.start() }, [])
  useEffect(() => {
    if (am.phase !== 'ready' || !am.authorized) return
    musicKit.api('/v1/me/recent/played', { limit: 12 }).then((d) => setRecent(d?.data || [])).catch(() => setRecent([]))
    musicKit.api('/v1/me/library/playlists', { limit: 30 }).then((d) => setLibrary(d?.data || [])).catch(() => setLibrary([]))
  }, [am.phase, am.authorized])
  const search = (text) => {
    setQ(text)
    clearTimeout(search.t)
    search.t = setTimeout(async () => {
      if (!text.trim()) return setResults(null)
      try {
        const d = await musicKit.api('/v1/catalog/{{storefrontId}}/search', { term: text.trim(), types: 'songs,albums,playlists,stations', limit: 6 })
        setResults(['songs', 'albums', 'playlists', 'stations'].flatMap((k) => d?.results?.[k]?.data || []))
      } catch { setResults([]) }
    }, 400)
  }
  const toItems = (list) => (list || []).map((it) => {
    const a = it.attributes || {}
    return { key: it.type + it.id, title: a.name, sub: a.artistName || a.curatorName || (a.trackCount ? T('tracks', { n: a.trackCount }) : ''), image: artUrl(a.artwork, 300), onPlay: () => musicKit.play(musicKit.kindOf(it.type), it.id) }
  })

  if (am.phase === 'idle' || am.phase === 'loading') return <div className="hub-empty">{T('amLoading')}</div>
  if (am.phase === 'setup') return (
    <div className="hub-setup" style={{ '--brand': APPLE }}>
      <AppleLogo size={40} />
      <b>{T('amSetup')}</b>
      <span>{T('amWhy')}</span>
      <a className="hub-btn" href="/react/settings/applemusic">{T('openSettings')}</a>
    </div>
  )
  if (am.phase === 'error') return <div className="mp-error">{am.error}</div>
  const it = am.item
  return (
    <div className="hub-panel">
      <div className="hub-np" style={{ '--brand': APPLE }}>
        {it?.artwork && <div className="hub-np-backdrop" style={{ backgroundImage: `url("${artUrl(it.artwork, 200)}")` }} />}
        <div className="hub-np-art">{it?.artwork ? <img src={artUrl(it.artwork, 300)} alt="" /> : <AppleLogo size={34} />}</div>
        <div className="hub-np-meta">
          <b>{it?.name || T('nothing')}</b>
          <span>{it ? [it.artistName, it.albumName].filter(Boolean).join(' — ') : am.authorized ? T('amPick') : T('amPreview')}</span>
          {it && (
            <div className="hub-progress seek">
              <span>{fmt(am.pos)}</span>
              <input type="range" min="0" max={Math.max(1, Math.floor(am.dur))} value={Math.floor(am.pos)} onChange={(e) => musicKit.seek(Number(e.target.value))} aria-label={T('position')} style={{ '--pct': `${am.dur ? (am.pos / am.dur) * 100 : 0}%` }} />
              <span>{fmt(am.dur)}</span>
            </div>
          )}
          <div className="hub-ctrl">
            <button className="hub-icon" onClick={() => musicKit.prev()} title={T('prev')} disabled={!it}><PrevIcon /></button>
            <button className="hub-play" onClick={() => musicKit.toggle()} title={am.playing ? T('pause') : T('play')} disabled={!it}>{am.playing ? <PauseIcon /> : <PlayIcon />}</button>
            <button className="hub-icon" onClick={() => musicKit.next()} title={T('next')} disabled={!it}><NextIcon /></button>
            {!am.authorized
              ? <button className="hub-btn small" onClick={() => musicKit.signIn()}><AppleLogo size={14} /> {T('amSignIn')}</button>
              : <button className="hub-link" onClick={() => musicKit.signOut()}>{T('amSignOut')}</button>}
          </div>
          <div className="hub-on">{T('amHere')}</div>
        </div>
      </div>
      <VolumeControl value={am.volume} muted={am.volume === 0} small onChange={(v) => musicKit.setVolume(v)} onMute={(m) => musicKit.setVolume(m ? 0 : 60)} />
      {am.error && <div className="mp-error">{am.error}</div>}
      <div className="mp-search"><SearchIcon /><input value={q} onChange={(e) => search(e.target.value)} placeholder={T('amSearch')} aria-label={T('amSearch')} /></div>
      {results ? <ArtGrid items={toItems(results)} empty={T('noResults')} /> : (
        <>
          {recent?.length > 0 && <><div className="hub-sub">{T('recent')}</div><ArtGrid items={toItems(recent)} /></>}
          {library?.length > 0 && <><div className="hub-sub">{T('yourPlaylists')}</div><ArtGrid items={toItems(library)} /></>}
          {am.authorized && recent?.length === 0 && library?.length === 0 && <div className="hub-empty">{T('amEmpty')}</div>}
        </>
      )}
    </div>
  )
}

// ── TIDAL ─────────────────────────────────────────────────────────────────────
function TidalPanel() {
  const [st, setSt] = useState(null)
  const [lib, setLib] = useState(null)
  const [q, setQ] = useState('')
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => { api('/api/tidal/status').then((j) => setSt(j.success ? j.data : { configured: false })).catch(() => setSt({ configured: false })) }, [])
  useEffect(() => {
    if (!st?.connected) return
    api('/api/tidal/library').then((j) => { setLib(j.success ? j.data : { playlists: [], albums: [] }); if (!j.success) setError(j.error) }).catch(() => setLib({ playlists: [], albums: [] }))
  }, [st?.connected])
  const searchRef = useRef(0)
  const search = (text) => {
    setQ(text)
    clearTimeout(searchRef.t)
    searchRef.t = setTimeout(() => {
      if (!text.trim()) return setResults(null)
      const n = ++searchRef.current
      api(`/api/tidal/search?q=${encodeURIComponent(text.trim())}`).then((j) => {
        if (n !== searchRef.current) return
        setResults(j.success ? j.data : []); setError(j.success ? null : j.error)
      }).catch(() => setResults([]))
    }, 400)
  }
  const toItems = (list) => (list || []).map((r) => ({
    key: r.kind + r.id, title: r.name, image: r.image, round: r.kind === 'artist',
    sub: [T(r.kind), r.kind === 'playlist' && r.sub ? T('tracks', { n: r.sub }) : r.sub].filter(Boolean).join(' · '),
    onPlay: () => window.open(r.open || r.url, '_blank', 'noopener'),
  }))

  if (!st) return <div className="hub-empty">{T('loading')}</div>
  if (!st.configured || (!st.canSearch && !st.connected)) return (
    <div className="hub-setup" style={{ '--brand': TIDAL }}>
      <TidalLogo size={40} />
      <b>{st.configured ? T('tdConnect') : T('tdSetup')}</b>
      <span>{T('tdWhy')}</span>
      <a className="hub-btn" href="/react/settings/tidal">{T('openSettings')}</a>
    </div>
  )
  return (
    <div className="hub-panel">
      <div className="hub-np" style={{ '--brand': TIDAL }}>
        <div className="hub-np-art"><TidalLogo size={34} /></div>
        <div className="hub-np-meta">
          <b>TIDAL</b>
          <span>{st.connected ? `${T('tdSignedIn')} ${st.user?.name || ''}` : T('tdGuest')}</span>
          <div className="hub-ctrl">
            <a className="hub-btn small" style={{ marginLeft: 0 }} href="https://listen.tidal.com/" target="_blank" rel="noopener noreferrer"><TidalLogo size={14} /> {T('tdOpen')}</a>
            {!st.connected && <a className="hub-link" href="/react/settings/tidal">{T('tdSignIn')}</a>}
          </div>
          <div className="hub-on">{T('tdHere')}</div>
        </div>
      </div>
      {(error || st.error) && <div className="mp-error">{error || st.error}</div>}
      <div className="mp-search"><SearchIcon /><input value={q} onChange={(e) => search(e.target.value)} placeholder={T('tdSearch')} aria-label={T('tdSearch')} /></div>
      {results ? <ArtGrid items={toItems(results)} empty={T('noResults')} /> : st.connected && (
        lib === null ? <div className="hub-empty">{T('loading')}</div> : (
          <>
            {lib.playlists.length > 0 && <><div className="hub-sub">{T('yourPlaylists')}</div><ArtGrid items={toItems(lib.playlists)} /></>}
            {lib.albums.length > 0 && <><div className="hub-sub">{T('yourAlbums')}</div><ArtGrid items={toItems(lib.albums)} /></>}
            {!lib.playlists.length && !lib.albums.length && <div className="hub-empty">{T('tdEmpty')}</div>}
          </>
        )
      )}
    </div>
  )
}

function ArtGrid({ items, empty }) {
  if (!items.length) return empty ? <div className="hub-empty">{empty}</div> : null
  return (
    <div className="hub-art-grid">
      {items.map((it) => (
        <button key={it.key} className="hub-art-tile" onClick={it.onPlay} title={it.title}>
          <div className={`hub-art-img${it.round ? ' round' : ''}`}>
            {it.image ? <img src={it.image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} /> : <NoteIcon size={22} />}
            <span className="hub-art-play"><PlayIcon size={16} /></span>
          </div>
          <b>{it.title}</b>
          {it.sub && <small>{it.sub}</small>}
        </button>
      ))}
    </div>
  )
}

// ── Equalizer ─────────────────────────────────────────────────────────────────
function EqualizerPanel() {
  const local = useSyncExternalStore(localAudio.subscribe, localAudio.get)
  const eq = local.eq
  const set = (i, v) => localAudio.setEq({ gains: eq.gains.map((g, k) => (k === i ? v : g)), preset: '' })
  // a smooth response curve through the five bands (log frequency axis)
  const curve = useMemo(() => {
    const W = 300, H = 90, pts = []
    for (let x = 0; x <= W; x += 4) {
      const f = 20 * Math.pow(1000, x / W) // 20 Hz … 20 kHz
      let db = 0
      EQ_BANDS.forEach((bf, i) => {
        const d = Math.log2(f / bf)
        const width = i === 0 || i === EQ_BANDS.length - 1 ? 2.2 : 1.3
        const shape = i === 0 ? (d < 0 ? 1 : Math.exp(-(d * d) / width)) : i === EQ_BANDS.length - 1 ? (d > 0 ? 1 : Math.exp(-(d * d) / width)) : Math.exp(-(d * d) / width)
        db += (eq.on ? eq.gains[i] : 0) * shape
      })
      pts.push([x, H / 2 - (Math.max(-14, Math.min(14, db)) / 14) * (H / 2 - 6)])
    }
    const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y.toFixed(1)}`).join(' ')
    return { d, fill: `${d} L${W},${H} L0,${H} Z`, W, H }
  }, [eq])
  return (
    <div className="hub-panel hub-eq">
      <div className="hub-eq-top">
        <label className="hub-switch">
          <input type="checkbox" checked={eq.on} onChange={(e) => localAudio.setEq({ on: e.target.checked })} />
          <span className="hub-switch-ui" /><span>{eq.on ? T('eqOn') : T('eqOff')}</span>
        </label>
        <div className="hub-presets">
          {Object.keys(EQ_PRESETS).map((p) => (
            <button key={p} className={eq.preset === p ? 'on' : ''} onClick={() => localAudio.setEq({ gains: EQ_PRESETS[p], preset: p, on: true })}>{T(`p_${p}`)}</button>
          ))}
        </div>
      </div>
      <svg className="hub-eq-curve" viewBox={`0 0 ${curve.W} ${curve.H}`} preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="hub-eq-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#bf5af2" stopOpacity=".45" /><stop offset="100%" stopColor="#bf5af2" stopOpacity="0" /></linearGradient></defs>
        <line x1="0" y1={curve.H / 2} x2={curve.W} y2={curve.H / 2} className="hub-eq-zero" />
        <path d={curve.fill} fill="url(#hub-eq-fill)" />
        <path d={curve.d} fill="none" stroke="#bf5af2" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="hub-bands" data-off={String(!eq.on)}>
        {EQ_BANDS.map((f, i) => (
          <div key={f} className="hub-band">
            <span className="hub-band-db">{eq.gains[i] > 0 ? '+' : ''}{eq.gains[i]} dB</span>
            <input type="range" min="-12" max="12" step="0.5" value={eq.gains[i]} disabled={!eq.on}
              onChange={(e) => set(i, Number(e.target.value))} onDoubleClick={() => set(i, 0)}
              aria-label={`${f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`}`} aria-valuetext={`${eq.gains[i]} dB`} />
            <span className="hub-band-f">{f >= 1000 ? `${f / 1000}k` : f}</span>
          </div>
        ))}
      </div>
      <p className="hub-note">{T('eqWhere')}</p>
    </div>
  )
}

// ── icons ─────────────────────────────────────────────────────────────────────
const svg = (d, fill) => ({ size = 18, ...p }) => <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>{d}</svg>
const NoteIcon = svg(<><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>)
const PlayIcon = svg(<path d="M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5z" />, true)
const PauseIcon = svg(<><rect x="6" y="4.5" width="4" height="15" rx="1.2" /><rect x="14" y="4.5" width="4" height="15" rx="1.2" /></>, true)
const PrevIcon = svg(<><path d="M19 19L9 12l10-7v14z" /><rect x="5" y="5" width="2.5" height="14" rx="1" /></>, true)
const NextIcon = svg(<><path d="M5 5l10 7-10 7V5z" /><rect x="16.5" y="5" width="2.5" height="14" rx="1" /></>, true)
const ExpandIcon = svg(<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />)
const CloseIcon = svg(<path d="M18 6L6 18M6 6l12 12" />)
const BandIcon = svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 16v-2M10 16v-4M13 16v-3M16 16v-5" /></>)
const FillIcon = svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="12" cy="12" r="3" /><path d="M12 5.5v2M12 16.5v2M5.5 12h2M16.5 12h2" /></>)
const VolIcon = svg(<><path d="M11 5L6 9H3v6h3l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /></>)
const ShuffleIcon = svg(<><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></>)
const SpeakerIcon = svg(<><rect x="4" y="2" width="16" height="20" rx="2" /><circle cx="12" cy="14" r="4" /><line x1="12" y1="6" x2="12.01" y2="6" /></>)
const CheckIcon = svg(<path d="M20 6L9 17l-5-5" />)
const SearchIcon = svg(<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>)
const EqIcon = svg(<><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></>)
function SpotifyLogo({ size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill={SPOTIFY} /><path d="M6.5 9.3c3.8-1.1 8-.8 11.2 1M7.1 12.4c3.1-.9 6.6-.6 9.3.9M7.7 15.3c2.5-.7 5.1-.5 7.3.7" stroke="#000" strokeWidth="1.6" strokeLinecap="round" fill="none" /></svg>
}
function AppleLogo({ size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="6" fill={APPLE} /><path d="M15.8 6.2v8.3a2.1 2.1 0 1 1-1.4-2V8.6l-5 1v6.3a2.1 2.1 0 1 1-1.4-2V8.4l7.8-1.6z" fill="#fff" /></svg>
}

function TidalLogo({ size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="6" fill="#000" /><path d="M5 9.5l2.5-2.5L10 9.5 7.5 12zM10 9.5l2-2 .5-.5 2.5 2.5-2.5 2.5zM15 9.5l2.5-2.5L20 9.5 17.5 12zM10 14.5l2.5-2.5 2.5 2.5-2.5 2.5z" fill="#fff" /></svg>
}

// ── texts ─────────────────────────────────────────────────────────────────────
const TX = {
  en: { vizFill: 'Visualizer across the screen', vizBand: 'Visualizer along the bottom',
    fullScreen: 'Full screen', close: 'Close', thisScreen: 'On this screen', radioOn: 'Radio on', vol: 'Volume',
    vizStyle: 'Visualizer style', viz_bars: 'Bars', viz_wave: 'Wave', viz_ring: 'Ring',
    tdSetup: 'TIDAL isn’t set up', tdConnect: 'Sign in to TIDAL', tdWhy: 'Search TIDAL and browse your playlists and albums here. TIDAL doesn’t let other apps control playback, so Play opens the item in TIDAL.', tdSearch: 'Search TIDAL', tdOpen: 'Open TIDAL', tdSignIn: 'Sign in for your library', tdSignedIn: 'Signed in as', tdGuest: 'Search only — sign in to see your playlists and albums', tdHere: 'Play opens in the TIDAL web player or app', tdEmpty: 'Nothing in your collection yet', yourAlbums: 'Your albums',
    vizStation: 'Spectrum of the station, decoded by LSH and timed to the speaker', music: 'Music', show: 'Show music', hide: 'Hide music', hidden: 'hidden', equalizer: 'Equalizer', loading: 'Loading…', nothing: 'Nothing playing', play: 'Play', pause: 'Pause', prev: 'Previous', next: 'Next', shuffle: 'Shuffle', devices: 'Spotify devices', noDevices: 'No devices — open Spotify on a phone, computer or speaker', playingOn: 'Playing on', failed: 'That didn’t work',
    spSetup: 'Spotify isn’t set up', spConnect: 'Connect your Spotify account', spWhy: 'Control playback, browse your playlists and search — Spotify Premium is needed to control playback.', openSettings: 'Open Settings', spPick: 'Pick a playlist or search below', spSearch: 'Search Spotify', yourPlaylists: 'Your playlists', noPlaylists: 'No playlists', noResults: 'Nothing found', tracks: '{n} tracks', track: 'Song', playlist: 'Playlist', album: 'Album', artist: 'Artist',
    amLoading: 'Loading Apple Music…', amSetup: 'Apple Music isn’t set up', amWhy: 'An admin adds the MusicKit key in Settings → Media → Apple Music. Music then plays right here.', amPick: 'Pick something below', amPreview: 'Sign in to play full tracks — without it you get 30-second previews', amSignIn: 'Sign in', amSignOut: 'Sign out', amHere: 'Plays on this screen', amSearch: 'Search Apple Music', recent: 'Recently played', amEmpty: 'Nothing in your library yet', position: 'Position',
    eqOn: 'Equalizer on', eqOff: 'Equalizer off', p_flat: 'Flat', p_bass: 'Bass boost', p_vocal: 'Vocal', p_rock: 'Rock', p_jazz: 'Jazz', p_electronic: 'Electronic', p_night: 'Night',
    eqWhere: 'Applies live to radio on this screen, and to AirPlay speakers from the next station you start. Chromecast, Spotify and Apple Music play elsewhere or protected, so they can’t be equalized here. Double-click a slider to reset it.',
    liveSpectrum: 'live spectrum', vizLive: 'Spectrum of the audio playing on this screen', vizAnim: 'Animation — Spotify and Apple Music audio is protected, so its spectrum can’t be read' },
  pl: { vizFill: 'Wizualizacja na cały ekran', vizBand: 'Wizualizacja na dole',
    fullScreen: 'Pełny ekran', close: 'Zamknij', thisScreen: 'Na tym ekranie', radioOn: 'Radio na', vol: 'Głośność',
    vizStyle: 'Styl wizualizacji', viz_bars: 'Słupki', viz_wave: 'Fala', viz_ring: 'Pierścień',
    tdSetup: 'TIDAL nie jest skonfigurowany', tdConnect: 'Zaloguj się do TIDAL', tdWhy: 'Wyszukuj w TIDAL i przeglądaj tu swoje playlisty i albumy. TIDAL nie pozwala innym aplikacjom sterować odtwarzaniem, więc Odtwórz otwiera pozycję w TIDAL.', tdSearch: 'Szukaj w TIDAL', tdOpen: 'Otwórz TIDAL', tdSignIn: 'Zaloguj się, by zobaczyć bibliotekę', tdSignedIn: 'Zalogowano jako', tdGuest: 'Tylko wyszukiwanie — zaloguj się, by zobaczyć swoje playlisty i albumy', tdHere: 'Odtwarzanie otwiera się w odtwarzaczu TIDAL w przeglądarce lub w aplikacji', tdEmpty: 'Twoja kolekcja jest jeszcze pusta', yourAlbums: 'Twoje albumy',
    vizStation: 'Widmo stacji, dekodowane przez LSH i zgrane z głośnikiem', music: 'Muzyka', show: 'Pokaż muzykę', hide: 'Ukryj muzykę', hidden: 'ukryte', equalizer: 'Korektor', loading: 'Wczytywanie…', nothing: 'Nic nie gra', play: 'Odtwórz', pause: 'Pauza', prev: 'Poprzedni', next: 'Następny', shuffle: 'Losowo', devices: 'Urządzenia Spotify', noDevices: 'Brak urządzeń — otwórz Spotify na telefonie, komputerze lub głośniku', playingOn: 'Gra na', failed: 'Nie udało się',
    spSetup: 'Spotify nie jest skonfigurowane', spConnect: 'Połącz konto Spotify', spWhy: 'Steruj odtwarzaniem, przeglądaj playlisty i wyszukuj — do sterowania potrzebne jest Spotify Premium.', openSettings: 'Otwórz Ustawienia', spPick: 'Wybierz playlistę albo wyszukaj poniżej', spSearch: 'Szukaj w Spotify', yourPlaylists: 'Twoje playlisty', noPlaylists: 'Brak playlist', noResults: 'Nic nie znaleziono', tracks: 'utwory: {n}', track: 'Utwór', playlist: 'Playlista', album: 'Album', artist: 'Wykonawca',
    amLoading: 'Wczytywanie Apple Music…', amSetup: 'Apple Music nie jest skonfigurowane', amWhy: 'Admin dodaje klucz MusicKit w Ustawienia → Multimedia → Apple Music. Muzyka gra wtedy tutaj.', amPick: 'Wybierz coś poniżej', amPreview: 'Zaloguj się, aby słuchać całych utworów — bez tego 30-sekundowe fragmenty', amSignIn: 'Zaloguj', amSignOut: 'Wyloguj', amHere: 'Gra na tym ekranie', amSearch: 'Szukaj w Apple Music', recent: 'Ostatnio odtwarzane', amEmpty: 'Biblioteka jest pusta', position: 'Pozycja',
    eqOn: 'Korektor włączony', eqOff: 'Korektor wyłączony', p_flat: 'Płasko', p_bass: 'Więcej basu', p_vocal: 'Wokal', p_rock: 'Rock', p_jazz: 'Jazz', p_electronic: 'Elektronika', p_night: 'Noc',
    eqWhere: 'Działa na żywo dla radia na tym ekranie oraz dla głośników AirPlay od następnej uruchomionej stacji. Chromecast, Spotify i Apple Music grają gdzie indziej lub są chronione, więc nie da się ich tu korygować. Kliknij dwukrotnie suwak, aby go wyzerować.',
    liveSpectrum: 'widmo na żywo', vizLive: 'Widmo dźwięku grającego na tym ekranie', vizAnim: 'Animacja — dźwięk Spotify i Apple Music jest chroniony, więc nie da się odczytać jego widma' },
  de: { vizFill: 'Visualisierung über den ganzen Bildschirm', vizBand: 'Visualisierung unten',
    fullScreen: 'Vollbild', close: 'Schließen', thisScreen: 'Auf diesem Bildschirm', radioOn: 'Radio auf', vol: 'Lautstärke',
    vizStyle: 'Visualisierung', viz_bars: 'Balken', viz_wave: 'Welle', viz_ring: 'Ring',
    tdSetup: 'TIDAL ist nicht eingerichtet', tdConnect: 'Bei TIDAL anmelden', tdWhy: 'TIDAL durchsuchen und deine Playlists und Alben hier ansehen. TIDAL erlaubt anderen Apps keine Wiedergabesteuerung, daher öffnet Abspielen den Eintrag in TIDAL.', tdSearch: 'In TIDAL suchen', tdOpen: 'TIDAL öffnen', tdSignIn: 'Für deine Bibliothek anmelden', tdSignedIn: 'Angemeldet als', tdGuest: 'Nur Suche — melde dich an, um deine Playlists und Alben zu sehen', tdHere: 'Abspielen öffnet den TIDAL-Web-Player oder die App', tdEmpty: 'Deine Sammlung ist noch leer', yourAlbums: 'Deine Alben',
    vizStation: 'Spektrum des Senders, von LSH dekodiert und auf den Lautsprecher abgestimmt', music: 'Musik', show: 'Musik zeigen', hide: 'Musik ausblenden', hidden: 'ausgeblendet', equalizer: 'Equalizer', loading: 'Wird geladen…', nothing: 'Keine Wiedergabe', play: 'Abspielen', pause: 'Pause', prev: 'Zurück', next: 'Weiter', shuffle: 'Zufall', devices: 'Spotify-Geräte', noDevices: 'Keine Geräte — Spotify auf Handy, Computer oder Lautsprecher öffnen', playingOn: 'Läuft auf', failed: 'Das hat nicht geklappt',
    spSetup: 'Spotify ist nicht eingerichtet', spConnect: 'Spotify-Konto verbinden', spWhy: 'Wiedergabe steuern, Playlists durchsuchen und suchen — zum Steuern ist Spotify Premium nötig.', openSettings: 'Einstellungen öffnen', spPick: 'Unten eine Playlist wählen oder suchen', spSearch: 'In Spotify suchen', yourPlaylists: 'Deine Playlists', noPlaylists: 'Keine Playlists', noResults: 'Nichts gefunden', tracks: '{n} Titel', track: 'Titel', playlist: 'Playlist', album: 'Album', artist: 'Künstler',
    amLoading: 'Apple Music wird geladen…', amSetup: 'Apple Music ist nicht eingerichtet', amWhy: 'Ein Admin fügt den MusicKit-Schlüssel unter Einstellungen → Medien → Apple Music hinzu. Die Musik spielt dann hier.', amPick: 'Unten etwas wählen', amPreview: 'Anmelden für ganze Titel — sonst 30-Sekunden-Vorschauen', amSignIn: 'Anmelden', amSignOut: 'Abmelden', amHere: 'Spielt auf diesem Bildschirm', amSearch: 'In Apple Music suchen', recent: 'Zuletzt gespielt', amEmpty: 'Noch nichts in der Mediathek', position: 'Position',
    eqOn: 'Equalizer an', eqOff: 'Equalizer aus', p_flat: 'Neutral', p_bass: 'Bass-Boost', p_vocal: 'Gesang', p_rock: 'Rock', p_jazz: 'Jazz', p_electronic: 'Elektronisch', p_night: 'Nacht',
    eqWhere: 'Wirkt sofort auf Radio auf diesem Bildschirm und auf AirPlay-Lautsprecher ab dem nächsten gestarteten Sender. Chromecast, Spotify und Apple Music spielen anderswo oder geschützt und lassen sich hier nicht entzerren. Doppelklick auf einen Regler setzt ihn zurück.',
    liveSpectrum: 'Live-Spektrum', vizLive: 'Spektrum des Tons auf diesem Bildschirm', vizAnim: 'Animation — der Ton spielt auf einem Lautsprecher oder ist geschützt, daher kann diese Seite sein Spektrum nicht lesen' },
  fr: { vizFill: 'Visualisation sur tout l’écran', vizBand: 'Visualisation en bas',
    fullScreen: 'Plein écran', close: 'Fermer', thisScreen: 'Sur cet écran', radioOn: 'Radio sur', vol: 'Volume',
    vizStyle: 'Style de visualisation', viz_bars: 'Barres', viz_wave: 'Onde', viz_ring: 'Anneau',
    tdSetup: 'TIDAL n’est pas configuré', tdConnect: 'Connectez-vous à TIDAL', tdWhy: 'Cherchez dans TIDAL et parcourez ici vos playlists et albums. TIDAL ne permet pas aux autres apps de piloter la lecture : Lire ouvre l’élément dans TIDAL.', tdSearch: 'Rechercher sur TIDAL', tdOpen: 'Ouvrir TIDAL', tdSignIn: 'Se connecter pour voir sa bibliothèque', tdSignedIn: 'Connecté en tant que', tdGuest: 'Recherche seule — connectez-vous pour voir vos playlists et albums', tdHere: 'Lire ouvre le lecteur web TIDAL ou l’app', tdEmpty: 'Votre collection est encore vide', yourAlbums: 'Vos albums',
    vizStation: 'Spectre de la station, décodé par LSH et calé sur l’enceinte', music: 'Musique', show: 'Afficher la musique', hide: 'Masquer la musique', hidden: 'masqué', equalizer: 'Égaliseur', loading: 'Chargement…', nothing: 'Rien en lecture', play: 'Lire', pause: 'Pause', prev: 'Précédent', next: 'Suivant', shuffle: 'Aléatoire', devices: 'Appareils Spotify', noDevices: 'Aucun appareil — ouvrez Spotify sur un téléphone, un ordinateur ou une enceinte', playingOn: 'Lecture sur', failed: 'Échec',
    spSetup: 'Spotify n’est pas configuré', spConnect: 'Connectez votre compte Spotify', spWhy: 'Pilotez la lecture, parcourez vos playlists et cherchez — Spotify Premium est requis pour piloter la lecture.', openSettings: 'Ouvrir les réglages', spPick: 'Choisissez une playlist ou cherchez ci-dessous', spSearch: 'Rechercher sur Spotify', yourPlaylists: 'Vos playlists', noPlaylists: 'Aucune playlist', noResults: 'Aucun résultat', tracks: '{n} titres', track: 'Titre', playlist: 'Playlist', album: 'Album', artist: 'Artiste',
    amLoading: 'Chargement d’Apple Music…', amSetup: 'Apple Music n’est pas configuré', amWhy: 'Un admin ajoute la clé MusicKit dans Réglages → Médias → Apple Music. La musique joue alors ici.', amPick: 'Choisissez quelque chose ci-dessous', amPreview: 'Connectez-vous pour les titres complets — sinon extraits de 30 secondes', amSignIn: 'Se connecter', amSignOut: 'Se déconnecter', amHere: 'Joue sur cet écran', amSearch: 'Rechercher sur Apple Music', recent: 'Écoutés récemment', amEmpty: 'Rien dans votre bibliothèque', position: 'Position',
    eqOn: 'Égaliseur activé', eqOff: 'Égaliseur désactivé', p_flat: 'Plat', p_bass: 'Basses', p_vocal: 'Voix', p_rock: 'Rock', p_jazz: 'Jazz', p_electronic: 'Électro', p_night: 'Nuit',
    eqWhere: 'S’applique en direct à la radio sur cet écran, et aux enceintes AirPlay à partir de la prochaine station lancée. Chromecast, Spotify et Apple Music jouent ailleurs ou sont protégés et ne peuvent pas être égalisés ici. Double-cliquez sur un curseur pour le remettre à zéro.',
    liveSpectrum: 'spectre en direct', vizLive: 'Spectre du son joué sur cet écran', vizAnim: 'Animation — le son joue sur une enceinte ou est protégé, cette page ne peut donc pas lire son spectre' },
  es: { vizFill: 'Visualización en toda la pantalla', vizBand: 'Visualización abajo',
    fullScreen: 'Pantalla completa', close: 'Cerrar', thisScreen: 'En esta pantalla', radioOn: 'Radio en', vol: 'Volumen',
    vizStyle: 'Estilo de visualización', viz_bars: 'Barras', viz_wave: 'Onda', viz_ring: 'Anillo',
    tdSetup: 'TIDAL no está configurado', tdConnect: 'Inicia sesión en TIDAL', tdWhy: 'Busca en TIDAL y explora aquí tus listas y álbumes. TIDAL no permite que otras apps controlen la reproducción, así que Reproducir abre el elemento en TIDAL.', tdSearch: 'Buscar en TIDAL', tdOpen: 'Abrir TIDAL', tdSignIn: 'Inicia sesión para ver tu biblioteca', tdSignedIn: 'Sesión iniciada como', tdGuest: 'Solo búsqueda — inicia sesión para ver tus listas y álbumes', tdHere: 'Reproducir abre el reproductor web de TIDAL o la app', tdEmpty: 'Tu colección aún está vacía', yourAlbums: 'Tus álbumes',
    vizStation: 'Espectro de la emisora, decodificado por LSH y sincronizado con el altavoz', music: 'Música', show: 'Mostrar música', hide: 'Ocultar música', hidden: 'oculto', equalizer: 'Ecualizador', loading: 'Cargando…', nothing: 'No suena nada', play: 'Reproducir', pause: 'Pausa', prev: 'Anterior', next: 'Siguiente', shuffle: 'Aleatorio', devices: 'Dispositivos Spotify', noDevices: 'Sin dispositivos — abre Spotify en un móvil, ordenador o altavoz', playingOn: 'Sonando en', failed: 'No funcionó',
    spSetup: 'Spotify no está configurado', spConnect: 'Conecta tu cuenta de Spotify', spWhy: 'Controla la reproducción, explora tus listas y busca — se necesita Spotify Premium para controlar la reproducción.', openSettings: 'Abrir ajustes', spPick: 'Elige una lista o busca abajo', spSearch: 'Buscar en Spotify', yourPlaylists: 'Tus listas', noPlaylists: 'Sin listas', noResults: 'Sin resultados', tracks: '{n} canciones', track: 'Canción', playlist: 'Lista', album: 'Álbum', artist: 'Artista',
    amLoading: 'Cargando Apple Music…', amSetup: 'Apple Music no está configurado', amWhy: 'Un admin añade la clave MusicKit en Ajustes → Multimedia → Apple Music. La música suena aquí.', amPick: 'Elige algo abajo', amPreview: 'Inicia sesión para canciones completas — si no, fragmentos de 30 segundos', amSignIn: 'Iniciar sesión', amSignOut: 'Cerrar sesión', amHere: 'Suena en esta pantalla', amSearch: 'Buscar en Apple Music', recent: 'Escuchado recientemente', amEmpty: 'Tu biblioteca está vacía', position: 'Posición',
    eqOn: 'Ecualizador activado', eqOff: 'Ecualizador desactivado', p_flat: 'Plano', p_bass: 'Graves', p_vocal: 'Voz', p_rock: 'Rock', p_jazz: 'Jazz', p_electronic: 'Electrónica', p_night: 'Noche',
    eqWhere: 'Se aplica en directo a la radio en esta pantalla y a los altavoces AirPlay desde la próxima emisora que inicies. Chromecast, Spotify y Apple Music suenan en otro sitio o están protegidos, así que aquí no se pueden ecualizar. Doble clic en un control para restablecerlo.',
    liveSpectrum: 'espectro en directo', vizLive: 'Espectro del audio que suena en esta pantalla', vizAnim: 'Animación — el audio suena en un altavoz o está protegido, así que esta página no puede leer su espectro' },
  it: { vizFill: 'Visualizzazione a tutto schermo', vizBand: 'Visualizzazione in basso',
    fullScreen: 'Schermo intero', close: 'Chiudi', thisScreen: 'Su questo schermo', radioOn: 'Radio su', vol: 'Volume',
    vizStyle: 'Stile di visualizzazione', viz_bars: 'Barre', viz_wave: 'Onda', viz_ring: 'Anello',
    tdSetup: 'TIDAL non è configurato', tdConnect: 'Accedi a TIDAL', tdWhy: 'Cerca su TIDAL e sfoglia qui le tue playlist e i tuoi album. TIDAL non consente ad altre app di controllare la riproduzione, quindi Riproduci apre l’elemento in TIDAL.', tdSearch: 'Cerca su TIDAL', tdOpen: 'Apri TIDAL', tdSignIn: 'Accedi per la tua libreria', tdSignedIn: 'Accesso come', tdGuest: 'Solo ricerca — accedi per vedere le tue playlist e i tuoi album', tdHere: 'Riproduci apre il web player di TIDAL o l’app', tdEmpty: 'La tua raccolta è ancora vuota', yourAlbums: 'I tuoi album',
    vizStation: 'Spettro della stazione, decodificato da LSH e allineato all’altoparlante', music: 'Musica', show: 'Mostra musica', hide: 'Nascondi musica', hidden: 'nascosto', equalizer: 'Equalizzatore', loading: 'Caricamento…', nothing: 'Niente in riproduzione', play: 'Riproduci', pause: 'Pausa', prev: 'Precedente', next: 'Successivo', shuffle: 'Casuale', devices: 'Dispositivi Spotify', noDevices: 'Nessun dispositivo — apri Spotify su un telefono, computer o altoparlante', playingOn: 'In riproduzione su', failed: 'Non è riuscito',
    spSetup: 'Spotify non è configurato', spConnect: 'Collega il tuo account Spotify', spWhy: 'Controlla la riproduzione, sfoglia le playlist e cerca — per controllare la riproduzione serve Spotify Premium.', openSettings: 'Apri impostazioni', spPick: 'Scegli una playlist o cerca qui sotto', spSearch: 'Cerca su Spotify', yourPlaylists: 'Le tue playlist', noPlaylists: 'Nessuna playlist', noResults: 'Nessun risultato', tracks: '{n} brani', track: 'Brano', playlist: 'Playlist', album: 'Album', artist: 'Artista',
    amLoading: 'Caricamento di Apple Music…', amSetup: 'Apple Music non è configurato', amWhy: 'Un admin aggiunge la chiave MusicKit in Impostazioni → Media → Apple Music. La musica suona qui.', amPick: 'Scegli qualcosa qui sotto', amPreview: 'Accedi per i brani completi — altrimenti anteprime di 30 secondi', amSignIn: 'Accedi', amSignOut: 'Esci', amHere: 'Suona su questo schermo', amSearch: 'Cerca su Apple Music', recent: 'Ascoltati di recente', amEmpty: 'Libreria vuota', position: 'Posizione',
    eqOn: 'Equalizzatore attivo', eqOff: 'Equalizzatore spento', p_flat: 'Piatto', p_bass: 'Bassi', p_vocal: 'Voce', p_rock: 'Rock', p_jazz: 'Jazz', p_electronic: 'Elettronica', p_night: 'Notte',
    eqWhere: 'Si applica subito alla radio su questo schermo e agli altoparlanti AirPlay dalla prossima stazione avviata. Chromecast, Spotify e Apple Music suonano altrove o sono protetti, quindi qui non si possono equalizzare. Doppio clic su un cursore per azzerarlo.',
    liveSpectrum: 'spettro dal vivo', vizLive: 'Spettro dell’audio su questo schermo', vizAnim: 'Animazione — l’audio suona su un altoparlante o è protetto, quindi questa pagina non può leggerne lo spettro' },
  uk: { vizFill: 'Візуалізація на весь екран', vizBand: 'Візуалізація внизу',
    fullScreen: 'На весь екран', close: 'Закрити', thisScreen: 'На цьому екрані', radioOn: 'Радіо на', vol: 'Гучність',
    vizStyle: 'Стиль візуалізації', viz_bars: 'Стовпці', viz_wave: 'Хвиля', viz_ring: 'Кільце',
    tdSetup: 'TIDAL не налаштовано', tdConnect: 'Увійдіть у TIDAL', tdWhy: 'Шукайте в TIDAL і переглядайте тут свої плейлисти й альбоми. TIDAL не дозволяє іншим застосункам керувати відтворенням, тож «Відтворити» відкриває елемент у TIDAL.', tdSearch: 'Пошук у TIDAL', tdOpen: 'Відкрити TIDAL', tdSignIn: 'Увійдіть, щоб бачити бібліотеку', tdSignedIn: 'Вхід як', tdGuest: 'Лише пошук — увійдіть, щоб бачити свої плейлисти й альбоми', tdHere: '«Відтворити» відкриває вебплеєр TIDAL або застосунок', tdEmpty: 'Ваша колекція поки порожня', yourAlbums: 'Ваші альбоми',
    vizStation: 'Спектр станції, декодований LSH і синхронізований з динаміком', music: 'Музика', show: 'Показати музику', hide: 'Сховати музику', hidden: 'приховано', equalizer: 'Еквалайзер', loading: 'Завантаження…', nothing: 'Нічого не грає', play: 'Відтворити', pause: 'Пауза', prev: 'Попередній', next: 'Наступний', shuffle: 'Перемішати', devices: 'Пристрої Spotify', noDevices: 'Немає пристроїв — відкрийте Spotify на телефоні, комп’ютері чи динаміку', playingOn: 'Грає на', failed: 'Не вдалося',
    spSetup: 'Spotify не налаштовано', spConnect: 'Під’єднайте обліковий запис Spotify', spWhy: 'Керуйте відтворенням, переглядайте плейлисти й шукайте — для керування потрібен Spotify Premium.', openSettings: 'Відкрити налаштування', spPick: 'Оберіть плейлист або знайдіть нижче', spSearch: 'Пошук у Spotify', yourPlaylists: 'Ваші плейлисти', noPlaylists: 'Немає плейлистів', noResults: 'Нічого не знайдено', tracks: 'треків: {n}', track: 'Трек', playlist: 'Плейлист', album: 'Альбом', artist: 'Виконавець',
    amLoading: 'Завантаження Apple Music…', amSetup: 'Apple Music не налаштовано', amWhy: 'Адміністратор додає ключ MusicKit у Налаштування → Медіа → Apple Music. Тоді музика грає тут.', amPick: 'Оберіть щось нижче', amPreview: 'Увійдіть для повних треків — інакше 30-секундні фрагменти', amSignIn: 'Увійти', amSignOut: 'Вийти', amHere: 'Грає на цьому екрані', amSearch: 'Пошук в Apple Music', recent: 'Нещодавно слухали', amEmpty: 'Медіатека порожня', position: 'Позиція',
    eqOn: 'Еквалайзер увімкнено', eqOff: 'Еквалайзер вимкнено', p_flat: 'Рівно', p_bass: 'Більше басу', p_vocal: 'Вокал', p_rock: 'Рок', p_jazz: 'Джаз', p_electronic: 'Електроніка', p_night: 'Ніч',
    eqWhere: 'Діє одразу на радіо на цьому екрані та на динаміки AirPlay з наступної запущеної станції. Chromecast, Spotify і Apple Music грають деінде або захищені, тож їх тут не можна еквалізувати. Двічі клацніть повзунок, щоб скинути його.',
    liveSpectrum: 'спектр наживо', vizLive: 'Спектр звуку на цьому екрані', vizAnim: 'Анімація — звук грає на динаміку або захищений, тож ця сторінка не може прочитати його спектр' },
}
function T(k, vars) {
  let s = (TX[getLang()] || TX.en)[k] || TX.en[k] || k
  if (vars) for (const [n, v] of Object.entries(vars)) s = s.split(`{${n}}`).join(v)
  return s
}
