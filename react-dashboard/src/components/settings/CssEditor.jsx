import { useEffect, useRef, useState } from 'react'
import { DEFAULTS, FONT_OPTIONS, TOGGLES, buildQuickBlock, mergeQuickBlock } from '../../cssQuickControls'

// Upgrades the plain <textarea> Custom CSS field into something closer to a
// real editor: line-number gutter, Tab inserts spaces instead of leaving the
// field, "Quick controls" (accent/font/popup size/tile size/style toggles —
// see cssQuickControls.js) that write a generated, marked block into the
// text instead of a separate config field, and a live-preview toggle that
// injects the CSS into <head> on THIS page as you type — so you see the
// effect before committing to Save (which is still what persists it, via
// the parent card's existing /api/settings/ui call).
export default function CssEditor({ value, onChange, rows = 12 }) {
  const taRef = useRef(null)
  const gutterRef = useRef(null)
  const [preview, setPreview] = useState(false)
  // Quick-controls state lives here, not parsed back out of `value` — it's a
  // convenience layer over the generated block (see cssQuickControls.js),
  // not a second source of truth. Reopening the page resets these to
  // defaults even if a generated block is still present in the saved CSS;
  // the block itself is what actually applies either way.
  const [controls, setControls] = useState(DEFAULTS)
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
    if (data.success) {
      setControls(DEFAULTS)
      onChange(data.data.css)
    }
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
    setControls(next)
    onChange(mergeQuickBlock(value, buildQuickBlock(next)))
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
        <label className="css-editor-quick-item">
          <span>Accent</span>
          <input type="color" value={controls.accent} onChange={(e) => setControl({ accent: e.target.value })}/>
        </label>
        <label className="css-editor-quick-item">
          <span>Font</span>
          <select className="stg-input" value={controls.font} onChange={(e) => setControl({ font: e.target.value })}>
            {FONT_OPTIONS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
          </select>
        </label>
        <label className="css-editor-quick-item">
          <span>Popup size ({controls.popupWidth}px)</span>
          <input type="range" min={480} max={960} step={20} value={controls.popupWidth}
            onChange={(e) => setControl({ popupWidth: Number(e.target.value) })}/>
        </label>
        <label className="css-editor-quick-item">
          <span>Tile size ({controls.tileSize}px)</span>
          <input type="range" min={100} max={220} step={10} value={controls.tileSize}
            onChange={(e) => setControl({ tileSize: Number(e.target.value) })}/>
        </label>
        <button type="button" className="stg-disclosure" onClick={() => {
          setControls(DEFAULTS)
          onChange(mergeQuickBlock(value, ''))
        }}>
          Reset controls
        </button>
      </div>
      <div className="css-editor-toggles">
        {TOGGLES.map((t) => (
          <label key={t.key} className="css-editor-toggle-chip" data-on={controls[t.key] || undefined}>
            <input type="checkbox" checked={!!controls[t.key]}
              onChange={(e) => setControl({ [t.key]: e.target.checked })}/>
            {t.label}
          </label>
        ))}
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
          setControls(DEFAULTS)
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
