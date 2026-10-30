import * as THREE from 'three'

// Real LSH devices on the imported 3D model (PlanModelViewer).
//
// The model carries device slots as named nodes, "<category>__<slot>[_part]"
// (lighting__light_kitchen, lighting__light_kitchen_stem, climate__ac_living_tag,
// …) — the format exported by the LSH floor-plan tool. Windows (win_<room>_<side>_*)
// become slots for blinds. Each LSH device is placed on a slot of its category:
// a saved binding first (config.homePlan.model.bindings), then a free slot whose
// name shares a room word with the device's room or label, then any free slot.

export const MODEL_CATS = ['Lighting', 'Switches', 'Blinds', 'Climate', 'Media', 'Security', 'Sensors', 'Victron', 'Other']
export const CAT_COLOR = {
  Lighting: '#ffcc00', Switches: '#0a84ff', Blinds: '#5ac8fa', Climate: '#ff9f0a', Media: '#bf5af2',
  Security: '#ff453a', Sensors: '#30c7b5', Victron: '#30d158', Other: '#8e8e93',
}
const SLOT_CAT = {
  lighting: 'Lighting', lamp: 'Lighting', switches: 'Switches', climate: 'Climate', media: 'Media',
  security: 'Security', sensors: 'Sensors', victron: 'Victron', other: 'Other',
}
const PART = /_(stem|lens|collar|shade|tag|body|base|screen|led|cap|ring|dome|grille|head|arm|plate|knob|panel|bulb|cord|frame)$/
const SLOT_RE = /^([a-z]+)__([a-z0-9_]+)$/
const WIN_RE = /^(win_[a-z0-9]+_[nsew])(_|$)/

// Room words — slot names are English, device names and rooms usually Polish
const ROOMS = {
  kitchen: ['kuchni', 'kuchen', 'kitchen', 'island', 'wyspa'],
  dining: ['jadal', 'dining', 'stół', 'stol'],
  living: ['salon', 'living', 'dzienny', 'tv', 'telewiz'],
  hall: ['hall', 'przedpok', 'wejśc', 'wejsc', 'entry', 'drzwi'],
  corridor: ['korytarz', 'corridor'],
  bed: ['sypial', 'bedroom', 'bed', 'pokój', 'pokoj', 'blanka', 'dziec'],
  bath: ['łazien', 'lazien', 'bath', 'wc', 'toalet'],
  balcony: ['balkon', 'taras', 'balcony', 'terrace', 'pergola', 'żagiel', 'zagiel', 'ogród', 'ogrod', 'garden'],
}
const roomsOf = (text) => {
  const t = String(text || '').toLowerCase()
  return Object.entries(ROOMS).filter(([, words]) => words.some((w) => t.includes(w))).map(([r]) => r)
}

// Walk the placed model once: slots with their world box, marker meshes
// (to hide when filtered) and bulb materials (to light up).
export function extractSlots(root) {
  const slots = new Map()
  const touch = (id, cat, name) => {
    if (!slots.has(id)) slots.set(id, { id, cat, name, box: new THREE.Box3(), markers: [], bulbs: [] })
    return slots.get(id)
  }
  root.updateMatrixWorld(true)
  root.traverse((o) => {
    if (!o.isMesh) return
    const n = String(o.name || '').replace(/\./g, '_')
    let m = SLOT_RE.exec(n)
    if (m && SLOT_CAT[m[1]]) {
      const cat = SLOT_CAT[m[1]]
      let base = m[2]
      while (PART.test(base)) base = base.replace(PART, '')
      const id = `${cat === 'Lighting' ? 'lighting' : m[1]}:${base}`
      const s = touch(id, cat, base)
      s.box.expandByObject(o)
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      // bulbs light up with the device; category-coloured pins hide with the filter;
      // the physical body (an AC unit, a TV) always stays
      if (mats.some((x) => /^bulb/i.test(x?.name || ''))) s.bulbs.push(...mats.filter((x) => /^bulb/i.test(x?.name || '')))
      if (mats.some((x) => /^cat_/i.test(x?.name || ''))) s.markers.push(o)
      return
    }
    m = WIN_RE.exec(n)
    if (m) touch(`blinds:${m[1]}`, 'Blinds', m[1]).box.expandByObject(o)
  })
  for (const s of slots.values()) {
    const c = s.box.getCenter(new THREE.Vector3())
    s.anchor = new THREE.Vector3(c.x, s.box.max.y + 0.12, c.z)
    s.rooms = roomsOf(s.name.replace(/_/g, ' ').replace(/\bbed\d/g, 'bed').replace(/\bbath\d/g, 'bath'))
  }
  return [...slots.values()].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
}

// → { placed: [{ device, slot, manual }], unplaced: [device] }
export function assignDevices(devices, slots, bindings = {}, groupOf) {
  const byId = new Map(slots.map((s) => [s.id, s]))
  const taken = new Set()
  const placed = []
  const unplaced = []
  const rest = []
  for (const d of devices) {
    const b = bindings[d.key]
    if (b === null) continue // removed from the model on purpose
    const s = b && byId.get(b)
    if (s && !taken.has(s.id)) { taken.add(s.id); placed.push({ device: d, slot: s, manual: true }) }
    else rest.push(d)
  }
  for (const d of rest) {
    const cat = groupOf(d)
    // "Other" is a grab bag (gateways, demo flows, price feeds…) — it only goes
    // on the model where someone puts it by hand
    if (cat === 'Other') { unplaced.push(d); continue }
    const free = slots.filter((s) => s.cat === cat && !taken.has(s.id))
    if (!free.length) { unplaced.push(d); continue }
    const want = roomsOf(`${d.room || ''} ${d.label || ''}`)
    const best = free.find((s) => s.rooms.some((r) => want.includes(r))) || free[0]
    taken.add(best.id)
    placed.push({ device: d, slot: best, manual: false })
  }
  return { placed, unplaced }
}

const val = (d, k) => d.readings?.[k]?.value
export function isOn(d) {
  const sw = val(d, 'switch')
  return sw === 1 || sw === true || sw === 'on'
}
// Short state for a label: "62%", "21.5°", "Wł." …
export function stateText(d, gt) {
  const r = d.readings || {}
  if (r.temperature?.value != null && !r.switch) return `${Number(r.temperature.value).toFixed(1)}°`
  if (r.level?.value != null && (r.switch == null || isOn(d))) return `${Math.round(r.level.value)}%`
  if (r.position?.value != null) return `${Math.round(r.position.value)}%`
  if (r.switch?.value != null) return isOn(d) ? gt('on', 'On') : gt('off', 'Off')
  if (r.power?.value != null) return `${Math.round(r.power.value)} W`
  if (r.soc?.value != null) return `${Math.round(r.soc.value)}%`
  return ''
}
