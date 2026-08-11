import { PlusIcon, MinusIcon } from '../Icons'

// ── Shared Settings design system ───────────────────────────────────────────
// Visual rules live in ../../styles/settings.css (built on the existing CSS
// vars in styles/global.css, so dark/light theme parity is automatic). These
// components only carry structure + behavior.

export function SettingsCard({ icon: Icon, title, badge, desc, children }) {
  return (
    <section className="stg-card">
      <div className="stg-card-head">
        {Icon && <span className="stg-card-icon"><Icon size={20}/></span>}
        <h3 className="stg-card-title">{title}</h3>
        {badge && <span className={`stg-badge stg-badge-${badge.tone || 'optional'}`}>{badge.label}</span>}
      </div>
      {desc && <p className="stg-card-desc">{desc}</p>}
      <div className="stg-card-body">{children}</div>
    </section>
  )
}

export function Field({
  label, hint, value, onChange, type = 'text', placeholder, options,
  min, max, maxLength, autoComplete, inputMode, disabled, style,
}) {
  const id = 'f-' + Math.random().toString(36).slice(2, 9)
  return (
    <div className="stg-field" style={style}>
      {label && <label htmlFor={id}>{label}{hint && <span className="stg-hint"> {hint}</span>}</label>}
      {type === 'select' ? (
        <select id={id} className="stg-input" value={value} disabled={disabled}
          onChange={e => onChange(e.target.value)}>
          {(options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : type === 'textarea' ? (
        <textarea id={id} className="stg-input stg-textarea" value={value} placeholder={placeholder}
          disabled={disabled} onChange={e => onChange(e.target.value)} rows={4}/>
      ) : type === 'checkbox' ? (
        <input id={id} className="stg-checkbox" type="checkbox" checked={!!value}
          disabled={disabled} onChange={e => onChange(e.target.checked)}/>
      ) : (
        <input id={id} className="stg-input" type={type} value={value} placeholder={placeholder}
          min={min} max={max} maxLength={maxLength} autoComplete={autoComplete} inputMode={inputMode}
          disabled={disabled} onChange={e => onChange(e.target.value)}/>
      )}
    </div>
  )
}

export function Toggle({ label, checked, onChange, hint }) {
  // A real checkbox under the hood (visually hidden, not display:none) so
  // Tab+Space works — vanilla's .toggle-label uses a real <input> too, this
  // just skins it instead of faking the whole control with a clickable <span>.
  return (
    <label className="stg-toggle-row">
      <input type="checkbox" className="stg-toggle-input" checked={!!checked} onChange={e => onChange(e.target.checked)}/>
      <span className={`stg-toggle ${checked ? 'on' : ''}`}><span className="stg-toggle-knob"/></span>
      <span className="stg-toggle-label">{label}{hint && <span className="stg-hint"> {hint}</span>}</span>
    </label>
  )
}

export function Button({ children, onClick, variant = 'secondary', busy, disabled, type, href, download, title }) {
  const cls = `stg-btn stg-btn-${variant}${busy ? ' busy' : ''}`
  if (href) {
    return <a className={cls} href={href} download={download} title={title}>{children}</a>
  }
  return (
    <button className={cls} onClick={onClick} disabled={disabled || busy} type={type || 'button'} title={title}>
      {busy && <span className="stg-spinner"/>}
      {children}
    </button>
  )
}

export function ResultBanner({ result }) {
  if (!result) return null
  return <span className={`stg-banner ${result.ok ? 'ok' : 'err'}`}>{result.ok ? '✓' : '✗'} {result.message}</span>
}

// Generic editable array-of-objects list — the one interaction pattern with
// no existing precedent anywhere in the React app (contrast: DeviceModal's
// EditPanel edits a single object, never a repeating list). `fields`
// describes each column; `renderExtra(row, i)` lets a section slot in a
// per-row action (e.g. Reolink's snapshot Test button) without ListEditor
// needing to know about it.
export function ListEditor({ rows, onChange, fields, renderExtra, addLabel = '+ Add' }) {
  const setRow = (i, patch) => {
    const next = rows.slice()
    next[i] = { ...next[i], ...patch }
    onChange(next)
  }
  const addRow = () => onChange([...rows, Object.fromEntries(fields.map(f => [f.key, f.default ?? '']))])
  const removeRow = (i) => onChange(rows.filter((_, idx) => idx !== i))

  return (
    <div className="stg-list">
      {rows.map((row, i) => (
        <div className="stg-list-row" key={i}>
          <div className="stg-list-row-fields">
            {fields.map(f => (
              <Field key={f.key} label={f.label} type={f.type} value={row[f.key] ?? (f.type === 'checkbox' ? false : '')}
                placeholder={f.placeholder} options={f.options}
                onChange={v => setRow(i, { [f.key]: v })}/>
            ))}
          </div>
          <div className="stg-list-row-actions">
            {renderExtra && renderExtra(row, i, (patch) => setRow(i, patch))}
            <button className="stg-list-remove" title="Remove" onClick={() => removeRow(i)}>
              <MinusIcon size={16}/>
            </button>
          </div>
        </div>
      ))}
      <button className="stg-list-add" onClick={addRow}>
        <PlusIcon size={16}/> {addLabel}
      </button>
    </div>
  )
}
