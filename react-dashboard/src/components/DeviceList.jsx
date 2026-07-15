import { useState, useCallback, useEffect } from 'react'
import {
  resolveIcon, CAT_ICON_COMPONENT, GridPowerIcon,
  SwitchOutletIcon, BulbIcon, ShutterIcon, ThermometerIcon,
  HumidityIcon, MotionIcon, DoorIcon, SecurityIcon, PlugIcon, SensorIcon, RelayIcon, MyIcon,
  BatteryIcon, SignalIcon, PowerIcon,
} from './Icons'
import DeviceModal from './DeviceModal'
import StatsView   from './StatsView'
import { gt }      from '../i18n'
import EnergyFlow from './EnergyFlow'
import RelayPanel from './RelayPanel'

const FIBARO_SENSOR_ICON = {
  switch:      SwitchOutletIcon,
  dimmer:      BulbIcon,
  shutter:     ShutterIcon,
  temperature: ThermometerIcon,
  humidity:    HumidityIcon,
  light:       BulbIcon,
  power:       PlugIcon,
  door:        DoorIcon,
  motion:      MotionIcon,
  security:    SecurityIcon,
  sensor:      SensorIcon,
}

const SATEL_SENSOR_ICON = {
  violation:  SecurityIcon,
  tamper:     SecurityIcon,
  armed:      SecurityIcon,
  alarm:      SecurityIcon,
  fire_alarm: SecurityIcon,
  output:     RelayIcon,
  input:      SensorIcon,
}

const SUPPLA_SENSOR_ICON = {
  switch:      SwitchOutletIcon,
  dimmer:      BulbIcon,
  shutter:     ShutterIcon,
  gate:        DoorIcon,
  lock:        DoorIcon,
  temperature: ThermometerIcon,
  humidity:    HumidityIcon,
  binary:      SensorIcon,
  power:       PlugIcon,
  energy:      PlugIcon,
}

const SMARTTHINGS_SENSOR_ICON = {
  switch:      SwitchOutletIcon,
  dimmer:      BulbIcon,
  shutter:     ShutterIcon,
  temperature: ThermometerIcon,
  humidity:    HumidityIcon,
  light:       BulbIcon,
  power:       PlugIcon,
  energy:      PlugIcon,
  motion:      MotionIcon,
  door:        DoorIcon,
  security:    SecurityIcon,
  sensor:      SensorIcon,
}

const LOXONE_SENSOR_ICON = {
  switch:      SwitchOutletIcon,
  dimmer:      BulbIcon,
  shutter:     ShutterIcon,
  gate:        DoorIcon,
  temperature: ThermometerIcon,
  security:    SecurityIcon,
  door:        DoorIcon,
  sensor:      SensorIcon,
}

const SHELLY_SENSOR_ICON = {
  switch:      SwitchOutletIcon,
  dimmer:      BulbIcon,
  power:       PlugIcon,
  temperature: ThermometerIcon,
  humidity:    HumidityIcon,
  light:       BulbIcon,
  door:        DoorIcon,
  motion:      MotionIcon,
  security:    SecurityIcon,
  sensor:      SensorIcon,
}

const ESPHOME_SENSOR_ICON = {
  switch:      SwitchOutletIcon,
  dimmer:      BulbIcon,
  shutter:     ShutterIcon,
  temperature: ThermometerIcon,
  humidity:    HumidityIcon,
  light:       BulbIcon,
  power:       PlugIcon,
  energy:      PlugIcon,
  motion:      MotionIcon,
  door:        DoorIcon,
  security:    SecurityIcon,
  sensor:      SensorIcon,
}

const KNX_SENSOR_ICON = {
  switch:      SwitchOutletIcon,
  dimmer:      BulbIcon,
  temperature: ThermometerIcon,
  humidity:    HumidityIcon,
  light:       BulbIcon,
  power:       PlugIcon,
  energy:      PlugIcon,
  motion:      MotionIcon,
  door:        DoorIcon,
  security:    SecurityIcon,
  sensor:      SensorIcon,
}

const ARDUINO_SENSOR_ICON = {
  switch:      SwitchOutletIcon,
  dimmer:      BulbIcon,
  temperature: ThermometerIcon,
  humidity:    HumidityIcon,
  light:       BulbIcon,
  power:       PlugIcon,
  energy:      PlugIcon,
  motion:      MotionIcon,
  door:        DoorIcon,
  security:    SecurityIcon,
  sensor:      SensorIcon,
}

// Auth via same-origin session cookie (see useLSH.js) — no hardcoded token.
const H = { 'Content-Type': 'application/json' }

// ── Toast ─────────────────────────────────────────────────────────────────────
let _setToast = null
export function Toast() {
  const [msg, setMsg] = useState(null)
  _setToast = setMsg
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(null), 1800)
    return () => clearTimeout(t)
  }, [msg])
  if (!msg) return null
  return (
    <div style={{
      position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)',
      background: msg.ok ? 'rgba(63,185,80,0.95)' : 'rgba(248,81,73,0.95)',
      color:'#fff', padding:'8px 20px', borderRadius:24,
      fontSize:13, fontWeight:600, backdropFilter:'blur(12px)',
      zIndex:9999, boxShadow:'0 4px 20px rgba(0,0,0,0.4)', pointerEvents:'none',
    }}>
      {msg.text}
    </div>
  )
}
function toast(ok, text) { _setToast?.({ ok, text }) }

async function sendCommand(key, sensor, value) {
  try {
    const res  = await fetch(`/api/device/${key}/command`, {
      method:'POST', credentials:'same-origin', headers:H, body:JSON.stringify({ sensor, value }),
    })
    const json = await res.json().catch(() => ({}))
    if (!json.success) throw new Error(json.error || `HTTP ${res.status}`)
    toast(true, `✓ ${sensor} → ${value}`)
    return true
  } catch(e) {
    console.error('sendCommand:', key, sensor, value, e)
    toast(false, `✗ ${e.message}`)
    return false
  }
}


// ── Categories ────────────────────────────────────────────────────────────────
function getGroup(d) {
  if (['vebus','battery','solarcharger'].includes(d.type)) return 'Victron'
  if (d.type === 'auxair') return 'Climate'
  if (d.type === 'smarttub') return 'Climate'
  if (d.type === 'sonos')  return 'Media'
  if (d.type === 'denon')  return 'Media'
  const r = d.readings || {}
  const k = Object.keys(r)
  if (k.includes('temperature') || k.includes('humidity')) return 'Climate'
  if (k.includes('motion') || k.includes('contact') || k.includes('presence')) return 'Security'
  if (r.switch?.value != null && (r.level?.value != null || r.hue?.value != null || r.colorTemperature?.value != null)) return 'Lighting'
  if (r.switch?.value != null) return 'Switches'
  if (k.includes('battery') && !k.includes('switch')) return 'Sensors'
  return 'Other'
}

const CATS = ['All','Victron','Lighting','Switches','Climate','Media','Security','Sensors','Other','Graphs']

// ── Toggle ────────────────────────────────────────────────────────────────────
function Toggle({ on, onChange }) {
  return (
    <div
      role="switch" aria-checked={on}
      onClick={e => { e.stopPropagation(); onChange(!on) }}
      style={{
        width:48, height:28, borderRadius:14,
        background: on ? 'var(--accent)' : 'rgba(255,255,255,0.12)',
        position:'relative', cursor:'pointer', flexShrink:0,
        transition:'background 0.2s',
        boxShadow: on ? '0 0 12px rgba(88,166,255,0.5)' : 'none',
        WebkitTapHighlightColor:'transparent',
        // Extend tap area without changing visual size
        padding:'8px',
        margin:'-8px',
        boxSizing:'content-box',
      }}>
      <div style={{
        position:'absolute', width:22, height:22, borderRadius:'50%',
        background:'#fff', top:3, left:3,
        boxShadow:'0 1px 4px rgba(0,0,0,0.5)',
        transition:'transform 0.2s cubic-bezier(0.4,0,0.2,1)',
        transform: on ? 'translateX(20px)' : 'none',
      }}/>
    </div>
  )
}

// ── Brightness slider ─────────────────────────────────────────────────────────
function Slider({ value, onCommit, color='var(--accent-lt)' }) {
  const [local, setLocal] = useState(value ?? 100)
  useEffect(() => { setLocal(value ?? 100) }, [value])
  return (
    <input type="range" min={1} max={100} value={local}
      onChange={e => setLocal(Number(e.target.value))}
      onMouseUp={e => onCommit(Number(e.target.value))}
      onTouchEnd={() => onCommit(local)}
      onClick={e => e.stopPropagation()}
      style={{
        width:'100%', height:4, appearance:'none', WebkitAppearance:'none',
        background:`linear-gradient(to right, ${color} ${local}%, rgba(255,255,255,0.1) ${local}%)`,
        borderRadius:2, outline:'none', cursor:'pointer',
        padding:'10px 0', margin:'-10px 0',
      }}
    />
  )
}

// ── CT slider ─────────────────────────────────────────────────────────────────
function CTSlider({ value, onCommit }) {
  const min=2700, max=6500
  const toPct = v => Math.round(((v||4000)-min)/(max-min)*100)
  const fromPct = p => Math.round(min+(p/100)*(max-min))
  const [local, setLocal] = useState(toPct(value))
  useEffect(() => { setLocal(toPct(value)) }, [value])
  return (
    <input type="range" min={0} max={100} value={local}
      onChange={e => setLocal(Number(e.target.value))}
      onMouseUp={e => onCommit(fromPct(Number(e.target.value)))}
      onTouchEnd={() => onCommit(fromPct(local))}
      onClick={e => e.stopPropagation()}
      style={{
        width:'100%', height:3, appearance:'none', WebkitAppearance:'none',
        background:'linear-gradient(to right, #ff9f3c, #fff, #b8d4ff)',
        borderRadius:2, outline:'none', cursor:'pointer',
      }}
    />
  )
}

// ── RGB color picker ──────────────────────────────────────────────────────────
function hslToHex(h, s, l = 50) {
  s /= 100; l /= 100
  const k = n => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const hex = x => Math.round(x * 255).toString(16).padStart(2, '0')
  return `#${hex(f(0))}${hex(f(4))}${hex(f(8))}`
}

// hueDeg: 0-360, sat: 0-100; onCommit(hueDeg, sat)
function ColorPicker({ hueDeg, sat, onCommit }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:4, marginBottom:3 }}>
      <span style={{ fontSize:10, color:'var(--text2)', flex:1 }}>RGB Color</span>
      <input type="color" value={hslToHex(hueDeg ?? 0, sat ?? 100)}
        onClick={e => e.stopPropagation()}
        onChange={e => {
          const v = e.target.value
          const r = parseInt(v.slice(1,3),16), g = parseInt(v.slice(3,5),16), b = parseInt(v.slice(5,7),16)
          const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min
          let h = 0
          if (d) {
            h = max === r ? (60*((g-b)/d)+360)%360
              : max === g ? (60*((b-r)/d)+120)%360
              : (60*((r-g)/d)+240)%360
          }
          const s = max === 0 ? 0 : (d/max)*100
          onCommit(Math.round(h), Math.round(s))
        }}
        style={{ width:32, height:32, border:'none', borderRadius:6, cursor:'pointer' }} />
    </div>
  )
}

// ── Device Tile ───────────────────────────────────────────────────────────────
function DeviceTile({ device, onCommand, onOpen }) {
  const [localState, setLocalState] = useState({})
  const r = device.readings || {}

  useEffect(() => {
    setLocalState({})
  }, [device.readings])

  const merged = { ...r }
  Object.entries(localState).forEach(([k,v]) => {
    merged[k] = { ...(merged[k]||{}), value: v }
  })

  const cmd = useCallback((sensor, value) => {
    setLocalState(s => ({ ...s, [sensor]: value }))
    onCommand(device.key, sensor, value)
  }, [device.key, onCommand])

  const isOn     = merged.switch?.value===1 || merged.switch?.value==='on' || merged.switch?.value===true
  const level    = merged.level?.value ?? 100
  const ct       = merged.colorTemperature?.value ?? 4000
  const hasSwitch= r.switch != null
  const hasLevel = r.level != null
  const hasMy    = (device.sensors || []).some(s => s.path === 'my') // Somfy "my" favourite
  const hasCT    = r.colorTemperature != null
  const hasTemp  = r.temperature != null
  const hasHum   = r.humidity != null
  const hasBatt  = r.battery != null
  const hasMot   = r.motion != null
  const hasPres  = r.presence != null
  const motActive  = merged.motion?.value===1||merged.motion?.value==='active'
  const presActive = merged.presence?.value===1||merged.presence?.value==='present'
  const IconComp = resolveIcon(device)

  const activeColor = hasMot||hasPres ? 'var(--orange)'
                    : hasTemp||hasHum  ? 'var(--teal)'
                    : !hasSwitch       ? 'var(--accent-lt)'
                    : 'var(--accent)'

  const isPool    = device.type === 'bayrol'
  const isFibaro  = device.type === 'fibaro'
  const isSatel   = device.type === 'satel'
  const isSupla   = device.type === 'suppla'
  const isArduino = device.type === 'arduino'
  const isKnx     = device.type === 'knx'
  const isEsphome = device.type === 'esphome'
  const isShelly  = device.type === 'shelly'
  const isLoxone       = device.type === 'loxone'
  const isSmartthings  = device.type === 'smartthings'
  const isTradfri      = device.type === 'tradfri'
  const isAC      = device.type === 'auxair'
  const isSonos  = device.type === 'sonos'
  const isDenon  = device.type === 'denon'
  const isSpa    = device.type === 'smarttub'

  const AC_MODES  = ['Cool','Heat','Dry','Fan','Auto']
  const FAN_NAMES = ['Auto','Low','Med','High','Turbo','Mute']
  // Mirrors HEAT_MODES order in src/smarttub-client.js — value is the index
  const SPA_MODES = ['Eco','Day','Auto','Ready','Rest']

  const denonPower      = isDenon ? (merged.power?.value  === 1 || merged.power?.value  === true) : false
  const denonVolume     = isDenon ? (merged.volume?.value ?? 50) : 50
  const denonMute       = isDenon ? (merged.mute?.value   === 1 || merged.mute?.value   === true) : false
  const denonInput      = isDenon ? (merged.input?.value  ?? '') : ''
  const denonInputIdx   = isDenon ? (merged.input_idx?.value ?? 0) : 0
  // inputNames lives on the sensor descriptor (spread into readings by getDeviceReadings)
  const denonInputNames = isDenon
    ? (r.input_idx?.inputNames ?? device.sensors?.find(s => s.path === 'input_idx')?.inputNames ?? [])
    : []

  const sonosPlaying = isSonos ? (merged.playing?.value === 1 || merged.playing?.value === true) : false
  const sonosVolume  = isSonos ? (merged.volume?.value  ?? 50) : 50
  const sonosMute    = isSonos ? (merged.mute?.value    === 1 || merged.mute?.value === true) : false
  const sonosTrack   = isSonos ? (merged.track?.value   ?? '') : ''
  const sonosArtist  = isSonos ? (merged.artist?.value  ?? '') : ''

  const spaWater   = isSpa ? (merged.water_temp?.value ?? r.water_temp?.value) : null
  const spaSetTemp = isSpa ? (merged.set_temp?.value   ?? r.set_temp?.value)   : null
  const spaMode    = isSpa ? (merged.heat_mode?.value  ?? r.heat_mode?.value ?? 2) : 2
  const spaHeater  = isSpa ? (merged.heater?.value === 1 || merged.heater?.value === true) : false
  const spaOnline  = isSpa ? ((merged.online?.value ?? r.online?.value ?? 1) === 1) : true
  // Pump/light toggle rows — path-keyed readings like the other platforms
  const spaSensors = isSpa ? (device.sensors || [])
    .filter(s => s.type === 'boolean' && s.controllable)
    .map(s => ({ ...s, value: (merged[s.path] ?? r[s.path])?.value })) : []

  const acPwr     = isAC ? (merged.pwr?.value ?? r.pwr?.value) : null
  const acOn      = acPwr === 1 || acPwr === true
  const acSetTemp = isAC ? (merged.temp?.value    ?? r.temp?.value)    : null
  const acEnvTemp = isAC ? (merged.envtemp?.value ?? r.envtemp?.value) : null
  const acMode    = isAC ? (merged.ac_mode?.value ?? r.ac_mode?.value ?? 0) : 0
  const acFan     = isAC ? (merged.ac_mark?.value ?? r.ac_mark?.value ?? 0) : 0

  // For SmartThings: extract sensor values from path-keyed readings
  const smartthingsSensors = isSmartthings ? (device.sensors || []).filter(s => !s.hidden).map(s => ({
    ...s,
    value: (merged[s.path] ?? r[s.path])?.value,
  })) : []

  // For Loxone: extract sensor values from path-keyed readings
  const loxoneSensors = isLoxone ? (device.sensors || []).map(s => ({
    ...s,
    value: (merged[s.path] ?? r[s.path])?.value,
  })) : []

  // For Shelly: extract sensor values from path-keyed readings
  const shellySensors = isShelly ? (device.sensors || []).map(s => ({
    ...s,
    value: (merged[s.path] ?? r[s.path])?.value,
  })) : []

  // For ESPHome: extract sensor values from domain/id-keyed readings
  const espSensors = isEsphome ? (device.sensors || []).map(s => ({
    ...s,
    value: (merged[s.path] ?? r[s.path])?.value,
  })) : []

  // For KNX: extract sensor values from group-address-keyed readings
  const knxSensors = isKnx ? (device.sensors || []).map(s => ({
    ...s,
    value: (merged[s.path] ?? r[s.path])?.value,
  })) : []

  // For Arduino: extract sensor values from path-keyed readings
  const arduinoSensors = isArduino ? (device.sensors || []).map(s => ({
    ...s,
    value: (merged[s.path] ?? r[s.path])?.value,
  })) : []

  // For Suppla: extract sensor values from path-keyed readings
  const suplaSensors = isSupla ? (device.sensors || []).map(s => ({
    ...s,
    value: (merged[s.path] ?? r[s.path])?.value,
  })) : []

  // For Satel: extract sensor values from path-keyed readings
  const satelSensors = isSatel ? (device.sensors || []).map(s => ({
    ...s,
    value: (merged[s.path] ?? r[s.path])?.value,
  })) : []

  // For TRADFRI: extract sensor values from path-keyed readings
  const tradfriSensors = isTradfri ? (device.sensors || []).map(s => ({
    ...s,
    value: (merged[s.path] ?? r[s.path])?.value,
  })) : []

  // System inputs (8, 9, 12, 13) have special display with icons
  const systemInputLabels = { 8: 'Battery', 9: 'AC Mains', 12: 'GSM', 13: 'Temperature' }
  const systemInputIcons = { 8: BatteryIcon, 9: PowerIcon, 12: SignalIcon, 13: ThermometerIcon }
  const satelSystemInputs = isSatel ? satelSensors.filter(s => {
    const inputNum = parseInt(s.path.split('/')[2])
    return systemInputLabels[inputNum]
  }).map(s => {
    const inputNum = parseInt(s.path.split('/')[2])
    return { ...s, inputNum, label: systemInputLabels[inputNum], icon: systemInputIcons[inputNum] }
  }) : []

  // For Fibaro rooms: extract sensor values from numeric-path readings
  const fibaroSensors = isFibaro ? (device.sensors || []).map(s => ({
    ...s,
    value: (merged[s.path] ?? r[s.path])?.value,
  })) : []
  const fibaroSwitches = fibaroSensors.filter(s => s.type === 'boolean' && s.controllable)
  const fibaroTemps    = fibaroSensors.filter(s => s.unit === '°C' && s.value != null)
  const fibaroOnCount  = fibaroSwitches.filter(s => s.value === true || s.value === 1).length

  const statusText = (() => {
    if (isDenon) {
      if (!denonPower) return 'Standby'
      const parts = []
      if (denonInput) parts.push(denonInput)
      if (denonMute)  parts.push('Muted')
      return parts.join(' · ') || 'On'
    }
    if (isSonos) {
      if (sonosTrack) return sonosPlaying ? sonosTrack : `⏸ ${sonosTrack}`
      return sonosPlaying ? 'Playing' : 'Stopped'
    }
    if (isAC) {
      if (!acOn) return 'Off'
      const parts = []
      if (acEnvTemp != null) parts.push(`${Number(acEnvTemp).toFixed(1)}°C room`)
      if (acSetTemp != null) parts.push(`→ ${Number(acSetTemp).toFixed(0)}°C`)
      parts.push(AC_MODES[acMode] || 'Cool')
      return parts.join(' · ')
    }
    if (isFibaro) {
      const parts = []
      if (fibaroSwitches.length) parts.push(`${fibaroOnCount}/${fibaroSwitches.length} on`)
      if (fibaroTemps.length)    parts.push(`${Number(fibaroTemps[0].value).toFixed(1)}°C`)
      return parts.join(' · ') || `${fibaroSensors.length} sensors`
    }
    if (isSpa) {
      if (!spaOnline) return 'Offline'
      const parts = []
      if (spaWater   != null) parts.push(`${Number(spaWater).toFixed(1)}°C`)
      if (spaSetTemp != null) parts.push(`→ ${Number(spaSetTemp).toFixed(1)}°C`)
      parts.push(spaHeater ? 'Heating' : (SPA_MODES[spaMode] || 'Auto'))
      return parts.join(' · ')
    }
    if (isPool) {
      const ph  = merged.ph?.value
      const orp = merged.orp?.value
      const parts = []
      if (ph  != null) parts.push(`pH ${Number(ph).toFixed(1)}`)
      if (orp != null) parts.push(`${orp} mV`)
      return parts.join(' · ') || '—'
    }
    if (hasTemp)  return `${merged.temperature?.value}°C${hasHum ? ` · ${merged.humidity?.value}%` : ''}`
    if (hasMot)   return motActive ? 'Motion' : 'Clear'
    if (hasPres)  return presActive ? 'Present' : 'Away'
    if (r['Pv/V']?.value != null) return `${Number(r['Pv/V'].value).toFixed(1)} V`
    if (r['Yield/Total']?.value != null) return `${Number(r['Yield/Total'].value).toFixed(0)} kWh`
    if (hasLevel && isOn) return `${level}%`
    return isOn ? 'On' : 'Off'
  })()

  const tileOn = (isOn && hasSwitch) || (isAC && acOn) || (isSonos && sonosPlaying) || (isDenon && denonPower) || (isSpa && spaHeater)

  return (
    <div onClick={() => onOpen?.(device.key)} className="device-tile" data-on={String(tileOn)} style={{
      padding: '12px',
      display: 'flex', flexDirection: 'column',
      minHeight: 118,
    }}>

      {/* Top glow bar when on */}
      {tileOn && (
        <div style={{
          position:'absolute', top:0, left:'15%', right:'15%', height:2,
          background:'linear-gradient(90deg, transparent, #79c0ff, transparent)',
          borderRadius:1,
        }}/>
      )}

      {/* Top row: icon left + control right */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <div style={{
          width:40, height:40, borderRadius:12, flexShrink:0,
          background: tileOn ? 'rgba(88,166,255,0.22)' : 'rgba(255,255,255,0.06)',
          display:'flex', alignItems:'center', justifyContent:'center',
          boxShadow: tileOn ? '0 0 16px rgba(88,166,255,0.3)' : 'none',
          transition:'all 0.2s',
        }}>
          <IconComp size={21} color={tileOn ? '#79c0ff' : activeColor} />
        </div>

        <div style={{ flexShrink:0 }}>
          {isDenon && (
            <Toggle on={denonPower} onChange={val => cmd('power', val ? 1 : 0)} />
          )}
          {isSonos && (
            <button onClick={e => { e.stopPropagation(); cmd('playing', sonosPlaying ? 0 : 1) }}
              style={{
                width:34, height:34, borderRadius:10, border:'none', cursor:'pointer',
                background: sonosPlaying ? 'rgba(88,166,255,0.25)' : 'rgba(255,255,255,0.08)',
                color: sonosPlaying ? '#79c0ff' : 'var(--text2)',
                fontSize:15, display:'flex', alignItems:'center', justifyContent:'center',
                boxShadow: sonosPlaying ? '0 0 12px rgba(88,166,255,0.3)' : 'none',
                WebkitTapHighlightColor:'transparent',
              }}>
              {sonosPlaying ? '⏸' : '▶'}
            </button>
          )}
          {isAC && (
            <Toggle on={acOn} onChange={val => cmd('pwr', val ? 1 : 0)} />
          )}
          {!isSonos && !isAC && hasSwitch && (
            <Toggle on={isOn} onChange={val => cmd('switch', val ? 1 : 0)} />
          )}
          {!isSonos && !isAC && !hasSwitch && (hasMot||hasPres) && (
            <span style={{
              width:9, height:9, borderRadius:'50%', display:'block', marginTop:3,
              background: (motActive||presActive) ? 'var(--orange)' : 'rgba(255,255,255,0.12)',
              boxShadow: (motActive||presActive) ? '0 0 8px var(--orange)' : 'none',
            }}/>
          )}
          {!isSonos && !isAC && !hasSwitch && hasBatt && (
            <span style={{ fontSize:11, fontWeight:700, marginTop:2, display:'block',
              color:(merged.battery?.value??100)<20?'var(--red)':(merged.battery?.value??100)<50?'var(--orange)':'var(--green)' }}>
              {merged.battery?.value}%
            </span>
          )}
        </div>
      </div>

      {/* Sliders when on */}
      {tileOn && (hasLevel || hasCT) && (
        <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:10 }}>
          {hasLevel && <Slider value={level} onCommit={v => cmd('level', v)} />}
          {hasCT    && <CTSlider value={ct}  onCommit={v => cmd('colorTemperature', v)} />}
        </div>
      )}

      {/* Somfy "My" favourite position */}
      {hasMy && (
        <button onClick={e => { e.stopPropagation(); cmd('my', 1) }}
          title="Move to favourite (My) position"
          style={{ marginTop:8, width:'100%', padding:'7px 10px', borderRadius:9,
            border:'1px solid var(--border)', background:'var(--surface2)', color:'var(--text2)',
            cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <MyIcon size={18} />
        </button>
      )}

      {/* AC controls: mode pills + temp */}
      {isAC && acOn && (
        <div style={{ marginTop:8, display:'flex', flexDirection:'column', gap:6 }}>
          {/* Mode pills */}
          <div style={{ display:'flex', gap:3, flexWrap:'wrap' }}>
            {AC_MODES.map((m, i) => (
              <button key={m} onClick={e => { e.stopPropagation(); cmd('ac_mode', i) }}
                style={{
                  fontSize:9, fontWeight:700, padding:'2px 6px', borderRadius:6, border:'none',
                  background: acMode === i ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
                  color: acMode === i ? '#fff' : 'var(--text2)', cursor:'pointer',
                }}>
                {m}
              </button>
            ))}
          </div>
          {/* Temp +/- */}
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <button onClick={e => { e.stopPropagation(); if (acSetTemp != null) cmd('temp', Math.max(16, acSetTemp - 1)) }}
              style={{ width:22, height:22, borderRadius:6, border:'none', background:'rgba(255,255,255,0.1)', color:'var(--text)', fontSize:14, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>−</button>
            <span style={{ fontSize:12, fontWeight:700, color:'#79c0ff', minWidth:36, textAlign:'center' }}>
              {acSetTemp != null ? `${Number(acSetTemp).toFixed(0)}°C` : '—'}
            </span>
            <button onClick={e => { e.stopPropagation(); if (acSetTemp != null) cmd('temp', Math.min(30, acSetTemp + 1)) }}
              style={{ width:22, height:22, borderRadius:6, border:'none', background:'rgba(255,255,255,0.1)', color:'var(--text)', fontSize:14, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>+</button>
            <span style={{ fontSize:10, color:'var(--text3)', marginLeft:4 }}>{FAN_NAMES[acFan] || 'auto'} fan</span>
          </div>
        </div>
      )}

      {/* SmartTub controls: heat mode pills + set temp */}
      {isSpa && spaOnline && (
        <div style={{ marginTop:8, display:'flex', flexDirection:'column', gap:6 }}>
          {/* Heat mode pills */}
          <div style={{ display:'flex', gap:3, flexWrap:'wrap' }}>
            {SPA_MODES.map((m, i) => (
              <button key={m} onClick={e => { e.stopPropagation(); cmd('heat_mode', i) }}
                style={{
                  fontSize:9, fontWeight:700, padding:'2px 6px', borderRadius:6, border:'none',
                  background: spaMode === i ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
                  color: spaMode === i ? '#fff' : 'var(--text2)', cursor:'pointer',
                }}>
                {m}
              </button>
            ))}
          </div>
          {/* Set temp +/- (spa range 15–40°C, 0.5° steps — see smarttub-client.js) */}
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <button onClick={e => { e.stopPropagation(); if (spaSetTemp != null) cmd('set_temp', Math.max(15, spaSetTemp - 0.5)) }}
              style={{ width:22, height:22, borderRadius:6, border:'none', background:'rgba(255,255,255,0.1)', color:'var(--text)', fontSize:14, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>−</button>
            <span style={{ fontSize:12, fontWeight:700, color:'#79c0ff', minWidth:42, textAlign:'center' }}>
              {spaSetTemp != null ? `${Number(spaSetTemp).toFixed(1)}°C` : '—'}
            </span>
            <button onClick={e => { e.stopPropagation(); if (spaSetTemp != null) cmd('set_temp', Math.min(40, spaSetTemp + 0.5)) }}
              style={{ width:22, height:22, borderRadius:6, border:'none', background:'rgba(255,255,255,0.1)', color:'var(--text)', fontSize:14, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>+</button>
            {spaHeater && <span style={{ fontSize:10, color:'var(--orange)', marginLeft:4 }}>heating</span>}
          </div>
        </div>
      )}

      {/* Denon controls */}
      {isDenon && denonPower && (
        <div style={{ marginTop:8, display:'flex', flexDirection:'column', gap:5 }}>
          {/* Input selection pills */}
          {denonInputNames.length > 0 && (
            <div style={{ display:'flex', gap:3, flexWrap:'wrap' }}>
              {denonInputNames.map((name, i) => (
                <button key={name} onClick={e => { e.stopPropagation(); cmd('input_idx', i) }}
                  style={{
                    fontSize:9, fontWeight:700, padding:'2px 6px', borderRadius:6, border:'none',
                    background: denonInputIdx === i ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
                    color: denonInputIdx === i ? '#fff' : 'var(--text2)', cursor:'pointer',
                    WebkitTapHighlightColor:'transparent',
                  }}>
                  {name}
                </button>
              ))}
            </div>
          )}
          {/* Volume slider + mute */}
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <button onClick={e => { e.stopPropagation(); cmd('mute', denonMute ? 0 : 1) }}
              style={{
                width:24, height:24, borderRadius:7, border:'none', cursor:'pointer', flexShrink:0,
                background: denonMute ? 'rgba(248,81,73,0.2)' : 'rgba(255,255,255,0.07)',
                color: denonMute ? '#f87171' : 'var(--text2)', fontSize:11,
                WebkitTapHighlightColor:'transparent',
              }}>
              {denonMute ? '🔇' : '🔊'}
            </button>
            <span style={{ fontSize:9, color:'var(--text3)', flexShrink:0, minWidth:22, textAlign:'right' }}>
              {Math.round(denonVolume)}
            </span>
            <Slider value={denonVolume} onCommit={v => cmd('volume', v)} color="var(--accent)" />
          </div>
        </div>
      )}

      {/* Sonos controls */}
      {isSonos && (
        <div style={{ marginTop:8, display:'flex', flexDirection:'column', gap:5 }}>
          {sonosArtist && (
            <div style={{ fontSize:9, color:'var(--text3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {sonosArtist}
            </div>
          )}
          {/* Prev / Next / Mute */}
          <div style={{ display:'flex', alignItems:'center', gap:4 }}>
            <button onClick={e => { e.stopPropagation(); cmd('prev', true) }}
              style={{ flex:1, height:24, borderRadius:7, border:'none', cursor:'pointer',
                background:'rgba(255,255,255,0.07)', color:'var(--text2)', fontSize:12,
                WebkitTapHighlightColor:'transparent' }}>⏮</button>
            <button onClick={e => { e.stopPropagation(); cmd('next', true) }}
              style={{ flex:1, height:24, borderRadius:7, border:'none', cursor:'pointer',
                background:'rgba(255,255,255,0.07)', color:'var(--text2)', fontSize:12,
                WebkitTapHighlightColor:'transparent' }}>⏭</button>
            <button onClick={e => { e.stopPropagation(); cmd('mute', sonosMute ? 0 : 1) }}
              style={{ width:28, height:24, borderRadius:7, border:'none', cursor:'pointer',
                background: sonosMute ? 'rgba(248,81,73,0.2)' : 'rgba(255,255,255,0.07)',
                color: sonosMute ? '#f87171' : 'var(--text2)', fontSize:12,
                WebkitTapHighlightColor:'transparent' }}>
              {sonosMute ? '🔇' : '🔊'}
            </button>
          </div>
          {/* Volume slider */}
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ fontSize:9, color:'var(--text3)', flexShrink:0, width:22, textAlign:'right' }}>{sonosVolume}%</span>
            <Slider value={sonosVolume} onCommit={v => cmd('volume', v)} color="var(--accent)" />
          </div>
        </div>
      )}

      {/* Bottom: name + status */}
      <div style={{ marginTop:'auto', paddingTop:10 }}>
        <div style={{
          fontSize:12, fontWeight:600, lineHeight:1.2,
          color: hasSwitch && !isOn ? 'var(--text3)' : 'var(--text)',
          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
        }}>
          {device.label}
        </div>
        <div style={{
          fontSize:11, marginTop:3, fontWeight:500,
          color: tileOn ? '#79c0ff'
               : (motActive||presActive) ? 'var(--orange)'
               : !hasSwitch ? activeColor
               : 'var(--text3)',
        }}>
          {statusText}
        </div>
        {isFibaro && fibaroSensors.length > 0 && (
          <div style={{ marginTop:6, display:'flex', flexDirection:'column', gap:3 }}>
            {fibaroSensors.slice(0,5).map(s => {
              const on  = s.value === true || s.value === 1
              const Icon = FIBARO_SENSOR_ICON[s.sensorType] || SensorIcon
              const isToggle = s.type === 'boolean' && s.controllable
              const isReadBool = s.type === 'boolean' && !s.controllable
              return (
                <div key={s.path} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:4 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:4, overflow:'hidden', flex:1 }}>
                    <Icon size={12} color={on ? '#79c0ff' : 'var(--text3)'} />
                    <span style={{ fontSize:10, color:'var(--text2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.name}</span>
                  </div>
                  {isToggle
                    ? <Toggle on={on} onChange={val => cmd(s.path, val ? 1 : 0)} />
                    : isReadBool
                      ? <span style={{ fontSize:10, color: on ? '#79c0ff' : 'var(--text3)', fontWeight:600 }}>{on ? 'Yes' : 'No'}</span>
                      : <span style={{ fontSize:10, color:'var(--text2)' }}>{s.value != null ? `${Number(s.value).toFixed(s.unit === '°C' ? 1 : 0)}${s.unit || ''}` : '—'}</span>
                  }
                </div>
              )
            })}
          </div>
        )}
        {isSmartthings && smartthingsSensors.length > 0 && (
          <div style={{ marginTop:6, display:'flex', flexDirection:'column', gap:3 }}>
            {/* Color picker for devices with color control (SmartThings hue is 0-100) */}
            {(() => {
              const hueSensor = smartthingsSensors.find(s => s.path === 'hue')
              const satSensor = smartthingsSensors.find(s => s.path === 'saturation')
              if (!hueSensor || !satSensor) return null
              return (
                <ColorPicker key="color-picker"
                  hueDeg={(hueSensor.value ?? 0) * 3.6}
                  sat={satSensor.value ?? 100}
                  onCommit={(h, s) => cmd('color', { hue: Math.round(h / 3.6), saturation: s })}
                />
              )
            })()}
            {smartthingsSensors.slice(0,5).map(s => {
              const on   = s.value === 1 || s.value === true
              const Icon = SMARTTHINGS_SENSOR_ICON[s.sensorType] || SensorIcon
              const isToggle = s.type === 'toggle'
              const isRange  = s.type === 'range'
              const isColor  = s.type === 'color'
              if (isColor) return null
              if (s.path === 'hue' || s.path === 'saturation') return null
              return (
                <div key={s.path} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:4 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:4, overflow:'hidden', flex:1 }}>
                    <Icon size={12} color={on || (isRange && s.value > 0) ? '#79c0ff' : 'var(--text3)'} />
                    <span style={{ fontSize:10, color:'var(--text2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.label || s.name}</span>
                  </div>
                  {isToggle
                    ? <Toggle on={on} onChange={val => cmd(s.path, val ? (s.writeOn||'on') : (s.writeOff||'off'))} />
                    : s.value != null
                      ? <span style={{ fontSize:10, color:'var(--text2)' }}>{`${typeof s.value === 'number' ? s.value.toFixed(s.unit === '°C' ? 1 : 0) : s.value}${s.unit || ''}`}</span>
                      : <span style={{ fontSize:10, color:'var(--text3)' }}>—</span>
                  }
                </div>
              )
            })}
          </div>
        )}
        {isTradfri && tradfriSensors.length > 0 && (
          <div style={{ marginTop:6, display:'flex', flexDirection:'column', gap:3 }}>
            {/* Color picker for TRADFRI RGB lights (hue is 0-360 degrees) */}
            {(() => {
              const hueSensor = tradfriSensors.find(s => s.path === 'hue')
              const satSensor = tradfriSensors.find(s => s.path === 'saturation')
              if (!hueSensor || !satSensor) return null
              return (
                <ColorPicker key="color-picker"
                  hueDeg={hueSensor.value ?? 0}
                  sat={satSensor.value ?? 100}
                  onCommit={(h, s) => cmd('color', { hue: h, saturation: s })}
                />
              )
            })()}
            {tradfriSensors.slice(0,5).map(s => {
              const on   = s.value === 1 || s.value === true
              const isToggle = s.type === 'toggle'
              const isRange  = s.type === 'range'
              if (s.path === 'hue' || s.path === 'saturation' || s.path === 'color') return null
              return (
                <div key={s.path} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:4 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:4, overflow:'hidden', flex:1 }}>
                    <span style={{ fontSize:12, color:'#79c0ff' }}>◆</span>
                    <span style={{ fontSize:10, color:'var(--text2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.name}</span>
                  </div>
                  {isToggle
                    ? <Toggle on={on} onChange={val => cmd(s.path, val ? (s.writeOn||1) : (s.writeOff||0))} />
                    : s.value != null
                      ? <span style={{ fontSize:10, color:'var(--text2)' }}>{`${typeof s.value === 'number' ? s.value.toFixed(s.unit === '°C' ? 1 : 0) : s.value}${s.unit || ''}`}</span>
                      : <span style={{ fontSize:10, color:'var(--text3)' }}>—</span>
                  }
                </div>
              )
            })}
          </div>
        )}
        {isLoxone && loxoneSensors.length > 0 && (
          <div style={{ marginTop:6, display:'flex', flexDirection:'column', gap:3 }}>
            {loxoneSensors.slice(0,5).map(s => {
              const on   = s.value === 1 || s.value === true
              const Icon = LOXONE_SENSOR_ICON[s.sensorType] || SensorIcon
              const isToggle = s.type === 'toggle'
              const isRange  = s.type === 'range'
              return (
                <div key={s.path} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:4 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:4, overflow:'hidden', flex:1 }}>
                    <Icon size={12} color={on || (isRange && s.value > 0) ? '#79c0ff' : 'var(--text3)'} />
                    <span style={{ fontSize:10, color:'var(--text2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.label}</span>
                  </div>
                  {isToggle
                    ? <Toggle on={on} onChange={val => cmd(s.path, val ? (s.writeOn||'on') : (s.writeOff||'off'))} />
                    : s.value != null
                      ? <span style={{ fontSize:10, color:'var(--text2)' }}>{`${typeof s.value === 'number' ? s.value.toFixed(s.unit === '°C' ? 1 : 0) : s.value}${s.unit || ''}`}</span>
                      : <span style={{ fontSize:10, color:'var(--text3)' }}>—</span>
                  }
                </div>
              )
            })}
          </div>
        )}
        {isShelly && shellySensors.length > 0 && (
          <div style={{ marginTop:6, display:'flex', flexDirection:'column', gap:3 }}>
            {shellySensors.slice(0,5).map(s => {
              const on   = s.value === 1 || s.value === true
              const Icon = SHELLY_SENSOR_ICON[s.sensorType] || SensorIcon
              const isToggle = s.type === 'toggle'
              const isRange  = s.type === 'range'
              return (
                <div key={s.path} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:4 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:4, overflow:'hidden', flex:1 }}>
                    <Icon size={12} color={on || (isRange && s.value > 0) ? '#79c0ff' : 'var(--text3)'} />
                    <span style={{ fontSize:10, color:'var(--text2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.label}</span>
                  </div>
                  {isToggle
                    ? <Toggle on={on} onChange={val => cmd(s.path, val ? 1 : 0)} />
                    : s.value != null
                      ? <span style={{ fontSize:10, color:'var(--text2)' }}>{`${typeof s.value === 'number' ? s.value.toFixed(s.unit === '°C' ? 1 : 0) : s.value}${s.unit || ''}`}</span>
                      : <span style={{ fontSize:10, color:'var(--text3)' }}>—</span>
                  }
                </div>
              )
            })}
          </div>
        )}
        {isEsphome && espSensors.length > 0 && (
          <div style={{ marginTop:6, display:'flex', flexDirection:'column', gap:3 }}>
            {espSensors.slice(0,5).map(s => {
              const on   = s.value === 1 || s.value === true
              const Icon = ESPHOME_SENSOR_ICON[s.sensorType] || SensorIcon
              const isToggle = s.controllable && s.type === 'boolean'
              return (
                <div key={s.path} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:4 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:4, overflow:'hidden', flex:1 }}>
                    <Icon size={12} color={on ? '#79c0ff' : 'var(--text3)'} />
                    <span style={{ fontSize:10, color:'var(--text2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.label || s.name}</span>
                  </div>
                  {isToggle
                    ? <Toggle on={on} onChange={val => cmd(s.path, val ? 1 : 0)} />
                    : s.value != null
                      ? <span style={{ fontSize:10, color:'var(--text2)' }}>{`${typeof s.value === 'number' ? s.value.toFixed(s.unit === '°C' ? 1 : 0) : s.value}${s.unit || ''}`}</span>
                      : <span style={{ fontSize:10, color:'var(--text3)' }}>—</span>
                  }
                </div>
              )
            })}
          </div>
        )}
        {isKnx && knxSensors.length > 0 && (
          <div style={{ marginTop:6, display:'flex', flexDirection:'column', gap:3 }}>
            {knxSensors.slice(0,5).map(s => {
              const on   = s.value === 1 || s.value === true
              const Icon = KNX_SENSOR_ICON[s.sensorType] || SensorIcon
              const isToggle = s.type === 'toggle'
              const isRange  = s.type === 'range'
              return (
                <div key={s.path} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:4 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:4, overflow:'hidden', flex:1 }}>
                    <Icon size={12} color={on || (isRange && s.value > 0) ? '#79c0ff' : 'var(--text3)'} />
                    <span style={{ fontSize:10, color:'var(--text2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.label}</span>
                  </div>
                  {isToggle
                    ? <Toggle on={on} onChange={val => cmd(s.path, val ? 1 : 0)} />
                    : s.value != null
                      ? <span style={{ fontSize:10, color:'var(--text2)' }}>{`${typeof s.value === 'number' ? s.value.toFixed(s.unit === '°C' ? 1 : 0) : s.value}${s.unit || ''}`}</span>
                      : <span style={{ fontSize:10, color:'var(--text3)' }}>—</span>
                  }
                </div>
              )
            })}
          </div>
        )}
        {isArduino && arduinoSensors.length > 0 && (
          <div style={{ marginTop:6, display:'flex', flexDirection:'column', gap:3 }}>
            {arduinoSensors.slice(0,5).map(s => {
              const on   = s.value === 1 || s.value === true
              const Icon = ARDUINO_SENSOR_ICON[s.sensorType] || SensorIcon
              const isToggle = s.type === 'toggle'
              const isRange  = s.type === 'range'
              return (
                <div key={s.path} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:4 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:4, overflow:'hidden', flex:1 }}>
                    <Icon size={12} color={on || (isRange && s.value > 0) ? '#79c0ff' : 'var(--text3)'} />
                    <span style={{ fontSize:10, color:'var(--text2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.label}</span>
                  </div>
                  {isToggle
                    ? <Toggle on={on} onChange={val => cmd(s.path, val ? 1 : 0)} />
                    : s.value != null
                      ? <span style={{ fontSize:10, color:'var(--text2)' }}>{`${typeof s.value === 'number' ? s.value.toFixed(s.unit === '°C' ? 1 : 0) : s.value}${s.unit || ''}`}</span>
                      : <span style={{ fontSize:10, color:'var(--text3)' }}>—</span>
                  }
                </div>
              )
            })}
          </div>
        )}
        {isSupla && suplaSensors.length > 0 && (
          <div style={{ marginTop:6, display:'flex', flexDirection:'column', gap:3 }}>
            {suplaSensors.slice(0,5).map(s => {
              const on   = s.value === 1 || s.value === true
              const Icon = SUPPLA_SENSOR_ICON[s.sensorType] || SensorIcon
              const isToggle = s.type === 'toggle'
              const isRange  = s.type === 'range'
              return (
                <div key={s.path} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:4 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:4, overflow:'hidden', flex:1 }}>
                    <Icon size={12} color={on || (isRange && s.value > 0) ? '#79c0ff' : 'var(--text3)'} />
                    <span style={{ fontSize:10, color:'var(--text2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.label}</span>
                  </div>
                  {isToggle
                    ? <Toggle on={on} onChange={val => cmd(s.path, val ? (s.writeOn||'on') : (s.writeOff||'off'))} />
                    : s.value != null
                      ? <span style={{ fontSize:10, color:'var(--text2)' }}>{`${typeof s.value === 'number' ? s.value.toFixed(s.unit === '°C' ? 1 : 0) : s.value}${s.unit || ''}`}</span>
                      : <span style={{ fontSize:10, color:'var(--text3)' }}>—</span>
                  }
                </div>
              )
            })}
          </div>
        )}
        {isSatel && satelSensors.length > 0 && (
          <div style={{ marginTop:6, display:'flex', flexDirection:'column', gap:3 }}>
            {satelSensors.map(s => {
              const on   = s.value === 1 || s.value === true
              const Icon = SATEL_SENSOR_ICON[s.sensorType] || SecurityIcon
              const iconColor = s.sensorType === 'fire_alarm' ? (on ? '#f0883e'            : 'var(--text3)')
                              : s.sensorType === 'alarm'     ? (on ? 'var(--red,#f85149)' : 'var(--text3)')
                              : s.sensorType === 'violation' ? (on ? 'var(--orange)'       : 'var(--text3)')
                              : on ? '#79c0ff' : 'var(--text3)'
              return (
                <div key={s.path} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:4 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:4, overflow:'hidden', flex:1 }}>
                    <Icon size={12} color={iconColor} />
                    <span style={{ fontSize:10, color:'var(--text2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.label}</span>
                  </div>
                  {s.controllable
                    ? <Toggle on={on} onChange={val => cmd(s.path, val ? (s.writeOn||'on') : (s.writeOff||'off'))} />
                    : <span style={{ fontSize:10, color: iconColor, fontWeight:600 }}>{on ? 'Yes' : 'No'}</span>
                  }
                </div>
              )
            })}
          </div>
        )}
        {satelSystemInputs.length > 0 && (
          <div style={{ marginTop:12, paddingTop:8, borderTop:'1px solid #21262d', display:'flex', flexDirection:'column', gap:3 }}>
            <div style={{ fontSize:9, fontWeight:600, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'0.5px' }}>System Inputs</div>
            {satelSystemInputs.map(s => {
              const ok = s.value === 1 || s.value === true
              const Icon = s.icon
              const statusColor = ok ? '#3fb950' : 'var(--red,#f85149)'
              const statusText = ok ? 'OK' : 'FAULT'
              return (
                <div key={s.path} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:4 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:4, overflow:'hidden', flex:1 }}>
                    <Icon size={12} color={statusColor} />
                    <span style={{ fontSize:10, color:'var(--text2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.label}</span>
                  </div>
                  <span style={{ fontSize:10, color: statusColor, fontWeight:700 }}>{statusText}</span>
                </div>
              )
            })}
          </div>
        )}
        {isSpa && spaSensors.length > 0 && (
          <div style={{ marginTop:6, display:'flex', flexDirection:'column', gap:3 }}>
            {spaSensors.slice(0,5).map(s => {
              const on   = s.value === 1 || s.value === true
              const Icon = s.path.startsWith('light_') ? BulbIcon : RelayIcon
              return (
                <div key={s.path} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:4 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:4, overflow:'hidden', flex:1 }}>
                    <Icon size={12} color={on ? '#79c0ff' : 'var(--text3)'} />
                    <span style={{ fontSize:10, color:'var(--text2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.name}</span>
                  </div>
                  <Toggle on={on} onChange={val => cmd(s.path, val ? 1 : 0)} />
                </div>
              )
            })}
          </div>
        )}
        {isPool && (() => {
          const temp = merged.temperature?.value
          const salt = merged.salt?.value
          const parts = []
          if (temp != null) parts.push(`${Number(temp).toFixed(1)}°C`)
          if (salt != null) parts.push(`${Number(salt).toFixed(1)} g/L`)
          return parts.length > 0 ? (
            <div style={{ fontSize:10, marginTop:2, color:'var(--text3)', fontWeight:500 }}>
              {parts.join(' · ')}
            </div>
          ) : null
        })()}
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function DeviceList({ devices, energy, onToggleRelay }) {
  const [openKey, setOpenKey] = useState(() => new URLSearchParams(window.location.search).get('device'))
  const openDevice = openKey ? devices.find(d => d.key === openKey) : null
  const [cat, setCat] = useState(() => {
    const c = new URLSearchParams(window.location.search).get('cat')
    return CATS.includes(c) ? c : 'All'
  })
  const [originFilter, setOriginFilter] = useState(() => {
    const saved = localStorage.getItem('originFilter')
    return saved ? new Set(JSON.parse(saved)) : new Set()
  })
  const [energyHidden, setEnergyHidden] = useState(() => localStorage.getItem('hideEnergy') === '1')
  const toggleEnergy = () => {
    const next = !energyHidden
    localStorage.setItem('hideEnergy', next ? '1' : '0')
    setEnergyHidden(next)
  }

  const onCommand = useCallback((key, sensor, value) => {
    sendCommand(key, sensor, value)
  }, [])

  // Count devices by origin
  const originCounts = {}
  for (const d of devices) {
    const o = d.type || 'unknown'
    originCounts[o] = (originCounts[o] || 0) + 1
  }
  const allOrigins = ['All', ...Object.keys(originCounts).sort()]

  const toggleOriginFilter = (origin) => {
    const newFilter = new Set(originFilter)
    if (origin === 'All') {
      newFilter.clear()
    } else {
      if (newFilter.has(origin)) {
        newFilter.delete(origin)
      } else {
        newFilter.add(origin)
      }
    }
    setOriginFilter(newFilter)
    localStorage.setItem('originFilter', JSON.stringify(Array.from(newFilter)))
  }

  const visible = (cat === 'All' ? devices : devices.filter(d => getGroup(d) === cat))
    .filter(d => !originFilter.has(d.type || 'unknown'))
  const onCount = devices.filter(d => { const sw=d.readings?.switch?.value; return sw===1||sw==='on'||sw===true }).length
  const liveCount = devices.filter(d => Object.values(d.readings||{}).some(v=>v?.value!=null)).length

  // Counts per category
  const counts = {}
  for (const d of devices) {
    const g = getGroup(d); counts[g] = (counts[g]||0)+1
  }

  return (
    <div style={{ display:'flex', height:'100%', overflow:'hidden' }}>

      {/* ── Sidebar ── */}
      <div className="device-sidebar" style={{
        width: 180, flexShrink:0,
        background: 'var(--sidebar)',
        borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection:'column',
        padding: '16px 10px',
        overflowY: 'auto',
        gap: 2,
      }}>
        <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em',
          color:'var(--text3)', padding:'0 6px', marginBottom:8 }}>
          Rooms & Categories
        </div>

        {CATS.filter(c => c==='All' || c==='Graphs' || counts[c]).map(c => {
          const cnt    = c==='All' ? devices.length : c==='Graphs' ? '📊' : (counts[c]||0)
          const active = cat === c
          const CatIcon = CAT_ICON_COMPONENT[c]
          return (
            <button key={c} onClick={() => setCat(c)} className="side-btn" data-active={String(active)}>
              <CatIcon size={16} color={active ? 'var(--accent-lt)' : 'var(--text3)'} />
              <span style={{ flex:1 }}>{c === 'Graphs' ? gt('tab', 'Graphs') : c}</span>
              <span style={{
                fontSize:10, fontWeight:600, padding:'1px 6px', borderRadius:8,
                background: active ? 'rgba(88,166,255,0.3)' : 'rgba(255,255,255,0.06)',
                color: active ? 'var(--accent-lt)' : 'var(--text3)',
              }}>{cnt}</span>
            </button>
          )
        })}

        {/* Origin Filter */}
        <div style={{ marginTop:16, paddingTop:12, borderTop:'1px solid var(--sep)' }}>
          <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em',
            color:'var(--text3)', padding:'0 6px', marginBottom:8 }}>
            Origin / Platform
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
            {allOrigins.map(o => {
              const cnt = o === 'All' ? devices.length : originCounts[o] || 0
              const hidden = o !== 'All' && originFilter.has(o)
              return (
                <button key={o} onClick={() => toggleOriginFilter(o)} className="side-btn" style={{
                  padding:'6px 10px', fontSize:12,
                  textTransform:'capitalize',
                  ...(hidden ? { background:'rgba(248,81,73,0.1)', color:'var(--text3)', opacity:0.6 } : {}),
                }}>
                  <div style={{
                    width:16, height:16, borderRadius:4, border:'1.5px solid var(--border)',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    background: hidden ? 'transparent' : 'transparent',
                    flexShrink:0,
                  }}>
                    {!hidden && o !== 'All' ? (
                      <div style={{ width:8, height:8, background:'var(--accent)', borderRadius:2 }}/>
                    ) : o === 'All' && originFilter.size === 0 ? (
                      <div style={{ width:8, height:8, background:'var(--accent)', borderRadius:2 }}/>
                    ) : null}
                  </div>
                  <span style={{ flex:1 }}>{o}</span>
                  <span style={{
                    fontSize:10, fontWeight:600, padding:'1px 5px', borderRadius:6,
                    background: 'rgba(255,255,255,0.06)',
                    color: 'var(--text3)',
                    minWidth: '24px', textAlign: 'center'
                  }}>{cnt}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Stats footer */}
        <div style={{ marginTop:'auto', padding:'12px 6px 0', borderTop:'1px solid var(--sep)' }}>
          <div style={{ fontSize:11, color:'var(--text3)', marginBottom:6 }}>Status</div>
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:11 }}>
              <span style={{ color:'var(--text3)' }}>Devices on</span>
              <span style={{ color:'var(--yellow)', fontWeight:600 }}>{onCount}</span>
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:11 }}>
              <span style={{ color:'var(--text3)' }}>Live</span>
              <span style={{ color:'var(--green)', fontWeight:600 }}>{liveCount}</span>
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:11 }}>
              <span style={{ color:'var(--text3)' }}>Total</span>
              <span style={{ color:'var(--text2)', fontWeight:600 }}>{devices.length}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Tile Grid ── */}
      <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column' }}>

        {/* Mobile category pills (hidden on desktop via CSS) */}
        <div className="mobile-cat-pills" style={{
          display:'none',
          overflowX:'auto', flexShrink:0,
          padding:'10px 12px',
          gap:8,
          borderBottom:'1px solid var(--border)',
          scrollbarWidth:'none',
          WebkitOverflowScrolling:'touch',
        }}>
          {CATS.filter(c => c==='All' || c==='Graphs' || counts[c]).map(c => {
            const active = cat === c
            const CatIcon = CAT_ICON_COMPONENT[c]
            return (
              <button key={c} onClick={() => setCat(c)} className="cat-pill" data-active={String(active)}>
                <CatIcon size={13} color={active ? '#fff' : 'var(--text3)'} />
                {c}
                {active && counts[c] && (
                  <span style={{ fontSize:10, fontWeight:700, background:'rgba(255,255,255,0.2)', borderRadius:8, padding:'1px 5px' }}>
                    {c === 'All' ? devices.length : counts[c]}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Desktop header row (hidden on mobile via CSS) */}
        <div className="desktop-grid-header" style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 16px 10px', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            {(() => { const I = CAT_ICON_COMPONENT[cat]; return <I size={18} color="var(--accent-lt)"/>})()}
            <span style={{ fontSize:15, fontWeight:700 }}>{cat === 'Graphs' ? gt('tab', 'Graphs') : cat}</span>
          </div>
          <div style={{ display:'flex', gap:6 }}>
            {onCount>0 && <span className="badge badge-yellow">{onCount} on</span>}
            <span className="badge badge-green">{liveCount} live</span>
            <span className="badge badge-gray">{visible.length} shown</span>
          </div>
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:'0 12px 16px' }}>
          {cat === 'Graphs' && (
            <StatsView devices={devices} energy={energy} onOpen={setOpenKey} />
          )}
          {/* Energy as the top section of the overview */}
          {cat !== 'Graphs' && cat === 'All' && energy && (
            <div className="card" style={{
              margin:'8px 0 12px',
              borderRadius:'var(--radius-lg)', overflow:'hidden',
            }}>
              <div
                onClick={toggleEnergy}
                title={energyHidden ? 'Show energy module' : 'Hide energy module'}
                style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', userSelect:'none',
                         padding: energyHidden ? '12px 14px' : '12px 14px 8px' }}
              >
                <GridPowerIcon size={15} color="var(--orange)" />
                <span style={{ fontSize:13, fontWeight:700 }}>Energy</span>
                <span style={{
                  marginLeft:'auto', color:'var(--text3)', fontSize:11,
                  display:'inline-flex', alignItems:'center', gap:6,
                }}>
                  {energyHidden && <span>hidden</span>}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    style={{ transform: energyHidden ? 'rotate(-90deg)' : 'none', transition:'transform 0.2s ease' }}>
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </span>
              </div>
              {!energyHidden && (
                <div style={{ padding:'0 12px 12px' }}>
                  <EnergyFlow energy={energy} />
                  {energy.relays && (
                    <div style={{ marginTop:12, background:'rgba(0,0,0,0.25)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)' }}>
                      <RelayPanel relays={energy.relays} onToggle={onToggleRelay} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {cat !== 'Graphs' && visible.length === 0 && (
            <div style={{ color:'var(--text3)', fontSize:13, padding:'20px 0', textAlign:'center' }}>
              No devices in this category
            </div>
          )}
          {cat !== 'Graphs' && <div className="device-grid" style={{
            display:'grid',
            gridTemplateColumns:'repeat(auto-fill, minmax(150px, 1fr))',
            gap:10,
            paddingTop:8,
          }}>
            {visible.map(d => (
              <DeviceTile key={d.key} device={d} onCommand={onCommand} onOpen={setOpenKey} />
            ))}
          </div>}
        </div>
      </div>
      <DeviceModal device={openDevice} onClose={() => setOpenKey(null)} onCommand={onCommand} />
    </div>
  )
}
