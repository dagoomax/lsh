import { SunIcon, PylonIcon, BatteryCellIcon, BoltIcon, HomeIcon } from './Icons'

const fmtW  = v => v==null||isNaN(v) ? '—' : Math.abs(v)>=1000 ? `${(Math.abs(v)/1000).toFixed(2)} kW` : `${Math.round(Math.abs(v))} W`
const fmtV  = v => v==null ? '—' : `${Number(v).toFixed(1)} V`
const fmtA  = v => v==null ? '—' : `${Number(v).toFixed(1)} A`
const fmtHz = v => v==null ? '—' : `${Number(v).toFixed(1)} Hz`
const fmtDur = s => {
  if (!s || s <= 0) return null
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60)
  return h ? `${h}h ${m}m` : `${m}m`
}

const BATT_STATES = { 0:'Idle', 1:'Charging', 2:'Discharging', 3:'Absorption', 4:'Float', 5:'Storage', 6:'Equalise', 9:'Inverting' }
const CHARGING_STATES    = [1, 3, 4, 6]
const DISCHARGING_STATES = [2, 9]

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

// ── Animated flow diagram ────────────────────────────────────────────────────
// Nodes around a central inverter hub; dashes stream along each conduit in the
// direction the energy moves, at a speed proportional to the wattage.

// Dash animation speed: ~1 s cycle at 900 W, clamped so trickles still crawl
// and heavy flows don't strobe.
const flowDur = w => `${Math.max(0.45, Math.min(2.8, 900 / Math.max(60, Math.abs(w)))).toFixed(2)}s`

function FlowPath({ d, color, watts, reverse }) {
  const active = Math.abs(watts ?? 0) > 5
  return (
    <g>
      <path className="eflow-track" d={d}/>
      {active && (
        <path
          className={`eflow-flow${reverse ? ' eflow-rev' : ''}`}
          d={d} stroke={color}
          style={{ '--fc': color, animationDuration: flowDur(watts) }}
        />
      )}
    </g>
  )
}

function FlowNode({ x, y, icon: Icon, label, color, value, sub, active = true, socPct = null }) {
  const R = 31
  const circ = 2 * Math.PI * R
  return (
    <g className="eflow-node" style={{ opacity: active ? 1 : 0.45, transition: 'opacity 0.6s ease' }}>
      <text x={x} y={y - R - 13} textAnchor="middle" className="eflow-label">{label}</text>
      <circle cx={x} cy={y} r={R} fill="var(--card)" stroke="rgba(255,255,255,0.09)" strokeWidth="2"/>
      {socPct == null && (
        <circle cx={x} cy={y} r={R} fill="none" stroke={color} strokeWidth="2"
          style={active ? { filter: `drop-shadow(0 0 5px ${color})` } : undefined}/>
      )}
      {socPct != null && (
        <circle cx={x} cy={y} r={R} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"
          strokeDasharray={`${circ * Math.min(1, Math.max(0, socPct / 100))} ${circ}`}
          transform={`rotate(-90 ${x} ${y})`}
          style={{ filter: `drop-shadow(0 0 5px ${color})`, transition: 'stroke-dasharray 0.8s ease' }}/>
      )}
      <g transform={`translate(${x - 13}, ${y - 13})`}>
        <Icon color={color} size={26}/>
      </g>
      <text x={x} y={y + R + 20} textAnchor="middle" className="eflow-value" fill={color}>{value}</text>
      {sub && <text x={x} y={y + R + 35} textAnchor="middle" className="eflow-sub">{sub}</text>}
    </g>
  )
}

function FlowDiagram({ solarW, gridW, battW, battCharging, battSoc, battColor, loadW, gridColor, exporting }) {
  // Geometry: hub at (340,183); solar N, grid W, home E, battery S
  const hub = { x: 340, y: 183 }
  return (
    <div className="eflow-wrap">
      <svg viewBox="0 0 680 386" className="eflow-svg" role="img"
        aria-label={`Energy flow: solar ${fmtW(solarW)}, grid ${exporting ? 'export' : 'import'} ${fmtW(gridW)}, battery ${battCharging ? 'charging' : 'discharging'} ${fmtW(battW)}, home ${fmtW(loadW)}`}>

        {/* soft glow behind the hub */}
        <radialGradient id="eflow-hub-glow">
          <stop offset="0%"  stopColor="rgba(88,166,255,0.14)"/>
          <stop offset="100%" stopColor="rgba(88,166,255,0)"/>
        </radialGradient>
        <circle cx={hub.x} cy={hub.y} r="110" fill="url(#eflow-hub-glow)"/>

        {/* conduits — every `d` is drawn TOWARD the hub; `reverse` flips the stream */}
        <FlowPath d={`M ${hub.x} 92  L ${hub.x} ${hub.y - 42}`} color="var(--orange)" watts={solarW}/>
        <FlowPath d={`M 148 ${hub.y} L ${hub.x - 42} ${hub.y}`} color={gridColor} watts={gridW} reverse={exporting}/>
        <FlowPath d={`M ${hub.x} 274 L ${hub.x} ${hub.y + 42}`} color={battColor} watts={battW} reverse={battCharging}/>
        <FlowPath d={`M ${hub.x + 42} ${hub.y} L 532 ${hub.y}`} color="var(--accent-lt)" watts={loadW} reverse/>

        {/* inverter hub */}
        <circle cx={hub.x} cy={hub.y} r="30" fill="var(--card)" stroke="rgba(255,255,255,0.09)" strokeWidth="2"/>
        <circle className="eflow-hub-ring" cx={hub.x} cy={hub.y} r="30" fill="none"
          stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4 9" strokeLinecap="round" opacity="0.7"/>
        <g transform={`translate(${hub.x - 11}, ${hub.y - 11})`}>
          <BoltIcon color="var(--accent-lt)" size={22}/>
        </g>

        {/* nodes */}
        <FlowNode x={340} y={57}  icon={SunIcon} label="Solar" color="var(--orange)"
          value={fmtW(solarW)} active={Math.abs(solarW ?? 0) > 5}/>
        <FlowNode x={105} y={183} icon={PylonIcon} label={exporting ? 'Grid · export' : 'Grid · import'} color={gridColor}
          value={fmtW(gridW)} active={Math.abs(gridW ?? 0) > 5}/>
        <FlowNode x={575} y={183} icon={HomeIcon} label="Home" color="var(--accent-lt)"
          value={fmtW(loadW)} active={Math.abs(loadW ?? 0) > 5}/>
        <FlowNode x={340} y={309} icon={BatteryCellIcon} label={battCharging ? 'Battery · charging' : 'Battery · discharging'}
          color={battColor} value={fmtW(battW)} sub={battSoc != null ? `${battSoc}%` : null}
          active={Math.abs(battW ?? 0) > 5} socPct={battSoc}/>
      </svg>
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

function DetailCard({ icon, title, children }) {
  return (
    <div className="detail-card">
      <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text3)', marginBottom:8 }}>
        {icon}{title}
      </div>
      {children}
    </div>
  )
}

export default function EnergyFlow({ energy }) {
  const { battery:b, solar:s, grid:g, loads:l } = energy||{}

  const num = v => (v == null || isNaN(v)) ? 0 : Number(v)
  const sum3 = o => o == null ? null : num(o.power) + num(o.powerL2) + num(o.powerL3)

  const gridTotal  = sum3(g)
  const loadTotal  = sum3(l)
  const exporting  = (gridTotal ?? 0) < 0
  const gridColor  = exporting ? 'var(--green)' : 'var(--red)'
  const battPct    = b?.soc ?? 0
  const battColor  = battPct > 50 ? 'var(--green)' : battPct > 20 ? 'var(--orange)' : 'var(--red)'
  const battState  = BATT_STATES[b?.state] ?? 'Unknown'
  const battW      = b?.power ?? ((b?.voltage != null && b?.current != null) ? b.voltage * b.current : null)
  const battCharging = CHARGING_STATES.includes(b?.state) ? true
                     : DISCHARGING_STATES.includes(b?.state) ? false
                     : (b?.current ?? 0) >= 0
  const solarPct   = s?.power > 0 ? Math.min(100, (s.power / 5000) * 100) : 0
  const timeToGo   = fmtDur(b?.timeToGo)

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>

      {/* ── Top 4-card strip ── */}
      <div className="energy-strip" style={{ display:'flex', gap:10 }}>
        <ECard icon={<SunIcon color="var(--orange)" size={24}/>} label="Solar" value={fmtW(s?.power)} color="var(--orange)"
          pct={solarPct} sub={`${(s?.dailyYield??0).toFixed(2)} kWh today`} />
        <ECard icon={<BatteryCellIcon color={battColor} size={24}/>} label="Battery" value={`${battPct}%`} color={battColor}
          pct={battPct} sub={`${battState} · ${fmtW(battW)}`} />
        <ECard icon={<HomeIcon color="var(--accent-lt)" size={24}/>} label="Loads" value={fmtW(loadTotal)} color="var(--accent-lt)"
          sub={`L1 ${fmtW(l?.power)} · L2 ${fmtW(l?.powerL2)} · L3 ${fmtW(l?.powerL3)}`} />
        <ECard icon={<PylonIcon color={gridColor} size={24}/>} label={exporting?'Exporting':'Importing'}
          value={fmtW(gridTotal)} color={gridColor}
          sub={`${fmtV(g?.voltage)} · ${fmtHz(g?.frequency)}`} />
      </div>

      {/* ── Animated flow diagram ── */}
      <FlowDiagram
        solarW={s?.power} gridW={gridTotal} battW={battW} loadW={loadTotal}
        battCharging={battCharging} battSoc={b?.soc ?? null} battColor={battColor}
        gridColor={gridColor} exporting={exporting}
      />

      {/* ── Detail row ── */}
      <div className="energy-detail-grid" style={{
        display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))',
        gap:10,
      }}>
        <DetailCard icon={<BatteryCellIcon color="var(--text3)" size={13}/>} title="Battery">
          <DetailRow label="SoC"     value={`${battPct}%`}    color={battColor} />
          <DetailRow label="Power"   value={fmtW(battW)}      color={battColor} />
          <DetailRow label="Voltage" value={fmtV(b?.voltage)} />
          <DetailRow label="Current" value={fmtA(b?.current)} color={(b?.current??0)>0?'var(--green)':'var(--text2)'} />
          <DetailRow label="State"   value={battState}        color="var(--text2)" />
          {timeToGo && <DetailRow label="Time to go" value={timeToGo} color="var(--text2)" />}
        </DetailCard>

        <DetailCard icon={<SunIcon color="var(--text3)" size={13}/>} title="Solar MPPT">
          <DetailRow label="Power"   value={fmtW(s?.power)}   color="var(--orange)" />
          <DetailRow label="Today"   value={`${(s?.dailyYield??0).toFixed(2)} kWh`} color="var(--orange)" />
          {s?.current != null && <DetailRow label="Current" value={fmtA(s.current)} />}
          {s?.panelVoltage != null && <DetailRow label="PV Voltage" value={fmtV(s.panelVoltage)} />}
          <DetailRow label="Share of loads" value={
            loadTotal > 0 ? `${Math.min(100, Math.round(num(s?.power) / loadTotal * 100))}%` : '—'
          } color="var(--text2)" />
        </DetailCard>

        <DetailCard icon={<PylonIcon color="var(--text3)" size={13}/>} title="Grid">
          <DetailRow label="Total"     value={fmtW(gridTotal)}  color={gridColor} />
          <DetailRow label="L1 Power"  value={fmtW(g?.power)}   color={gridColor} />
          <DetailRow label="L2 Power"  value={fmtW(g?.powerL2)} color={gridColor} />
          <DetailRow label="L3 Power"  value={fmtW(g?.powerL3)} color={gridColor} />
          <DetailRow label="Voltage"   value={fmtV(g?.voltage)} />
          <DetailRow label="Frequency" value={fmtHz(g?.frequency)} color="var(--text2)" />
        </DetailCard>

        <DetailCard icon={<HomeIcon color="var(--text3)" size={13}/>} title="AC Loads">
          <DetailRow label="Total"    value={fmtW(loadTotal)}  color="var(--accent-lt)" />
          <DetailRow label="L1 Power" value={fmtW(l?.power)}   />
          <DetailRow label="L2 Power" value={fmtW(l?.powerL2)} />
          <DetailRow label="L3 Power" value={fmtW(l?.powerL3)} />
        </DetailCard>
      </div>

    </div>
  )
}
