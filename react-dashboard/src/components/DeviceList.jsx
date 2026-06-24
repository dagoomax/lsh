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
        width:48, height:28, borderRadius:14,
        background: on ? 'var(--purple)' : 'rgba(255,255,255,0.12)',
        position:'relative', cursor:'pointer', flexShrink:0,
        transition:'background 0.2s',
        boxShadow: on ? '0 0 12px rgba(124,58,237,0.5)' : 'none',
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

  const statusText = (() => {
    if (hasTemp)  return `${merged.temperature?.value}°C${hasHum ? ` · ${merged.humidity?.value}%` : ''}`
    if (hasMot)   return motActive ? 'Motion' : 'Clear'
    if (hasPres)  return presActive ? 'Present' : 'Away'
    if (r['Pv/V']?.value != null) return `${Number(r['Pv/V'].value).toFixed(1)} V`
    if (r['Yield/Total']?.value != null) return `${Number(r['Yield/Total'].value).toFixed(0)} kWh`
    if (hasLevel && isOn) return `${level}%`
    return isOn ? 'On' : 'Off'
  })()

  return (
    <div style={{
      background: isOn && hasSwitch
        ? 'linear-gradient(160deg, #1c1040 0%, #2a1858 100%)'
        : '#16172a',
      border: `1px solid ${isOn && hasSwitch ? 'rgba(167,139,250,0.28)' : 'rgba(255,255,255,0.06)'}`,
      borderRadius: 20,
      padding: '16px 12px 14px',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 8,
      minHeight: 158,
      boxShadow: isOn && hasSwitch
        ? '0 6px 28px rgba(124,58,237,0.22), inset 0 1px 0 rgba(167,139,250,0.08)'
        : '0 2px 8px rgba(0,0,0,0.25)',
      transition: 'all 0.22s ease',
      animation: 'fadeIn 0.2s ease',
      position: 'relative',
      overflow: 'hidden',
    }}>

      {/* Top glow bar when on */}
      {isOn && hasSwitch && (
        <div style={{
          position:'absolute', top:0, left:'20%', right:'20%', height:2,
          background:'linear-gradient(90deg, transparent, #a78bfa, transparent)',
          borderRadius:1,
        }}/>
      )}

      {/* Icon */}
      <div style={{
        width:54, height:54, borderRadius:16, flexShrink:0,
        background: isOn && hasSwitch ? 'rgba(124,58,237,0.22)' : 'rgba(255,255,255,0.05)',
        display:'flex', alignItems:'center', justifyContent:'center',
        boxShadow: isOn && hasSwitch ? '0 0 20px rgba(124,58,237,0.35)' : 'none',
        transition:'all 0.22s',
      }}>
        <IconComp size={26} color={isOn && hasSwitch ? '#a78bfa' : activeColor} />
      </div>

      {/* Name */}
      <div style={{
        fontSize:13, fontWeight:600, lineHeight:1.2, textAlign:'center',
        color: hasSwitch && !isOn ? '#475569' : '#f1f5f9',
        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
        maxWidth:'100%',
      }}>
        {device.label}
      </div>

      {/* Status */}
      <div style={{
        fontSize:11, fontWeight:500, textAlign:'center',
        color: isOn && hasSwitch ? '#a78bfa'
             : (motActive||presActive) ? 'var(--orange)'
             : '#475569',
      }}>
        {statusText}
      </div>

      {/* Sliders */}
      {hasSwitch && isOn && (hasLevel || hasCT) && (
        <div style={{ width:'100%', display:'flex', flexDirection:'column', gap:8, marginTop:2 }}>
          {hasLevel && <Slider value={level} onCommit={v => cmd('level', v)} />}
          {hasCT    && <CTSlider value={ct}  onCommit={v => cmd('colorTemperature', v)} />}
        </div>
      )}

      {/* Toggle / battery / motion dot — pinned to bottom-right */}
      <div style={{ marginTop:'auto', alignSelf:'flex-end' }}>
        {hasSwitch && (
          <Toggle on={isOn} onChange={val => cmd('switch', val ? 1 : 0)} />
        )}
        {!hasSwitch && (hasMot||hasPres) && (
          <span style={{
            width:10, height:10, borderRadius:'50%', display:'block',
            background: (motActive||presActive) ? 'var(--orange)' : '#334155',
            boxShadow: (motActive||presActive) ? '0 0 8px var(--orange)' : 'none',
          }}/>
        )}
        {!hasSwitch && hasBatt && (
          <span style={{ fontSize:12, fontWeight:700,
            color:(merged.battery?.value??100)<20?'var(--red)':(merged.battery?.value??100)<50?'var(--orange)':'var(--green)' }}>
            🔋{merged.battery?.value}%
          </span>
        )}
      </div>
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
          {CATS.filter(c => c==='All' || counts[c]).map(c => {
            const active = cat === c
            const CatIcon = CAT_ICON_COMPONENT[c]
            return (
              <button key={c} onClick={() => setCat(c)} style={{
                display:'inline-flex', alignItems:'center', gap:5,
                padding:'7px 13px', borderRadius:20, border:'none', cursor:'pointer',
                flexShrink:0,
                background: active ? 'var(--purple)' : 'rgba(255,255,255,0.07)',
                color: active ? '#fff' : 'var(--text2)',
                fontSize:13, fontWeight:active?600:400,
                boxShadow: active ? '0 2px 12px rgba(124,58,237,0.4)' : 'none',
                transition:'all 0.15s',
                WebkitTapHighlightColor:'transparent',
              }}>
                <CatIcon size={14} color={active ? '#fff' : 'var(--text3)'} />
                {c}
              </button>
            )
          })}
        </div>

        {/* Desktop header row (hidden on mobile via CSS) */}
        <div className="desktop-grid-header" style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 16px 10px', flexShrink:0 }}>
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

        <div style={{ flex:1, overflowY:'auto', padding:'0 12px 16px' }}>
          {visible.length === 0 && (
            <div style={{ color:'var(--text3)', fontSize:13, padding:'20px 0', textAlign:'center' }}>
              No devices in this category
            </div>
          )}
          <div className="device-grid" style={{
            display:'grid',
            gridTemplateColumns:'repeat(auto-fill, minmax(150px, 1fr))',
            gap:10,
            paddingTop:8,
          }}>
            {visible.map(d => (
              <DeviceTile key={d.key} device={d} onCommand={onCommand} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
