// Connected-platform badges — mirrors the vanilla dashboard's platform bar
// (public/app.js PLATFORMS). Only platforms reporting status are shown;
// green = connected, red = disconnected.
const PLATFORMS = [
  { key: 'victron-mqtt', label: 'MQTT',        color: '#0066cc', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M8 20l5-10 3 6 2-4 4 8" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg> },
  { key: 'victron-vrm',  label: 'VRM',         color: '#0066cc', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M10 11h12M16 11v10M12 21h8" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/></svg> },
  { key: 'smartthings',  label: 'SmartThings', color: '#15bfff', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><circle cx="16" cy="16" r="5" fill="#fff"/><circle cx="16" cy="7" r="2" fill="#fff"/><circle cx="16" cy="25" r="2" fill="#fff"/><circle cx="7" cy="16" r="2" fill="#fff"/><circle cx="25" cy="16" r="2" fill="#fff"/></svg> },
  { key: 'solaredge',    label: 'SolarEdge',   color: '#f47920', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M16 8v2M16 22v2M8 16H6M26 16h-2M10.3 10.3l-1.4-1.4M23.1 23.1l-1.4-1.4M10.3 21.7l-1.4 1.4M23.1 8.9l-1.4 1.4" stroke="#fff" strokeWidth="2" strokeLinecap="round"/><circle cx="16" cy="16" r="4" fill="#fff"/></svg> },
  { key: 'loxone',       label: 'Loxone',      color: '#69b034', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><rect x="9" y="9" width="14" height="14" rx="2" fill="#fff"/><rect x="13" y="13" width="6" height="6" rx="1" fill="currentColor"/></svg> },
  { key: 'satel',        label: 'Satel',       color: '#e31e24', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M11 11h10v10H11z" fill="none" stroke="#fff" strokeWidth="2"/><path d="M14 14h4v4h-4z" fill="#fff"/></svg> },
  { key: 'bayrol',       label: 'Bayrol',      color: '#0072bc', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M16 7c3.2 4.4 6 7.6 6 11a6 6 0 01-12 0c0-3.4 2.8-6.6 6-11z" fill="#fff"/><path d="M13.5 18.5a2.5 2.5 0 002.5 2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg> },
  { key: 'unifi',        label: 'UniFi',       color: '#0559c9', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M16 9a7 7 0 010 14 7 7 0 010-14z" fill="none" stroke="#fff" strokeWidth="2"/><path d="M16 13a3 3 0 010 6 3 3 0 010-6z" fill="#fff"/></svg> },
  { key: 'shelly',       label: 'Shelly',      color: '#f0a500', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M16 10v6l4 2" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="16" cy="16" r="3" fill="#fff"/></svg> },
  { key: 'mqtt-explorer',label: 'Explorer',    color: '#7c3aed', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><circle cx="10" cy="10" r="2.5" fill="#fff"/><circle cx="22" cy="10" r="2.5" fill="#fff"/><circle cx="10" cy="22" r="2.5" fill="#fff"/><circle cx="22" cy="22" r="2.5" fill="#fff"/><path d="M12.5 10h7M10 12.5v7M22 12.5v7M12.5 22h7" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/></svg> },
  { key: 'boneio',       label: 'BoneIO',      color: '#1a73e8', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><circle cx="10" cy="10" r="3" fill="#fff"/><circle cx="22" cy="10" r="3" fill="#fff"/><circle cx="10" cy="22" r="3" fill="#fff"/><circle cx="22" cy="22" r="3" fill="#fff"/><path d="M13 10h6M10 13v6M22 13v6M13 22h6" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/></svg> },
  { key: 'fibaro',       label: 'Fibaro',      color: '#e4181c', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M10 10h12v3H10zM10 16h8v3h-8zM10 22h5v3h-5z" fill="#fff"/></svg> },
  { key: 'somfy',        label: 'Somfy',       color: '#f2a900', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M9 9h14v3.5H9zM9 14.5h14V18H9z" fill="#fff"/><path d="M9 20h14v1.8H9z" fill="#fff" opacity="0.85"/><circle cx="16" cy="24.5" r="1.6" fill="#fff"/></svg> },
  { key: 'lgthinq',      label: 'LG ThinQ',    color: '#a50034', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><text x="16" y="21" textAnchor="middle" fontFamily="Arial,sans-serif" fontWeight="bold" fontSize="11" fill="#fff">LG</text></svg> },
  { key: 'zway',         label: 'Z-Way',       color: '#7d59a5', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M10 11h12l-12 10h12" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg> },
  { key: 'wirenboard',   label: 'WirenBoard',  color: '#4caf50', svg: <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><rect x="9" y="9" width="14" height="14" rx="2" fill="none" stroke="#fff" strokeWidth="2"/><path d="M12 13v6M16 13v6M20 13v6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round"/></svg> },
]

export default function PlatformBar({ platforms }) {
  const visible = PLATFORMS.filter(p => p.key in (platforms || {}))
  if (!visible.length) return null

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      padding: '8px 20px 0', flexShrink: 0,
    }}>
      {visible.map(p => {
        const on = !!platforms[p.key]
        return (
          <div key={p.key} title={`${p.label}: ${on ? 'connected' : 'disconnected'}`} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '3px 10px 3px 4px', borderRadius: 999,
            background: 'var(--card, rgba(255,255,255,0.04))',
            border: `1px solid ${on ? 'rgba(63,185,80,0.35)' : 'rgba(248,81,73,0.35)'}`,
            opacity: on ? 1 : 0.55,
            fontSize: 11.5, color: 'var(--text2, #8b949e)', userSelect: 'none',
          }}>
            <span style={{ width: 18, height: 18, display: 'block', color: p.color }}>{p.svg}</span>
            {p.label}
            <span style={{
              width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
              background: on ? '#3fb950' : '#f85149',
              boxShadow: on ? '0 0 6px rgba(63,185,80,0.8)' : 'none',
            }}/>
          </div>
        )
      })}
    </div>
  )
}
