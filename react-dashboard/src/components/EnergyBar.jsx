function fmt(val, decimals = 1) {
  if (val == null || isNaN(val)) return '—'
  return Number(val).toFixed(decimals)
}

function Tile({ icon, label, value, unit, glowColor }) {
  return (
    <div className="glass" style={{
      flex: 1,
      padding: '10px 18px',
      borderTop: '2px solid var(--gold)',
      borderRadius: 12,
      position: 'relative',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        background: `radial-gradient(ellipse 80% 60% at 50% 120%, ${glowColor} 0%, transparent 70%)`,
        pointerEvents: 'none',
      }} />
      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>
        {icon} {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 26, fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>
          {value}
        </span>
        {unit && <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500 }}>{unit}</span>}
      </div>
    </div>
  )
}

function RelayPill({ label, on }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 14px',
      borderRadius: 20,
      background: on ? 'rgba(61,186,110,0.1)' : 'var(--white-03)',
      border: `1px solid ${on ? 'rgba(61,186,110,0.3)' : 'rgba(212,175,55,0.15)'}`,
    }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: on ? 'var(--green)' : 'var(--muted)',
        boxShadow: on ? '0 0 6px var(--green)' : 'none',
      }} />
      <span style={{ fontSize: 11, fontWeight: 600, color: on ? 'var(--green)' : 'var(--muted)', letterSpacing: '0.05em' }}>
        {label}
      </span>
    </div>
  )
}

export default function EnergyBar({ status }) {
  const soc    = fmt(status?.battery?.soc, 0)
  const solar  = fmt(status?.solar?.power != null ? status.solar.power / 1000 : null)
  const grid   = fmt(status?.grid?.power   != null ? status.grid.power   / 1000 : null)
  const load   = fmt(status?.load?.power   != null ? status.load.power   / 1000 : null)

  const relay1 = status?.relays?.[0]?.state ?? false
  const relay2 = status?.relays?.[1]?.state ?? false

  return (
    <div style={{
      display: 'flex', alignItems: 'stretch', gap: 8,
      padding: '8px 16px',
      background: 'rgba(7,7,15,0.6)',
      borderBottom: '1px solid rgba(212,175,55,0.1)',
      flexShrink: 0,
      height: 76,
    }}>
      <Tile icon="⚡" label="Solar"   value={solar} unit="kW" glowColor="rgba(240,136,62,0.18)" />
      <Tile icon="🔋" label="Battery" value={soc}   unit="%"  glowColor="rgba(61,186,110,0.18)" />
      <Tile icon="🔌" label="Grid"    value={grid}  unit="kW" glowColor="rgba(74,158,255,0.18)" />
      <Tile icon="🏠" label="Load"    value={load}  unit="kW" glowColor="rgba(155,127,212,0.18)" />

      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6, marginLeft: 8 }}>
        <RelayPill label="Relay 1" on={relay1} />
        <RelayPill label="Relay 2" on={relay2} />
      </div>
    </div>
  )
}
