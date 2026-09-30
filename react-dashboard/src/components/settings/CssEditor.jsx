import { useEffect, useRef, useState } from 'react'
import { DEFAULTS, FONT_OPTIONS, ACCENT_PRESETS, SLIDERS, SELECTS, TOGGLES, buildQuickBlock, mergeQuickBlock, parseQuickState } from '../../cssQuickControls'

// Upgrades the plain <textarea> Custom CSS field into something closer to a
// real editor: line-number gutter, Tab inserts spaces instead of leaving the
// field, "Quick tweaks" (accent/font/tile style/background/sizes/toggles —
// see cssQuickControls.js) that write a generated, marked block into the
// text instead of a separate config field, and a live-preview toggle that
// injects the CSS into <head> on THIS page as you type — so you see the
// effect before committing to Save (which is still what persists it, via
// the parent card's existing /api/settings/ui call).
export default function CssEditor({ value, onChange, rows = 12 }) {
  const taRef = useRef(null)
  const gutterRef = useRef(null)
  const [preview, setPreview] = useState(false)
  // Quick-controls state is restored from the state line the generated block
  // carries (see parseQuickState) — on first render, and again whenever the
  // CSS is replaced from outside (loading a theme, the saved config arriving).
  const [controls, setControls] = useState(() => parseQuickState(value))
  const lastEmitted = useRef(value)
  useEffect(() => {
    if (value !== lastEmitted.current) setControls(parseQuickState(value))
    lastEmitted.current = value
  }, [value])
  const [themes, setThemes] = useState({ builtin: [], custom: [] })
  const [themeSel, setThemeSel] = useState('')

  const loadThemes = () => {
    fetch('/api/settings/css-themes', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => { if (d.success) setThemes(d.data) })
      .catch(() => {})
  }
  useEffect(loadThemes, [])

  const applyTheme = async (kind, name) => {
    if (value.trim() && !window.confirm(`Replace the current Custom CSS with "${name}"? This overwrites everything in the box below.`)) return
    const res = await fetch(`/api/settings/css-themes/${kind}/${encodeURIComponent(name)}`, { credentials: 'include' })
    const data = await res.json()
    if (data.success) onChange(data.data.css)
  }

  const saveTheme = async () => {
    const name = window.prompt('Save current Custom CSS as a theme named:')
    if (!name) return
    const res = await fetch(`/api/settings/css-themes/custom/${encodeURIComponent(name)}`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ css: value }),
    })
    const data = await res.json()
    if (data.success) { loadThemes(); setThemeSel(`custom:${data.data.name}`) }
    else window.alert(data.error || 'Failed to save theme')
  }

  const deleteTheme = async (name) => {
    if (!window.confirm(`Delete the saved theme "${name}"? This can't be undone.`)) return
    await fetch(`/api/settings/css-themes/custom/${encodeURIComponent(name)}`, { method: 'DELETE', credentials: 'include' })
    setThemeSel('')
    loadThemes()
  }

  const setControl = (patch) => {
    const next = { ...controls, ...patch }
    const css = mergeQuickBlock(value, buildQuickBlock(next))
    setControls(next)
    lastEmitted.current = css
    onChange(css)
  }

  const lineCount = (value.match(/\n/g)?.length || 0) + 1

  useEffect(() => {
    if (!preview) {
      document.getElementById('lsh-css-live-preview')?.remove()
      return
    }
    let tag = document.getElementById('lsh-css-live-preview')
    if (!tag) {
      tag = document.createElement('style')
      tag.id = 'lsh-css-live-preview'
      document.head.appendChild(tag)
    }
    tag.textContent = value
  }, [preview, value])

  // Belt-and-braces: don't leave a stray preview <style> tag behind if the
  // card unmounts (navigating away in Settings) while preview was still on.
  useEffect(() => () => { document.getElementById('lsh-css-live-preview')?.remove() }, [])

  const onKeyDown = (e) => {
    if (e.key !== 'Tab') return
    e.preventDefault()
    const el = e.target
    const { selectionStart: start, selectionEnd: end } = el
    onChange(value.slice(0, start) + '  ' + value.slice(end))
    requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 2 })
  }

  const syncScroll = () => {
    if (gutterRef.current && taRef.current) gutterRef.current.scrollTop = taRef.current.scrollTop
  }

  return (
    <div className="css-editor">
      <div className="css-editor-themes">
        <select className="stg-input css-editor-theme-select" value={themeSel}
          onChange={(e) => {
            setThemeSel(e.target.value)
            const [kind, ...rest] = e.target.value.split(':')
            const name = rest.join(':')
            if (kind && name) applyTheme(kind, name)
          }}>
          <option value="" disabled>Load theme…</option>
          {themes.builtin.length > 0 && (
            <optgroup label="Built-in">
              {themes.builtin.map((n) => <option key={`builtin:${n}`} value={`builtin:${n}`}>{n}</option>)}
            </optgroup>
          )}
          {themes.custom.length > 0 && (
            <optgroup label="Saved">
              {themes.custom.map((n) => <option key={`custom:${n}`} value={`custom:${n}`}>{n}</option>)}
            </optgroup>
          )}
        </select>
        <button type="button" className="stg-disclosure" onClick={saveTheme}>Save as theme…</button>
        {themeSel.startsWith('custom:') && (
          <button type="button" className="stg-disclosure css-editor-theme-delete"
            onClick={() => deleteTheme(themeSel.slice('custom:'.length))}>
            Delete "{themeSel.slice('custom:'.length)}"
          </button>
        )}
      </div>
      <div className="css-editor-quick">
        <div className="css-editor-quick-head">
          <span>Quick tweaks</span>
          <button type="button" className="stg-disclosure" onClick={() => setControl(DEFAULTS)}>
            Reset tweaks
          </button>
        </div>

        <div className="css-editor-quick-section">Colour & type</div>
        <div className="css-editor-quick-row">
          <div className="css-editor-quick-item">
            <span>Accent</span>
            <div className="css-editor-swatches">
              {ACCENT_PRESETS.map((a) => (
                <button key={a.value} type="button" title={a.label} aria-label={a.label}
                  className="css-editor-swatch" style={{ background: a.value }}
                  data-on={controls.accent.toLowerCase() === a.value || undefined}
                  onClick={() => setControl({ accent: a.value })}/>
              ))}
              <input type="color" title="Custom colour" value={controls.accent}
                onChange={(e) => setControl({ accent: e.target.value })}/>
            </div>
          </div>
          <label className="css-editor-quick-item">
            <span>Font</span>
            <select className="stg-input" value={controls.font} onChange={(e) => setControl({ font: e.target.value })}>
              {FONT_OPTIONS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
            </select>
          </label>
          {SELECTS.map((sel) => (
            <label key={sel.key} className="css-editor-quick-item">
              <span>{sel.label}</span>
              <select className="stg-input" value={controls[sel.key]} onChange={(e) => setControl({ [sel.key]: e.target.value })}>
                {sel.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          ))}
        </div>

        <div className="css-editor-quick-section">Size & shape</div>
        <div className="css-editor-quick-row">
          {SLIDERS.map((sl) => (
            <label key={sl.key} className="css-editor-quick-item">
              <span>{sl.label} <b>{controls[sl.key]}{sl.unit}</b></span>
              <input type="range" min={sl.min} max={sl.max} step={sl.step} value={controls[sl.key]}
                onChange={(e) => setControl({ [sl.key]: Number(e.target.value) })}
                onDoubleClick={() => setControl({ [sl.key]: DEFAULTS[sl.key] })}
                title="Double-click to reset"/>
            </label>
          ))}
        </div>

        <div className="css-editor-quick-section">Tweaks</div>
        <div className="css-editor-toggles">
          {TOGGLES.map((t) => (
            <label key={t.key} className="css-editor-toggle-chip" data-on={controls[t.key] || undefined}>
              <input type="checkbox" checked={!!controls[t.key]}
                onChange={(e) => setControl({ [t.key]: e.target.checked })}/>
              {t.label}
            </label>
          ))}
        </div>
      </div>
      <div className="css-editor-toolbar">
        <label className="css-editor-preview-toggle">
          <input type="checkbox" className="stg-checkbox" checked={preview}
            onChange={(e) => setPreview(e.target.checked)} />
          Live preview on this page
        </label>
        <span className="css-editor-toolbar-spacer"/>
        <button type="button" className="stg-disclosure" onClick={() => {
          if (!value.trim()) return
          if (!window.confirm('Clear all Custom CSS? This removes everything in the box below, not just the Quick controls block.')) return
          onChange('')
        }}>
          Reset to defaults
        </button>
      </div>
      <div className="css-editor-body">
        <div className="css-editor-gutter" ref={gutterRef} aria-hidden="true">
          {Array.from({ length: lineCount }, (_, i) => <div key={i}>{i + 1}</div>)}
        </div>
        <textarea ref={taRef} className="stg-input stg-textarea css-editor-textarea" spellCheck={false}
          value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} onScroll={syncScroll}
          rows={rows} placeholder={'/* e.g. */\n.device-tile { border-radius: 4px !important; }'} />
      </div>
    </div>
  )
}
