'use strict';

// LSH BLE deep dive — everything BlueZ knows about one device, its
// advertisements decoded where the format is known, and (opt-in) a read-only
// GATT walk. Used by POST /api/lsh-ble/inspect (Settings → Bluetooth scan →
// click a device). Part of the lsh-ble module (re-exported by
// lsh-ble-client.js), so it ships with dbus-next.

const { VICTRON_MANUFACTURER_ID, RECORDS, KINDS, parseAdvertisement, normalizeMac } = require('./lsh-ble');
const MODELS = require('./lsh-ble-models.json');

// ── Names ───────────────────────────────────────────────────────────────────
const COMPANIES = {
  0x0006: 'Microsoft', 0x000f: 'Broadcom', 0x004c: 'Apple', 0x0059: 'Nordic Semiconductor', 0x005c: 'Belkin (Linksys)',
  0x0075: 'Samsung', 0x0087: 'Garmin', 0x00e0: 'Google', 0x0131: 'Cypress', 0x0157: 'Anhui Huami', 0x0171: 'Amazon',
  0x01da: 'Logitech', 0x02e1: 'Victron Energy', 0x038f: 'Xiaomi', 0x0499: 'Ruuvi Innovations', 0x05a7: 'Sonos',
  0x05a8: 'Eve Systems', 0x0822: 'Shelly (Allterco)', 0x0969: 'Woan Technology (SwitchBot)', 0x0001: 'Nokia',
  0x0002: 'Intel', 0x000a: 'Qualcomm', 0x001d: 'Qualcomm', 0x0047: 'Bose', 0x009e: 'Bose', 0x0310: 'SGL Italia (Fitbit)',
}
const SERVICES = {
  '1800': 'Generic Access', '1801': 'Generic Attribute', '180a': 'Device Information', '180f': 'Battery',
  '180d': 'Heart Rate', '1809': 'Health Thermometer', '181a': 'Environmental Sensing', '1812': 'Human Interface Device',
  '1816': 'Cycling Speed and Cadence', '1818': 'Cycling Power', '181c': 'User Data', '181d': 'Weight Scale',
  '1802': 'Immediate Alert', '1803': 'Link Loss', '1804': 'Tx Power', '1805': 'Current Time',
  'fe9f': 'Google', 'feaa': 'Eddystone', 'fd6f': 'Exposure Notification', 'fe2c': 'Google Fast Pair',
  'fcd2': 'BTHome', 'fe95': 'Xiaomi MiBeacon', 'fdcd': 'Qingping', 'fd3d': 'SwitchBot', 'fe0f': 'Philips Hue',
  'fe07': 'Sonos', 'fd44': 'Apple (HomeKit)', 'fe78': 'HP', 'fef3': 'Google', 'feed': 'Tile', 'fd5a': 'Samsung SmartThings Find',
}
const CHARACTERISTICS = {
  '2a00': 'Device Name', '2a01': 'Appearance', '2a04': 'Peripheral Preferred Connection Parameters',
  '2a19': 'Battery Level', '2a23': 'System ID', '2a24': 'Model Number', '2a25': 'Serial Number',
  '2a26': 'Firmware Revision', '2a27': 'Hardware Revision', '2a28': 'Software Revision', '2a29': 'Manufacturer Name',
  '2a37': 'Heart Rate Measurement', '2a6e': 'Temperature', '2a6f': 'Humidity', '2a6d': 'Pressure', '2a05': 'Service Changed',
}
const STRING_CHARS = new Set(['2a00', '2a24', '2a25', '2a26', '2a27', '2a28', '2a29'])
const APPLE_TYPES = {
  0x02: 'iBeacon', 0x03: 'AirPrint', 0x05: 'AirDrop', 0x06: 'HomeKit', 0x07: 'Proximity pairing (AirPods)',
  0x08: 'Hey Siri', 0x09: 'AirPlay target', 0x0a: 'AirPlay source', 0x0b: 'Magic Switch', 0x0c: 'Handoff',
  0x0d: 'Tethering target', 0x0e: 'Tethering source', 0x0f: 'Nearby action', 0x10: 'Nearby info', 0x12: 'Find My',
}
const APPEARANCE = {
  0: 'Unknown', 64: 'Phone', 128: 'Computer', 192: 'Watch', 193: 'Sports watch', 448: 'Keyring', 512: 'Media player',
  768: 'Thermometer', 832: 'Heart rate sensor', 960: 'HID', 961: 'Keyboard', 962: 'Mouse', 1344: 'Sensor', 2112: 'Earbud', 2113: 'Headset',
}

const uuid16 = (u) => {
  const m = /^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/i.exec(String(u))
  return m ? m[1].toLowerCase() : null
}
const uuidLabel = (u, table) => {
  const s = uuid16(u)
  return s ? `0x${s}${table[s] ? ` ${table[s]}` : ''}` : String(u)
}
const companyName = (id) => COMPANIES[id] || null
const hex = (b) => Buffer.from(b).toString('hex')
const v = (x) => (x && typeof x === 'object' && 'value' in x ? x.value : x)

// ── Advertisement decoders ──────────────────────────────────────────────────
function decodeManufacturer(id, buf, victronKey) {
  const out = []
  if (id === 0x004c) {
    if (buf[0] === 0x02 && buf[1] === 0x15 && buf.length >= 23) {
      const u = hex(buf.subarray(2, 18))
      out.push({
        format: 'iBeacon',
        fields: {
          UUID: `${u.slice(0, 8)}-${u.slice(8, 12)}-${u.slice(12, 16)}-${u.slice(16, 20)}-${u.slice(20)}`,
          Major: buf.readUInt16BE(18), Minor: buf.readUInt16BE(20), 'Measured power': `${buf.readInt8(22)} dBm @ 1 m`,
        },
      })
    } else {
      // Apple Continuity: sequence of [type, length, payload]
      const msgs = []
      for (let i = 0; i + 1 < buf.length;) {
        const t = buf[i], len = buf[i + 1]
        msgs.push(`${APPLE_TYPES[t] || `type 0x${t.toString(16)}`} (${len} B)`)
        i += 2 + len
      }
      if (msgs.length) out.push({ format: 'Apple Continuity', fields: { Messages: msgs.join(', ') }, note: 'Payloads are randomised/encrypted by Apple — only the message types are meaningful.' })
    }
  }
  if (id === VICTRON_MANUFACTURER_ID && buf[0] === 0x10 && buf.length >= 8) {
    const pid = buf.readUInt16LE(2)
    const kind = RECORDS[buf[4]]?.[0]
    const f = {
      Model: MODELS[pid.toString(16).padStart(4, '0')] || `unknown (0x${pid.toString(16)})`,
      Type: KINDS[kind]?.label || `record 0x${buf[4].toString(16)}`,
      'Data counter': buf.readUInt16LE(5), 'Key starts with': buf[7].toString(16).padStart(2, '0'),
    }
    if (victronKey) {
      const r = parseAdvertisement(buf, victronKey)
      if (r.error) f.Decrypt = r.error
      else for (const [k, val] of Object.entries(r.values)) if (val != null) f[k.toLowerCase().replace(/_text$/, '').replace(/_/g, ' ')] = val
    } else f.Readings = 'add this device under Energy → LSH BLE with its encryption key to decrypt'
    out.push({ format: 'Victron Instant Readout', fields: f })
  }
  if (id === 0x0499 && buf[0] === 0x05 && buf.length >= 24) {
    const t = buf.readInt16BE(1), h = buf.readUInt16BE(3), p = buf.readUInt16BE(5), pw = buf.readUInt16BE(13)
    out.push({
      format: 'RuuviTag RAWv2',
      fields: {
        Temperature: t === -32768 ? null : `${(t * 0.005).toFixed(2)} °C`, Humidity: h === 65535 ? null : `${(h * 0.0025).toFixed(2)} %`,
        Pressure: p === 65535 ? null : `${((p + 50000) / 100).toFixed(2)} hPa`,
        Acceleration: `${buf.readInt16BE(7)} / ${buf.readInt16BE(9)} / ${buf.readInt16BE(11)} mG`,
        Battery: `${((pw >> 5) + 1600) / 1000} V`, 'TX power': `${(pw & 0x1f) * 2 - 40} dBm`,
        'Movement counter': buf[15], Sequence: buf.readUInt16BE(16),
      },
    })
  }
  return out
}

function decodeServiceData(u, buf) {
  const s = uuid16(u)
  if (s === 'feaa' && buf.length >= 2) {
    const frame = buf[0]
    if (frame === 0x00 && buf.length >= 18) return [{ format: 'Eddystone-UID', fields: { Namespace: hex(buf.subarray(2, 12)), Instance: hex(buf.subarray(12, 18)), 'TX power @0 m': `${buf.readInt8(1)} dBm` } }]
    if (frame === 0x10) {
      const schemes = ['http://www.', 'https://www.', 'http://', 'https://']
      const exp = ['.com/', '.org/', '.edu/', '.net/', '.info/', '.biz/', '.gov/', '.com', '.org', '.edu', '.net', '.info', '.biz', '.gov']
      let url = schemes[buf[2]] || ''
      for (const c of buf.subarray(3)) url += c < exp.length ? exp[c] : String.fromCharCode(c)
      return [{ format: 'Eddystone-URL', fields: { URL: url } }]
    }
    if (frame === 0x20 && buf.length >= 14) {
      return [{ format: 'Eddystone-TLM', fields: { Battery: `${buf.readUInt16BE(2)} mV`, Temperature: `${(buf.readInt16BE(4) / 256).toFixed(1)} °C`, 'Adv count': buf.readUInt32BE(6), Uptime: `${Math.round(buf.readUInt32BE(10) / 10)} s` } }]
    }
  }
  if (s === 'fcd2' && buf.length >= 1) {
    return [{ format: 'BTHome', fields: { Version: (buf[0] >> 5) & 0x7, Encrypted: !!(buf[0] & 1) }, note: 'BTHome v2 objects not decoded here.' }]
  }
  return []
}

// ── Inspect ─────────────────────────────────────────────────────────────────
// opts: { adapter, mac, seconds, gatt, victronKey }
async function inspect({ adapter = 'hci0', mac, seconds = 8, gatt = false, victronKey = null }) {
  if (process.platform !== 'linux') throw new Error('Needs Linux + BlueZ (e.g. the Arduino UNO Q)')
  mac = normalizeMac(mac)
  if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac)) throw new Error('Invalid MAC address')
  const dbus = require('dbus-next')
  const { Variant } = dbus
  const bus = dbus.systemBus()
  const adapterPath = `/org/bluez/${adapter}`
  const devPath = `${adapterPath}/dev_${mac.replace(/:/g, '_')}`
  const watch = Math.min(Math.max(Number(seconds) || 8, 3), 30)
  try {
    const ad = (await bus.getProxyObject('org.bluez', adapterPath)).getInterface('org.bluez.Adapter1')
    await ad.SetDiscoveryFilter({ Transport: new Variant('s', 'le'), DuplicateData: new Variant('b', true) })
    try { await ad.StartDiscovery() } catch (err) { if (!/InProgress/i.test(err.type || err.message || '')) throw err }

    // Watch the device's advertisements for a few seconds.
    const samples = []
    const payloads = new Map() // `m:<id>` / `s:<uuid>` → Set of hex
    let devIf, propsIf
    const t0 = Date.now()
    const record = (changed) => {
      if (changed.RSSI) samples.push({ t: Date.now() - t0, rssi: v(changed.RSSI) })
      for (const [id, val] of Object.entries(v(changed.ManufacturerData) || {})) {
        const k = `m:${id}`; if (!payloads.has(k)) payloads.set(k, new Set()); payloads.get(k).add(hex(v(val)))
      }
      for (const [u, val] of Object.entries(v(changed.ServiceData) || {})) {
        const k = `s:${u}`; if (!payloads.has(k)) payloads.set(k, new Set()); payloads.get(k).add(hex(v(val)))
      }
    }
    try {
      const obj = await bus.getProxyObject('org.bluez', devPath)
      devIf = obj.getInterface('org.bluez.Device1')
      propsIf = obj.getInterface('org.freedesktop.DBus.Properties')
      propsIf.on('PropertiesChanged', (iface, changed) => { if (iface === 'org.bluez.Device1') record(changed) })
    } catch {
      // Not known to BlueZ yet — wait for it to show up during discovery.
    }
    await new Promise((r) => setTimeout(r, watch * 1000))
    if (!propsIf) {
      try {
        const obj = await bus.getProxyObject('org.bluez', devPath)
        devIf = obj.getInterface('org.bluez.Device1')
        propsIf = obj.getInterface('org.freedesktop.DBus.Properties')
      } catch {
        throw new Error(`${mac} wasn't seen during ${watch} s — out of range or not advertising`)
      }
    }
    const all = await propsIf.GetAll('org.bluez.Device1')
    record(all)
    await ad.StopDiscovery().catch(() => {})

    const P = (k) => v(all[k])
    const mfr = Object.entries(P('ManufacturerData') || {}).map(([id, val]) => {
      const n = Number(id)
      const buf = Buffer.from(v(val))
      return {
        id: `0x${n.toString(16).padStart(4, '0')}`, company: companyName(n), hex: hex(buf), length: buf.length,
        variants: [...(payloads.get(`m:${id}`) || [])].length,
        decoded: decodeManufacturer(n, buf, victronKey),
      }
    })
    const svcData = Object.entries(P('ServiceData') || {}).map(([u, val]) => {
      const buf = Buffer.from(v(val))
      return { uuid: uuidLabel(u, SERVICES), hex: hex(buf), length: buf.length, variants: [...(payloads.get(`s:${u}`) || [])].length, decoded: decodeServiceData(u, buf) }
    })
    const rssis = samples.map((s) => s.rssi)
    const result = {
      mac,
      name: P('Name') || null,
      alias: P('Alias') || null,
      addressType: P('AddressType') || null,
      randomAddress: P('AddressType') === 'random' ? addressKind(mac) : null,
      appearance: P('Appearance') != null ? `${APPEARANCE[P('Appearance')] || 'other'} (${P('Appearance')})` : null,
      icon: P('Icon') || null,
      paired: !!P('Paired'), trusted: !!P('Trusted'), connected: !!P('Connected'), blocked: !!P('Blocked'),
      txPower: P('TxPower') ?? null,
      services: (P('UUIDs') || []).map((u) => uuidLabel(u, SERVICES)),
      manufacturerData: mfr,
      serviceData: svcData,
      rssi: {
        current: P('RSSI') ?? null,
        min: rssis.length ? Math.min(...rssis) : null, max: rssis.length ? Math.max(...rssis) : null,
        avg: rssis.length ? Math.round(rssis.reduce((a, b) => a + b, 0) / rssis.length) : null,
        samples: samples.slice(-120),
        advertsPerSecond: Math.round((samples.length / watch) * 10) / 10,
        estimatedDistance: P('TxPower') != null && P('RSSI') != null ? `${(10 ** ((P('TxPower') - 41 - P('RSSI')) / 20)).toFixed(1)} m (rough)` : null,
      },
      watchedSeconds: watch,
      gatt: null,
    }
    if (gatt) result.gatt = await readGatt(bus, devIf, devPath, P('Connected'))
    return result
  } finally {
    bus.disconnect()
  }
}

// Random address subtypes, from the two most significant bits.
function addressKind(mac) {
  const top = parseInt(mac.slice(0, 2), 16) >> 6
  return top === 3 ? 'static random' : top === 1 ? 'resolvable private (rotates — e.g. phones)' : top === 0 ? 'non-resolvable private' : 'reserved'
}

// Read-only GATT walk: connect (no pairing), list services/characteristics,
// read standard info + up to 25 readable values, disconnect again (unless it
// was already connected before we started).
async function readGatt(bus, devIf, devPath, wasConnected) {
  const out = { connected: false, services: [], error: null }
  try {
    if (!wasConnected) {
      await Promise.race([devIf.Connect(), new Promise((_, rej) => setTimeout(() => rej(new Error('connect timed out (20 s) — device may not accept connections')), 20000))])
    }
    out.connected = true
    const props = (await bus.getProxyObject('org.bluez', devPath)).getInterface('org.freedesktop.DBus.Properties')
    for (let i = 0; i < 40 && !v(await props.Get('org.bluez.Device1', 'ServicesResolved')); i++) await new Promise((r) => setTimeout(r, 250))
    const om = (await bus.getProxyObject('org.bluez', '/')).getInterface('org.freedesktop.DBus.ObjectManager')
    const objects = await om.GetManagedObjects()
    const services = new Map()
    for (const [path, ifaces] of Object.entries(objects)) {
      if (path.startsWith(devPath + '/') && ifaces['org.bluez.GattService1']) {
        services.set(path, { uuid: uuidLabel(v(ifaces['org.bluez.GattService1'].UUID), SERVICES), primary: !!v(ifaces['org.bluez.GattService1'].Primary), characteristics: [] })
      }
    }
    let reads = 0
    for (const [path, ifaces] of Object.entries(objects).sort(([a], [b]) => a.localeCompare(b))) {
      const c = ifaces['org.bluez.GattCharacteristic1']
      if (!c || !path.startsWith(devPath + '/')) continue
      const svc = services.get(v(c.Service))
      if (!svc) continue
      const u = v(c.UUID)
      const short = uuid16(u)
      const flags = v(c.Flags) || []
      const ch = { uuid: uuidLabel(u, CHARACTERISTICS), flags, value: null }
      if (flags.includes('read') && reads < 25) {
        reads++
        try {
          const ci = (await bus.getProxyObject('org.bluez', path)).getInterface('org.bluez.GattCharacteristic1')
          const raw = Buffer.from(await Promise.race([ci.ReadValue({}), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]))
          ch.value = { hex: hex(raw) }
          if (STRING_CHARS.has(short) || /^[\x20-\x7e]{3,}$/.test(raw.toString('latin1'))) ch.value.text = raw.toString('utf8').replace(/\0+$/, '')
          if (short === '2a19') ch.value.text = `${raw[0]} %`
        } catch (err) {
          ch.value = { error: /NotPermitted|NotAuthorized|Authentication/i.test(err.type || err.message || '') ? 'needs pairing' : err.message }
        }
      }
      svc.characteristics.push(ch)
    }
    out.services = [...services.values()]
  } catch (err) {
    out.error = err.message
  } finally {
    if (!wasConnected) await devIf.Disconnect().catch(() => {})
  }
  return out
}

module.exports = { inspect, decodeManufacturer, decodeServiceData, addressKind }
