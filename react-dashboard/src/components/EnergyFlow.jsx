const fmtW  = v => v==null||isNaN(v) ? '—' : Math.abs(v)>=1000 ? `${(v/1000).toFixed(2)} kW` : `${Math.round(Math.abs(v))} W`
const fmtV  = v => v==null ? '—' : `${Number(v).toFixed(1)} V`
const fmtA  = v => v==null ? '—' : `${Number(v).toFixed(1)} A`
const fmtHz = v => v==null ? '—' : `${Number(v).toFixed(1)} Hz`

const BATT_STATES = { 0:'Idle', 1:'Charging', 2:'Discharging', 3:'Absorption', 4:'Float', 5:'Storage', 6:'Equalise', 9:'Inverting' }

// ── Arc gauge ────────────────────────────────────────────────────────────────
function Arc({ pct = 0, color, size = 64 }) {
  const r   = (size / 2) - 6
  const circ = 2 * Math.PI * r
  const dash = circ * 0.75   // 270° arc
  const gap  = circ * 0.25
  const prog = dash * Math.min(1, Math.max(0, pct / 100))
  return (
    <svg width={size} height={size} style={{ transform:'rotate(135deg)' }}>
      <circle cx={size/2} cy={size/2} r={r}
        fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5"
        strokeDasharray={`${dash} ${gap}`} strokeLinecap="round"/>
      <circle cx={size/2} cy={size/2} r={r}
        fill="none" stroke={color} strokeWidth="5"
        strokeDasharray={`${prog} ${circ - prog}`} strokeLinecap="round"
        style={{ transition:'stroke-dasharray 0.6s ease' }}/>
    </svg>
  )
}

// ── Mini energy card ─────────────────────────────────────────────────────────
function ECard({ icon, label, value, sub, color, pct }) {
  return (
    <div className="ecard" style={{ '--c': color }}>
      {pct != null && (
        <div className="energy-card-arc" style={{ position:'relative', flexShrink:0, width:64, height:64 }}>
          <Arc pct={pct} color={color} size={64}/>
          <div style={{
            position:'absolute', inset:0, display:'flex',
            alignItems:'center', justifyContent:'center',
            fontSize: 20,
          }}>{icon}</div>
        </div>
      )}
      {pct == null && (
        <div style={{
          width:44, height:44, borderRadius:12, flexShrink:0,
          background: `${color}15`, display:'flex', alignItems:'center', justifyContent:'center',
          fontSize: 22,
        }}>{icon}</div>
      )}
      <div style={{ minWidth:0 }}>
        <div style={{ fontSize:11, color:'var(--text3)', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:3 }}>
          {label}
        </div>
        <div className="ecard-value" style={{ fontSize:22, fontWeight:700, color, fontVariantNumeric:'tabular-nums', letterSpacing:'-0.5px', lineHeight:1, whiteSpace:'nowrap' }}>
          {value}
        </div>
        {sub && (
          <div className="energy-card-sub" style={{ fontSize:11, color:'var(--text3)', marginTop:4 }}>{sub}</div>
        )}
      </div>
    </div>
  )
}

// ── Full energy detail panel (expandable) ────────────────────────────────────
function DetailRow({ label, value, color }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:'1px solid var(--sep)', fontSize:12 }}>
      <span style={{ color:'var(--text2)' }}>{label}</span>
      <span style={{ color: color||'var(--text)', fontVariantNumeric:'tabular-nums', fontWeight:500 }}>{value}</span>
    </div>
  )
}

export default function EnergyFlow({ energy }) {
  const { battery:b, solar:s, grid:g, loads:l } = energy||{}

  const exporting  = (g?.power??0) < 0
  const gridColor  = exporting ? 'var(--green)' : 'var(--red)'
  const battPct    = b?.soc ?? 0
  const battColor  = battPct > 50 ? 'var(--green)' : battPct > 20 ? 'var(--orange)' : 'var(--red)'
  const battState  = BATT_STATES[b?.state] ?? 'Unknown'
  const solarPct   = s?.power > 0 ? Math.min(100, (s.power / 5000) * 100) : 0

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>

      {/* ── Top 4-card strip ── */}
      <div className="energy-strip" style={{ display:'flex', gap:10 }}>
        <ECard icon="☀️" label="Solar"   value={fmtW(s?.power)}    color="var(--orange)"
          pct={solarPct} sub={`${(s?.dailyYield??0).toFixed(2)} kWh today`} />
        <ECard icon="🔋" label="Battery" value={`${battPct}%`}     color={battColor}
          pct={battPct} sub={`${battState} · ${fmtV(b?.voltage)}`} />
        <ECard icon="🏠" label="Loads"   value={fmtW(l?.power)}    color="var(--accent-lt)"
          sub={`L1 ${fmtW(l?.power)} · L2 ${fmtW(l?.powerL2)} · L3 ${fmtW(l?.powerL3)}`} />
        <ECard icon={exporting?'↗️':'↙️'} label={exporting?'Exporting':'Importing'}
          value={fmtW(g?.power)} color={gridColor}
          sub={`${fmtV(g?.voltage)} · ${fmtHz(g?.frequency)}`} />
      </div>

      {/* ── Detail row ── */}
      <div className="energy-detail-grid" style={{
        display:'grid', gridTemplateColumns:'1fr 1fr 1fr',
        gap:10,
      }}>
        {/* Battery detail */}
        <div className="detail-card">
          <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text3)', marginBottom:8 }}>
            🔋 Battery
          </div>
          <DetailRow label="SoC"     value={`${battPct}%`}              color={battColor} />
          <DetailRow label="Voltage" value={fmtV(b?.voltage)}           />
          <DetailRow label="Current" value={fmtA(b?.current)}           color={(b?.current??0)>0?'var(--green)':'var(--text2)'} />
          <DetailRow label="State"   value={battState}                  color="var(--text2)" />
        </div>

        {/* Solar detail */}
        <div className="detail-card">
          <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text3)', marginBottom:8 }}>
            ☀️ Solar MPPT
          </div>
          <DetailRow label="Power"      value={fmtW(s?.power)}                    color="var(--orange)" />
          <DetailRow label="Today"      value={`${(s?.dailyYield??0).toFixed(2)} kWh`} color="var(--orange)" />
          <DetailRow label="PV Voltage" value={fmtV(s?.panelVoltage)}             />
          <DetailRow label="State"      value={s?.state===2?'Active':s?.state===0?'Off':'Idle'} color="var(--text2)" />
        </div>

        {/* Grid detail */}
        <div className="detail-card">
          <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text3)', marginBottom:8 }}>
            🔌 Grid
          </div>
          <DetailRow label="L1 Power" value={fmtW(g?.power)}   color={gridColor} />
          <DetailRow label="L2 Power" value={fmtW(g?.powerL2)} color={gridColor} />
          <DetailRow label="L3 Power" value={fmtW(g?.powerL3)} color={gridColor} />
          <DetailRow label="Voltage"  value={fmtV(g?.voltage)}                   />
        </div>
      </div>

    </div>
  )
}
