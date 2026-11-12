import * as THREE from 'three'
import { slotOf, slotRooms } from './planModelSlots'

// Real LSH devices on the imported 3D model (PlanModelViewer): the three.js
// side. Slot naming, device assignment and state helpers live in
// planModelSlots.js, which the HTML view shares.
export * from './planModelSlots'

// Walk the placed model once: slots with their world box, marker meshes
// (to hide when filtered) and bulb materials (to light up).
export function extractSlots(root) {
  const slots = new Map()
  const touch = ({ id, cat, name }) => {
    if (!slots.has(id)) slots.set(id, { id, cat, name, box: new THREE.Box3(), markers: [], bulbs: [] })
    return slots.get(id)
  }
  root.updateMatrixWorld(true)
  root.traverse((o) => {
    if (!o.isMesh) return
    const key = slotOf(o.name)
    if (!key) return
    const s = touch(key)
    s.box.expandByObject(o)
    if (key.window) return
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    // bulbs light up with the device; category-coloured pins hide with the filter;
    // the physical body (an AC unit, a TV) always stays
    if (mats.some((x) => /^bulb/i.test(x?.name || ''))) s.bulbs.push(...mats.filter((x) => /^bulb/i.test(x?.name || '')))
    if (mats.some((x) => /^cat_/i.test(x?.name || ''))) s.markers.push(o)
  })
  for (const s of slots.values()) {
    const c = s.box.getCenter(new THREE.Vector3())
    s.anchor = new THREE.Vector3(c.x, s.box.max.y + 0.12, c.z)
    s.rooms = slotRooms(s.name)
  }
  return [...slots.values()].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
}
