import { useState, useRef, useEffect } from 'react'
import { gt } from '../i18n'
import { ENERGY_METRICS, ENERGY_SOURCES } from '../energySources'

// Gear button in the Energy header that opens a small popover letting the user
// choose which brand feeds each metric (solar / battery / grid / loads).
// Only rendered when more than one source is actually available.
export default function EnergySourcePicker({ sources, onChange }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const mixed = ENERGY_METRICS.some(m => sources[m.id] !== 'victron')

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-flex' }}
      onClick={e => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title={gt('e_sources', 'Data sources')}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          background: mixed ? 'var(--accent-soft, rgba(74,157,255,0.15))' : 'transparent',
          border: '1px solid var(--border)', color: mixed ? 'var(--accent-lt)' : 'var(--text3)',
          borderRadius: 8, padding: '3px 7px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        {gt('e_sources', 'Sources')}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 30,
          minWidth: 232, background: 'var(--card, #12151c)',
          border: '1px solid var(--border)', borderRadius: 'var(--radius-lg, 12px)',
          boxShadow: '0 16px 40px rgba(0,0,0,0.55)', padding: 10,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)',
            textTransform: 'uppercase', letterSpacing: '0.04em', padding: '2px 2px 8px' }}>
            {gt('e_sources_title', 'Energy source per metric')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ENERGY_METRICS.map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>
                  {gt('e_' + m.id, m.label)}
                </span>
                <div style={{ display: 'inline-flex', background: 'rgba(0,0,0,0.35)',
                  border: '1px solid var(--border)', borderRadius: 8, padding: 2 }}>
                  {ENERGY_SOURCES.map(s => {
                    const active = sources[m.id] === s.id
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => onChange({ ...sources, [m.id]: s.id })}
                        style={{
                          padding: '3px 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                          border: 'none', borderRadius: 6,
                          background: active ? 'var(--accent, #4a9dff)' : 'transparent',
                          color: active ? '#fff' : 'var(--text3)',
                        }}
                      >
                        {s.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
