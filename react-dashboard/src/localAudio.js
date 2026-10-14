// Audio played by this screen itself — the media player's "This screen" target.
// One <audio> element for the whole app, so playback goes on while you switch
// views (dashboard ↔ wall ↔ settings) and every player shows the same state.
// Subscribe with useSyncExternalStore(localAudio.subscribe, localAudio.get).
//
// Browsers play MP3 / AAC / Ogg / Opus streams and files; HLS (.m3u8) only in
// Safari. Playback has to start from a tap (autoplay rules), which the player's
// buttons are.
//
// Sound goes through Web Audio: a 5-band equalizer (EQ_BANDS) and an analyser
// that the music hub's visualizer reads. Streams come through LSH's relay
// (same origin), so the browser lets Web Audio see them.
export const EQ_BANDS = [60, 230, 910, 3600, 14000]
export const EQ_PRESETS = {
  flat: [0, 0, 0, 0, 0], bass: [7, 4, 0, 0, 1], vocal: [-2, -1, 3, 4, 1], rock: [5, 2, -2, 3, 5],
  jazz: [3, 1, -1, 2, 3], electronic: [6, 3, 0, 2, 5], night: [-3, -1, 1, 1, -4],
}
const listeners = new Set()
let audio = null
let graph = null // { ctx, filters, analyser }
let stopping = false
let state = { url: '', title: '', status: 'idle', volume: readVolume(), muted: false, error: null, eq: readEq() }

function readVolume() {
  try { const v = Number(localStorage.getItem('lsh-local-volume')); return v >= 0 && v <= 100 && localStorage.getItem('lsh-local-volume') !== null ? v : 80 } catch { return 80 }
}
function readEq() {
  try {
    const e = JSON.parse(localStorage.getItem('lsh-eq') || 'null')
    if (Array.isArray(e?.gains) && e.gains.length === EQ_BANDS.length) return { on: e.on !== false, gains: e.gains.map((g) => Math.max(-12, Math.min(12, Number(g) || 0))), preset: e.preset || '' }
  } catch { /* fall through */ }
  return { on: true, gains: [0, 0, 0, 0, 0], preset: 'flat' }
}
// Build the Web Audio graph once (needs a user gesture — called from play)
function ensureGraph() {
  if (graph || !audio) return graph
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return null
  try {
    const ctx = new AC()
    const source = ctx.createMediaElementSource(audio)
    const filters = EQ_BANDS.map((f, i) => {
      const b = ctx.createBiquadFilter()
      b.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking'
      b.frequency.value = f
      b.Q.value = 1
      return b
    })
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.78
    let node = source
    for (const b of filters) { node.connect(b); node = b }
    node.connect(analyser)
    analyser.connect(ctx.destination)
    graph = { ctx, filters, analyser }
    applyEq()
  } catch { graph = null }
  return graph
}
function applyEq() {
  if (!graph) return
  graph.filters.forEach((b, i) => { b.gain.value = state.eq.on ? state.eq.gains[i] : 0 })
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
  audio.muted = state.muted
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
  // url = the stream (what's shown / looked up); src = what the element loads, e.g.
  // LSH's relay (/api/media/stream?url=…) so https pages can play http streams
  async play(url, title, src = url) {
    const a = el()
    stopping = false
    a.src = src
    emit({ url, title: title || url, status: 'buffering', error: null })
    const g = ensureGraph()
    if (g?.ctx.state === 'suspended') g.ctx.resume().catch(() => {})
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
    if (audio) { audio.volume = vol / 100; audio.muted = false }
    try { localStorage.setItem('lsh-local-volume', String(vol)) } catch { /* private mode */ }
    emit({ volume: vol, muted: false })
  },
  // equalizer: { on?, gains?: [5 × dB], preset? } — applied live
  setEq(patch) {
    const eq = { ...state.eq, ...patch }
    eq.gains = eq.gains.map((g) => Math.max(-12, Math.min(12, Math.round(Number(g) * 2) / 2 || 0)))
    try { localStorage.setItem('lsh-eq', JSON.stringify(eq)) } catch { /* private mode */ }
    emit({ eq })
    applyEq()
  },
  // the visualizer's data source (null until something has played on this screen)
  analyser() { return graph?.analyser || null },
  setMuted(muted) {
    if (audio) audio.muted = !!muted
    emit({ muted: !!muted })
  },
}
