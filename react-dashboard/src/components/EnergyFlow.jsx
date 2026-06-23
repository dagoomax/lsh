const fmtW = v => v==null||isNaN(v) ? '—' : Math.abs(v)>=1000 ? `${(v/1000).toFixed(2)} kW` : `${Math.round(Math.abs(v))} W`
const fmtV = v => v==null ? '—' : `${Number(v).toFixed(1)} V`
const fmtA = v => v==null ? '—' : `${Number(v).toFixed(1)} A`
const fmtHz = v => v==null ? '—' : `${Number(v).toFixed(1)} Hz`

const BATT_STATES = { 0:'Idle', 1:'Charging', 2:'Discharging', 3:'Absorption', 4:'Float', 5:'Storage', 6:'Equalise', 9:'Inverting' }

function Stat({ label, value, color='var(--text)', sub }) {
  return (
    <div style={{ textAlign:'center', padding:'0 10px' }}>
      <div style={{ fontSize:18, fontWeight:700, color, fontVariantNumeric:'tabular-nums', letterSpacing:'-0.4px' }}>{value}</div>
      <div style={{ fontSize:11, color:'var(--text2)', marginTop:1 }}>{label}</div>
      {sub && <div style={{ fontSize:10, color:'var(--text3)' }}>{sub}</div>}
    </div>
  )
}

function Divider() {
  return <div style={{ width:1, background:'var(--sep)', alignSelf:'stretch', margin:'4px 0' }} />
}

function PhaseRow({ label, power, color }) {
  if (power==null) return null
  const exp = power < 0
  return (
    <div style={{ display:'flex', justifyContent:'space-between', padding:'3px 0', fontSize:12 }}>
      <span style={{ color:'var(--text2)' }}>{label}</span>
      <span style={{ color, fontVariantNumeric:'tabular-nums', fontWeight:500 }}>
        {exp ? '↗ ' : ''}{fmtW(power)}
      </span>
    </div>
  )
}

function FlowNode({ icon, title, mainValue, mainColor, rows, top, bottom, glow }) {
  return (
    <div style={{
      background:'var(--bg2)', border:`1px solid ${glow ? mainColor+'44' : 'var(--border)'}`,
      borderRadius:16, padding:'14px 16px', minWidth:148,
      boxShadow: glow ? `0 0 24px ${mainColor}22` : 'none',
      position:'relative', overflow:'hidden',
    }}>
      <div style={{ position:'absolute', top:0, left:0, right:0, height:2, background:mainColor, borderRadius:'16px 16px 0 0' }} />
      <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:10 }}>
        <span style={{ fontSize:20 }}>{icon}</span>
        <span style={{ fontSize:12, fontWeight:600, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'0.05em' }}>{title}</span>
      </div>
      <div style={{ fontSize:26, fontWeight:700, color:mainColor, letterSpacing:'-0.5px', fontVariantNumeric:'tabular-nums', marginBottom:8 }}>
        {mainValue}
      </div>
      <div style={{ borderTop:'1px solid var(--sep)', paddingTop:8 }}>
        {rows?.map((r,i) => (
          <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'2px 0', fontSize:12 }}>
            <span style={{ color:'var(--text2)' }}>{r.label}</span>
            <span style={{ color:r.color||'var(--text)', fontVariantNumeric:'tabular-nums' }}>{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function EnergyFlow({ energy }) {
  const { battery:b, solar:s, grid:g, loads:l } = energy||{}

  const exporting   = (g?.power??0) < 0
  const gridColor   = exporting ? 'var(--green)' : 'var(--red)'
  const battState   = BATT_STATES[b?.state] ?? 'Unknown'
  const battColor   = (b?.soc??0) > 20 ? 'var(--green)' : 'var(--red)'
  const totalGrid   = Math.abs((g?.power??0) + (g?.powerL2??0) + (g?.powerL3??0))

  return (
    <div style={{ padding:'18px 20px' }}>

      {/* Section label */}
      <div style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text2)', marginBottom:16 }}>
        Energy Flow
      </div>

      {/* Top row: 4 stat boxes */}
      <div style={{ display:'flex', background:'var(--bg3)', borderRadius:12, padding:'12px 0', marginBottom:16 }}>
        <Stat label="Solar" value={fmtW(s?.power)} color="var(--orange)" sub={`${(s?.dailyYield??0).toFixed(2)} kWh today`} />
        <Divider/>
        <Stat label="Battery" value={`${b?.soc??'—'} %`} color={battColor} sub={battState} />
        <Divider/>
        <Stat label="AC Load" value={fmtW(l?.power)} color="var(--blue)" sub={`L1+L2+L3`} />
        <Divider/>
        <Stat label={exporting?'Exporting':'Importing'} value={fmtW(g?.power)} color={gridColor} sub={`${fmtV(g?.voltage)} · ${fmtHz(g?.frequency)}`} />
      </div>

      {/* Flow diagram */}
      <div style={{ display:'flex', alignItems:'center', gap:12 }}>

        {/* Left nodes */}
        <div style={{ display:'flex', flexDirection:'column', gap:10, flex:'0 0 auto' }}>
          <FlowNode
            icon="☀️" title="Solar MPPT" mainValue={fmtW(s?.power)} mainColor="var(--orange)" glow={s?.power>0}
            rows={[
              { label:'Daily yield', value:`${(s?.dailyYield??0).toFixed(2)} kWh`, color:'var(--orange)' },
            ]}
          />
          <FlowNode
            icon="🔋" title="Battery" mainValue={`${b?.soc??'—'} %`} mainColor={battColor} glow
            rows={[
              { label:'Voltage', value:fmtV(b?.voltage), color:'var(--text)' },
              { label:'Current', value:fmtA(b?.current), color: (b?.current??0)>0?'var(--green)':'var(--red)' },
              { label:'State',   value:battState, color:'var(--text2)' },
            ]}
          />
        </div>

        {/* Animated SVG connector */}
        <div style={{ flex:'0 0 80px', display:'flex', alignItems:'center', justifyContent:'center', height:220 }}>
          <svg width="80" height="220" style={{ overflow:'visible' }}>
            <path d="M 0,55 C 40,55 40,110 80,110" fill="none" stroke="var(--orange)" strokeWidth="1.5"
              strokeDasharray="5 4" style={{ animation:'flowDash 0.7s linear infinite' }} opacity="0.7"/>
            <path d="M 0,165 C 40,165 40,110 80,110" fill="none" stroke="var(--green)" strokeWidth="1.5"
              strokeDasharray="5 4" style={{ animation:'flowDash 0.7s linear infinite' }} opacity="0.7"/>
          </svg>
        </div>

        {/* Center node */}
        <div style={{
          background:'var(--bg2)', border:'1px solid rgba(255,255,255,0.15)',
          borderRadius:18, padding:'20px 18px', textAlign:'center',
          boxShadow:'0 0 40px rgba(10,132,255,0.1)', flex:'0 0 auto',
        }}>
          <div style={{ fontSize:32, marginBottom:6 }}>⚡</div>
          <div style={{ fontSize:14, fontWeight:700, letterSpacing:'-0.3px' }}>LSH</div>
          <div style={{ fontSize:10, color:'var(--text2)', marginTop:2 }}>Inverter</div>
        </div>

        {/* Animated SVG connector */}
        <div style={{ flex:'0 0 80px', display:'flex', alignItems:'center', justifyContent:'center', height:220 }}>
          <svg width="80" height="220" style={{ overflow:'visible' }}>
            <path d="M 0,110 C 40,110 40,55 80,55" fill="none" stroke="var(--blue)" strokeWidth="1.5"
              strokeDasharray="5 4" style={{ animation:'flowDash 0.7s linear infinite' }} opacity="0.7"/>
            <path d="M 0,110 C 40,110 40,165 80,165" fill="none" stroke={gridColor} strokeWidth="1.5"
              strokeDasharray="5 4" style={{ animation:'flowDash 0.7s linear infinite' }} opacity="0.7"/>
          </svg>
        </div>

        {/* Right nodes */}
        <div style={{ display:'flex', flexDirection:'column', gap:10, flex:'0 0 auto' }}>
          <FlowNode
            icon="🏠" title="AC Loads" mainValue={fmtW(l?.power)} mainColor="var(--blue)" glow={(l?.power??0)>0}
            rows={[
              { label:'L1', value:fmtW(l?.power),   color:'var(--text)' },
              { label:'L2', value:fmtW(l?.powerL2),  color:'var(--text)' },
              { label:'L3', value:fmtW(l?.powerL3),  color:'var(--text)' },
            ]}
          />
          <FlowNode
            icon="🔌" title={exporting?'Grid Export':'Grid Import'} mainValue={fmtW(g?.power)} mainColor={gridColor} glow
            rows={[
              { label:'L1', value:fmtW(g?.power),   color:gridColor },
              { label:'L2', value:fmtW(g?.powerL2), color:gridColor },
              { label:'L3', value:fmtW(g?.powerL3), color:gridColor },
            ]}
          />
        </div>
      </div>
    </div>
  )
}
