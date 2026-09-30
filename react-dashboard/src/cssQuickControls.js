// Pure helpers behind the CSS editor's "Quick controls" (colors, sizes,
// tile style, background, toggles) — they read/write a marked block inside
// the Custom CSS text instead of a separate config field, so the generated
// CSS stays visible and hand-editable like everything else in that box.
//
// /custom.css loads BEFORE the app bundle in <head>, so any rule here that
// ties with a global.css rule (same selector/specificity — including its
// bare :root tokens and inline styles in the components) loses unless it
// carries !important. That's why nearly everything below is !important.

export const QUICK_START = '/* ── quick controls — generated, safe to edit by hand ── */'
export const QUICK_END = '/* ── end quick controls ── */'
// The block also carries the control values as JSON, so reopening the editor
// restores the sliders/toggles instead of resetting them to defaults.
const STATE_PREFIX = '/* quick-state: '

// Mirrors the dashboard's own defaults (global.css) — a control sitting at
// its default emits nothing, so an untouched editor adds no CSS at all.
export const DEFAULTS = {
  accent: '#0a84ff', font: '',
  uiScale: 100, radius: 20, popupWidth: 680, tileSize: 150, tileGap: 10,
  onTileStyle: 'white', background: 'plain', switchColor: 'green',
  unifiedCategoryColor: false, dimOffTiles: false, hideTileStatus: false,
  compactTiles: false, squareIcons: false, bigTileText: false,
  amoledBlack: false, squarePopup: false, bigPopupTitle: false,
  noBlur: false, reduceMotion: false,
}

export const FONT_OPTIONS = [
  { label: 'System (SF / Inter)', value: '' },
  { label: 'Rounded', value: '"SF Pro Rounded", ui-rounded, "Nunito", "Segoe UI", sans-serif' },
  { label: 'Classic serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Condensed', value: '"Avenir Next Condensed", "Roboto Condensed", "Arial Narrow", sans-serif' },
  { label: 'Monospace', value: 'ui-monospace, "SF Mono", Menlo, monospace' },
]

export const ACCENT_PRESETS = [
  { label: 'Homey blue', value: '#0a84ff' },
  { label: 'Green',      value: '#30d158' },
  { label: 'Orange',     value: '#ff9f0a' },
  { label: 'Pink',       value: '#ff375f' },
  { label: 'Purple',     value: '#bf5af2' },
  { label: 'Teal',       value: '#64d2ff' },
  { label: 'Graphite',   value: '#8e8e93' },
]

// Sliders: key, label, range, unit. Rendered generically by CssEditor.jsx.
export const SLIDERS = [
  { key: 'uiScale',    label: 'UI scale',       min: 80,  max: 130, step: 5,  unit: '%' },
  { key: 'radius',     label: 'Corner radius',  min: 0,   max: 32,  step: 2,  unit: 'px' },
  { key: 'tileSize',   label: 'Tile size',      min: 100, max: 240, step: 10, unit: 'px' },
  { key: 'tileGap',    label: 'Tile spacing',   min: 4,   max: 24,  step: 2,  unit: 'px' },
  { key: 'popupWidth', label: 'Popup width',    min: 480, max: 960, step: 20, unit: 'px' },
]

// Selects: key, label, options [{ label, value }].
export const SELECTS = [
  { key: 'onTileStyle', label: 'Tile when on', options: [
    { label: 'White (Homey)', value: 'white' },
    { label: 'Category tint', value: 'tint' },
    { label: 'Solid colour',  value: 'solid' },
  ] },
  { key: 'background', label: 'Background', options: [
    { label: 'Plain', value: 'plain' },
    { label: 'Soft gradient', value: 'gradient' },
    { label: 'Accent wash', value: 'wash' },
  ] },
  { key: 'switchColor', label: 'Switches', options: [
    { label: 'Green (iOS)', value: 'green' },
    { label: 'Accent colour', value: 'accent' },
    { label: 'Category colour', value: 'category' },
  ] },
]

// On/off tweaks — each one is a self-contained CSS snippet.
export const TOGGLES = [
  {
    key: 'unifiedCategoryColor', label: 'One colour for every category',
    css: '[data-cat] { --cat-c: var(--accent) !important; }\n.device-tile[data-cat] { --tile-accent: var(--accent) !important; }',
  },
  {
    key: 'dimOffTiles', label: 'Fade devices that are off',
    css: '.device-tile[data-on="false"] { opacity: 0.55; }\n.device-tile[data-on="false"]:hover { opacity: 0.85; }',
  },
  {
    key: 'hideTileStatus', label: 'Hide tile status line',
    css: '.device-tile .tile-status { display: none !important; }',
  },
  {
    key: 'compactTiles', label: 'Compact tiles',
    // min-height/padding are inline on the tile (DeviceList.jsx)
    css: '.device-tile { min-height: 96px !important; padding: 10px !important; }\n.device-tile .tile-icon { width: 32px; height: 32px; }',
  },
  {
    key: 'squareIcons', label: 'Rounded-square icons',
    css: '.tile-icon { border-radius: 12px !important; }',
  },
  {
    key: 'bigTileText', label: 'Bigger tile text (wall display)',
    css: '.device-tile .tile-name { font-size: 17px !important; }\n.device-tile .tile-status { font-size: 14.5px !important; }',
  },
  {
    key: 'amoledBlack', label: 'AMOLED true black',
    css: ':root:not([data-theme="light"]) {\n  --bg: #000000 !important;\n  --card: #0b0b0c !important;\n  --card-grad: #0b0b0c !important;\n  --surface: #0b0b0c !important;\n  --tile-off-bg: #0b0b0c !important;\n  --modal-grad: #0b0b0c !important;\n}',
  },
  {
    key: 'squarePopup', label: 'Squarer popups',
    css: '.device-modal-glow, .dm-card { border-radius: 12px !important; }\n:root { --sheet-radius: 12px !important; }',
  },
  {
    key: 'bigPopupTitle', label: 'Bigger popup title',
    css: '.modal-device-title { font-size: 28px !important; font-weight: 800 !important; }',
  },
  {
    key: 'noBlur', label: 'No blur (faster on old tablets)',
    // header/sidebar blur is set inline — !important needed
    css: '* { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }\nheader { background: var(--bg) !important; }',
  },
  {
    key: 'reduceMotion', label: 'Reduce motion',
    css: '*, *::before, *::after {\n  animation-duration: 0.01ms !important;\n  animation-iteration-count: 1 !important;\n  transition-duration: 0.01ms !important;\n}',
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

// Per-theme ink for tinted on-tiles. Literal values on purpose: inside an on
// tile global.css sets --text: var(--tile-on-text), so pointing
// --tile-on-text back at var(--text) would be a cycle (invalid → no ink).
const TINT_INK = {
  dark:  { text: '#ffffff', text2: 'rgba(235,235,245,0.62)' },
  light: { text: '#000000', text2: 'rgba(60,60,67,0.62)' },
}

export function buildQuickBlock(controls) {
  const c = { ...DEFAULTS, ...controls }
  const lines = []

  if (c.accent.toLowerCase() !== DEFAULTS.accent) {
    const rgb = hexToRgb(c.accent)
    const lt = toHex(lighten(rgb, 0.22))
    lines.push(`:root, [data-theme="light"] {\n  --accent: ${c.accent} !important;\n  --accent-lt: ${lt} !important;\n  --accent-dim: rgba(${rgb.join(', ')}, 0.18) !important;\n  --blue: ${c.accent} !important;\n}`)
  }
  if (c.font) {
    lines.push(`body, button, input, select, textarea { font-family: ${c.font} !important; }\n:root { --font-display: ${c.font} !important; }`)
  }
  if (c.uiScale !== DEFAULTS.uiScale) {
    lines.push(`#root { zoom: ${c.uiScale / 100}; }`)
  }
  if (c.radius !== DEFAULTS.radius) {
    const r = c.radius
    lines.push(`:root, [data-theme="light"] {\n  --radius-lg: ${r}px !important;\n  --radius-md: ${Math.round(r * 0.8)}px !important;\n  --radius-sm: ${Math.round(r * 0.6)}px !important;\n  --sheet-radius: ${Math.round(r * 1.4)}px !important;\n}`)
  }
  if (c.tileSize !== DEFAULTS.tileSize) {
    // .device-grid's columns are inline (DeviceList.jsx)
    lines.push(`.device-grid { grid-template-columns: repeat(auto-fill, minmax(${c.tileSize}px, 1fr)) !important; }`)
  }
  if (c.tileGap !== DEFAULTS.tileGap) {
    lines.push(`.device-grid { gap: ${c.tileGap}px !important; }`)
  }
  if (c.popupWidth !== DEFAULTS.popupWidth) {
    // popup width is inline (DeviceModal.jsx)
    lines.push(`.device-modal-glow { width: min(${c.popupWidth}px, 100%) !important; }`)
  }

  if (c.onTileStyle === 'tint') {
    lines.push(
      `.device-tile { --tile-on-bg: color-mix(in srgb, var(--tile-accent) 26%, var(--card)) !important; --tile-on-text: ${TINT_INK.dark.text} !important; --tile-on-text2: ${TINT_INK.dark.text2} !important; }\n` +
      `[data-theme="light"] .device-tile { --tile-on-bg: color-mix(in srgb, var(--tile-accent) 18%, #ffffff) !important; --tile-on-text: ${TINT_INK.light.text} !important; --tile-on-text2: ${TINT_INK.light.text2} !important; }`)
  } else if (c.onTileStyle === 'solid') {
    lines.push(
      '.device-tile { --tile-on-bg: var(--tile-accent) !important; --tile-on-text: #ffffff !important; --tile-on-text2: rgba(255,255,255,0.78) !important; }\n' +
      '.device-tile[data-on="true"] .tile-icon { background: rgba(255,255,255,0.25) !important; }\n' +
      '.device-tile[data-on="true"] .ios-switch[data-on="true"] { background: rgba(255,255,255,0.4) !important; }')
  }

  if (c.background === 'gradient') {
    lines.push(
      'body { background: linear-gradient(180deg, #1c1c1e 0%, #000000 45%) fixed !important; }\n' +
      '[data-theme="light"] body { background: linear-gradient(180deg, #ffffff 0%, #f2f2f7 45%) fixed !important; }')
  } else if (c.background === 'wash') {
    lines.push('body { background: radial-gradient(1100px 600px at 50% -10%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 70%), var(--bg) fixed !important; }')
  }

  if (c.switchColor === 'accent') {
    lines.push('.ios-switch[data-on="true"], .stg-toggle.on { background: var(--accent) !important; }')
  } else if (c.switchColor === 'category') {
    lines.push('.device-tile .ios-switch[data-on="true"] { background: var(--tile-accent) !important; }')
  }

  for (const toggle of TOGGLES) {
    if (c[toggle.key]) lines.push(toggle.css)
  }

  if (!lines.length) return ''
  // Only non-default values go into the saved state
  const state = Object.fromEntries(Object.entries(c).filter(([k, v]) => DEFAULTS[k] !== v))
  return `${QUICK_START}\n${STATE_PREFIX}${JSON.stringify(state)} */\n${lines.join('\n')}\n${QUICK_END}`
}

// Reads the control values back out of a saved block (see STATE_PREFIX).
// Falls back to defaults for CSS with no block, or an older block that
// predates the state line.
export function parseQuickState(css) {
  const start = css.indexOf(QUICK_START)
  if (start === -1) return { ...DEFAULTS }
  const i = css.indexOf(STATE_PREFIX, start)
  const end = css.indexOf(QUICK_END, start)
  if (i === -1 || (end !== -1 && i > end)) return { ...DEFAULTS }
  const close = css.indexOf(' */', i)
  try {
    const saved = JSON.parse(css.slice(i + STATE_PREFIX.length, close))
    const out = { ...DEFAULTS }
    for (const k of Object.keys(DEFAULTS)) {
      if (k in saved && typeof saved[k] === typeof DEFAULTS[k]) out[k] = saved[k]
    }
    return out
  } catch {
    return { ...DEFAULTS }
  }
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
