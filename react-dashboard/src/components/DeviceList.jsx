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

  const tileOn = isOn && hasSwitch

  return (
    <div style={{
      background: tileOn
        ? 'linear-gradient(145deg, #1a0f3a 0%, #231550 100%)'
        : '#14152a',
      border: `1px solid ${tileOn ? 'rgba(167,139,250,0.22)' : 'rgba(255,255,255,0.06)'}`,
      borderRadius: 18,
      padding: '12px',
      display: 'flex', flexDirection: 'column',
      minHeight: 118,
      boxShadow: tileOn
        ? '0 4px 24px rgba(124,58,237,0.18)'
        : '0 2px 6px rgba(0,0,0,0.2)',
      transition: 'all 0.2s ease',
      animation: 'fadeIn 0.2s ease',
      position: 'relative',
      overflow: 'hidden',
    }}>

      {/* Top glow bar when on */}
      {tileOn && (
        <div style={{
          position:'absolute', top:0, left:'15%', right:'15%', height:2,
          background:'linear-gradient(90deg, transparent, #a78bfa, transparent)',
          borderRadius:1,
        }}/>
      )}

      {/* Top row: icon left + control right */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <div style={{
          width:40, height:40, borderRadius:12, flexShrink:0,
          background: tileOn ? 'rgba(124,58,237,0.22)' : 'rgba(255,255,255,0.06)',
          display:'flex', alignItems:'center', justifyContent:'center',
          boxShadow: tileOn ? '0 0 16px rgba(124,58,237,0.3)' : 'none',
          transition:'all 0.2s',
        }}>
          <IconComp size={21} color={tileOn ? '#a78bfa' : activeColor} />
        </div>

        <div style={{ flexShrink:0 }}>
          {hasSwitch && (
            <Toggle on={isOn} onChange={val => cmd('switch', val ? 1 : 0)} />
          )}
          {!hasSwitch && (hasMot||hasPres) && (
            <span style={{
              width:9, height:9, borderRadius:'50%', display:'block', marginTop:3,
              background: (motActive||presActive) ? 'var(--orange)' : '#2d3748',
              boxShadow: (motActive||presActive) ? '0 0 8px var(--orange)' : 'none',
            }}/>
          )}
          {!hasSwitch && hasBatt && (
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

      {/* Bottom: name + status */}
      <div style={{ marginTop:'auto', paddingTop:10 }}>
        <div style={{
          fontSize:12, fontWeight:600, lineHeight:1.2,
          color: hasSwitch && !isOn ? '#4a5568' : '#e2e8f0',
          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
        }}>
          {device.label}
        </div>
        <div style={{
          fontSize:11, marginTop:3, fontWeight:500,
          color: tileOn ? '#a78bfa'
               : (motActive||presActive) ? 'var(--orange)'
               : !hasSwitch ? activeColor
               : '#4a5568',
        }}>
          {statusText}
        </div>
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
                display:'inline-flex', alignItems:'center', gap:4,
                padding:'6px 11px', borderRadius:20, border:'none', cursor:'pointer',
                flexShrink:0,
                background: active ? 'var(--purple)' : 'rgba(255,255,255,0.07)',
                color: active ? '#fff' : 'var(--text2)',
                fontSize:12, fontWeight:active?600:400,
                boxShadow: active ? '0 2px 12px rgba(124,58,237,0.38)' : 'none',
                transition:'all 0.15s',
                WebkitTapHighlightColor:'transparent',
              }}>
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
