import { useEffect, useRef, useState } from 'react'
import PageShell from './PageShell'

// Apple Music player (MusicKit JS v3) — plays in this browser, signed in with
// the listener's Apple ID (full tracks need an Apple Music subscription;
// otherwise 30-second previews). The developer token comes from LSH
// (src/apple-music.js). While open, the page reports what it plays to LSH and
// runs commands sent to the `applemusic/player` device (dashboard, flows).

const MUSICKIT_SRC = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js'
const api = (url, method = 'GET', body) => fetch(url, {
  method, credentials: 'include',
  ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
}).then((r) => r.json())
const fmt = (s) => (s == null || !Number.isFinite(s) ? '0:00' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`)
const art = (a, size = 300) => (a?.url ? a.url.replace('{w}', size).replace('{h}', size) : null)

function loadMusicKit() {
  if (window.MusicKit) return Promise.resolve(window.MusicKit)
  return new Promise((resolve, reject) => {
    document.addEventListener('musickitloaded', () => resolve(window.MusicKit), { once: true })
    if (!document.querySelector(`script[src="${MUSICKIT_SRC}"]`)) {
      const s = document.createElement('script')
      s.src = MUSICKIT_SRC; s.async = true
      s.onerror = () => reject(new Error('Couldn’t load MusicKit from Apple (offline, or blocked by an ad blocker?)'))
      document.head.appendChild(s)
    }
    setTimeout(() => reject(new Error('MusicKit didn’t load in time')), 20000)
  })
}

const playerId = () => {
  try {
    let id = localStorage.getItem('lsh-am-player')
    if (!id) { id = `p${Math.random().toString(36).slice(2, 12)}`; localStorage.setItem('lsh-am-player', id) }
    return id
  } catch { return `p${Math.random().toString(36).slice(2, 12)}` }
}
const defaultName = () => {
  try { return localStorage.getItem('lsh-am-name') || `${/iPad|iPhone|Android/.test(navigator.userAgent) ? 'Tablet / phone' : 'Browser'} (${navigator.platform || 'web'})` } catch { return 'Browser' }
}

export default function MusicPage({ onClose }) {
  const [phase, setPhase] = useState('loading') // loading | setup | error | ready
  const [error, setError] = useState(null)
  const [authorized, setAuthorized] = useState(false)
  const [np, setNp] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState({ pos: 0, dur: 0 })
  const [volume, setVolume] = useState(100)
  const [q, setQ] = useState('')
  const [results, setResults] = useState(null)
  const [library, setLibrary] = useState([])
  const [recent, setRecent] = useState([])
  const [name, setName] = useState(defaultName)
  const [msg, setMsg] = useState(null)
  const mk = useRef(null)
  const id = useRef(playerId())

  // Configure MusicKit with LSH's developer token
  useEffect(() => {
    let off = false
    ;(async () => {
      const t = await api('/api/apple-music/token').catch(() => null)
      if (!t?.success) { if (!off) setPhase('setup'); return }
      try {
        const MK = await loadMusicKit()
        const music = await MK.configure({ developerToken: t.data.developerToken, app: { name: 'LSH', build: '1.0' }, storefrontId: t.data.storefront })
        if (off) return
        mk.current = music
        const sync = () => {
          setAuthorized(!!music.isAuthorized)
          setPlaying(music.playbackState === MK.PlaybackStates.playing)
          setNp(music.nowPlayingItem ? { ...music.nowPlayingItem.attributes, id: music.nowPlayingItem.id } : null)
          setVolume(Math.round((music.volume ?? 1) * 100))
        }
        const tick = () => setTime({ pos: music.currentPlaybackTime || 0, dur: music.currentPlaybackDuration || 0 })
        for (const e of ['playbackStateDidChange', 'nowPlayingItemDidChange', 'authorizationStatusDidChange', 'playbackVolumeDidChange']) music.addEventListener(e, sync)
        music.addEventListener('playbackTimeDidChange', tick)
        sync()
        setPhase('ready')
      } catch (err) { if (!off) { setError(err.message); setPhase('error') } }
    })()
    return () => { off = true; try { mk.current?.stop() } catch {} }
  }, [])

  // Library + recently played once signed in
  useEffect(() => {
    const music = mk.current
    if (!authorized || !music) return
    music.api.music('/v1/me/library/playlists', { limit: 50 }).then((r) => setLibrary(r.data?.data || [])).catch(() => {})
    music.api.music('/v1/me/recent/played', { limit: 10 }).then((r) => setRecent(r.data?.data || [])).catch(() => {})
  }, [authorized])

  const kindOf = (type) => ({ songs: 'song', albums: 'album', playlists: 'playlist', stations: 'station', 'library-playlists': 'playlist', 'library-albums': 'album', 'library-songs': 'song' }[type] || 'song')
  const playItem = async (kind, itemId) => {
    setMsg(null)
    try { await mk.current.setQueue({ [kind]: itemId, startPlaying: true }) }
    catch (err) { setMsg(err?.message || 'Couldn’t play that') }
  }
  const run = async (c) => {
    const music = mk.current
    if (!music) return
    try {
      if (c.cmd === 'play') await music.play()
      else if (c.cmd === 'pause') music.pause()
      else if (c.cmd === 'next') await music.skipToNextItem()
      else if (c.cmd === 'prev') await music.skipToPreviousItem()
      else if (c.cmd === 'volume') music.volume = Math.max(0, Math.min(100, c.value)) / 100
      else if (c.cmd === 'playItem') await playItem(c.kind, c.id)
    } catch (err) { setMsg(err?.message || String(err)) }
  }

  // Report to LSH, pick up commands for this player
  const latest = useRef({})
  latest.current = { np, playing, volume, time, authorized, name }
  useEffect(() => {
    if (phase !== 'ready') return
    const send = async () => {
      const s = latest.current
      const j = await api(`/api/apple-music/player/${id.current}/report`, 'POST', {
        name: s.name,
        state: { playing: s.playing, volume: s.volume, track: s.np?.name, artist: s.np?.artistName, album: s.np?.albumName, artwork: art(s.np?.artwork, 300), position: s.time.pos, duration: s.time.dur, authorized: s.authorized },
      }).catch(() => null)
      for (const c of j?.data?.commands || []) await run(c)
    }
    send()
    const iv = setInterval(send, 2000)
    return () => clearInterval(iv)
  }, [phase])

  const search = async (e) => {
    e?.preventDefault()
    if (!q.trim()) return setResults(null)
    try {
      const r = await mk.current.api.music('/v1/catalog/{{storefrontId}}/search', { term: q.trim(), types: 'songs,albums,playlists,stations', limit: 8 })
      setResults(r.data?.results || {})
    } catch (err) { setMsg(err?.message || 'Search failed') }
  }
  const signIn = async () => { try { await mk.current.authorize() } catch (err) { setMsg(err?.message || 'Sign-in cancelled') } }
  const signOut = async () => { try { await mk.current.unauthorize() } catch {} setLibrary([]); setRecent([]) }
  const saveName = (v) => { setName(v); try { localStorage.setItem('lsh-am-name', v) } catch {} }

  return (
    <PageShell title="Music" icon={<span>🎵</span>} onClose={onClose}
      actions={phase === 'ready' && (authorized
        ? <button className="stg-btn stg-btn-secondary" onClick={signOut}>Sign out of Apple Music</button>
        : <button className="stg-btn stg-btn-primary" onClick={signIn}> Sign in with Apple Music</button>)}>
      <div className="am-page">
        {phase === 'loading' && <p className="stg-hint">Loading Apple Music…</p>}
        {phase === 'setup' && <div className="am-empty"><div style={{ fontSize: 48 }}>🎵</div><p>Apple Music isn’t set up yet.</p><p className="stg-hint">An admin adds the MusicKit key in <a href="/react/settings">Settings → Media → Apple Music</a>.</p></div>}
        {phase === 'error' && <div className="am-empty"><p>⚠ {error}</p></div>}
        {phase === 'ready' && (
          <>
            <div className={`am-np${playing ? ' playing' : ''}`}>
              <div className="am-art"><span>🎵</span>{np?.artwork && <img key={np.id} src={art(np.artwork, 400)} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }}/>}</div>
              <div className="am-meta">
                <b>{np?.name || 'Nothing playing'}</b>
                <span>{np ? `${np.artistName || ''}${np.albumName ? ` — ${np.albumName}` : ''}` : authorized ? 'Pick something below' : 'Sign in to play full tracks — without it you get 30-second previews'}</span>
                {np && (
                  <div className="am-time">
                    <span>{fmt(time.pos)}</span>
                    <input type="range" min="0" max={Math.max(1, Math.floor(time.dur))} value={Math.floor(time.pos)} onChange={(e) => mk.current.seekToTime(Number(e.target.value))}/>
                    <span>{fmt(time.dur)}</span>
                  </div>
                )}
                <div className="am-ctrl">
                  <button title="Previous" onClick={() => run({ cmd: 'prev' })}>⏮</button>
                  <button title={playing ? 'Pause' : 'Play'} className="main" onClick={() => run({ cmd: playing ? 'pause' : 'play' })} disabled={!np}>{playing ? '⏸' : '▶'}</button>
                  <button title="Next" onClick={() => run({ cmd: 'next' })}>⏭</button>
                  <label className="am-vol">🔈<input type="range" min="0" max="100" value={volume} onChange={(e) => run({ cmd: 'volume', value: Number(e.target.value) })}/></label>
                </div>
                <label className="am-name stg-hint">This player in LSH: <input className="stg-input" value={name} onChange={(e) => saveName(e.target.value)}/></label>
              </div>
            </div>
            {msg && <p className="stg-hint" style={{ color: 'var(--red)' }}>{msg}</p>}

            <form className="am-search" onSubmit={search}>
              <input className="stg-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Apple Music"/>
              <button className="stg-btn stg-btn-primary" type="submit">Search</button>
            </form>
            {results && ['songs', 'albums', 'playlists', 'stations'].filter((k) => results[k]?.data?.length).map((k) => (
              <Section key={k} title={{ songs: 'Songs', albums: 'Albums', playlists: 'Playlists', stations: 'Stations' }[k]} items={results[k].data} onPlay={(it) => playItem(kindOf(it.type), it.id)}/>
            ))}
            {results && !Object.values(results).some((r) => r?.data?.length) && <p className="stg-hint">Nothing found.</p>}
            {recent.length > 0 && <Section title="Recently played" items={recent} onPlay={(it) => playItem(kindOf(it.type), it.id)}/>}
            {library.length > 0 && <Section title="Your playlists" items={library} onPlay={(it) => playItem('playlist', it.id)}/>}
            <p className="stg-hint am-foot">Music plays in this browser. While this page is open, LSH shows it as the device <code>applemusic/player</code> — dashboards and flows can play / pause / skip / set the volume, or start something with <code>POST /api/apple-music/play {'{'} "kind": "playlist", "id": "pl.…" {'}'}</code>.</p>
          </>
        )}
      </div>
    </PageShell>
  )
}

function Section({ title, items, onPlay }) {
  return (
    <>
      <h4 className="stg-subheading">{title}</h4>
      <div className="sp-grid am-grid">
        {items.map((it) => {
          const a = it.attributes || {}
          return (
            <button key={it.type + it.id} className="sp-tile" onClick={() => onPlay(it)} title={`Play ${a.name}`}>
              <div className="sp-tile-art"><span>🎵</span>{art(a.artwork, 300) && <img src={art(a.artwork, 300)} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }}/>}<i>▶</i></div>
              <b>{a.name}</b>
              <span>{a.artistName || a.curatorName || (a.trackCount ? `${a.trackCount} tracks` : '')}</span>
            </button>
          )
        })}
      </div>
    </>
  )
}
