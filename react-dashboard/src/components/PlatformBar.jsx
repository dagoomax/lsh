import { gt } from '../i18n'

// Connected-platform badges — mirrors the vanilla dashboard's platform bar
// (public/app.js PLATFORMS). Only platforms reporting status are shown;
// green = connected, red = disconnected. Badges are ordered by GROUPS below
// (by what the platform does), not by this list's order.
const PLATFORMS = [
  { key: 'victron-mqtt', label: 'MQTT',        color: '#0066cc', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M8 20l5-10 3 6 2-4 4 8" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg> },
  { key: 'victron-vrm',  label: 'VRM',         color: '#0066cc', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M10 11h12M16 11v10M12 21h8" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/></svg> },
  { key: 'smartthings',  label: 'SmartThings', color: '#15bfff', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><circle cx="16" cy="16" r="5" fill="#fff"/><circle cx="16" cy="7" r="2" fill="#fff"/><circle cx="16" cy="25" r="2" fill="#fff"/><circle cx="7" cy="16" r="2" fill="#fff"/><circle cx="25" cy="16" r="2" fill="#fff"/></svg> },
  { key: 'solaredge',    label: 'SolarEdge',   color: '#f47920', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M16 8v2M16 22v2M8 16H6M26 16h-2M10.3 10.3l-1.4-1.4M23.1 23.1l-1.4-1.4M10.3 21.7l-1.4 1.4M23.1 8.9l-1.4 1.4" stroke="#fff" strokeWidth="2" strokeLinecap="round"/><circle cx="16" cy="16" r="4" fill="#fff"/></svg> },
  { key: 'loxone',       label: 'Loxone',      color: '#69b034', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><rect x="9" y="9" width="14" height="14" rx="2" fill="#fff"/><rect x="13" y="13" width="6" height="6" rx="1" fill="currentColor"/></svg> },
  { key: 'satel',        label: 'Satel',       color: '#e31e24', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M11 11h10v10H11z" fill="none" stroke="#fff" strokeWidth="2"/><path d="M14 14h4v4h-4z" fill="#fff"/></svg> },
  { key: 'bayrol',       label: 'Bayrol',      color: '#0072bc', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M16 7c3.2 4.4 6 7.6 6 11a6 6 0 01-12 0c0-3.4 2.8-6.6 6-11z" fill="#fff"/><path d="M13.5 18.5a2.5 2.5 0 002.5 2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg> },
  { key: 'smarttub',     label: 'SmartTub',    color: '#0e7c9e', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><rect x="8" y="17" width="16" height="7" rx="3" fill="#fff"/><path d="M12 14c-1-1.5-1-3 0-4.5M16 14c-1-1.5-1-3 0-4.5M20 14c-1-1.5-1-3 0-4.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round"/></svg> },
  { key: 'aquilo',       label: 'Aquilo',      color: '#1a8fd1', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><rect x="9" y="8" width="14" height="17" rx="2.5" stroke="#fff" strokeWidth="1.8"/><path d="M9.9 17.5c2-1 4-1 6 0s4 1 6.2 0V22a2.1 2.1 0 01-2.1 2.1h-8A2.1 2.1 0 019.9 22z" fill="#fff"/></svg> },
  { key: 'unifi',        label: 'UniFi',       color: '#0559c9', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M16 9a7 7 0 010 14 7 7 0 010-14z" fill="none" stroke="#fff" strokeWidth="2"/><path d="M16 13a3 3 0 010 6 3 3 0 010-6z" fill="#fff"/></svg> },
  { key: 'unifiAccess',  label: 'UniFi Access',color: '#0559c9', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><rect x="12" y="15" width="8" height="7" rx="1.5" fill="#fff"/><path d="M13.5 15v-2.5a2.5 2.5 0 015 0V15" fill="none" stroke="#fff" strokeWidth="2"/></svg> },
  { key: 'reolink',      label: 'Reolink',     color: '#2596e6', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><circle cx="16" cy="16" r="6" fill="none" stroke="#fff" strokeWidth="2"/><circle cx="16" cy="16" r="2" fill="#fff"/><rect x="8" y="9" width="4" height="2.5" rx="1" fill="#fff"/></svg> },
  { key: 'shelly',       label: 'Shelly',      color: '#f0a500', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M16 10v6l4 2" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="16" cy="16" r="3" fill="#fff"/></svg> },
  { key: 'mqtt-explorer',label: 'Explorer',    color: '#7c3aed', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><circle cx="10" cy="10" r="2.5" fill="#fff"/><circle cx="22" cy="10" r="2.5" fill="#fff"/><circle cx="10" cy="22" r="2.5" fill="#fff"/><circle cx="22" cy="22" r="2.5" fill="#fff"/><path d="M12.5 10h7M10 12.5v7M22 12.5v7M12.5 22h7" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/></svg> },
  { key: 'boneio',       label: 'BoneIO',      color: '#1a73e8', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><circle cx="10" cy="10" r="3" fill="#fff"/><circle cx="22" cy="10" r="3" fill="#fff"/><circle cx="10" cy="22" r="3" fill="#fff"/><circle cx="22" cy="22" r="3" fill="#fff"/><path d="M13 10h6M10 13v6M22 13v6M13 22h6" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/></svg> },
  { key: 'fibaro',       label: 'Fibaro',      color: '#e4181c', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M10 10h12v3H10zM10 16h8v3h-8zM10 22h5v3h-5z" fill="#fff"/></svg> },
  { key: 'somfy',        label: 'Somfy',       color: '#f2a900', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M9 9h14v3.5H9zM9 14.5h14V18H9z" fill="#fff"/><path d="M9 20h14v1.8H9z" fill="#fff" opacity="0.85"/><circle cx="16" cy="24.5" r="1.6" fill="#fff"/></svg> },
  { key: 'lgthinq',      label: 'LG ThinQ',    color: '#a50034', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><text x="16" y="21" textAnchor="middle" fontFamily="Arial,sans-serif" fontWeight="bold" fontSize="11" fill="#fff">LG</text></svg> },
  { key: 'zway',         label: 'Z-Way',       color: '#7d59a5', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M10 11h12l-12 10h12" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg> },
  { key: 'zwaveJs',      label: 'Z-Wave JS',   color: '#1a8fe3', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M10 11h12l-12 10h12" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg> },
  { key: 'wirenboard',   label: 'WirenBoard',  color: '#4caf50', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><rect x="9" y="9" width="14" height="14" rx="2" fill="none" stroke="#fff" strokeWidth="2"/><path d="M12 13v6M16 13v6M20 13v6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round"/></svg> },
  { key: 'tuya-ipc',     label: 'Tuya',        color: '#ff4800', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M9.5 11.5h13M16 11.5v10.5" stroke="#fff" strokeWidth="3.2" strokeLinecap="round"/><circle cx="22" cy="21" r="2" fill="#fff"/></svg> },
  { key: 'denon',        label: 'Denon',       color: '#4a4a4c', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><text x="16" y="18.6" textAnchor="middle" fontFamily="Georgia,serif" fontWeight="bold" fontSize="5.8" letterSpacing="0.2" fill="#fff">DENON</text></svg> },
  { key: 'homeassistant',label: 'Home Assistant', color: '#18bcf2', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M8 16.5L16 9l8 7.5V24H8z" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round"/><path d="M16 24v-8M13 18.5l3 2.5 3-4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><circle cx="16" cy="15.5" r="1.4" fill="#fff"/></svg> },
  { key: 'nippy',        label: 'nippy',       color: '#00a19a', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M10.5 22v-8.2a5.5 5.5 0 0111 0V22" stroke="#fff" strokeWidth="2.6" strokeLinecap="round"/><circle cx="16" cy="9" r="1.6" fill="#fff"/></svg> },
  { key: 'broadlink',    label: 'Broadlink',   color: '#00a0e9', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><circle cx="11" cy="21" r="2.2" fill="#fff"/><path d="M11 15a6 6 0 016 6M11 10.5a10.5 10.5 0 0110.5 10.5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/></svg> },
  { key: 'karcher',      label: 'Kärcher',     color: '#ffe600', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><circle cx="16" cy="16" r="8" fill="none" stroke="#1a1a1a" strokeWidth="2.2"/><path d="M12 13.5h8" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round"/><circle cx="16" cy="18.5" r="2" fill="#1a1a1a"/></svg> },
  { key: 'mc6',          label: 'MC6',         color: '#e8590c', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M14 18.2V9.5a2 2 0 014 0v8.7a4 4 0 11-4 0z" fill="none" stroke="#fff" strokeWidth="2"/><circle cx="16" cy="21.5" r="2" fill="#fff"/><path d="M16 20v-6" stroke="#fff" strokeWidth="2" strokeLinecap="round"/></svg> },
  { key: 'tauronTariff', label: 'Tauron',      color: '#e2007a', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M17.5 7.5L10.5 17.5h5l-1.5 7 7.5-10.5h-5z" fill="#fff" strokeLinejoin="round"/></svg> },
  { key: 'objectDetection', label: 'AI Detection', color: '#7c3aed', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M9 12.5V9.5h3M20 9.5h3v3M23 19.5v3h-3M12 22.5H9v-3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="16" cy="16" r="3" fill="#fff"/></svg> },
  { key: 'systemMetrics',label: 'System',      color: '#64748b', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><rect x="11" y="11" width="10" height="10" rx="1.5" fill="none" stroke="#fff" strokeWidth="2"/><rect x="14" y="14" width="4" height="4" fill="#fff"/><path d="M14 8.5v2.5M18 8.5v2.5M14 21v2.5M18 21v2.5M8.5 14H11M8.5 18H11M21 14h2.5M21 18h2.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/></svg> },
]

// Platforms without a hand-drawn badge above still report status (about 60
// clients do) — show them with a generic lettered badge instead of hiding them.
const prettify = (key) => key
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/[-_]/g, ' ')
  .replace(/\b\w/g, c => c.toUpperCase())
const genericPlatform = (key) => {
  const label = prettify(key)
  return {
    key, label, color: 'var(--text3)',
    svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><text x="16" y="21" textAnchor="middle" fontSize="14" fontWeight="700" fill="#fff">{label[0]}</text></svg>,
  }
}

// Functional grouping — badges render group by group with a thin divider
// between groups. Keys are platformStatus.set() keys; anything reporting
// that isn't listed here falls into a trailing "Other" group.
const GROUPS = [
  { id: 'energy',     label: 'Energy',              keys: ['victron-mqtt', 'victron-vrm', 'solaredge', 'sofar', 'solaraccelerator', 'tauronTariff', 'ocpp', 'easee', 'wallbox', 'zaptec', 'goecharger', 'modbus', 'modbusEmu'] },
  { id: 'security',   label: 'Security & access',   keys: ['satel', 'dsc', 'unifiAccess', 'yale', 'sip'] },
  { id: 'cameras',    label: 'Cameras',             keys: ['reolink', 'axis', 'mobotix', 'tuya-ipc', 'objectDetection'] },
  { id: 'control',    label: 'Lighting & control',  keys: ['loxone', 'loxoneOut', 'knx', 'fibaro', 'fibaroOut', 'boneio', 'grenton', 'nippy', 'ampio', 'wirenboard', 'shelly', 'wled', 'hue', 'tradfri', 'dirigera', 'somfy', 'suppla', 'smartbob', 'esphome', 'arduino', 'broadlink', 'can', 'lsh-ble'] },
  { id: 'climate',    label: 'Climate & weather',   keys: ['vitodens', 'auxair', 'dyson', 'vents', 'mc6', 'airly', 'loxoneWeather'] },
  { id: 'outdoor',    label: 'Pool & garden',       keys: ['bayrol', 'smarttub', 'landroid', 'aquilo'] },
  { id: 'appliances', label: 'Appliances',          keys: ['lgthinq', 'homeconnect', 'miele', 'thermomix', 'roborock', 'dreame', 'karcher'] },
  { id: 'media',      label: 'Media',               keys: ['sonos', 'denon', 'beosound', 'sony', 'googletv', 'googlehome'] },
  { id: 'hubs',       label: 'Hubs & ecosystems',   keys: ['smartthings', 'homeassistant', 'homey', 'vera', 'zway', 'zwaveJs', 'aqara', 'matter-bridge', 'matter-controller', 'virtual'] },
  { id: 'system',     label: 'Network & system',    keys: ['unifi', 'mqtt-explorer', 'systemMetrics', 'google-calendar'] },
]
const GROUPED = new Set(GROUPS.flatMap(g => g.keys))
const BY_KEY = Object.fromEntries(PLATFORMS.map(p => [p.key, p]))

// Device counts per platform for the hover tooltip. A device belongs to a
// platform when its `type` (or the first segment of its key) matches the
// platform key ignoring case and -/_ ; ALIASES covers the few that differ.
const norm = (k) => String(k || '').toLowerCase().replace(/[-_]/g, '')
const ALIASES = {
  'victron-mqtt': ['victron'], 'victron-vrm': ['victron', 'vrm'],
  objectDetection: ['objectdetect'], systemMetrics: ['system'],
}
function countDevices(devices) {
  const counts = {}
  for (const d of devices || []) {
    const t = norm(d.type), k = norm(String(d.key || '').split('/')[0])
    for (const id of new Set([t, k])) if (id) counts[id] = (counts[id] || 0) + 1
  }
  return (key) => {
    const ids = [norm(key), ...(ALIASES[key] || []).map(norm)]
    const seen = new Set()
    let n = 0
    for (const id of ids) if (!seen.has(id)) { seen.add(id); n += counts[id] || 0 }
    return n
  }
}

export default function PlatformBar({ platforms, devices }) {
  const deviceCount = countDevices(devices)
  const reported = new Set(Object.keys(platforms || {}))
  const groups = [
    ...GROUPS,
    { id: 'other', label: 'Other', keys: [...reported].filter(k => !GROUPED.has(k)).sort() },
  ]
    .map(g => ({ ...g, items: g.keys.filter(k => reported.has(k)).map(k => BY_KEY[k] || genericPlatform(k)) }))
    .filter(g => g.items.length)
  if (!groups.length) return null

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
      padding: '6px 20px 0', flexShrink: 0,
    }}>
      {groups.map((g, gi) => (
        <div key={g.id} role="group" aria-label={gt('platform_group_' + g.id, g.label)}
          style={{ display: 'contents' }}>
          {gi > 0 && (
            <span aria-hidden="true" style={{
              width: 1, height: 18, margin: '0 4px', flexShrink: 0,
              background: 'var(--sep)',
            }}/>
          )}
          {g.items.map(p => {
            const on = !!platforms[p.key]
            return (
              <div key={p.key} title={`${p.label}: ${on ? gt('connected', 'connected') : gt('platform_disconnected', 'disconnected')} · ${deviceCount(p.key)} ${gt('devices', 'devices')}`}
                className="platform-chip" data-on={String(on)}>
                <span style={{ width: 18, height: 18, display: 'block', color: p.color }}>{p.svg}</span>
                {p.label}
                <span style={{
                  width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                  background: on ? 'var(--green)' : '#ff453a',
                  boxShadow: 'none',
                }}/>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
