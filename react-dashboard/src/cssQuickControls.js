// Pure helpers behind the CSS editor's "Quick controls" row (accent color,
// font, popup size, tile size) — they read/write a marked block inside the
// Custom CSS text instead of a separate config field, so the generated CSS
// stays visible and hand-editable like everything else in that box.

export const QUICK_START = '/* ── quick controls — generated, safe to edit by hand ── */'
export const QUICK_END = '/* ── end quick controls ── */'

// Matches the dashboard's own dark-mode default (global.css :root --accent)
// — picking this color back in the swatch means "no override", so nothing
// gets emitted for it.
export const DEFAULTS = {
  accent: '#4a9dff', font: '', popupWidth: 680, tileSize: 150,
  flatTiles: false, bigTileText: false, amoledBlack: false,
  unifiedCategoryColor: false, squarePopup: false, bigPopupTitle: false,
}

export const FONT_OPTIONS = [
  { label: 'System default', value: '' },
  { label: 'Classic serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Rounded', value: '"SF Pro Rounded", ui-rounded, "Segoe UI", sans-serif' },
  { label: 'Monospace', value: 'ui-monospace, "SF Mono", Menlo, monospace' },
]

// One toggle per EXAMPLES entry that doesn't already have a dedicated
// picker/slider above (accent color and tile density do — see accent/font/
// popupWidth/tileSize) — same CSS as the matching dropdown snippet, just
// switchable instead of pasted as one-shot text.
export const TOGGLES = [
  {
    key: 'flatTiles', label: 'Flat, rounded tiles',
    // global.css's own .device-tile sets both properties at the same
    // specificity, and (being part of the app bundle) loads *after*
    // custom.css in <head> — so without !important this silently does
    // nothing. Confirmed by reading global.css, not assumed.
    css: '.device-tile {\n  border-radius: 20px !important;\n  box-shadow: none !important;\n}',
  },
  {
    key: 'bigTileText', label: 'Bigger tile text (wall display)',
    css: '.device-tile { font-size: 1.15em; }\n.device-tile span { font-size: 1.1em !important; }',
  },
  {
    key: 'amoledBlack', label: 'AMOLED true black',
    css: ':root:not([data-theme="light"]) {\n  --bg: #000000;\n  --card: #0a0a0a;\n  --card-grad: linear-gradient(180deg, #0a0a0a 0%, #050505 100%);\n}',
  },
  {
    key: 'unifiedCategoryColor', label: 'One accent for every category',
    css: '.device-tile[data-cat] { --cat-c: var(--accent) !important; }',
  },
  {
    key: 'squarePopup', label: 'Squarer, opaque popup',
    css: '.device-modal-glow {\n  border-radius: 10px !important;\n  background: var(--card) !important;\n}',
  },
  {
    key: 'bigPopupTitle', label: 'Bigger popup title',
    // font-weight: 500 is also on the base .modal-device-title rule —
    // same load-order issue as flatTiles above.
    css: '.modal-device-title { font-size: 24px !important; font-weight: 700 !important; }',
  },
]

function hexToRgb(hex) {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function lighten([r, g, b], amt) {
  return [r, g, b].map((c) => Math.round(c + (255 - c) * amt))
}

function toHex([r, g, b]) {
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')
}

export function buildQuickBlock(controls) {
  const lines = []

  if (controls.accent !== DEFAULTS.accent) {
    // global.css's own bare :root also sets --accent/-lt/-dim (its dark-mode
    // defaults live there unqualified, not behind a media query) — same
    // selector, same specificity, and it loads after custom.css, so this
    // needs !important or it's silently a no-op. Confirmed by reading
    // global.css, not assumed — this bit it in an earlier version.
    const rgb = hexToRgb(controls.accent)
    const lt = toHex(lighten(rgb, 0.28))
    lines.push(`:root {\n  --accent: ${controls.accent} !important;\n  --accent-lt: ${lt} !important;\n  --accent-dim: rgba(${rgb.join(', ')}, 0.2) !important;\n}`)
  }
  if (controls.font) {
    // body's own font-family (global.css) is set directly on the selector,
    // not via a variable, and custom.css loads before the app bundle in
    // <head> — so this needs !important to actually win.
    lines.push(`body { font-family: ${controls.font} !important; }`)
  }
  if (controls.popupWidth !== DEFAULTS.popupWidth) {
    // .device-modal-glow's width is inline (DeviceModal.jsx) — !important required.
    lines.push(`.device-modal-glow { width: min(${controls.popupWidth}px, 100%) !important; }`)
  }
  if (controls.tileSize !== DEFAULTS.tileSize) {
    // .device-grid's columns are inline too (DeviceList.jsx) — same reason.
    lines.push(`.device-grid { grid-template-columns: repeat(auto-fill, minmax(${controls.tileSize}px, 1fr)) !important; }`)
  }
  for (const toggle of TOGGLES) {
    if (controls[toggle.key]) lines.push(toggle.css)
  }

  return lines.length ? `${QUICK_START}\n${lines.join('\n')}\n${QUICK_END}` : ''
}

// Replaces the marked block inside `css` with `block` (or removes it, if
// `block` is empty — every control back at its default), leaving any
// hand-written CSS before/after untouched.
export function mergeQuickBlock(css, block) {
  const startIdx = css.indexOf(QUICK_START)
  const endIdx = css.indexOf(QUICK_END)
  const hasExisting = startIdx !== -1 && endIdx !== -1 && endIdx > startIdx

  const before = hasExisting ? css.slice(0, startIdx).trimEnd() : css.trim()
  const after = hasExisting ? css.slice(endIdx + QUICK_END.length).trimStart() : ''

  return [before, block, after].filter(Boolean).join('\n\n')
}
