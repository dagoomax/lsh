'use strict';

// LSH LAN scanner — what's on the local network: live hosts (TCP probes, no
// root needed), MAC + vendor (ARP table + IEEE OUI via oui-data), names
// (reverse DNS, mDNS/Bonjour via multicast-dns, SSDP/UPnP), open ports, HTTP
// fingerprints, and which LSH integration a device looks like. Plus a deep
// dive per host (extended ports, banners, HTTP headers, TLS certificates,
// mDNS records, UPnP description, latency).
//
// Tool module (src/tool-modules.js): never started at boot, installed from
// Settings → System → LAN scan the first time it's used.

const os = require('os');
const net = require('net');
const tls = require('tls');
const http = require('http');
const dgram = require('dgram');
const dns = require('dns').promises;
const fs = require('fs');
const { execFile } = require('child_process');

// ── Ports ───────────────────────────────────────────────────────────────────
const QUICK_PORTS = [22, 53, 80, 443, 445, 554, 1400, 1883, 1880, 3000, 5000, 5353, 6053, 7000, 8008, 8009, 8080, 8081, 8123, 8443, 8883, 9000, 9100, 49152, 62078]
const PORT_NAMES = {
  20: 'FTP data', 21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS', 67: 'DHCP', 80: 'HTTP', 81: 'HTTP alt', 88: 'Kerberos',
  110: 'POP3', 111: 'RPC', 123: 'NTP', 135: 'MS RPC', 139: 'NetBIOS', 143: 'IMAP', 161: 'SNMP', 389: 'LDAP', 443: 'HTTPS', 445: 'SMB',
  465: 'SMTPS', 502: 'Modbus TCP', 515: 'LPD printer', 548: 'AFP', 554: 'RTSP', 587: 'SMTP submission', 631: 'IPP printer', 636: 'LDAPS',
  873: 'rsync', 993: 'IMAPS', 995: 'POP3S', 1080: 'SOCKS', 1194: 'OpenVPN', 1400: 'Sonos', 1433: 'MS SQL', 1521: 'Oracle', 1723: 'PPTP',
  1880: 'Node-RED', 1883: 'MQTT', 1900: 'UPnP', 1925: 'Philips TV', 2049: 'NFS', 2323: 'Telnet alt', 3000: 'HTTP (LSH/Grafana/dev)',
  3001: 'HTTP (LSH dev)', 3306: 'MySQL', 3389: 'RDP', 3671: 'KNX IP', 4070: 'Spotify Connect', 4840: 'OPC UA', 4859: 'Homey SHS',
  5000: 'HTTP alt / UPnP', 5001: 'HTTPS alt (Synology)', 5060: 'SIP', 5353: 'mDNS', 5432: 'PostgreSQL', 5540: 'Matter', 5555: 'ADB',
  5683: 'CoAP', 5900: 'VNC', 6053: 'ESPHome API', 6379: 'Redis', 6466: 'Android TV remote', 6467: 'Android TV pairing', 6668: 'Tuya',
  7000: 'AirPlay', 7080: 'HTTP alt', 7681: 'ttyd', 8000: 'HTTP alt', 8001: 'HTTP alt', 8008: 'Chromecast', 8009: 'Chromecast',
  8060: 'Roku', 8080: 'HTTP alt', 8081: 'HTTP alt', 8083: 'Z-Way', 8086: 'InfluxDB', 8088: 'HTTP alt', 8089: 'HTTP alt',
  8091: 'Z-Wave JS UI', 8123: 'Home Assistant', 8200: 'MiniDLNA', 8291: 'MikroTik Winbox', 8443: 'HTTPS alt', 8554: 'RTSP alt',
  8883: 'MQTT TLS', 8888: 'HTTP alt', 9000: 'HTTP alt / OCPP', 9001: 'MQTT WebSocket', 9090: 'Prometheus/Cockpit', 9100: 'Printer (RAW)',
  9123: 'Elgato', 9200: 'Elasticsearch', 9443: 'Portainer', 10001: 'Domatiq/UniFi', 32400: 'Plex', 47128: 'HomeKit (LSH)',
  49152: 'UPnP', 51827: 'HomeKit', 55443: 'Yeelight', 62078: 'Apple lockdown',
}
const DEEP_PORTS = Object.keys(PORT_NAMES).map(Number)

// ── Small helpers ───────────────────────────────────────────────────────────
const ipToInt = (ip) => ip.split('.').reduce((a, b) => ((a << 8) >>> 0) + Number(b), 0) >>> 0
const intToIp = (n) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.')
const withTimeout = (p, ms, fallback = null) => Promise.race([p, new Promise((r) => setTimeout(() => r(fallback), ms))])

async function pool(items, limit, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k) }
  }))
  return out
}

let OUI = null
function vendorOf(mac) {
  if (!mac) return null
  const first = parseInt(mac.slice(0, 2), 16)
  if (first & 0x02) return 'Private / randomised MAC'
  if (!OUI) { try { OUI = require('oui-data') } catch { OUI = {} } }
  const v = OUI[mac.replace(/[:-]/g, '').slice(0, 6).toUpperCase()]
  return v ? v.split('\n')[0].trim() : null
}

// ── Networks ────────────────────────────────────────────────────────────────
// IPv4 LANs of this host. Skips loopback, Docker/VM bridges and Tailscale
// (100.64.0.0/10). Large networks are narrowed to the host's /24.
function localNetworks() {
  const out = []
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (/^(lo|docker|br-|veth|virbr|tailscale|utun|tun|zt|vmnet|vboxnet)/i.test(name)) continue
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue
      if (a.internal || a.address.startsWith('169.254.') || a.address.startsWith('100.')) continue
      let prefix = Number(a.cidr?.split('/')[1]) || 24
      if (prefix < 24) prefix = 24
      const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0
      const network = (ipToInt(a.address) & mask) >>> 0
      out.push({ iface: name, address: a.address, mac: a.mac, cidr: `${intToIp(network)}/${prefix}`, network, prefix })
    }
  }
  return out
}

function hostsOf(net) {
  const size = 2 ** (32 - net.prefix)
  const hosts = []
  for (let i = 1; i < size - 1; i++) hosts.push(intToIp(net.network + i))
  return hosts
}

// ── TCP probes ──────────────────────────────────────────────────────────────
// Resolves { state: 'open'|'refused'|'timeout', ms }. A refused connection
// also proves the host is up.
function tcpProbe(ip, port, timeout = 600) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const s = net.connect({ host: ip, port })
    const done = (state) => { s.destroy(); resolve({ state, ms: Date.now() - t0 }) }
    s.setTimeout(timeout, () => done('timeout'))
    s.once('connect', () => done('open'))
    s.once('error', (err) => done(err.code === 'ECONNREFUSED' ? 'refused' : 'timeout'))
  })
}

// ── ARP table ───────────────────────────────────────────────────────────────
function arpTable() {
  return new Promise((resolve) => {
    const map = new Map()
    if (process.platform === 'linux') {
      try {
        for (const line of fs.readFileSync('/proc/net/arp', 'utf8').split('\n').slice(1)) {
          const p = line.trim().split(/\s+/)
          // flags 0x0 = incomplete (no reply)
          if (p.length >= 4 && p[2] !== '0x0' && p[3] !== '00:00:00:00:00:00') map.set(p[0], p[3].toUpperCase())
        }
      } catch {}
      return resolve(map)
    }
    execFile(fs.existsSync('/usr/sbin/arp') ? '/usr/sbin/arp' : 'arp', ['-an'], { timeout: 5000 }, (err, stdout) => {
      for (const m of String(stdout || '').matchAll(/\(([\d.]+)\) at ([0-9a-f:]+)/gi)) {
        const mac = m[2].split(':').map((x) => x.padStart(2, '0')).join(':').toUpperCase()
        if (mac !== 'FF:FF:FF:FF:FF:FF') map.set(m[1], mac)
      }
      resolve(map)
    })
  })
}

async function arpSweep(targets) {
  const sock = dgram.createSocket('udp4')
  sock.on('error', () => {})
  const payload = Buffer.from([0])
  for (const ip of targets) {
    try { sock.send(payload, 9, ip) } catch {}
    await new Promise((r) => setImmediate(r))
  }
  await new Promise((r) => setTimeout(r, 1500))
  try { sock.close() } catch {}
}

// ── mDNS / Bonjour ──────────────────────────────────────────────────────────
// Enumerates every advertised service type, then its instances. Returns
// Map ip → { hostname, services: [{ type, name, port, txt }] }.
async function mdnsDiscover(seconds = 4) {
  let mdns
  try { mdns = require('multicast-dns')() } catch { return new Map() }
  const byIp = new Map()
  const srvTarget = new Map() // instance → { target, port, type }
  const hostIp = new Map()    // hostname → ip
  const txts = new Map()
  const types = new Set()
  const entry = (ip) => { if (!byIp.has(ip)) byIp.set(ip, { hostname: null, services: [] }); return byIp.get(ip) }
  mdns.on('response', (res) => {
    for (const a of [...res.answers, ...res.additionals]) {
      if (a.type === 'PTR' && a.name === '_services._dns-sd._udp.local' && !types.has(a.data)) {
        types.add(a.data)
        mdns.query({ questions: [{ name: a.data, type: 'PTR' }] })
      } else if (a.type === 'SRV') srvTarget.set(a.name, { target: a.data.target, port: a.data.port })
      else if (a.type === 'A') hostIp.set(a.name, a.data)
      else if (a.type === 'TXT') {
        const kv = {}
        for (const b of [].concat(a.data || [])) { const s = Buffer.from(b).toString(); const i = s.indexOf('='); if (i > 0) kv[s.slice(0, i)] = s.slice(i + 1) }
        txts.set(a.name, kv)
      }
    }
  })
  mdns.query({ questions: [{ name: '_services._dns-sd._udp.local', type: 'PTR' }] })
  setTimeout(() => mdns.query({ questions: [{ name: '_services._dns-sd._udp.local', type: 'PTR' }] }), 1000)
  await new Promise((r) => setTimeout(r, seconds * 1000))
  mdns.destroy()
  for (const [instance, { target, port }] of srvTarget) {
    const ip = hostIp.get(target)
    if (!ip) continue
    const e = entry(ip)
    e.hostname = e.hostname || target.replace(/\.local\.?$/, '')
    const type = instance.split('.').slice(1, 3).join('.')
    e.services.push({ type, name: instance.split('._')[0].replace(/\\032/g, ' '), port, txt: txts.get(instance) || {} })
  }
  for (const [host, ip] of hostIp) { const e = entry(ip); e.hostname = e.hostname || host.replace(/\.local\.?$/, '') }
  return byIp
}

// ── SSDP / UPnP ─────────────────────────────────────────────────────────────
async function ssdpDiscover(seconds = 3) {
  const byIp = new Map()
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  sock.on('message', (msg, rinfo) => {
    const h = {}
    for (const line of msg.toString().split('\r\n')) { const i = line.indexOf(':'); if (i > 0) h[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim() }
    if (!byIp.has(rinfo.address)) byIp.set(rinfo.address, { server: h.server || null, locations: new Set(), types: new Set() })
    const e = byIp.get(rinfo.address)
    if (h.location) e.locations.add(h.location)
    if (h.st) e.types.add(h.st)
  })
  await new Promise((resolve) => sock.bind(0, resolve)).catch(() => {})
  const msg = Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n')
  try { sock.send(msg, 1900, '239.255.255.250'); setTimeout(() => sock.send(msg, 1900, '239.255.255.250'), 600) } catch {}
  await new Promise((r) => setTimeout(r, seconds * 1000))
  try { sock.close() } catch {}
  // Device description XML (first location per host)
  await pool([...byIp.entries()], 8, async ([ip, e]) => {
    const loc = [...e.locations][0]
    if (!loc) return
    const xml = await httpGet(loc, 2500).then((r) => r?.body || '').catch(() => '')
    const tag = (t) => (xml.match(new RegExp(`<${t}>([^<]*)</${t}>`)) || [])[1] || null
    e.description = { friendlyName: tag('friendlyName'), manufacturer: tag('manufacturer'), modelName: tag('modelName'), modelNumber: tag('modelNumber'), deviceType: tag('deviceType'), location: loc }
  })
  for (const e of byIp.values()) { e.locations = [...e.locations]; e.types = [...e.types] }
  return byIp
}

// ── HTTP ────────────────────────────────────────────────────────────────────
function httpGet(url, timeout = 2500, { https: useHttps = false, headersOnly = false } = {}) {
  return new Promise((resolve) => {
    const mod = useHttps || url.startsWith('https:') ? require('https') : http
    const req = mod.get(url, { timeout, rejectUnauthorized: false, headers: { 'User-Agent': 'LSH-LAN-scan' } }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { if (!headersOnly && body.length < 65536) body += c })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
      res.on('error', () => resolve(null))
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(null))
  })
}

const titleOf = (body) => ((body || '').match(/<title[^>]*>([^<]{0,120})/i) || [])[1]?.trim() || null

// Fingerprint what's on a host's web port(s) + a few product-specific probes.
async function httpFingerprint(ip, ports) {
  const fp = {}
  const webPort = [80, 8080, 8081, 8123, 1880, 3000, 5000].find((p) => ports.includes(p))
  if (webPort) {
    const r = await httpGet(`http://${ip}:${webPort}/`, 2500)
    if (r) { fp.web = { port: webPort, status: r.status, server: r.headers.server || null, title: titleOf(r.body), poweredBy: r.headers['x-powered-by'] || null } }
  }
  if (ports.includes(80)) {
    const shelly = await httpGet(`http://${ip}/shelly`, 1500)
    if (shelly?.status === 200 && /"(type|model|gen)"/.test(shelly.body)) {
      try { const j = JSON.parse(shelly.body); fp.shelly = { model: j.model || j.type, gen: j.gen || 1, mac: j.mac, fw: j.fw || j.fw_id, name: j.name || null } } catch {}
    }
    const hue = await httpGet(`http://${ip}/api/0/config`, 1500)
    if (hue?.status === 200 && /bridgeid/i.test(hue.body)) {
      try { const j = JSON.parse(hue.body); fp.hue = { name: j.name, model: j.modelid, bridgeId: j.bridgeid, sw: j.swversion } } catch {}
    }
  }
  if (ports.includes(1400)) {
    const s = await httpGet(`http://${ip}:1400/xml/device_description.xml`, 1500)
    if (s?.status === 200) fp.sonos = { room: (s.body.match(/<roomName>([^<]*)/) || [])[1] || null, model: (s.body.match(/<modelName>([^<]*)/) || [])[1] || null }
  }
  return fp
}

// ── Identification ──────────────────────────────────────────────────────────
// → { kind, label, integration } — integration = the LSH config key that
// would connect it, when there is one.
function identify(h) {
  const svc = (t) => h.mdns?.services?.some((s) => s.type.startsWith(t))
  const server = `${h.http?.web?.server || ''} ${h.ssdp?.server || ''}`.toLowerCase()
  const title = (h.http?.web?.title || '').toLowerCase()
  const vendor = (h.vendor || '').toLowerCase()
  const has = (p) => h.ports.includes(p)
  if (h.http?.shelly) return { kind: 'shelly', label: `Shelly ${h.http.shelly.model || ''}`.trim(), integration: 'shelly' }
  if (h.http?.hue) return { kind: 'hue', label: 'Philips Hue Bridge', integration: 'hue' }
  if (h.http?.sonos || svc('_sonos')) return { kind: 'sonos', label: `Sonos ${h.http?.sonos?.model || ''}`.trim(), integration: 'sonos' }
  if (svc('_esphomelib') || has(6053)) return { kind: 'esphome', label: 'ESPHome device', integration: 'esphome' }
  if (/loxone/.test(server) || /loxone/.test(title)) return { kind: 'loxone', label: 'Loxone Miniserver', integration: 'loxone' }
  if (/fibaro/.test(title) || /fibaro/.test(server)) return { kind: 'fibaro', label: 'Fibaro Home Center', integration: 'fibaro' }
  if (svc('_wled')) return { kind: 'wled', label: 'WLED', integration: 'wled' }
  if (svc('_hue')) return { kind: 'hue', label: 'Philips Hue Bridge', integration: 'hue' }
  if (svc('_googlecast') || has(8009)) return { kind: 'cast', label: 'Google Cast device', integration: 'googlehome' }
  if (svc('_androidtvremote2') || has(6466)) return { kind: 'androidtv', label: 'Android / Google TV', integration: 'googletv' }
  if (svc('_airplay') || svc('_raop')) return { kind: 'airplay', label: 'AirPlay device', integration: 'airplay' }
  if (svc('_hap')) return { kind: 'homekit', label: 'HomeKit accessory', integration: null }
  if (svc('_matter') || has(5540)) return { kind: 'matter', label: 'Matter device', integration: 'matter' }
  if (has(8123) || /home assistant/.test(title)) return { kind: 'homeassistant', label: 'Home Assistant', integration: null }
  if (has(1880) && /node-red/.test(title)) return { kind: 'nodered', label: 'Node-RED', integration: null }
  if (has(1883)) return { kind: 'mqtt', label: 'MQTT broker', integration: 'mqtt' }
  if (has(3671)) return { kind: 'knx', label: 'KNX IP gateway', integration: 'knx' }
  if (has(502)) return { kind: 'modbus', label: 'Modbus TCP device', integration: 'modbus' }
  if (has(554) || svc('_rtsp')) return { kind: 'camera', label: 'Camera (RTSP)', integration: 'cameras' }
  if (svc('_ipp') || svc('_printer') || has(631) || has(9100)) return { kind: 'printer', label: 'Printer', integration: null }
  if (/victron|venus/.test(title) || /victron/.test(vendor)) return { kind: 'victron', label: 'Victron GX device', integration: 'mqtt' }
  if (/apple/.test(vendor) || has(62078)) return { kind: 'apple', label: 'Apple device', integration: null }
  if (/router|gateway|openwrt|mikrotik|ubiquiti|unifi|fritz|tp-link|linksys|netgear/.test(`${title} ${vendor} ${server}`)) return { kind: 'network', label: 'Network equipment', integration: /unifi|ubiquiti/.test(`${title} ${vendor}`) ? 'unifi' : null }
  if (h.http?.web) return { kind: 'web', label: h.http.web.title || 'Web server', integration: null }
  return { kind: 'unknown', label: null, integration: null }
}

// ── Scan ────────────────────────────────────────────────────────────────────
async function scan({ timeout = 600 } = {}) {
  const nets = localNetworks()
  if (!nets.length) throw new Error('No LAN interface found on this host')
  const selfIps = new Set(nets.map((n) => n.address))
  const targets = [...new Set(nets.flatMap(hostsOf))]
  const t0 = Date.now()

  // Discovery protocols run alongside the TCP sweep.
  const mdnsP = mdnsDiscover(5)
  const ssdpP = ssdpDiscover(4)

  // ARP sweep: a UDP datagram to every address makes the OS resolve its MAC
  // (most devices answer ARP even with every port closed); the ARP table is
  // read after the TCP sweep below.
  await arpSweep(targets)

  // TCP sweep: a few common ports to find live hosts (and their latency),
  // then the quick-port list on everything alive.
  const alive = new Map()
  await pool(targets, 96, async (ip) => {
    for (const port of [80, 443, 22, 62078, 7000, 8080]) {
      const r = await tcpProbe(ip, port, timeout)
      if (r.state !== 'timeout') { alive.set(ip, { latency: r.ms }); break }
    }
  })
  const [mdns, ssdp] = await Promise.all([mdnsP, ssdpP])
  for (const ip of [...mdns.keys(), ...ssdp.keys()]) if (targets.includes(ip) && !alive.has(ip)) alive.set(ip, { latency: null })
  const arp = await arpTable()
  for (const ip of arp.keys()) if (targets.includes(ip) && !alive.has(ip)) alive.set(ip, { latency: null })
  for (const ip of selfIps) alive.set(ip, { latency: 0 })

  const hosts = await pool([...alive.keys()], 24, async (ip) => {
    const results = await Promise.all(QUICK_PORTS.map((p) => tcpProbe(ip, p, timeout).then((r) => [p, r])))
    const ports = results.filter(([, r]) => r.state === 'open').map(([p]) => p)
    const rdns = await withTimeout(dns.reverse(ip).then((n) => n[0]).catch(() => null), 1500)
    const mac = arp.get(ip) || (selfIps.has(ip) ? nets.find((n) => n.address === ip)?.mac?.toUpperCase() : null) || null
    const h = {
      ip, self: selfIps.has(ip), mac, vendor: vendorOf(mac), hostname: rdns,
      latency: alive.get(ip).latency, ports,
      mdns: mdns.get(ip) || null, ssdp: ssdp.get(ip) || null,
    }
    h.http = await httpFingerprint(ip, ports)
    h.id = identify(h)
    h.name = h.http?.shelly?.name || h.http?.hue?.name || h.http?.sonos?.room || h.ssdp?.description?.friendlyName
      || h.mdns?.services?.[0]?.name || h.mdns?.hostname || h.hostname || h.id.label || null
    return h
  })
  hosts.sort((a, b) => ipToInt(a.ip) - ipToInt(b.ip))
  return { networks: nets.map(({ iface, address, cidr }) => ({ iface, address, cidr })), scannedHosts: targets.length, durationMs: Date.now() - t0, hosts }
}

// ── Deep dive ───────────────────────────────────────────────────────────────
function banner(ip, port, timeout = 1500) {
  return new Promise((resolve) => {
    const s = net.connect({ host: ip, port })
    let data = ''
    const done = () => { s.destroy(); resolve(data.replace(/[^\x20-\x7e\r\n]/g, '.').trim().slice(0, 200) || null) }
    s.setTimeout(timeout, done)
    s.on('data', (c) => { data += c.toString('latin1'); if (data.length > 200 || data.includes('\n')) done() })
    s.on('error', done)
    s.on('end', done)
  })
}

function tlsInfo(ip, port, timeout = 2500) {
  return new Promise((resolve) => {
    const s = tls.connect({ host: ip, port, servername: undefined, rejectUnauthorized: false, timeout }, () => {
      const c = s.getPeerCertificate()
      resolve(c && c.subject ? {
        subject: c.subject.CN || Object.values(c.subject).join(', '), issuer: c.issuer?.CN || c.issuer?.O || null,
        validFrom: c.valid_from, validTo: c.valid_to, selfSigned: c.issuer && c.subject && c.issuer.CN === c.subject.CN,
        altNames: c.subjectaltname || null, protocol: s.getProtocol(), fingerprint256: c.fingerprint256,
      } : null)
      s.end()
    })
    s.on('timeout', () => { s.destroy(); resolve(null) })
    s.on('error', () => resolve(null))
  })
}

const TLS_PORTS = new Set([443, 465, 636, 993, 995, 5001, 8443, 8883, 9443])
const HTTP_PORTS = new Set([80, 81, 1400, 1880, 3000, 3001, 5000, 7080, 8000, 8001, 8008, 8080, 8081, 8083, 8086, 8088, 8089, 8091, 8123, 8888, 9000, 9090])

async function inspect({ ip }) {
  if (!net.isIPv4(ip)) throw new Error('Invalid IPv4 address')
  const t0 = Date.now()
  const [probes, mdns, ssdp, arp, rdns] = await Promise.all([
    pool(DEEP_PORTS, 64, (p) => tcpProbe(ip, p, 900).then((r) => [p, r])),
    mdnsDiscover(4).then((m) => m.get(ip) || null),
    ssdpDiscover(3).then((m) => m.get(ip) || null),
    arpTable(),
    withTimeout(dns.reverse(ip).catch(() => []), 2000, []),
  ])
  const open = probes.filter(([, r]) => r.state === 'open').map(([p]) => p)
  const reachable = probes.some(([, r]) => r.state !== 'timeout')
  const portDetails = await pool(open, 8, async (p) => {
    const d = { port: p, service: PORT_NAMES[p] || null }
    if (TLS_PORTS.has(p)) {
      d.tls = await tlsInfo(ip, p)
      if (d.tls && [443, 8443, 9443, 5001].includes(p)) {
        const r = await httpGet(`https://${ip}:${p}/`, 2500, { https: true })
        if (r) d.http = { status: r.status, server: r.headers.server || null, title: titleOf(r.body), headers: pickHeaders(r.headers) }
      }
    } else if (HTTP_PORTS.has(p)) {
      const r = await httpGet(`http://${ip}:${p}/`, 2500)
      if (r) d.http = { status: r.status, server: r.headers.server || null, title: titleOf(r.body), headers: pickHeaders(r.headers) }
    } else {
      d.banner = await banner(ip, p)
    }
    return d
  })
  // Latency: 5 TCP handshakes to the first open port
  let latency = null
  if (open.length) {
    const ms = []
    for (let i = 0; i < 5; i++) { const r = await tcpProbe(ip, open[0], 1500); if (r.state === 'open') ms.push(r.ms) }
    if (ms.length) latency = { min: Math.min(...ms), avg: Math.round(ms.reduce((a, b) => a + b, 0) / ms.length), max: Math.max(...ms), port: open[0] }
  }
  const mac = arp.get(ip) || null
  const h = { ip, mac, vendor: vendorOf(mac), hostname: rdns[0] || null, ports: open, mdns, ssdp }
  h.http = await httpFingerprint(ip, open)
  h.id = identify(h)
  return {
    ...h, reachable: reachable || !!mac, reverseDns: rdns, latency, portDetails,
    scannedPorts: DEEP_PORTS.length, durationMs: Date.now() - t0,
  }
}

function pickHeaders(h) {
  const keep = ['server', 'x-powered-by', 'content-type', 'www-authenticate', 'location', 'set-cookie', 'strict-transport-security']
  const out = {}
  for (const k of keep) if (h[k]) out[k] = Array.isArray(h[k]) ? h[k].map((c) => c.split(';')[0]).join(', ') : h[k]
  return out
}

module.exports = { scan, inspect, localNetworks, identify, vendorOf, PORT_NAMES }
