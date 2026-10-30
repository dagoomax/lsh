// Live socket updates → the device list. The server sends batches of
// { "<deviceKey>/<sensorPath>": value }; mergeDeviceUpdate() folds one into
// the list without touching anything a batch didn't really change, so a batch
// of repeats hands back the same array and React skips the re-render.
//
// It walks the batch (a handful of keys) rather than every sensor of every
// device: each "/" in a key is a possible device-key / sensor-path split,
// looked up in a key → position index that is kept with the array.

const indexes = new WeakMap() // device array → Map(device key → position)

function indexFor(devices) {
  let index = indexes.get(devices)
  if (!index) {
    index = new Map()
    devices.forEach((d, n) => index.set(d.key, n))
    indexes.set(devices, index)
  }
  return index
}

export function mergeDeviceUpdate(devices, changes) {
  const index = indexFor(devices)
  let next = null           // copy of `devices`, made on the first real change
  const copied = new Set()  // positions whose device + readings are already copies
  for (const full of Object.keys(changes)) {
    for (let i = full.indexOf('/'); i > 0; i = full.indexOf('/', i + 1)) {
      const n = index.get(full.slice(0, i))
      if (n === undefined) continue
      const d = (next || devices)[n]
      const path = full.slice(i + 1)
      const old = d.readings?.[path]
      const sensor = old ? null : d.sensors?.find(s => s.path === path)
      if (!old && !sensor) continue
      const value = changes[full]
      if (old && Object.is(old.value, value)) continue
      if (!next) next = devices.slice()
      if (!copied.has(n)) { next[n] = { ...d, readings: { ...(d.readings || {}) } }; copied.add(n) }
      next[n].readings[path] = { ...(old || sensor), value }
    }
  }
  if (!next) return devices
  indexes.set(next, index) // same devices at the same positions
  return next
}
