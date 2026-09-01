import { useEffect, useRef, useState } from 'react'

// Real, working snippets — every selector/variable here exists in
// src/styles/global.css, so pasting one in and hitting Save (or just
// toggling Live preview) has a visible, correct effect immediately.
const EXAMPLES = [
  {
    label: 'Rounder, flatter tiles',
    css: '.device-tile {\n  border-radius: 20px;\n  box-shadow: none;\n}',
  },
  {
    label: 'Custom accent color',
    css: ':root {\n  --accent: #ff5470;\n  --accent-lt: #ff8099;\n  --accent-dim: rgba(255, 84, 112, 0.18);\n}',
  },
  {
    label: 'More tiles per row',
    css: '.device-grid {\n  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)) !important;\n}',
  },
  {
    label: 'Bigger text (wall-mounted display)',
    css: '.device-tile { font-size: 1.15em; }\n.device-tile span { font-size: 1.1em !important; }',
  },
  {
    label: 'True black background (AMOLED)',
    css: ':root:not([data-theme="light"]) {\n  --bg: #000000;\n  --card: #0a0a0a;\n  --card-grad: linear-gradient(180deg, #0a0a0a 0%, #050505 100%);\n}',
  },
  {
    label: 'One accent color for every category',
    css: '.device-tile[data-cat] { --cat-c: var(--accent) !important; }',
  },
  {
    label: 'Squarer, more opaque device popup',
    css: '.device-modal-glow {\n  border-radius: 10px !important;\n  background: var(--card) !important;\n}',
  },
  {
    label: 'Bigger popup title',
    css: '.modal-device-title { font-size: 24px !important; font-weight: 700; }',
  },
]

// Upgrades the plain <textarea> Custom CSS field into something closer to a
// real editor: line-number gutter, Tab inserts spaces instead of leaving the
// field, one-click example snippets, and a live-preview toggle that injects
// the CSS into <head> on THIS page as you type — so you see the effect
// before committing to Save (which is still what persists it, via the
// parent card's existing /api/settings/ui call).
export default function CssEditor({ value, onChange, rows = 12 }) {
  const taRef = useRef(null)
  const gutterRef = useRef(null)
  const [preview, setPreview] = useState(false)

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

  const insertExample = (css) => {
    onChange(value.trim() ? `${value}\n\n${css}` : css)
    taRef.current?.focus()
  }

  const syncScroll = () => {
    if (gutterRef.current && taRef.current) gutterRef.current.scrollTop = taRef.current.scrollTop
  }

  return (
    <div className="css-editor">
      <div className="css-editor-toolbar">
        <select className="stg-input css-editor-examples" defaultValue=""
          onChange={(e) => {
            const example = EXAMPLES.find((ex) => ex.label === e.target.value)
            if (example) insertExample(example.css)
            e.target.value = ''
          }}>
          <option value="" disabled>Insert example…</option>
          {EXAMPLES.map((ex) => <option key={ex.label} value={ex.label}>{ex.label}</option>)}
        </select>
        <label className="css-editor-preview-toggle">
          <input type="checkbox" className="stg-checkbox" checked={preview}
            onChange={(e) => setPreview(e.target.checked)} />
          Live preview on this page
        </label>
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
