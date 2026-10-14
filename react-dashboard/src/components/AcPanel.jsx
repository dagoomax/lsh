import { useEffect, useRef, useState } from 'react'
import { MODE_COLOR, acText, fmtTemp } from '../acModel'

// Air conditioner controls in the device popup (Homey style): a set-point ring
// with − / +, power, mode chips, fan speed, swing and the room / outdoor
// readings. `ac` comes from acView(); `send(path, value)` issues the command.
const MODE_ICON = { auto: 'A', cool: '❄︎', dry: '💧', fan: '🌀', heat: '☀︎' }

export default function AcPanel({ ac, send }) {
  const [temp, setTemp] = useState(ac.setTemp)
  const timer = useRef(null)
  useEffect(() => { if (!timer.current) setTemp(ac.setTemp) }, [ac.setTemp])
  useEffect(() => () => clearTimeout(timer.current), [])

  const color = ac.on ? MODE_COLOR[ac.mode] || '#0a84ff' : 'var(--text3)'
  const noSetpoint = ac.mode === 'fan'
  // set-point changes are sent once the − / + taps stop for a moment
  const nudge = (d) => {
    if (temp == null) return
    const next = Math.min(ac.max, Math.max(ac.min, Math.round((temp + d * ac.step) / ac.step) * ac.step))
    setTemp(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { timer.current = null; send(...ac.cmd.temp(next)) }, 700)
  }
  const frac = temp == null ? 0 : (temp - ac.min) / Math.max(1, ac.max - ac.min)
  // 270° ring, open at the bottom
  const R = 74, C = 2 * Math.PI * R, arc = C * 0.75

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 22, flexWrap: 'wrap' }}>
        <RoundBtn label="−" disabled={!ac.on || noSetpoint || temp == null || temp <= ac.min} onClick={() => nudge(-1)} />
        <div style={{ position: 'relative', width: 176, height: 176 }}>
          <svg width="176" height="176" viewBox="0 0 176 176" style={{ transform: 'rotate(135deg)' }} aria-hidden="true">
            <circle cx="88" cy="88" r={R} fill="none" stroke="var(--white-08)" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${arc} ${C}`} />
            <circle cx="88" cy="88" r={R} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
              strokeDasharray={`${ac.on && !noSetpoint ? Math.max(0.001, arc * frac) : 0.001} ${C}`} style={{ transition: 'stroke-dasharray .35s ease, stroke .3s ease' }} />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
              {ac.on ? acText(ac.mode) : acText('off')}
            </div>
            <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: '-0.04em', color: ac.on ? 'var(--text)' : 'var(--text3)', fontVariantNumeric: 'tabular-nums' }}>
              {noSetpoint ? '—' : fmtTemp(temp)}
            </div>
            {ac.roomTemp != null && <div style={{ fontSize: 12, color: 'var(--text2)' }}>{acText('room')} {fmtTemp(ac.roomTemp)}</div>}
          </div>
        </div>
        <RoundBtn label="+" disabled={!ac.on || noSetpoint || temp == null || temp >= ac.max} onClick={() => nudge(1)} />
      </div>
      {noSetpoint && ac.on && <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text3)', marginTop: -8 }}>{acText('fanOnly')}</div>}

      <Row label={acText('power')}>
        <Pill on={ac.on} onClick={() => send(...ac.cmd.power(!ac.on))} color={color}>{ac.on ? acText('on') : acText('off')}</Pill>
      </Row>

      <Row label={acText('mode')}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {ac.modes.map((m) => (
            <Pill key={m} on={ac.on && ac.mode === m} color={MODE_COLOR[m]}
              onClick={() => { if (!ac.on) send(...ac.cmd.power(true)); send(...ac.cmd.mode(m)) }}>
              <span aria-hidden="true" style={{ marginRight: 4 }}>{MODE_ICON[m]}</span>{acText(m)}
            </Pill>
          ))}
        </div>
      </Row>

      {ac.fan != null && (
        <Row label={acText('fanSpeed')}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {ac.fans.map((f, i) => (
              <Pill key={f} small on={ac.fan === i} color={color} onClick={() => send(...ac.cmd.fan(i))}>{acText(f)}</Pill>
            ))}
          </div>
        </Row>
      )}

      {ac.swing != null && ac.cmd.swing && (
        <Row label={acText('swing')}>
          <Pill on={ac.swing} color={color} onClick={() => send(...ac.cmd.swing(!ac.swing))}>{ac.swing ? acText('on') : acText('off')}</Pill>
        </Row>
      )}

      {(ac.outdoorTemp != null || ac.humidity != null) && (
        <div style={{ display: 'flex', gap: 8 }}>
          {ac.outdoorTemp != null && <Stat label={acText('outdoor')} value={fmtTemp(ac.outdoorTemp)} />}
          {ac.humidity != null && <Stat label={acText('humidity')} value={`${Math.round(ac.humidity)}%`} />}
        </div>
      )}
    </div>
  )
}

function RoundBtn({ label, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label === '+' ? 'Warmer' : 'Cooler'} style={{
      width: 52, height: 52, borderRadius: '50%', border: 'none', fontSize: 26, fontWeight: 500, lineHeight: 1,
      background: 'var(--white-10)', color: disabled ? 'var(--text3)' : 'var(--text)', cursor: disabled ? 'default' : 'pointer',
    }}>{label}</button>
  )
}

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--white-06)', borderRadius: 16 }}>
      <span style={{ fontSize: 13, fontWeight: 600, minWidth: 84 }}>{label}</span>
      <span style={{ marginLeft: 'auto' }}>{children}</span>
    </div>
  )
}

function Pill({ on, color, onClick, children, small }) {
  return (
    <button onClick={onClick} style={{
      padding: small ? '5px 10px' : '7px 13px', borderRadius: 999, border: 'none', cursor: 'pointer',
      fontSize: small ? 12 : 13, fontWeight: 600, whiteSpace: 'nowrap',
      background: on ? color : 'var(--white-08)', color: on ? '#fff' : 'var(--text2)',
      transition: 'background .2s ease, color .2s ease',
    }}>{children}</button>
  )
}

function Stat({ label, value }) {
  return (
    <div style={{ flex: 1, padding: '10px 14px', background: 'var(--white-06)', borderRadius: 16 }}>
      <div style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  )
}
