import { motion } from 'framer-motion'

const SENSOR_ICONS = {
  temperature: '🌡️',
  humidity: '💧',
  motion: '👁️',
  switch: '⚡',
  light: '💡',
  battery: '🔋',
  'switch-rw': '⚡',
  'light-rw': '💡',
  occupancy: '🏠',
  'air-quality': '🌬️',
  thermostat: '🌡️',
}

function SensorRow({ sensor }) {
  const icon = SENSOR_ICONS[sensor.homekitType] || SENSOR_ICONS[sensor.sensorType] || '📡'
  const val = sensor.value != null ? String(sensor.value) : '—'
  const unit = sensor.unit || ''

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 12px',
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(212,175,55,0.08)',
      borderRadius: 10,
      animation: 'fadeInUp 0.3s ease',
    }}>
      <span style={{ fontSize: 16, flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500, letterSpacing: '0.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {sensor.label || sensor.key}
        </div>
      </div>
      <div style={{ flexShrink: 0, textAlign: 'right' }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{val}</span>
        {unit && <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 3 }}>{unit}</span>}
      </div>
    </div>
  )
}

export default function RoomPanel({ room, sensors, onClose }) {
  if (!room) return null

  const roomSensors = sensors.filter(s => {
    const key = (s.key || '').toLowerCase()
    const label = (s.label || '').toLowerCase()
    const roomId = room.id.toLowerCase()
    const roomLabel = room.label.toLowerCase()
    return key.includes(roomId) || label.includes(roomId) || label.includes(roomLabel.split(' ')[0].toLowerCase())
  })

  const controllable = roomSensors.filter(s => s.controllable)

  return (
    <motion.div
      initial={{ x: 400, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 400, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 32 }}
      className="glass glow-gold"
      style={{
        position: 'fixed',
        right: 0,
        top: 64,
        height: 'calc(100vh - 64px - 76px)',
        width: 340,
        borderLeft: '3px solid var(--gold)',
        borderRadius: '16px 0 0 16px',
        padding: '20px 20px 20px',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        zIndex: 50,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 32, marginBottom: 4 }}>{room.icon}</div>
          <div className="gold-text" style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, fontWeight: 700, lineHeight: 1.2 }}>
            {room.label}
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 4 }}>
            {roomSensors.length} sensor{roomSensors.length !== 1 ? 's' : ''} assigned
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(212,175,55,0.2)',
            borderRadius: 8,
            color: 'var(--muted)',
            cursor: 'pointer',
            fontSize: 18,
            width: 32, height: 32,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >×</button>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: 'linear-gradient(90deg, var(--gold), transparent)', opacity: 0.3 }} />

      {/* Sensors */}
      <div>
        <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: 8 }}>
          Sensors
        </div>
        {roomSensors.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {roomSensors.map(s => <SensorRow key={s.key} sensor={s} />)}
          </div>
        ) : (
          <div style={{
            padding: '16px', textAlign: 'center',
            color: 'var(--muted)', fontSize: 12,
            border: '1px dashed rgba(212,175,55,0.15)',
            borderRadius: 10,
          }}>
            No sensors assigned to this room
          </div>
        )}
      </div>

      {/* Quick actions */}
      {controllable.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: 8 }}>
            Quick Actions
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {controllable.slice(0, 4).map(s => (
              <div key={s.key} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px',
                background: 'rgba(212,175,55,0.05)',
                border: '1px solid rgba(212,175,55,0.15)',
                borderRadius: 10,
              }}>
                <span style={{ fontSize: 12, fontWeight: 500 }}>{s.label || s.key}</span>
                <div style={{
                  width: 36, height: 20, borderRadius: 10,
                  background: s.value ? 'var(--green)' : 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(212,175,55,0.2)',
                  position: 'relative', cursor: 'pointer',
                  transition: 'background 0.2s',
                }}>
                  <div style={{
                    position: 'absolute', top: 2,
                    left: s.value ? 18 : 2,
                    width: 14, height: 14, borderRadius: '50%',
                    background: '#fff',
                    transition: 'left 0.2s',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  )
}
