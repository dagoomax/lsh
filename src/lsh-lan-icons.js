'use strict';

// Device icons for LAN scan (Saved devices, topology map). Downloaded once,
// stored in persist/lan-icons/, served by GET /api/lsh-lan/icons/:file.
//
// Sources:
//   vendor   brand logo from Simple Icons (CC0, simpleicons.org) via jsDelivr
//            (unpkg as fallback), picked from the device's MAC vendor / name —
//            one file per brand, shared by every device of that brand
//   favicon  the device's own web UI icon (http://<ip>/favicon.ico or the
//            <link rel=icon> on its home page)
//   url      any image URL the user pastes
//
// SVGs are sanitised (scripts, event handlers, external references
// stripped) because they're served from LSH's own origin; raster images are
// checked by magic bytes. Max 512 KB.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const DIR = process.env.LSH_LAN_ICONS_DIR || path.join(__dirname, '..', 'persist', 'lan-icons');
const MAX_BYTES = 512 * 1024;

// Vendor / name pattern → Simple Icons slugs to try, in order.
const BRANDS = [
  [/apple/, ['apple']], [/philips|signify|\bhue\b/, ['philipshue', 'philips']], [/samsung/, ['samsung']],
  [/linksys|belkin/, ['linksys', 'belkin']], [/tp-?link|tl-wr|deco/, ['tplink']], [/google|nest|chromecast/, ['google', 'googlenest']],
  [/sonos/, ['sonos']], [/ubiquiti|unifi/, ['ubiquiti']], [/raspberry/, ['raspberrypi']], [/espressif|esphome/, ['espressif', 'esphome']],
  [/logitech/, ['logitech']], [/home assistant/, ['homeassistant']], [/shelly|allterco/, ['shelly']], [/amazon|echo|kindle/, ['amazon', 'amazonalexa']],
  [/xiaomi|mi home/, ['xiaomi']], [/\blg\b|lg electronics/, ['lg']], [/sony/, ['sony', 'playstation']], [/synology/, ['synology']],
  [/netgear/, ['netgear']], [/asus/, ['asus']], [/intel/, ['intel']], [/microsoft|xbox/, ['microsoft', 'xbox']], [/hewlett|\bhp\b/, ['hp']],
  [/lenovo/, ['lenovo']], [/dell/, ['dell']], [/huawei/, ['huawei']], [/nvidia|shield/, ['nvidia']], [/ikea|tradfri|dirigera/, ['ikea']],
  [/bosch/, ['bosch']], [/siemens/, ['siemens']], [/orange|funbox|livebox|sagemcom/, ['orange']], [/tado/, ['tado']],
  [/brother/, ['brother']], [/canon/, ['canon']], [/epson/, ['epson']], [/nintendo/, ['nintendo', 'nintendoswitch']],
  [/roku/, ['roku']], [/netflix/, ['netflix']], [/spotify/, ['spotify']], [/zyxel/, ['zyxel']], [/mikrotik/, ['mikrotik']],
  [/avm|fritz/, ['avm']], [/miele/, ['miele']], [/viessmann/, ['viessmann']], [/tesla/, ['tesla']], [/garmin/, ['garmin']],
  [/fibaro/, ['fibaro']], [/loxone/, ['loxone']], [/homey|athom/, ['homey']], [/tuya/, ['tuya']], [/eve systems|\beve\b/, ['eve']],
  [/meross/, ['meross']], [/sensibo/, ['sensibo']], [/oneplus/, ['oneplus']], [/motorola/, ['motorola']], [/nokia/, ['nokia']],
]

function brandSlugs(dev) {
  const hay = `${dev.vendor || ''} ${dev.name || ''} ${dev.kindLabel || ''} ${dev.hostname || ''}`.toLowerCase()
  for (const [re, slugs] of BRANDS) if (re.test(hay)) return slugs
  return []
}

// ── Download ────────────────────────────────────────────────────────────────
function download(url, { timeout = 10000, redirects = 3 } = {}) {
  return new Promise((resolve, reject) => {
    let u
    try { u = new URL(url) } catch { return reject(new Error('Invalid URL')) }
    if (!/^https?:$/.test(u.protocol)) return reject(new Error('Only http(s) URLs'))
    const mod = u.protocol === 'https:' ? https : http
    const req = mod.get(u, { timeout, rejectUnauthorized: u.protocol === 'https:' && !isPrivate(u.hostname), headers: { 'User-Agent': 'LSH-icon-fetch', Accept: 'image/*,*/*;q=0.5' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume()
        return resolve(download(new URL(res.headers.location, u).href, { timeout, redirects: redirects - 1 }))
      }
      if (res.statusCode !== 200) { res.resume(); const e = new Error(`HTTP ${res.statusCode}`); e.status = res.statusCode; return reject(e) }
      const chunks = []
      let size = 0
      res.on('data', (c) => { size += c.length; if (size > MAX_BYTES) { req.destroy(); reject(new Error('Image too large (max 512 KB)')) } else chunks.push(c) })
      res.on('end', () => resolve({ body: Buffer.concat(chunks), type: String(res.headers['content-type'] || '') }))
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error('Timed out')))
    req.on('error', reject)
  })
}

const isPrivate = (h) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|localhost$)/.test(h)

// ── Validate / sanitise ─────────────────────────────────────────────────────
function detectType(buf, contentType = '') {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  if (buf.length >= 6 && buf.toString('latin1', 0, 6).startsWith('GIF8')) return 'gif'
  if (buf.length >= 4 && buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return 'ico'
  const head = buf.toString('utf8', 0, Math.min(buf.length, 512)).trim().toLowerCase()
  if (head.startsWith('<svg') || head.startsWith('<?xml') || /image\/svg/.test(contentType)) {
    if (/<svg[\s>]/.test(buf.toString('utf8').toLowerCase())) return 'svg'
  }
  return null
}

function sanitizeSvg(src, fill) {
  let s = String(src)
  s = s.replace(/<\?xml[^>]*>/gi, '').replace(/<!DOCTYPE[^>]*>/gi, '').replace(/<!--[\s\S]*?-->/g, '')
  s = s.replace(/<(script|foreignObject|iframe|object|embed|use)\b[\s\S]*?<\/\1\s*>/gi, '').replace(/<(script|foreignObject|iframe|object|embed|use)\b[^>]*\/?>/gi, '')
  s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  s = s.replace(/\s(xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, '')
  s = s.replace(/javascript:/gi, '')
  s = s.replace(/<title>[\s\S]*?<\/title>/gi, '')
  if (fill) s = s.replace(/<svg\b/i, `<svg fill="${fill}"`)
  if (!/^\s*<svg[\s>]/i.test(s)) throw new Error('Not an SVG')
  return s.trim()
}

// Store bytes, return the stored file name.
function store(buf, type, name) {
  fs.mkdirSync(DIR, { recursive: true })
  const file = `${name || crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16)}.${type}`
  fs.writeFileSync(path.join(DIR, file), buf)
  return file
}

async function saveFromBuffer(buf, contentType, name) {
  const type = detectType(buf, contentType)
  if (!type) throw new Error('Not a supported image (png, jpg, webp, gif, ico, svg)')
  const out = type === 'svg' ? Buffer.from(sanitizeSvg(buf.toString('utf8'))) : buf
  return store(out, type, name)
}

// ── Sources ─────────────────────────────────────────────────────────────────
const CDNS = [
  (slug) => `https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/${slug}.svg`,
  (slug) => `https://unpkg.com/simple-icons@latest/icons/${slug}.svg`,
]

// Brand logo, white (drawn on the device's coloured node). Cached per slug.
async function fetchBrandIcon(slug) {
  const file = `brand-${slug}.svg`
  if (fs.existsSync(path.join(DIR, file))) return file
  let lastErr = null
  for (const cdn of CDNS) {
    try {
      const { body } = await download(cdn(slug))
      fs.mkdirSync(DIR, { recursive: true })
      fs.writeFileSync(path.join(DIR, file), sanitizeSvg(body.toString('utf8'), '#ffffff'))
      return file
    } catch (err) {
      if (err.status === 404) return null // this brand isn't in Simple Icons
      lastErr = err
    }
  }
  throw lastErr || new Error('Download failed')
}

async function vendorIcon(dev) {
  const slugs = brandSlugs(dev)
  if (!slugs.length) return null
  for (const slug of slugs) {
    const file = await fetchBrandIcon(slug)
    if (file) return { file, source: 'vendor', ref: slug }
  }
  return null
}

async function faviconIcon(dev) {
  const bases = []
  for (const p of dev.ports || []) {
    if ([80, 8080, 8081, 5000, 1880, 8123, 3000].includes(p)) bases.push(`http://${dev.ip}:${p}`)
    if ([443, 8443, 5001].includes(p)) bases.push(`https://${dev.ip}:${p}`)
  }
  if (!bases.length) bases.push(`http://${dev.ip}`)
  for (const base of bases.slice(0, 3)) {
    const candidates = []
    try {
      const home = await download(`${base}/`, { timeout: 4000 })
      const html = home.body.toString('utf8')
      for (const m of html.matchAll(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/gi)) {
        const href = (m[0].match(/href=["']([^"']+)["']/i) || [])[1]
        if (href && !href.startsWith('data:')) candidates.push(new URL(href, `${base}/`).href)
      }
    } catch {}
    candidates.push(`${base}/favicon.ico`)
    for (const url of candidates) {
      try {
        const { body, type } = await download(url, { timeout: 4000 })
        if (!body.length) continue
        const file = await saveFromBuffer(body, type)
        return { file, source: 'favicon', ref: url }
      } catch {}
    }
  }
  return null
}

async function urlIcon(url) {
  const { body, type } = await download(url)
  const file = await saveFromBuffer(body, type)
  return { file, source: 'url', ref: url }
}

const MIME = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', ico: 'image/x-icon' }

function filePath(file) {
  if (!/^[a-z0-9._-]+\.(svg|png|jpg|webp|gif|ico)$/i.test(file) || file.includes('..')) return null
  const p = path.join(DIR, file)
  return fs.existsSync(p) ? { path: p, mime: MIME[file.split('.').pop().toLowerCase()] } : null
}

module.exports = { brandSlugs, vendorIcon, faviconIcon, urlIcon, saveFromBuffer, sanitizeSvg, detectType, filePath, DIR }
