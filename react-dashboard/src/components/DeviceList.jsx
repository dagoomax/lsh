import { useState, useCallback, useEffect } from 'react'
import { resolveIcon, CAT_ICON_COMPONENT } from './Icons'

const TOKEN = 'e95b1a01b85f38a831d8a8b8d949e5e783bf32d3f52ff5d1d6a46ab25b28385e'
const H     = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }

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
      background: msg.ok ? 'rgba(34,197,94,0.95)' : 'rgba(239,68,68,0.95)',
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
      method:'POST', headers:H, body:JSON.stringify({ sensor, value }),
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
  const r = d.readings || {}
  const k = Object.keys(r)
  if (k.includes('temperature') || k.includes('humidity')) return 'Climate'
  if (k.includes('motion') || k.includes('contact') || k.includes('presence')) return 'Security'
  if (r.switch?.value != null && (r.level?.value != null || r.hue?.value != null || r.colorTemperature?.value != null)) return 'Lighting'
  if (r.switch?.value != null) return 'Switches'
  if (k.includes('battery') && !k.includes('switch')) return 'Sensors'
  return 'Other'
}

const CATS = ['All','Victron','Lighting','Switches','Climate','Security','Sensors','Other']

// ── Toggle ────────────────────────────────────────────────────────────────────
function Toggle({ on, onChange }) {
  return (
    <div
      role="switch" aria-checked={on}
      onClick={e => { e.stopPropagation(); onChange(!on) }}
      style={{
        width:42, height:24, borderRadius:12,
        background: on ? 'var(--purple)' : 'rgba(255,255,255,0.12)',
        position:'relative', cursor:'pointer', flexShrink:0,
        transition:'background 0.2s',
        boxShadow: on ? '0 0 10px rgba(124,58,237,0.5)' : 'none',
        WebkitTapHighlightColor:'transparent',
      }}>
      <div style={{
        position:'absolute', width:18, height:18, borderRadius:'50%',
        background:'#fff', top:3, left:3,
        boxShadow:'0 1px 4px rgba(0,0,0,0.5)',
        transition:'transform 0.2s cubic-bezier(0.4,0,0.2,1)',
        transform: on ? 'translateX(18px)' : 'none',
      }}/>
    </div>
  )
}

// ── Brightness slider ─────────────────────────────────────────────────────────
function Slider({ value, onCommit, color='var(--purple-lt)' }) {
  const [local, setLocal] = useState(value ?? 100)
  useEffect(() => { setLocal(value ?? 100) }, [value])
  return (
    <input type="range" min={1} max={100} value={local}
      onChange={e => setLocal(Number(e.target.value))}
      onMouseUp={e => onCommit(Number(e.target.value))}
      onTouchEnd={() => onCommit(local)}
      onClick={e => e.stopPropagation()}
      style={{
        width:'100%', height:3, appearance:'none', WebkitAppearance:'none',
        background:`linear-gradient(to right, ${color} ${local}%, rgba(255,255,255,0.1) ${local}%)`,
        borderRadius:2, outline:'none', cursor:'pointer',
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

// ── Device Tile ───────────────────────────────────────────────────────────────
function DeviceTile({ device, onCommand }) {
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

  const isOn     = merged.switch?.value===1 || merged.switch?.value==='on' || merged.switch?.value===true
  const level    = merged.level?.value ?? 100
  const ct       = merged.colorTemperature?.value ?? 4000
  const hasSwitch= r.switch != null
  const hasLevel = r.level != null
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
                    : !hasSwitch       ? 'var(--purple-lt)'
                    : 'var(--purple)'

  return (
    <div style={{
      background: isOn && hasSwitch
        ? 'linear-gradient(145deg, #1a1035, #261550)'
        : 'var(--card)',
      border: `1px solid ${isOn && hasSwitch ? 'rgba(124,58,237,0.35)' : 'var(--border)'}`,
      borderRadius: 'var(--radius-lg)',
      padding: '16px 14px 14px',
      display: 'flex', flexDirection: 'column', gap: 10,
      boxShadow: isOn && hasSwitch ? '0 4px 24px rgba(124,58,237,0.2)' : '0 2px 8px rgba(0,0,0,0.2)',
      transition: 'all 0.2s ease',
      animation: 'fadeIn 0.2s ease',
      minHeight: 140,
    }}>

      {/* Icon + status dot */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <div style={{
          width:44, height:44, borderRadius:12, flexShrink:0,
          background: isOn && hasSwitch ? 'rgba(124,58,237,0.2)' : 'rgba(255,255,255,0.05)',
          display:'flex', alignItems:'center', justifyContent:'center',
          boxShadow: isOn && hasSwitch ? '0 0 16px rgba(124,58,237,0.3)' : 'none',
        }}>
          <IconComp size={22} color={isOn && hasSwitch ? 'var(--purple-lt)' : activeColor} />
        </div>

        {/* Status indicator */}
        {hasSwitch && (
          <Toggle on={isOn} onChange={val => cmd('switch', val ? 1 : 0)} />
        )}
        {!hasSwitch && (hasMot||hasPres) && (
          <span style={{
            width:8, height:8, borderRadius:'50%', display:'block', flexShrink:0,
            background: (motActive||presActive) ? 'var(--orange)' : 'var(--text3)',
            boxShadow: (motActive||presActive) ? '0 0 8px var(--orange)' : 'none',
            marginTop:4,
          }}/>
        )}
        {!hasSwitch && hasBatt && (
          <span style={{ fontSize:11, fontWeight:700,
            color:(merged.battery?.value??100)<20?'var(--red)':(merged.battery?.value??100)<50?'var(--orange)':'var(--green)' }}>
            {merged.battery?.value}%
          </span>
        )}
      </div>

      {/* Name */}
      <div>
        <div style={{
          fontSize:13, fontWeight:600, lineHeight:1.2,
          color: hasSwitch && !isOn ? 'var(--text3)' : 'var(--text)',
          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
        }}>
          {device.label}
        </div>
        <div style={{ fontSize:11, color:'var(--text3)', marginTop:2, display:'flex', gap:5, flexWrap:'wrap' }}>
          {hasTemp && <span style={{ color:'var(--orange)' }}>{merged.temperature?.value}°C</span>}
          {hasHum  && <span style={{ color:'var(--teal)' }}>{merged.humidity?.value}%</span>}
          {hasMot  && <span style={{ color:motActive?'var(--orange)':'var(--text3)' }}>{motActive?'Motion':'Clear'}</span>}
          {hasPres && !hasMot && <span style={{ color:presActive?'var(--blue)':'var(--text3)' }}>{presActive?'Present':'Away'}</span>}
          {hasSwitch && !hasLevel && <span style={{ color:isOn?activeColor:'var(--text3)' }}>{isOn?'On':'Off'}</span>}
          {hasLevel && isOn && <span style={{ color:'var(--purple-lt)' }}>{level}%</span>}
          {hasCT && isOn && <span style={{ color:'var(--text3)' }}>{Math.round(ct/100)/10}k</span>}
          {r['Pv/V']?.value!=null && <span>{Number(r['Pv/V'].value).toFixed(1)}V</span>}
          {r['Yield/Total']?.value!=null && <span>{Number(r['Yield/Total'].value).toFixed(0)} kWh</span>}
          {r.tvocLevel?.value!=null && <span>TVOC {Number(r.tvocLevel.value).toFixed(3)}</span>}
        </div>
      </div>

      {/* Sliders (only when on) */}
      {hasSwitch && isOn && (hasLevel || hasCT) && (
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          {hasLevel && <Slider value={level} onCommit={v => cmd('level', v)} />}
          {hasCT    && <CTSlider value={ct}  onCommit={v => cmd('colorTemperature', v)} />}
        </div>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function DeviceList({ devices }) {
  const [cat, setCat] = useState('All')

  const onCommand = useCallback((key, sensor, value) => {
    sendCommand(key, sensor, value)
  }, [])

  const visible = cat === 'All' ? devices : devices.filter(d => getGroup(d) === cat)
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

        {CATS.filter(c => c==='All' || counts[c]).map(c => {
          const cnt    = c==='All' ? devices.length : (counts[c]||0)
          const active = cat === c
          const CatIcon = CAT_ICON_COMPONENT[c]
          return (
            <button key={c} onClick={() => setCat(c)} style={{
              display:'flex', alignItems:'center', gap:8,
              padding:'8px 10px', borderRadius:10, border:'none', cursor:'pointer',
              background: active ? 'rgba(124,58,237,0.2)' : 'transparent',
              color: active ? 'var(--purple-lt)' : 'var(--text2)',
              fontSize:13, fontWeight: active?600:400,
              textAlign:'left', width:'100%',
              transition:'all 0.15s',
            }}>
              <CatIcon size={16} color={active ? 'var(--purple-lt)' : 'var(--text3)'} />
              <span style={{ flex:1 }}>{c}</span>
              <span style={{
                fontSize:10, fontWeight:600, padding:'1px 6px', borderRadius:8,
                background: active ? 'rgba(124,58,237,0.3)' : 'rgba(255,255,255,0.06)',
                color: active ? 'var(--purple-lt)' : 'var(--text3)',
              }}>{cnt}</span>
            </button>
          )
        })}

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
      <div style={{ flex:1, overflowY:'auto', padding:16 }}>
        {/* Header row */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            {(() => { const I = CAT_ICON_COMPONENT[cat]; return <I size={18} color="var(--purple-lt)"/>})()}
            <span style={{ fontSize:15, fontWeight:700 }}>{cat}</span>
          </div>
          <div style={{ display:'flex', gap:6 }}>
            {onCount>0 && <span className="badge badge-yellow">{onCount} on</span>}
            <span className="badge badge-green">{liveCount} live</span>
            <span className="badge badge-gray">{visible.length} shown</span>
          </div>
        </div>

        {visible.length === 0 && (
          <div style={{ color:'var(--text3)', fontSize:13, padding:'20px 0', textAlign:'center' }}>
            No devices in this category
          </div>
        )}

        <div className="device-grid" style={{
          display:'grid',
          gridTemplateColumns:'repeat(auto-fill, minmax(150px, 1fr))',
          gap:10,
        }}>
          {visible.map(d => (
            <DeviceTile key={d.key} device={d} onCommand={onCommand} />
          ))}
        </div>
      </div>
    </div>
  )
}
