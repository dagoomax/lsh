import { useState, useCallback } from 'react'

const TOKEN = 'e95b1a01b85f38a831d8a8b8d949e5e783bf32d3f52ff5d1d6a46ab25b28385e'
const H     = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }

async function sendCommand(key, sensor, value) {
  await fetch(`/api/device/${encodeURIComponent(key)}/command`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ sensor, value }),
  })
}

// ── Icon resolution ──────────────────────────────────────────────────────────
const NAME_ICON = {
  kinkiet:'🕯️', ledy:'🌈', ubikacja:'🚿', korytarz:'🚪', entrance:'🚪',
  edison:'💡', huebloom:'🌸', pólka:'📚', pralka:'👕', suszarka:'🌀',
  żyrandol:'🔮', 'zawórlidl':'🚰', 'cam 360':'📷', wejście:'🚪',
  'ikea vindstyrka':'🍃', 'ikea motion sensor':'👁', 'ikea remote control':'🎛️',
  'ikea dimmer switch':'🎛️', 'ikea bulb e27 ws 1':'💡', 'bilresa dual button':'🔘',
  'popp thermostat':'🌡️', 'http temperature':'🌡️', 'http switch':'🔌',
  'solar charger':'☀️', 'multi/quattro':'⚡', battery:'🔋',
  iphone:'📱', 'ipad pro':'📱', ogródek:'🌿', komórka:'🔦',
  'czujnik ruchu':'🚨', 'okno rgbw':'🌈', fdsegr:'🔌',
}
const TYPE_ICON = {
  vebus:'⚡', battery:'🔋', solarcharger:'☀️',
  smartthings:'🏠',
}

function getIcon(d) {
  return NAME_ICON[d.label?.toLowerCase()] || d.icon || TYPE_ICON[d.type] || '📱'
}

// ── Grouping ─────────────────────────────────────────────────────────────────
function getGroup(d) {
  if (['vebus','battery','solarcharger'].includes(d.type)) return 'Victron'
  const r    = d.readings || {}
  const keys = Object.keys(r)
  if (keys.includes('temperature') || keys.includes('humidity')) return 'Climate'
  if (keys.includes('motion') || keys.includes('contact') || keys.includes('presence')) return 'Security'
  if (r.switch?.value != null && (r.level?.value != null || r.hue?.value != null || r.colorTemperature?.value != null))
    return 'Lighting'
  if (r.switch?.value != null) return 'Switches'
  if (keys.includes('battery') && !keys.includes('switch')) return 'Sensors'
  return 'Other'
}

const GROUP_ORDER = ['Victron','Lighting','Switches','Climate','Security','Sensors','Other']
const GROUP_ICON  = { Victron:'⚡', Lighting:'💡', Switches:'🔌', Climate:'🌡️', Security:'🛡️', Sensors:'📡', Other:'📱' }

// ── Toggle switch ─────────────────────────────────────────────────────────────
function Toggle({ on, onChange, small }) {
  const w = small ? 38 : 44, h = small ? 22 : 26, knob = small ? 16 : 20, travel = small ? 16 : 18
  return (
    <div onClick={e => { e.stopPropagation(); onChange(!on) }} style={{
      width:w, height:h, borderRadius:h/2,
      background: on ? 'var(--green)' : 'var(--bg4)',
      position:'relative', cursor:'pointer', flexShrink:0,
      transition:'background 0.18s',
    }}>
      <div style={{
        position:'absolute', width:knob, height:knob, borderRadius:'50%',
        background:'#fff', top:(h-knob)/2, left:(h-knob)/2,
        boxShadow:'0 1px 4px rgba(0,0,0,0.4)',
        transition:'transform 0.18s cubic-bezier(0.4,0,0.2,1)',
        transform: on ? `translateX(${travel}px)` : 'none',
      }}/>
    </div>
  )
}

// ── Brightness slider ─────────────────────────────────────────────────────────
function Slider({ value, onChange, color = 'var(--yellow)' }) {
  return (
    <input type="range" min={1} max={100} value={value || 0}
      onChange={e => onChange(Number(e.target.value))}
      onClick={e => e.stopPropagation()}
      style={{
        width:'100%', height:4, appearance:'none', WebkitAppearance:'none',
        background: `linear-gradient(to right, ${color} ${value}%, var(--bg4) ${value}%)`,
        borderRadius:2, outline:'none', cursor:'pointer',
        accentColor: color,
      }}
    />
  )
}

// ── Color temp slider (warm→cool) ─────────────────────────────────────────────
function CTSlider({ value, onChange }) {
  // SmartThings range typically 2700–6500K; normalize to 0–100
  const min=2700, max=6500
  const pct = Math.round(((value||4000) - min) / (max - min) * 100)
  return (
    <input type="range" min={0} max={100} value={pct}
      onChange={e => { const v = Math.round(min + (Number(e.target.value)/100)*(max-min)); onChange(v) }}
      onClick={e => e.stopPropagation()}
      style={{
        width:'100%', height:4, appearance:'none', WebkitAppearance:'none',
        background:'linear-gradient(to right, #ff9f3c, #ffffff, #b8d4ff)',
        borderRadius:2, outline:'none', cursor:'pointer',
      }}
    />
  )
}

// ── Hue indicator dot ─────────────────────────────────────────────────────────
function HueDot({ hue, size = 10 }) {
  return (
    <div style={{
      width:size, height:size, borderRadius:'50%',
      background: `hsl(${Math.round(hue*3.6)},70%,55%)`,
      flexShrink:0,
      boxShadow: `0 0 6px hsl(${Math.round(hue*3.6)},70%,55%)44`,
    }}/>
  )
}

// ── Individual device row ─────────────────────────────────────────────────────
function DeviceRow({ device, onCommand }) {
  const [localState, setLocalState] = useState({})
  const r = device.readings || {}

  const merged = { ...r }
  Object.entries(localState).forEach(([k,v]) => {
    merged[k] = { ...(merged[k]||{}), value: v }
  })

  const cmd = useCallback((sensor, value) => {
    setLocalState(s => ({ ...s, [sensor]: value }))
    onCommand(device.key, sensor, value)
  }, [device.key, onCommand])

  const isOn    = merged.switch?.value === 1 || merged.switch?.value === 'on' || merged.switch?.value === true
  const level   = merged.level?.value ?? 100
  const ct      = merged.colorTemperature?.value ?? 4000
  const hue     = merged.hue?.value
  const hasLevel = r.level != null
  const hasCT    = r.colorTemperature != null
  const hasHue   = r.hue != null
  const hasSwitch= r.switch != null
  const hasMot   = r.motion != null
  const hasPres  = r.presence != null
  const hasTemp  = r.temperature != null
  const hasHum   = r.humidity != null
  const hasBatt  = r.battery != null
  const motActive  = merged.motion?.value === 1 || merged.motion?.value === 'active'
  const presActive = merged.presence?.value === 1 || merged.presence?.value === 'present'

  const icon = getIcon(device)

  return (
    <div style={{
      padding:'10px 0',
      borderBottom:'1px solid var(--sep)',
    }}>
      {/* Main row */}
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        {/* Icon */}
        <div style={{
          width:36, height:36, borderRadius:10, flexShrink:0,
          background: isOn && hasSwitch ? 'rgba(255,214,10,0.12)' : 'var(--bg3)',
          display:'flex', alignItems:'center', justifyContent:'center',
          fontSize:18,
          boxShadow: isOn && hasSwitch ? '0 0 12px rgba(255,214,10,0.2)' : 'none',
          transition:'background 0.2s, box-shadow 0.2s',
        }}>
          {hasHue && isOn ? <HueDot hue={hue} size={18}/> : icon}
        </div>

        {/* Label */}
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{
            fontSize:14, fontWeight:500,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
            color: hasSwitch && !isOn ? 'var(--text2)' : 'var(--text)',
          }}>
            {device.label}
          </div>
          <div style={{ fontSize:11, color:'var(--text3)', marginTop:1, display:'flex', gap:6, alignItems:'center' }}>
            {hasTemp && <span style={{ color:'var(--orange)' }}>{merged.temperature?.value}°C</span>}
            {hasHum  && <span style={{ color:'var(--blue)' }}>{merged.humidity?.value}%</span>}
            {hasLevel && isOn && <span style={{ color:'var(--text3)' }}>{level}%</span>}
            {hasCT && isOn && <span style={{ color:'var(--text3)' }}>{ct}K</span>}
            {hasBatt && !hasSwitch && <span>🔋 {merged.battery?.value}%</span>}
            {r.tvocLevel?.value != null && <span>TVOC {Number(r.tvocLevel.value).toFixed(3)}</span>}
            {r.heatingSetpoint?.value != null && <span>Set {merged.heatingSetpoint?.value}°</span>}
            {hasMot && <span style={{ color:motActive?'var(--orange)':'var(--text3)' }}>{motActive?'● Motion':'Clear'}</span>}
            {hasPres && !hasMot && <span style={{ color:presActive?'var(--blue)':'var(--text3)' }}>{presActive?'● Present':'Away'}</span>}
            {r['Pv/V']?.value != null && <span>{Number(r['Pv/V'].value).toFixed(1)} Vpv</span>}
            {r['Yield/Total']?.value != null && <span>{Number(r['Yield/Total'].value).toFixed(0)} kWh total</span>}
          </div>
        </div>

        {/* Right control */}
        {hasSwitch && (
          <Toggle on={isOn} onChange={val => cmd('switch', val ? 1 : 0)} small />
        )}
        {!hasSwitch && hasBatt && (
          <span style={{
            fontSize:12, fontWeight:600,
            color: (merged.battery?.value??100) < 20 ? 'var(--red)' : (merged.battery?.value??100) < 50 ? 'var(--orange)' : 'var(--green)',
          }}>
            🔋 {merged.battery?.value}%
          </span>
        )}
      </div>

      {/* Expanded controls for lights */}
      {hasSwitch && isOn && (hasLevel || hasCT) && (
        <div style={{ paddingLeft:46, paddingTop:8, display:'flex', flexDirection:'column', gap:6 }}>
          {hasLevel && (
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:11, color:'var(--text3)', width:24, flexShrink:0 }}>☀️</span>
              <Slider
                value={level}
                onChange={val => cmd('level', val)}
                color='var(--yellow)'
              />
              <span style={{ fontSize:11, color:'var(--text3)', width:28, textAlign:'right', flexShrink:0, fontVariantNumeric:'tabular-nums' }}>
                {level}%
              </span>
            </div>
          )}
          {hasCT && (
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:11, color:'var(--text3)', width:24, flexShrink:0 }}>🌡</span>
              <CTSlider value={ct} onChange={val => cmd('colorTemperature', val)} />
              <span style={{ fontSize:11, color:'var(--text3)', width:28, textAlign:'right', flexShrink:0, fontVariantNumeric:'tabular-nums' }}>
                {Math.round(ct/100)/10}k
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Group section ─────────────────────────────────────────────────────────────
function GroupSection({ name, devices, onCommand }) {
  const [open, setOpen] = useState(true)
  if (!devices?.length) return null
  const onCount = devices.filter(d => {
    const sw = d.readings?.switch?.value
    return sw===1||sw==='on'||sw===true
  }).length

  return (
    <div style={{ marginBottom:2 }}>
      <button onClick={() => setOpen(o=>!o)} style={{
        display:'flex', alignItems:'center', gap:6, width:'100%',
        background:'none', border:'none', cursor:'pointer',
        padding:'8px 0 4px', color:'var(--text2)',
      }}>
        <span style={{ fontSize:13 }}>{GROUP_ICON[name]||'📱'}</span>
        <span style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text2)' }}>{name}</span>
        {onCount > 0 && (
          <span className="badge badge-yellow" style={{ fontSize:10, padding:'1px 6px' }}>{onCount} on</span>
        )}
        <span style={{ fontSize:11, color:'var(--text3)', marginLeft:'auto' }}>
          {devices.length} {open?'▾':'▸'}
        </span>
      </button>
      {open && devices.map(d => (
        <DeviceRow key={d.key} device={d} onCommand={onCommand} />
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function DeviceList({ devices }) {
  const onCommand = useCallback((key, sensor, value) => {
    sendCommand(key, sensor, value)
  }, [])

  const grouped = {}
  for (const d of devices) {
    const g = getGroup(d)
    ;(grouped[g] = grouped[g]||[]).push(d)
  }

  const liveCount = devices.filter(d => Object.values(d.readings||{}).some(v=>v?.value!=null)).length
  const onCount   = devices.filter(d => {
    const sw = d.readings?.switch?.value
    return sw===1||sw==='on'||sw===true
  }).length

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <div style={{ padding:'14px 20px 10px', borderBottom:'1px solid var(--sep)', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span style={{ fontSize:13, fontWeight:600, letterSpacing:'-0.2px' }}>Devices</span>
          <div style={{ display:'flex', gap:5 }}>
            {onCount > 0 && <span className="badge badge-yellow">{onCount} on</span>}
            <span className="badge badge-green">{liveCount} live</span>
            <span className="badge badge-gray">{devices.length} total</span>
          </div>
        </div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'4px 20px 16px' }}>
        {GROUP_ORDER.filter(g => grouped[g]).map(g => (
          <GroupSection key={g} name={g} devices={grouped[g]} onCommand={onCommand} />
        ))}
      </div>
    </div>
  )
}
