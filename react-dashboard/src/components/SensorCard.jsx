export default function SensorCard({ sensor }) {
  return (
    <div className="glass" style={{
      padding: '12px 14px',
      borderRadius: 12,
      display: 'flex',
      alignItems: 'center',
      gap: 10,
    }}>
      <div style={{ fontSize: 20 }}>📡</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {sensor.label || sensor.key}
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
          {sensor.value != null ? `${sensor.value}${sensor.unit || ''}` : '—'}
        </div>
      </div>
    </div>
  )
}
