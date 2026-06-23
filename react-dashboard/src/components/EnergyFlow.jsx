const fmt  = (v, d = 1) => (v == null || isNaN(v)) ? '—' : Math.abs(Number(v)).toFixed(d)
const fmtKW = v => (v == null || isNaN(v)) ? '—' : (Math.abs(v) >= 1000 ? (v/1000).toFixed(2)+' kW' : Math.round(v)+' W')

function NodeCard({ icon, label, value, subValue, color, style = {} }) {
  return (
    <div style={{
      background: 'var(--bg2)', border: '1px solid var(--border)',
      borderRadius: 16, padding: '14px 18px', minWidth: 140,
      position: 'relative', overflow: 'hidden', ...style,
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: color, borderRadius: '16px 16px 0 0' }} />
      <div style={{ fontSize: 26, marginBottom: 6 }}>{icon}</div>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.5px', color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{label}</div>
      {subValue && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>{subValue}</div>}
    </div>
  )
}

function CenterNode() {
  return (
    <div style={{
      background: 'var(--bg2)', border: '1px solid rgba(255,255,255,0.15)',
      borderRadius: 20, padding: '16px 20px', textAlign: 'center',
      boxShadow: '0 0 40px rgba(10,132,255,0.08)',
    }}>
      <div style={{ fontSize: 28, marginBottom: 4 }}>⚡</div>
      <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-0.3px' }}>LSH</div>
      <div style={{ fontSize: 10, color: 'var(--text2)' }}>Core</div>
    </div>
  )
}

export default function EnergyFlow({ energy }) {
  const { battery, solar, grid, loads } = energy || {}

  const solarW   = solar?.power ?? 0
  const battSoc  = battery?.soc ?? 0
  const battV    = battery?.voltage ?? 0
  const battCur  = battery?.current ?? 0
  const gridW    = grid?.power ?? 0
  const loadW    = loads?.power ?? 0
  const exporting = gridW < 0

  const battCharging = battCur > 0

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text2)', marginBottom: 16 }}>
        Energy Flow
      </div>

      {/* Flow layout */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, justifyContent: 'space-between' }}>

        {/* Sources */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <NodeCard
            icon="☀️" label={`Daily: ${fmt(solar?.dailyYield, 2)} kWh`}
            value={fmtKW(solarW)} subValue="Solar MPPT"
            color="var(--orange)"
          />
          <NodeCard
            icon="🔋" label={`${battV.toFixed(1)} V · ${battCharging ? '↑ Charging' : '↓ Discharging'}`}
            value={`${fmt(battSoc, 0)} %`} subValue="Battery SoC"
            color={battSoc > 20 ? 'var(--green)' : 'var(--red)'}
          />
        </div>

        {/* Arrows + center */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: 1, position: 'relative' }}>
          <svg width="100%" height="120" style={{ overflow: 'visible' }} preserveAspectRatio="none">
            {/* Solar → center */}
            <path d="M 0,30 C 50,30 50,60 100,60" fill="none" stroke="var(--orange)" strokeWidth="2"
              strokeDasharray="6 4" style={{ animation: 'flowDash 0.6s linear infinite' }} />
            {/* Battery → center */}
            <path d="M 0,90 C 50,90 50,60 100,60" fill="none" stroke="var(--green)" strokeWidth="2"
              strokeDasharray="6 4" style={{ animation: 'flowDash 0.6s linear infinite' }} />
            {/* center → loads */}
            <path d="M 100,60 C 150,60 150,30 200,30" fill="none" stroke="var(--blue)" strokeWidth="2"
              strokeDasharray="6 4" style={{ animation: 'flowDash 0.6s linear infinite' }} />
            {/* center → grid */}
            <path d="M 100,60 C 150,60 150,90 200,90" fill="none"
              stroke={exporting ? 'var(--green)' : 'var(--red)'} strokeWidth="2"
              strokeDasharray="6 4" style={{ animation: 'flowDash 0.6s linear infinite' }} />
          </svg>

          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }}>
            <CenterNode />
          </div>
        </div>

        {/* Outputs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <NodeCard
            icon="🏠" label="AC Loads" subValue={`L1+L2+L3`}
            value={fmtKW(loadW)}
            color="var(--blue)"
          />
          <NodeCard
            icon="🔌"
            label={exporting ? '↗ Exporting' : '↙ Importing'}
            subValue={`${fmt(grid?.voltage, 0)} V · ${fmt(grid?.frequency, 1)} Hz`}
            value={fmtKW(gridW)}
            color={exporting ? 'var(--green)' : 'var(--red)'}
          />
        </div>
      </div>
    </div>
  )
}
