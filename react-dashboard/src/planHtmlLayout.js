import { slotOf, slotRooms } from './planModelSlots'

// Turns the box list of /api/plan-model/boxes into what PlanHtmlModel draws
// with CSS 3D transforms. Pure — no DOM, no React.
//
//   flats   things lying on the floor (floor finishes, rugs, wall shadows):
//           plain 2D children of one plane, so they cost a single layer
//   solids  extruded boxes: a top and four side faces, shaded by a fixed sun
//   slots   device slots (same ids as the WebGL viewer) with a 3D anchor
//
// Everything is in pixels at PX_PER_M; the view zooms with a CSS scale.

export const PX_PER_M = 56

const SUN = { top: 1, s: 0.9, e: 0.8, w: 0.68, n: 0.6 }
const CUT_COLOR = '#4a4d52' // the sliced top of a wall, like an architectural section

const shade = (hex, k) => {
  const n = parseInt(hex.slice(1), 16)
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * k)))
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`
}
const px = (m) => Math.round(m * PX_PER_M * 10) / 10

// Floor patterns, drawn with gradients so nothing is fetched
const floorPattern = (b) => {
  if (b.m === 'oak') {
    const along = b.w >= b.d ? '0deg' : '90deg' // boards run the long way
    return `repeating-linear-gradient(${along}, rgba(60,35,10,.16) 0 1px, transparent 1px ${px(0.14)}px), ${b.c}`
  }
  if (b.m === 'tile' || b.m === 'stone') {
    const t = px(0.6)
    return `repeating-linear-gradient(0deg, rgba(40,60,70,.14) 0 1px, transparent 1px ${t}px), repeating-linear-gradient(90deg, rgba(40,60,70,.14) 0 1px, transparent 1px ${t}px), ${b.c}`
  }
  return b.c
}

// Which texture (a .phm-t-* class of plan-html-textures.css) a material gets.
// Wood is floorboards when it lies on the floor and plain grain as furniture.
const SMOOTH = new Set(['porcelain', 'frame', 'skirting', 'dark'])
const textureOf = (b, flat) => {
  if (b.m === 'oak' || b.m === 'walnut') return flat ? (b.w >= b.d ? 'planks' : 'planks-v') : 'grain'
  if (b.m === 'slab') return 'concrete'
  if (b.m === 'planting') return 'leaf'
  if (SMOOTH.has(b.m)) return 'gloss'
  return ['tile', 'stone', 'plaster', 'linen', 'fabric', 'rug', 'steel'].includes(b.m) ? b.m : null
}

// cut: metres above the ground where the model is sliced (null = whole model)
export function layoutModel(data, { cut = null } = {}) {
  const boxes = data?.boxes || []
  const slabTop = Math.max(0, ...boxes.filter((b) => b.m === 'slab').map((b) => b.z + b.h))
  const flats = []
  const solids = []
  const slotMap = new Map()

  for (const b of boxes) {
    const key = slotOf(b.n)
    if (key) {
      let s = slotMap.get(key.id)
      if (!s) { s = { ...key, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, top: -Infinity, light: false }; slotMap.set(key.id, s) }
      s.x0 = Math.min(s.x0, b.x - b.w / 2); s.x1 = Math.max(s.x1, b.x + b.w / 2)
      s.y0 = Math.min(s.y0, b.y - b.d / 2); s.y1 = Math.max(s.y1, b.y + b.d / 2)
      s.top = Math.max(s.top, b.z + b.h)
      if (b.m === 'bulb') s.light = true
    }
    // category markers and bulbs are the WebGL viewer's pins — here pins are HTML
    if (b.m.startsWith('cat_') || b.m === 'bulb') continue
    if (Math.max(b.w, b.d, b.h) < 0.1) continue          // handles, pulls, seams
    if (Math.max(b.w, b.d) < 0.07) continue              // legs, balusters, stems
    if (cut != null && b.z >= cut) continue
    const base = { left: px(b.x - b.w / 2), top: px(b.y - b.d / 2), w: Math.max(1, px(b.w)), d: Math.max(1, px(b.d)), r: b.r || 0, o: b.o }

    if (b.h < 0.05 && b.z < slabTop + 0.1 && b.m !== 'slab') {
      flats.push({ ...base, z: b.z, bg: floorPattern(b), c: b.c, tex: textureOf(b, true), kind: b.m === 'rug' ? 'rug' : 'floor', round: !!b.round })
      continue
    }
    const sliced = cut != null && b.z + b.h > cut
    const h = sliced ? cut - b.z : b.h
    const topColor = sliced && !b.o ? CUT_COLOR : shade(b.c, SUN.top)
    const tex = textureOf(b, false)
    // a sliced wall shows its section, not its finish
    const solid = { ...base, n: b.n, z: px(b.z), h: Math.max(1, px(h)), cap: topColor, tex, capTex: sliced && !b.o ? null : tex, round: !!b.round, glass: b.m === 'glass' }
    if (!b.round && solid.h >= 2) {
      solid.sides = { n: shade(b.c, SUN.n), s: shade(b.c, SUN.s), w: shade(b.c, SUN.w), e: shade(b.c, SUN.e) }
    } else if (b.round && solid.h > 10) {
      solid.under = shade(b.c, 0.72) // a second, darker disc gives a cylinder some body
    }
    solids.push(solid)
    // a wall standing on the floor throws a soft shadow onto it
    if (b.m === 'plaster' && b.z < slabTop + 0.1 && b.h > 1) flats.push({ ...base, z: 99, kind: 'shadow' })
  }
  flats.sort((a, b) => a.z - b.z)

  const slots = [...slotMap.values()].map((s) => ({
    id: s.id, cat: s.cat, name: s.name, light: s.light, rooms: slotRooms(s.name),
    x: px((s.x0 + s.x1) / 2), y: px((s.y0 + s.y1) / 2),
    // pins sit just above their fixture — or above the cut, when it is lower
    z: px(Math.min(s.top + 0.12, cut != null ? cut + 0.12 : Infinity)),
  })).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))

  return { width: px(data?.w || 0), depth: px(data?.d || 0), height: px(cut != null ? Math.min(cut, data?.h || 0) : data?.h || 0),
    floorZ: px(slabTop) + 1, flats, solids, slots }
}
