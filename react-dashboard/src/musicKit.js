// Apple Music (MusicKit JS v3) for the dashboard's music hub — one instance for
// the whole app, so music keeps playing while you switch views. The developer
// token comes from LSH (src/apple-music.js); the listener signs in with their
// Apple ID (full tracks need a subscription, otherwise 30-second previews).
// Subscribe with useSyncExternalStore(musicKit.subscribe, musicKit.get).
const SRC = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js'
const listeners = new Set()
let mk = null
let starting = null
let tick = null
let state = { phase: 'idle', error: null, authorized: false, playing: false, item: null, pos: 0, dur: 0, volume: 100 }

function emit(patch) { state = { ...state, ...patch }; for (const f of listeners) f() }
export const artUrl = (a, size = 300) => (a?.url ? a.url.replace('{w}', size).replace('{h}', size) : null)

function load() {
  if (window.MusicKit) return Promise.resolve(window.MusicKit)
  return new Promise((resolve, reject) => {
    document.addEventListener('musickitloaded', () => resolve(window.MusicKit), { once: true })
    if (!document.querySelector(`script[src="${SRC}"]`)) {
      const s = document.createElement('script')
      s.src = SRC; s.async = true
      s.onerror = () => reject(new Error('Couldn’t load MusicKit from Apple (offline, or blocked by an ad blocker?)'))
      document.head.appendChild(s)
    }
    setTimeout(() => reject(new Error('MusicKit didn’t load in time')), 20000)
  })
}

function sync() {
  if (!mk) return
  const MK = window.MusicKit
  const it = mk.nowPlayingItem
  emit({
    authorized: !!mk.isAuthorized,
    playing: mk.playbackState === MK.PlaybackStates.playing,
    item: it ? { id: it.id, ...it.attributes } : null,
    volume: Math.round((mk.volume ?? 1) * 100),
  })
}

export const musicKit = {
  subscribe(f) { listeners.add(f); return () => listeners.delete(f) },
  get() { return state },
  // load + configure on first use (the Apple Music tab opening)
  start() {
    if (starting) return starting
    emit({ phase: 'loading', error: null })
    starting = (async () => {
      const r = await fetch('/api/apple-music/token', { credentials: 'include' }).then((x) => x.json()).catch(() => null)
      if (!r?.success || !r.data?.developerToken) { emit({ phase: 'setup' }); starting = null; return } // not set up in LSH
      try {
        const MK = await load()
        mk = MK.getInstance?.() || await MK.configure({ developerToken: r.data.developerToken, app: { name: 'LSH', build: '1.0' }, storefrontId: r.data.storefront })
        for (const e of ['playbackStateDidChange', 'nowPlayingItemDidChange', 'authorizationStatusDidChange', 'playbackVolumeDidChange']) mk.addEventListener(e, sync)
        mk.addEventListener('playbackTimeDidChange', () => {
          clearTimeout(tick)
          tick = setTimeout(() => emit({ pos: mk.currentPlaybackTime || 0, dur: mk.currentPlaybackDuration || 0 }), 200)
        })
        sync()
        emit({ phase: 'ready' })
      } catch (err) { emit({ phase: 'error', error: err.message }); starting = null }
    })()
    return starting
  },
  async signIn() { try { await mk?.authorize() } catch (err) { emit({ error: err?.message || 'Sign-in cancelled' }) } },
  async signOut() { try { await mk?.unauthorize() } catch { /* already out */ } sync() },
  async play(kind, id) {
    emit({ error: null })
    try { await mk.setQueue({ [kind]: id, startPlaying: true }) } catch (err) { emit({ error: err?.message || 'Couldn’t play that' }) }
  },
  toggle() { if (!mk) return; if (state.playing) mk.pause(); else mk.play().catch((err) => emit({ error: err?.message })) },
  next() { mk?.skipToNextItem().catch(() => {}) },
  prev() { mk?.skipToPreviousItem().catch(() => {}) },
  seek(s) { mk?.seekToTime(s) },
  setVolume(v) { if (mk) mk.volume = Math.max(0, Math.min(100, v)) / 100 },
  async api(path, params) { const r = await mk.api.music(path, params); return r.data },
  kindOf(type) { return { songs: 'song', albums: 'album', playlists: 'playlist', stations: 'station', 'library-playlists': 'playlist', 'library-albums': 'album', 'library-songs': 'song' }[type] || 'song' },
}
