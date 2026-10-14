// Audio played by this screen itself — the media player's "This screen" target.
// One <audio> element for the whole app, so playback goes on while you switch
// views (dashboard ↔ wall ↔ settings) and every player shows the same state.
// Subscribe with useSyncExternalStore(localAudio.subscribe, localAudio.get).
//
// Browsers play MP3 / AAC / Ogg / Opus streams and files; HLS (.m3u8) only in
// Safari. Playback has to start from a tap (autoplay rules), which the player's
// buttons are.
const listeners = new Set()
let audio = null
let stopping = false
let state = { url: '', title: '', status: 'idle', volume: readVolume(), error: null }

function readVolume() {
  try { const v = Number(localStorage.getItem('lsh-local-volume')); return v >= 0 && v <= 100 && localStorage.getItem('lsh-local-volume') !== null ? v : 80 } catch { return 80 }
}
function emit(patch) {
  state = { ...state, ...patch }
  for (const f of listeners) f()
}
function el() {
  if (audio) return audio
  audio = new Audio()
  audio.preload = 'none'
  audio.volume = state.volume / 100
  audio.addEventListener('playing', () => emit({ status: 'playing', error: null }))
  audio.addEventListener('waiting', () => { if (state.status !== 'idle') emit({ status: 'buffering' }) })
  audio.addEventListener('pause', () => { if (!stopping && !audio.ended && state.status !== 'idle') emit({ status: 'paused' }) })
  audio.addEventListener('ended', () => emit({ status: 'idle' }))
  audio.addEventListener('error', () => {
    if (stopping || !audio.getAttribute('src')) return
    emit({ status: 'idle', error: 'This browser can\'t play that stream' })
  })
  return audio
}

export const localAudio = {
  subscribe(f) { listeners.add(f); return () => listeners.delete(f) },
  get() { return state },
  async play(url, title) {
    const a = el()
    stopping = false
    a.src = url
    emit({ url, title: title || url, status: 'buffering', error: null })
    try { await a.play() } catch (err) {
      emit({ status: 'idle', error: err.name === 'NotAllowedError' ? 'Tap play to start sound on this screen' : 'This browser can\'t play that stream' })
      return false
    }
    return true
  },
  pause() { audio?.pause() },
  resume() { audio?.play().catch(() => emit({ error: 'This browser can\'t play that stream' })) },
  stop() {
    if (audio) { stopping = true; audio.pause(); audio.removeAttribute('src'); audio.load() }
    emit({ status: 'idle', url: '', title: '', error: null })
  },
  setVolume(v) {
    const vol = Math.max(0, Math.min(100, Math.round(v)))
    if (audio) audio.volume = vol / 100
    try { localStorage.setItem('lsh-local-volume', String(vol)) } catch { /* private mode */ }
    emit({ volume: vol })
  },
}
