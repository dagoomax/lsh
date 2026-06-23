import { useState } from 'react'

const TYPE_ICON = {
  vebus:'⚡', battery:'🔋', solarcharger:'☀️',
  smartthings:'🏠', switch:'🔌', light:'💡',
  temperature:'🌡️', thermostat:'🌡️', humidity:'💧',
  motion:'👁', occupancy:'👤', contact:'🚪',
  'air-quality':'🍃', vacuum:'🤖',
}

function getIcon(d) {
  return d.icon || TYPE_ICON[d.type] || '📱'
}

function getGroup(d) {
  if (['vebus','battery','solarcharger'].includes(d.type)) return 'Victron'
  const r = d.readings || {}
  const keys = Object.keys(r)
  if (keys.includes('temperature') || keys.includes('humidity')) return 'Climate'
  if (keys.includes('motion') || keys.includes('contact') || keys.includes('presence')) return 'Security'
  if ((r.switch?.value != null) && (r.level?.value != null)) return 'Lighting'
  if (r.switch?.value != null) return 'Switches'
  if (keys.includes('battery')) return 'Sensors'
  return 'Other'
}

const GROUP_ORDER = ['Victron','Lighting','Switches','Climate','Security','Sensors','Other']
const GROUP_ICON  = { Victron:'⚡', Lighting:'💡', Switches:'🔌', Climate:'🌡️', Security:'🛡️', Sensors:'📡', Other:'📱' }

function ReadingBadge({ readings }) {
  if (!readings) return null
  const r = readings

  // Temperature + humidity
  if (r.temperature?.value != null && r.humidity?.value != null) {
    return (
      <div style={{ display:'flex', gap:6 }}>
        <span style={{ fontSize:12, color:'var(--orange)', fontVariantNumeric:'tabular-nums' }}>{r.temperature.value}°C</span>
        <span style={{ fontSize:12, color:'var(--blue)', fontVariantNumeric:'tabular-nums' }}>{r.humidity.value}%</span>
      </div>
    )
  }
  // Temperature only
  if (r.temperature?.value != null) {
    return <span style={{ fontSize:12, color:'var(--orange)', fontVariantNumeric:'tabular-nums' }}>{r.temperature.value}°C</span>
  }
  // Dimmer/light with level
  if (r.switch?.value != null && r.level?.value != null) {
    const on = r.switch.value === 1 || r.switch.value === 'on' || r.switch.value === true
    return (
      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
        <div style={{
          width:10, height:10, borderRadius:'50%',
          background: on ? 'var(--yellow)' : 'var(--bg4)',
          boxShadow: on ? '0 0 6px var(--yellow)' : 'none',
        }}/>
        <span style={{ fontSize:12, color:'var(--text2)' }}>{on ? `${r.level.value}%` : 'Off'}</span>
      </div>
    )
  }
  // Switch only
  if (r.switch?.value != null) {
    const on = r.switch.value === 1 || r.switch.value === 'on' || r.switch.value === true
    return (
      <span className={`badge ${on ? 'badge-green' : 'badge-gray'}`} style={{ fontSize:11 }}>
        {on ? 'On' : 'Off'}
      </span>
    )
  }
  // Motion
  if (r.motion?.value != null) {
    const active = r.motion.value === 1 || r.motion.value === 'active'
    return (
      <span className={`badge ${active ? 'badge-orange' : 'badge-gray'}`} style={{ fontSize:11 }}>
        {active ? '● Motion' : 'Clear'}
      </span>
    )
  }
  // Presence
  if (r.presence?.value != null) {
    const present = r.presence.value === 1 || r.presence.value === 'present'
    return (
      <span className={`badge ${present ? 'badge-blue' : 'badge-gray'}`} style={{ fontSize:11 }}>
        {present ? '● Present' : 'Away'}
      </span>
    )
  }
  // Battery level
  if (r.battery?.value != null) {
    const pct = r.battery.value
    return <span style={{ fontSize:12, color: pct<20?'var(--red)':pct<50?'var(--orange)':'var(--green)' }}>🔋 {pct}%</span>
  }
  return null
}

function SubValues({ readings }) {
  if (!readings) return null
  const r = readings
  const extras = []
  if (r.battery?.value != null) extras.push(`🔋 ${r.battery.value}%`)
  if (r.tvocLevel?.value != null) extras.push(`TVOC ${r.tvocLevel.value.toFixed(3)}`)
  if (r.heatingSetpoint?.value != null) extras.push(`Set ${r.heatingSetpoint.value}°`)
  if (r['Pv/V']?.value != null) extras.push(`${Number(r['Pv/V'].value).toFixed(1)} Vpv`)
  if (r['Yield/Total']?.value != null) extras.push(`${Number(r['Yield/Total'].value).toFixed(0)} kWh total`)
  if (!extras.length) return null
  return <div style={{ fontSize:11, color:'var(--text3)', marginTop:1 }}>{extras.join(' · ')}</div>
}

function DeviceRow({ device }) {
  const icon = getIcon(device)
  return (
    <div style={{
      display:'flex', alignItems:'center', gap:12,
      padding:'9px 0', borderBottom:'1px solid var(--sep)',
    }}>
      <div style={{
        width:36, height:36, borderRadius:10, flexShrink:0,
        background:'var(--bg3)', display:'flex', alignItems:'center', justifyContent:'center',
        fontSize:17,
      }}>
        {icon}
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:14, fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {device.label}
        </div>
        <SubValues readings={device.readings} />
      </div>
      <div style={{ flexShrink:0 }}>
        <ReadingBadge readings={device.readings} />
      </div>
    </div>
  )
}

function GroupSection({ name, devices }) {
  const [open, setOpen] = useState(true)
  if (!devices?.length) return null
  return (
    <div style={{ marginBottom:4 }}>
      <button onClick={() => setOpen(o=>!o)} style={{
        display:'flex', alignItems:'center', gap:6, width:'100%',
        background:'none', border:'none', cursor:'pointer',
        padding:'8px 0 4px', color:'var(--text2)',
      }}>
        <span style={{ fontSize:13 }}>{GROUP_ICON[name] || '📱'}</span>
        <span style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>{name}</span>
        <span style={{ fontSize:11, color:'var(--text3)', marginLeft:'auto' }}>{devices.length} {open?'▾':'▸'}</span>
      </button>
      {open && devices.map(d => <DeviceRow key={d.key} device={d}/>)}
    </div>
  )
}

export default function DeviceList({ devices }) {
  const grouped = {}
  for (const d of devices) {
    const g = getGroup(d)
    ;(grouped[g] = grouped[g]||[]).push(d)
  }

  const online = devices.filter(d => {
    const r = d.readings||{}
    return Object.values(r).some(v=>v?.value!=null)
  }).length

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      {/* Header */}
      <div style={{ padding:'16px 20px 8px', borderBottom:'1px solid var(--sep)', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span style={{ fontSize:13, fontWeight:600, letterSpacing:'-0.2px' }}>Devices</span>
          <div style={{ display:'flex', gap:6 }}>
            <span className="badge badge-green">{online} live</span>
            <span className="badge badge-gray">{devices.length} total</span>
          </div>
        </div>
      </div>

      {/* Scrollable list */}
      <div style={{ flex:1, overflowY:'auto', padding:'4px 20px 16px' }}>
        {GROUP_ORDER.filter(g => grouped[g]).map(g => (
          <GroupSection key={g} name={g} devices={grouped[g]} />
        ))}
      </div>
    </div>
  )
}
