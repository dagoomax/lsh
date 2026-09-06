import { useEffect, useRef, useState } from 'react'
import { SunIcon, PylonIcon, BatteryCellIcon, BoltIcon, HomeIcon, GWagenIcon } from './Icons'
import GWagenEmbed from './GWagenEmbed'
import { gt } from '../i18n'
import { useHistoryPoints, smoothPath, fetchHistory } from '../historyChart'

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
const BATT_STATE_KEYS = { 0:'st_idle', 1:'st_charging', 2:'st_discharging', 3:'st_absorption', 4:'st_float', 5:'st_storage', 6:'st_equalise', 9:'st_inverting' }
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
        fill="none" stroke="var(--white-06)" strokeWidth="5"
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
    <div className="ecard eflow-bg" style={{ '--c': color }}>
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
  const R = 36
  const ICON = 34
  const circ = 2 * Math.PI * R
  return (
    <g className="eflow-node" style={{ opacity: active ? 1 : 0.45, transition: 'opacity 0.6s ease' }}>
      <text x={x} y={y - R - 14} textAnchor="middle" className="eflow-label">{label}</text>
      <circle cx={x} cy={y} r={R} fill="var(--card)" stroke="var(--white-09)" strokeWidth="2"/>
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
      <g transform={`translate(${x - ICON / 2}, ${y - ICON / 2})`}>
        <Icon color={color} size={ICON}/>
      </g>
      <text x={x} y={y + R + 22} textAnchor="middle" className="eflow-value" fill={color}>{value}</text>
      {sub && <text x={x} y={y + R + 37} textAnchor="middle" className="eflow-sub">{sub}</text>}
    </g>
  )
}

function FlowDiagram({ solarW, gridW, battW, battCharging, battSoc, battColor, loadW, gridColor, exporting, evW }) {
  // Geometry: hub at (410,200); solar N, grid W, home E, battery S, EV SE (diagonal, only when present)
  const hub = { x: 410, y: 200 }
  const ev  = { x: 570, y: 287 }
  const hubR = 34, gap = 6, nodeR = 36
  const hasEv = evW != null
  const label = `Energy flow: solar ${fmtW(solarW)}, grid ${exporting ? 'export' : 'import'} ${fmtW(gridW)}, battery ${battCharging ? 'charging' : 'discharging'} ${fmtW(battW)}, home ${fmtW(loadW)}`
    + (hasEv ? `, EV charging ${fmtW(evW)}` : '')
  return (
    <div className="eflow-wrap eflow-bg">
      <svg viewBox="0 0 820 420" className="eflow-svg" role="img" aria-label={label}>

        {/* soft glow behind the hub */}
        <radialGradient id="eflow-hub-glow">
          <stop offset="0%"  stopColor="var(--accent)" stopOpacity="0.14"/>
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0"/>
        </radialGradient>
        <circle cx={hub.x} cy={hub.y} r="130" fill="url(#eflow-hub-glow)"/>

        {/* conduits — every `d` is drawn TOWARD the hub; `reverse` flips the stream */}
        <FlowPath d={`M ${hub.x} 106 L ${hub.x} ${hub.y - hubR - gap}`} color="var(--orange)" watts={solarW}/>
        <FlowPath d={`M 160 ${hub.y} L ${hub.x - hubR - gap} ${hub.y}`} color={gridColor} watts={gridW} reverse={exporting}/>
        <FlowPath d={`M ${hub.x} 294 L ${hub.x} ${hub.y + hubR + gap}`} color={battColor} watts={battW} reverse={battCharging}/>
        <FlowPath d={`M ${hub.x + hubR + gap} ${hub.y} L 660 ${hub.y}`} color="var(--accent-lt)" watts={loadW} reverse/>
        {hasEv && <FlowPath d={`M 533 267 L 445 219`} color="var(--purple, #a371f7)" watts={evW} reverse/>}

        {/* inverter hub */}
        <circle cx={hub.x} cy={hub.y} r={hubR} fill="var(--card)" stroke="var(--white-09)" strokeWidth="2"/>
        <circle className="eflow-hub-ring" cx={hub.x} cy={hub.y} r={hubR} fill="none"
          stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4 9" strokeLinecap="round" opacity="0.7"/>
        <g transform={`translate(${hub.x - 13}, ${hub.y - 13})`}>
          <BoltIcon color="var(--accent-lt)" size={26}/>
        </g>

        {/* nodes */}
        <FlowNode x={hub.x} y={64}  icon={SunIcon} label={gt('e_solar','Solar')} color="var(--orange)"
          value={fmtW(solarW)} active={Math.abs(solarW ?? 0) > 5}/>
        <FlowNode x={118} y={hub.y} icon={PylonIcon} label={exporting ? gt('e_grid_export','Grid · export') : gt('e_grid_import','Grid · import')} color={gridColor}
          value={fmtW(gridW)} active={Math.abs(gridW ?? 0) > 5}/>
        <FlowNode x={702} y={hub.y} icon={HomeIcon} label={gt('e_home','Home')} color="var(--accent-lt)"
          value={fmtW(loadW)} active={Math.abs(loadW ?? 0) > 5}/>
        <FlowNode x={hub.x} y={336} icon={BatteryCellIcon} label={battCharging ? gt('e_batt_chg','Battery · charging') : gt('e_batt_dis','Battery · discharging')}
          color={battColor} value={fmtW(battW)} sub={battSoc != null ? `${battSoc}%` : null}
          active={Math.abs(battW ?? 0) > 5} socPct={battSoc}/>
        {hasEv && (
          <FlowNode x={ev.x} y={ev.y} icon={GWagenIcon} label={gt('e_ev','EV charging')} color="var(--purple, #a371f7)"
            value={fmtW(evW)} active={Math.abs(evW ?? 0) > 5}/>
        )}
      </svg>
    </div>
  )
}

// ── Trend sparklines (real history, last 6h) ─────────────────────────────────
function useHistory(key, hours = 6) {
  const points = useHistoryPoints(key, 60000)
  if (!points) return null
  const cutoff = Date.now() - hours * 3600_000
  return points.filter(p => p[0] >= cutoff)
}

// A true axis-free sparkline: area fill + line + an emphasized "now" dot.
// Deliberately no grid — at this size (120×40) gridlines are noise, not signal.
function Sparkline({ points, color, id, width = 120, height = 40 }) {
  if (points == null) {
    return <div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--white-10)', borderTopColor: color, animation: 'eflow-spin 0.9s linear infinite' }} />
    </div>
  }
  if (points.length < 2) {
    return <div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--text3)' }}>—</div>
  }
  const vals = points.map(p => p[1])
  const min = Math.min(0, ...vals)
  const max = Math.max(min + 1, ...vals)
  const t0 = points[0][0], t1 = points[points.length - 1][0]
  const span = Math.max(1, t1 - t0)
  const pad = 4
  const xy = points.map(([t, v]) => [
    pad + ((t - t0) / span) * (width - pad * 2),
    pad + (1 - (v - min) / (max - min)) * (height - pad * 2),
  ])
  const line = smoothPath(xy)
  const last = xy[xy.length - 1]
  const area = `${line} L ${last[0].toFixed(1)} ${height} L ${xy[0][0].toFixed(1)} ${height} Z`
  return (
    <svg width={width} height={height} style={{ overflow: 'visible', flexShrink: 0 }}>
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spark-${id})`} stroke="none" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="3" fill={color} style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
    </svg>
  )
}

function TrendCard({ icon, label, color, value, points }) {
  return (
    <div className="detail-card eflow-bg" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px' }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)', marginBottom: 4 }}>
          {icon}{label}
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{gt('trend_6h', 'Last 6h')}</div>
      </div>
      <Sparkline points={points} color={color} id={label} />
    </div>
  )
}

// Victron's own keys are fixed constants (unlike SolarEdge/SolarAccelerator,
// which vary per install and so come from the server — see their *Key
// fields in getGrouped(), src/data-store.js).
const VICTRON_SOLAR_KEY   = 'system/0/Dc/Pv/Power'
const VICTRON_BATTERY_KEY = 'system/0/Dc/Battery/Soc'
const VICTRON_DAILY_YIELD_KEY = 'system/0/PvChargerAggregated/Yield/User'

// Same idea as trendKey, for the daily-production bar chart: each brand's
// "today's yield so far" counter resets at midnight and climbs through the
// day, so its per-day MAX is that day's total production.
function dailyEnergyKey(source, energy) {
  if (source === 'solaredge') return energy?.solaredge?.dailyEnergyKey
  if (source === 'solaraccelerator') return energy?.solaraccelerator?.dailyEnergyKey
  return VICTRON_DAILY_YIELD_KEY
}

// Resolves which real store key the trend sparkline should fetch history
// for, following whichever source is actually selected for that metric —
// previously this was hardcoded to Victron's own keys regardless of
// selection, so switching to SolarEdge/SolarAccelerator changed the flow
// diagram's numbers but silently left the sparkline showing Victron's history.
function trendKey(metric, source, energy) {
  if (source === 'solaredge') {
    return metric === 'solar' ? energy?.solaredge?.currentPowerKey : energy?.solaredge?.batteryLevelKey
  }
  if (source === 'solaraccelerator') {
    return metric === 'solar' ? energy?.solaraccelerator?.pvPowerKey : energy?.solaraccelerator?.batterySocKey
  }
  return metric === 'solar' ? VICTRON_SOLAR_KEY : VICTRON_BATTERY_KEY
}

// Fixed accent for the "always Victron" comparison cards, distinct from the
// dynamic per-selection colors the primary cards use — signals "this is the
// reference brand's own reading", not the currently-picked source.
const VICTRON_TREND_COLOR = 'var(--accent, #4a9dff)'

function TrendRow({ solarColor, battColor, sources, energy }) {
  const solarSource = sources?.solar || 'victron'
  const batterySource = sources?.battery || 'victron'
  const solarPts = useHistory(trendKey('solar', solarSource, energy))
  const battPts  = useHistory(trendKey('battery', batterySource, energy))
  // Only fetched (and only shown) when a non-Victron source is actually
  // selected for that metric — otherwise it'd be the exact same chart twice.
  const victronSolarPts = useHistory(solarSource !== 'victron' ? VICTRON_SOLAR_KEY : null)
  const victronBattPts  = useHistory(batterySource !== 'victron' ? VICTRON_BATTERY_KEY : null)
  const lastVal = (pts, fmt) => pts && pts.length ? fmt(pts[pts.length - 1][1]) : '—'
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
      <TrendCard icon={<SunIcon color={solarColor} size={13} />} label={gt('e_solar', 'Solar')} color={solarColor}
        value={lastVal(solarPts, fmtW)} points={solarPts} />
      <TrendCard icon={<BatteryCellIcon color={battColor} size={13} />} label={gt('e_battery', 'Battery')} color={battColor}
        value={lastVal(battPts, v => `${Math.round(v)}%`)} points={battPts} />
      {solarSource !== 'victron' && (
        <TrendCard icon={<SunIcon color={VICTRON_TREND_COLOR} size={13} />} label={gt('e_solar_victron', 'Solar (Victron)')} color={VICTRON_TREND_COLOR}
          value={lastVal(victronSolarPts, fmtW)} points={victronSolarPts} />
      )}
      {batterySource !== 'victron' && (
        <TrendCard icon={<BatteryCellIcon color={VICTRON_TREND_COLOR} size={13} />} label={gt('e_battery_victron', 'Battery (Victron)')} color={VICTRON_TREND_COLOR}
          value={lastVal(victronBattPts, v => `${Math.round(v)}%`)} points={victronBattPts} />
      )}
    </div>
  )
}

// ── Daily production (bar chart, last 14 days) ────────────────────────────────
// A "today's yield" counter (Victron's PvChargerAggregated/Yield/User,
// SolarEdge's dailyEnergy, Solar Accelerator's day_pv_energy) resets to ~0 at
// midnight and climbs through the day — so each calendar day's MAX recorded
// value is that day's total production. Needs Mongo-backed long-range
// history (fetchHistory's `hours` beyond ~6 only works if config.mongo is
// set); with file-only persistence this just shows whatever's still in the
// in-memory ~6h buffer, i.e. at most today and maybe a sliver of yesterday.
function useDailyProduction(key, days = 14) {
  const [points, setPoints] = useState(null)
  useEffect(() => {
    let alive = true
    setPoints(null)
    if (!key) return undefined
    const load = () => fetchHistory(key, days * 24).then(p => { if (alive) setPoints(p) })
    load()
    const iv = setInterval(load, 5 * 60_000) // daily granularity — no need to poll every minute
    return () => { alive = false; clearInterval(iv) }
  }, [key, days])

  if (points == null) return null
  const byDay = new Map()
  for (const [t, v] of points) {
    const d = new Date(t)
    const dayId = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    const prev = byDay.get(dayId)
    if (prev == null || v > prev) byDay.set(dayId, v)
  }
  const today = new Date()
  const out = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    const dayId = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    out.push({ date: d, kwh: byDay.has(dayId) ? byDay.get(dayId) : null })
  }
  return out
}

function DailyProductionChart({ solarKey, color }) {
  const days = useDailyProduction(solarKey, 14)
  const width = 640, height = 130, barGap = 4
  const padBottom = 22, padTop = 6

  if (days == null) {
    return <div className="detail-card eflow-bg" style={{ padding: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', height: height + padBottom }}>
      <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid var(--white-10)', borderTopColor: color, animation: 'eflow-spin 0.9s linear infinite' }} />
    </div>
  }

  const known = days.filter(d => d.kwh != null)
  if (!known.length) {
    return <div className="detail-card eflow-bg" style={{ padding: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
        {gt('e_daily_production', 'Daily Production')}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text3)', padding: '20px 0', textAlign: 'center' }}>
        {gt('e_no_history', 'No history yet — check back after a full day, or enable MongoDB for longer-range charts (see the MongoDB Storage setting).')}
      </div>
    </div>
  }

  const max = Math.max(1, ...known.map(d => d.kwh))
  const barW = (width - barGap * (days.length - 1)) / days.length
  const todayId = new Date().toDateString()

  return (
    <div className="detail-card eflow-bg" style={{ padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {gt('e_daily_production', 'Daily Production')}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)' }}>{gt('trend_14d', 'Last 14 days')}</div>
      </div>
      <svg viewBox={`0 0 ${width} ${height + padBottom}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
        {days.map((d, i) => {
          const x = i * (barW + barGap)
          const h = d.kwh != null ? (d.kwh / max) * (height - padTop) : 0
          const isToday = d.date.toDateString() === todayId
          return (
            <g key={i}>
              {d.kwh != null && (
                <rect x={x} y={height - h} width={barW} height={Math.max(1, h)} rx={2}
                  fill={color} opacity={isToday ? 1 : 0.55} />
              )}
              <text x={x + barW / 2} y={height + 15} textAnchor="middle"
                fontSize="9" fill="var(--text3)">
                {d.date.toLocaleDateString(undefined, { weekday: 'narrow' })}
              </text>
            </g>
          )
        })}
      </svg>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4, textAlign: 'right' }}>
        {gt('r_today', 'Today')}: {known.find(d => d.date.toDateString() === todayId)?.kwh?.toFixed(2) ?? '—'} kWh
      </div>
    </div>
  )
}

// ── EV controls (start/stop + charge-current) ────────────────────────────────
function Toggle({ on, onChange }) {
  return (
    <div
      role="switch" aria-checked={on} className="lux-toggle" data-on={on}
      onClick={e => { e.stopPropagation(); onChange(!on) }}
      style={{
        width:44, height:26, borderRadius:13,
        background: on
          ? 'linear-gradient(180deg, var(--accent-lt) -20%, var(--accent) 90%)'
          : 'linear-gradient(180deg, var(--white-14) 0%, var(--white-08) 100%)',
        position:'relative', cursor:'pointer', flexShrink:0,
        transition:'background 0.25s ease, box-shadow 0.25s ease',
        boxShadow: on
          ? '0 0 14px color-mix(in srgb, var(--accent) 55%, transparent), inset 0 1px 1px rgba(255,255,255,0.3)'
          : 'inset 0 1px 2px rgba(0,0,0,0.2)',
        WebkitTapHighlightColor:'transparent',
        padding:'8px', margin:'-8px', boxSizing:'content-box',
      }}>
      <div style={{
        position:'absolute', width:20, height:20, borderRadius:'50%',
        background:'linear-gradient(180deg, #ffffff 0%, #e7ecf3 100%)', top:3, left:3,
        boxShadow:'0 1px 4px rgba(0,0,0,0.5), inset 0 1px 1px rgba(255,255,255,0.9)',
        transition:'transform 0.2s cubic-bezier(0.34, 1.4, 0.64, 1)',
        transform: on ? 'translateX(18px)' : 'none',
      }}/>
    </div>
  )
}

// Local state mirrors the slider instantly; the command fires 350ms after
// the last drag tick (same debounce as DeviceModal's RangeControl).
function EvRangeControl({ min = 6, max = 32, step = 1, value, unit = 'A', accent, onCommit }) {
  const [local, setLocal] = useState(value ?? min)
  const tRef = useRef(null)
  useEffect(() => { setLocal(value ?? min) }, [value])
  const pct = ((local - min) / Math.max(1, max - min)) * 100
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, flex:1 }}>
      <input type="range" min={min} max={max} step={step} value={local}
        onChange={e => {
          const v = Number(e.target.value); setLocal(v)
          clearTimeout(tRef.current); tRef.current = setTimeout(() => onCommit(v), 350)
        }}
        style={{
          flex:1, height:6, borderRadius:3, appearance:'none', WebkitAppearance:'none', cursor:'pointer',
          background: `linear-gradient(90deg, ${accent} 0%, ${accent} ${pct}%, var(--white-09) ${pct}%)`,
        }}/>
      <span style={{ fontSize:12, fontWeight:700, color:accent, fontVariantNumeric:'tabular-nums', minWidth:38, textAlign:'right' }}>
        {Math.round(local)}{unit}
      </span>
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
    <div className="detail-card eflow-bg">
      <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text3)', marginBottom:8 }}>
        {icon}{title}
      </div>
      {children}
    </div>
  )
}

export default function EnergyFlow({ energy, evDevices = [], onCommand, energySources }) {
  const { battery:b, solar:s, grid:g, loads:l } = energy||{}

  // Up to 10 vehicles — DeviceList.jsx already filters to category
  // 'ev-charger'; this is just the hard cap on the showcase below so one
  // household with an unusual number of chargers can't blow out the layout.
  const evList = evDevices.slice(0, 10)
  const evPower = evList.length
    ? evList.reduce((sum, d) => sum + (Number(d.readings?.power?.value) || 0), 0)
    : null
  const evEnergy = evList.length
    ? evList.reduce((sum, d) => sum + (Number(d.readings?.energy?.value) || 0), 0)
    : null
  const evStatus = evList.length === 1 ? evList[0].readings?.status?.value : null

  // Per-vehicle 3D model selection (Settings → Energy → EV Charging
  // Visualization) — fetched here (not inside GWagenEmbed) so each vehicle's
  // name can also be shown as a caption next to its model. `devices` maps a
  // charger's device key to its own model; anything not in that map falls
  // back to `default`.
  const [evVisual, setEvVisual] = useState(null)
  useEffect(() => {
    let cancelled = false
    fetch('/api/ev-visual').then(r => r.json()).then(d => { if (!cancelled && d?.success) setEvVisual(d) }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  const modelFor = (deviceKey) => evVisual?.devices?.[deviceKey] || evVisual?.default || {}

  const num = v => (v == null || isNaN(v)) ? 0 : Number(v)
  const sum3 = o => o == null ? null : num(o.power) + num(o.powerL2) + num(o.powerL3)

  const gridTotal  = sum3(g)
  const loadTotal  = sum3(l)
  const exporting  = (gridTotal ?? 0) < 0
  const gridColor  = exporting ? 'var(--green)' : 'var(--red)'
  const battPct    = b?.soc ?? 0
  const battColor  = battPct > 50 ? 'var(--green)' : battPct > 20 ? 'var(--orange)' : 'var(--red)'
  const battState  = BATT_STATES[b?.state] != null ? gt(BATT_STATE_KEYS[b.state], BATT_STATES[b.state]) : gt('st_unknown', 'Unknown')
  const battW      = b?.power ?? ((b?.voltage != null && b?.current != null) ? b.voltage * b.current : null)
  const battCharging = CHARGING_STATES.includes(b?.state) ? true
                     : DISCHARGING_STATES.includes(b?.state) ? false
                     : (b?.current ?? 0) >= 0
  const solarPct   = s?.power > 0 ? Math.min(100, (s.power / 5000) * 100) : 0
  const timeToGo   = fmtDur(b?.timeToGo)

  // Self-consumption: how much of current solar production the house is using
  // directly rather than exporting. Grid dependency: how much of the current
  // load is being covered by grid import rather than solar/battery.
  const selfConsumptionPct = s?.power > 0 && loadTotal != null
    ? Math.round(Math.min(1, loadTotal / s.power) * 100) : null
  const gridImportW = gridTotal != null ? Math.max(0, gridTotal) : null
  const gridDependencyPct = gridImportW != null && loadTotal > 0
    ? Math.round(Math.min(1, gridImportW / loadTotal) * 100) : null

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>

      {/* ── Top 4-card strip ── */}
      <div className="energy-strip" style={{ display:'flex', gap:10 }}>
        <ECard icon={<SunIcon color="var(--orange)" size={24}/>} label={gt('e_solar','Solar')} value={fmtW(s?.power)} color="var(--orange)"
          pct={solarPct} sub={`${(s?.dailyYield??0).toFixed(2)} ${gt('kwh_today','kWh today')}`} />
        <ECard icon={<BatteryCellIcon color={battColor} size={24}/>} label={gt('e_battery','Battery')} value={`${battPct}%`} color={battColor}
          pct={battPct} sub={`${battState} · ${fmtW(battW)}`} />
        <ECard icon={<HomeIcon color="var(--accent-lt)" size={24}/>} label={gt('e_loads','Loads')} value={fmtW(loadTotal)} color="var(--accent-lt)"
          sub={`L1 ${fmtW(l?.power)} · L2 ${fmtW(l?.powerL2)} · L3 ${fmtW(l?.powerL3)}`} />
        <ECard icon={<PylonIcon color={gridColor} size={24}/>} label={exporting?gt('e_exporting','Exporting'):gt('e_importing','Importing')}
          value={fmtW(gridTotal)} color={gridColor}
          sub={`${fmtV(g?.voltage)} · ${fmtHz(g?.frequency)}`} />
        {evPower != null && (
          <ECard icon={<GWagenIcon color="var(--purple, #a371f7)" size={24}/>} label={gt('e_ev','EV charging')}
            value={fmtW(evPower)} color="var(--purple, #a371f7)"
            sub={evStatus ? evStatus : (evEnergy != null ? `${evEnergy.toFixed(2)} kWh` : undefined)} />
        )}
      </div>

      {/* ── Animated flow diagram, with Daily Production alongside it on wide
          screens (stacks below on narrow ones) ── */}
      <div className="eflow-production-row">
        <FlowDiagram
          solarW={s?.power} gridW={gridTotal} battW={battW} loadW={loadTotal}
          battCharging={battCharging} battSoc={b?.soc ?? null} battColor={battColor}
          gridColor={gridColor} exporting={exporting} evW={evPower}
        />
        <DailyProductionChart solarKey={dailyEnergyKey(energySources?.solar || 'victron', energy)} color="var(--orange)" />
      </div>

      {/* Self-consumption / grid-dependency — already computed for the detail
          cards further down, surfaced here too since it's the one number
          that actually says whether the flow diagram above is "good" or not
          at a glance, without opening/scrolling to the detail row. */}
      {(selfConsumptionPct != null || gridDependencyPct != null) && (
        <div style={{
          display:'flex', justifyContent:'center', flexWrap:'wrap', columnGap:20, rowGap:4,
          fontSize:11.5, color:'var(--text3)', marginTop:-6,
        }}>
          {selfConsumptionPct != null && (
            <span>{gt('r_self_consumption','Self-consumption')}{' '}
              <b style={{ color:'var(--green)', fontVariantNumeric:'tabular-nums' }}>{selfConsumptionPct}%</b>
            </span>
          )}
          {gridDependencyPct != null && (
            <span>{gt('r_grid_dependency','Grid dependency')}{' '}
              <b style={{ color: gridDependencyPct > 50 ? 'var(--orange)' : 'var(--text2)', fontVariantNumeric:'tabular-nums' }}>{gridDependencyPct}%</b>
            </span>
          )}
        </div>
      )}

      {/* ── EV showcase: one card per vehicle (up to 10), each with its own
          3D model + live stats/controls side by side ── */}
      {evList.map(dev => {
        const model = modelFor(dev.key)
        const power = Number(dev.readings?.power?.value) || 0
        const energyKwh = dev.readings?.energy?.value
        const status = evList.length === 1 ? evStatus : dev.readings?.status?.value
        return (
          <div key={dev.key} className="detail-card" style={{
            display:'flex', flexWrap:'wrap', gap:16, padding:14,
            background:'linear-gradient(135deg, color-mix(in srgb, var(--purple, #a371f7) 9%, var(--card)) 0%, var(--card) 65%)',
            border:'1px solid color-mix(in srgb, var(--purple, #a371f7) 28%, var(--border))',
          }}>
            <div style={{ flex:'1 1 220px', minWidth:200, maxWidth:320 }}>
              <GWagenEmbed height={190} modelId={model.modelId} modelName={model.modelName} />
            </div>
            <div style={{ flex:'1 1 220px', minWidth:220, display:'flex', flexDirection:'column', gap:2 }}>
              <div style={{ marginBottom:6 }}>
                <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text3)' }}>
                  {gt('t_ev','EV Charging')}
                </div>
                <div style={{ fontSize:15, fontWeight:700, color:'var(--text)' }}>
                  {dev.label || gt('e_ev','EV charging')}
                </div>
                {model.modelName && (
                  <div style={{ fontSize:11.5, color:'var(--text3)', marginTop:2 }}>{model.modelName}</div>
                )}
              </div>

              <DetailRow label={gt('r_power','Power')} value={fmtW(power)} color="var(--purple, #a371f7)" />
              {energyKwh != null && <DetailRow label={gt('r_session_energy','Session energy')} value={`${Number(energyKwh).toFixed(2)} kWh`} />}
              {status && <DetailRow label={gt('r_state','State')} value={status} color="var(--text2)" />}

              {dev.readings?.charging?.controllable && (
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'7px 0', borderBottom:'1px solid var(--sep)', fontSize:12 }}>
                  <span style={{ color:'var(--text2)' }}>{gt('r_charging','Charging')}</span>
                  <Toggle on={!!dev.readings.charging.value}
                    onChange={next => onCommand?.(dev.key, 'charging', next)} />
                </div>
              )}
              {dev.readings?.currentLimit?.controllable && (
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0 2px', fontSize:12 }}>
                  <span style={{ color:'var(--text2)', flexShrink:0, marginRight:10 }}>{gt('r_charge_current','Charge current')}</span>
                  <EvRangeControl
                    min={dev.readings.currentLimit.min} max={dev.readings.currentLimit.max}
                    value={dev.readings.currentLimit.value} unit={dev.readings.currentLimit.unit || 'A'}
                    accent="var(--purple, #a371f7)"
                    onCommit={v => onCommand?.(dev.key, 'currentLimit', v)} />
                </div>
              )}
            </div>
          </div>
        )
      })}

      {/* ── Trend sparklines (real 6h history) ── */}
      <TrendRow solarColor="var(--orange)" battColor={battColor} sources={energySources} energy={energy} />

      {/* ── Detail row ── */}
      <div className="energy-detail-grid" style={{
        display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))',
        gap:10,
      }}>
        <DetailCard icon={<BatteryCellIcon color="var(--text3)" size={13}/>} title={gt('t_battery','Battery')}>
          <DetailRow label={gt('r_soc','SoC')}     value={`${battPct}%`}    color={battColor} />
          <DetailRow label={gt('r_power','Power')}   value={fmtW(battW)}      color={battColor} />
          <DetailRow label={gt('r_voltage','Voltage')} value={fmtV(b?.voltage)} />
          <DetailRow label={gt('r_current','Current')} value={fmtA(b?.current)} color={(b?.current??0)>0?'var(--green)':'var(--text2)'} />
          <DetailRow label={gt('r_state','State')}   value={battState}        color="var(--text2)" />
          {timeToGo && <DetailRow label={gt('r_ttg','Time to go')} value={timeToGo} color="var(--text2)" />}
          {b?.temperature != null && <DetailRow label={gt('r_temperature','Temperature')} value={`${Number(b.temperature).toFixed(1)}°C`} />}
          {b?.chargedEnergy != null && <DetailRow label={gt('r_total_charged','Total charged')} value={`${Number(b.chargedEnergy).toFixed(1)} kWh`} color="var(--text2)" />}
          {b?.dischargedEnergy != null && <DetailRow label={gt('r_total_discharged','Total discharged')} value={`${Number(b.dischargedEnergy).toFixed(1)} kWh`} color="var(--text2)" />}
        </DetailCard>

        <DetailCard icon={<SunIcon color="var(--text3)" size={13}/>} title={gt('t_solar','Solar MPPT')}>
          <DetailRow label={gt('r_power','Power')}   value={fmtW(s?.power)}   color="var(--orange)" />
          <DetailRow label={gt('r_today','Today')}   value={`${(s?.dailyYield??0).toFixed(2)} kWh`} color="var(--orange)" />
          {s?.current != null && <DetailRow label={gt('r_current','Current')} value={fmtA(s.current)} />}
          {s?.panelVoltage != null && <DetailRow label={'PV ' + gt('r_voltage','Voltage')} value={fmtV(s.panelVoltage)} />}
          {s?.totalYield != null && <DetailRow label={gt('r_total','Total')} value={`${Number(s.totalYield).toFixed(1)} kWh`} color="var(--text2)" />}
          {s?.temperature != null && <DetailRow label={gt('r_temperature','Temperature')} value={`${Number(s.temperature).toFixed(1)}°C`} />}
          <DetailRow label={gt('r_share','Share of loads')} value={
            loadTotal > 0 ? `${Math.min(100, Math.round(num(s?.power) / loadTotal * 100))}%` : '—'
          } color="var(--text2)" />
          <DetailRow label={gt('r_self_consumption','Self-consumption')}
            value={selfConsumptionPct != null ? `${selfConsumptionPct}%` : '—'} color="var(--text2)" />
        </DetailCard>

        <DetailCard icon={<PylonIcon color="var(--text3)" size={13}/>} title={gt('t_grid','Grid')}>
          <DetailRow label={gt('r_total','Total')}     value={fmtW(gridTotal)}  color={gridColor} />
          <DetailRow label={gt('r_l1','L1 Power')}  value={fmtW(g?.power)}   color={gridColor} />
          <DetailRow label={gt('r_l2','L2 Power')}  value={fmtW(g?.powerL2)} color={gridColor} />
          <DetailRow label={gt('r_l3','L3 Power')}  value={fmtW(g?.powerL3)} color={gridColor} />
          <DetailRow label={gt('r_voltage','Voltage')}   value={fmtV(g?.voltage)} />
          {g?.voltageL2 != null && <DetailRow label={gt('r_l2_voltage','L2 Voltage')} value={fmtV(g.voltageL2)} />}
          {g?.voltageL3 != null && <DetailRow label={gt('r_l3_voltage','L3 Voltage')} value={fmtV(g.voltageL3)} />}
          <DetailRow label={gt('r_freq','Frequency')} value={fmtHz(g?.frequency)} color="var(--text2)" />
          <DetailRow label={gt('r_grid_dependency','Grid dependency')}
            value={gridDependencyPct != null ? `${gridDependencyPct}%` : '—'} color="var(--text2)" />
        </DetailCard>

        <DetailCard icon={<HomeIcon color="var(--text3)" size={13}/>} title={gt('t_loads','AC Loads')}>
          <DetailRow label={gt('r_total','Total')}    value={fmtW(loadTotal)}  color="var(--accent-lt)" />
          <DetailRow label={gt('r_l1','L1 Power')} value={fmtW(l?.power)}   />
          <DetailRow label={gt('r_l2','L2 Power')} value={fmtW(l?.powerL2)} />
          <DetailRow label={gt('r_l3','L3 Power')} value={fmtW(l?.powerL3)} />
        </DetailCard>
      </div>

    </div>
  )
}
