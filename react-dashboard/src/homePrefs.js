// Home-view customisation (Apple-Home-style "Edit Home View"): which overview
// sections show and in what order, favourite devices pinned to the top,
// devices hidden from the overview, and per-device tile size. Kept in
// localStorage like the dashboard grid layout (DashboardGrid.jsx), so it's
// per browser. Tiles, the device popup and the editor all read it through
// useHomePrefs(), so a change in one place re-renders the others at once.
import { useSyncExternalStore } from 'react'

const KEY = 'lsh-home-prefs'
// wide / narrow: per-device overrides of the default tile size (defaultWide)
const EMPTY = { order: [], hidden: [], favs: [], hiddenDevices: [], wide: [], narrow: [] }

let cache = load()
const listeners = new Set()

function load() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (p && typeof p === 'object') {
      const out = { ...EMPTY }
      for (const k of Object.keys(EMPTY)) if (Array.isArray(p[k])) out[k] = p[k].filter(x => typeof x === 'string')
      return out
    }
  } catch { /* storage blocked or bad JSON — defaults */ }
  return { ...EMPTY }
}

export function getHomePrefs() { return cache }

export function setHomePrefs(update) {
  cache = { ...cache, ...(typeof update === 'function' ? update(cache) : update) }
  try { localStorage.setItem(KEY, JSON.stringify(cache)) } catch { /* in-memory only */ }
  listeners.forEach(l => l())
}

export function resetHomePrefs() {
  cache = { ...EMPTY }
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
  listeners.forEach(l => l())
}

function subscribe(l) {
  listeners.add(l)
  // another tab / window editing the same prefs
  const onStorage = e => { if (e.key === KEY) { cache = load(); l() } }
  window.addEventListener('storage', onStorage)
  return () => { listeners.delete(l); window.removeEventListener('storage', onStorage) }
}

export function useHomePrefs() {
  return useSyncExternalStore(subscribe, getHomePrefs)
}

const toggleIn = (list, id, on) => {
  const has = list.includes(id)
  if (on === undefined) on = !has
  return on ? (has ? list : [...list, id]) : list.filter(x => x !== id)
}

export const toggleFav = (key, on) => setHomePrefs(p => ({ favs: toggleIn(p.favs, key, on) }))
// Bento default: media players and dimmable lights get a 2-column tile.
const WIDE_TYPES = new Set(['sonos', 'radio', 'denon', 'lgwebos', 'sony', 'beosound'])
export function defaultWide(device) {
  const r = device?.readings || {}
  return WIDE_TYPES.has(device?.type) || (r.level != null && r.switch != null)
}
export function isTileWide(device, prefs) {
  if (prefs.wide.includes(device.key)) return true
  if (prefs.narrow.includes(device.key)) return false
  return defaultWide(device)
}
// Stores only a difference from the default, so devices keep following it otherwise.
export const setTileWide = (device, on) => setHomePrefs(p => {
  const k = device.key, def = defaultWide(device)
  return { wide: toggleIn(p.wide, k, on && !def), narrow: toggleIn(p.narrow, k, !on && def) }
})
export const toggleDeviceHidden = (key, on) => setHomePrefs(p => ({ hiddenDevices: toggleIn(p.hiddenDevices, key, on) }))
export const toggleSectionHidden = (id, on) => setHomePrefs(p => ({ hidden: toggleIn(p.hidden, id, on) }))

// Saved order first (dropping ids that no longer exist), then any section
// that's new since the order was saved, in its default position.
export function orderSections(defaultIds, saved) {
  const known = new Set(defaultIds)
  const head = saved.filter(id => known.has(id))
  const seen = new Set(head)
  return [...head, ...defaultIds.filter(id => !seen.has(id))]
}
