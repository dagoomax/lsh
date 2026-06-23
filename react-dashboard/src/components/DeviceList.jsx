import { useState } from 'react'

const TYPE_ICON = {
  vebus: '⚡', battery: '🔋', solarcharger: '☀️',
  smartthings: '🏠', light: '💡', switch: '🔌',
  temperature: '🌡️', humidity: '💧', motion: '👁',
  occupancy: '👤', thermostat: '🌡️', 'air-quality': '🍃',
}

function getIcon(device) {
  return TYPE_ICON[device.type] || TYPE_ICON[device.icon] || '📱'
}

function getGroup(device) {
  if (['vebus','battery','solarcharger'].includes(device.type)) return 'Victron'
  const label = device.label?.toLowerCase() || ''
  const sensors = device.sensors?.map(s => s.name?.toLowerCase()).join(' ') || ''
  if (label.includes('therm') || sensors.includes('temperature') || sensors.includes('humidity')) return 'Climate'
  if (sensors.includes('motion') || sensors.includes('contact') || sensors.includes('occupancy')) return 'Security'
  if (sensors.includes('switch') || sensors.includes('light') || sensors.includes('dimmer')) return 'Lighting'
  return 'Devices'
}

const GROUP_ORDER = ['Victron', 'Lighting', 'Climate', 'Security', 'Devices']

function DeviceRow({ device }) {
  const icon = getIcon(device)
  const colorMap = { blue: 'var(--blue)', green: 'var(--green)', orange: 'var(--orange)', red: 'var(--red)', yellow: 'var(--yellow)' }
  const color = colorMap[device.color] || 'var(--text2)'

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 0',
      borderBottom: '1px solid var(--sep)',
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10,
        background: 'var(--bg3)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 18, flexShrink: 0,
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {device.label}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 1 }}>
          {device.type} · {device.sensors?.length ?? 0} sensors
        </div>
      </div>
      <div style={{
        fontSize: 11, fontWeight: 600, color,
        background: `${color}18`, borderRadius: 6, padding: '2px 8px',
        flexShrink: 0,
      }}>
        {device.type.toUpperCase().slice(0, 6)}
      </div>
    </div>
  )
}

export default function DeviceList({ devices }) {
  const [expanded, setExpanded] = useState(false)

  const grouped = {}
  for (const d of devices) {
    const g = getGroup(d)
    if (!grouped[g]) grouped[g] = []
    grouped[g].push(d)
  }

  const maxVisible = 8
  let shown = 0
  const total = devices.length

  return (
    <div style={{ padding: '16px 20px', height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.2px' }}>Devices</span>
        <span className="badge badge-gray">{total}</span>
      </div>

      {GROUP_ORDER.filter(g => grouped[g]).map(group => {
        const devs = grouped[group] || []
        const visibleDevs = expanded ? devs : devs.slice(0, Math.max(0, maxVisible - shown))
        shown += visibleDevs.length
        if (!expanded && shown > maxVisible) return null
        if (visibleDevs.length === 0) return null

        return (
          <div key={group} style={{ marginBottom: 12 }}>
            <div style={{
              fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
              letterSpacing: '0.08em', color: 'var(--text3)',
              padding: '6px 0 4px',
            }}>
              {group} · {devs.length}
            </div>
            {visibleDevs.map(d => <DeviceRow key={d.key} device={d} />)}
          </div>
        )
      })}

      {total > maxVisible && (
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            width: '100%', marginTop: 8, padding: '10px',
            background: 'var(--bg3)', border: '1px solid var(--border)',
            borderRadius: 10, color: 'var(--blue)', fontSize: 13, fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          {expanded ? 'Show less' : `Show all ${total} devices`}
        </button>
      )}
    </div>
  )
}
