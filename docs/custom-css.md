# Custom CSS examples

## Themes — load, save, delete

The CSS editor's **Themes** row (above Quick controls) reads/writes actual
`.css` files, via `GET/POST/DELETE /api/settings/css-themes/...` in
`src/api-routes.js`:

- **Built-in** — ships with the app in
  `react-dashboard/public/css-themes/*.css` (bundled into `dist/` by Vite,
  read-only from the API). Currently just `red.css` — a complete black +
  hot-pink "kiosk" reskin (dark mode only): nav, tile highlight states,
  popup, sparklines, scrollbar. Picking it in the dropdown copies its
  content into the live Custom CSS box; it doesn't modify the shipped file.
- **Saved** — "Save as theme…" writes whatever's currently in the box to
  `persist/css-themes/<name>.css` (same directory convention as
  `persist/plan-decor/` for uploaded images) — admin-only to write/delete,
  readable by anyone who can already read `ui.customCss`. Names are
  sanitized to `[a-z0-9-]`, max 40 chars, so there's no path-traversal risk
  from what gets typed into the prompt.

Loading a theme confirms first if the box isn't empty (it replaces
everything, same as "Reset to defaults" is destructive) and resets Quick
controls to their defaults, since the loaded CSS isn't parsed back into
control state (same limitation as the generated Quick-controls block, see
below).

The Custom CSS field (**Settings → Interface**, in both the classic dashboard
and the React dashboard) is loaded as a real `<link>` stylesheet — see
`GET /custom.css` in `server.js` and `ui.customCss` in `config.json` — so it
applies on every page, including login/setup, before first paint.

In the React dashboard this field is now a small built-in editor
(`react-dashboard/src/components/settings/CssEditor.jsx`): line numbers, Tab
inserts spaces instead of leaving the field, and a "Live preview on this
page" toggle that applies the CSS instantly (before you hit Save) so you can
see the effect while you tweak it. The classic dashboard
(`public/settings.html`) still uses a plain textarea — paste any of the
snippets below there too, it's the same stylesheet either way.

Above the text box, **Quick controls** (`cssQuickControls.js`) cover every
example on this page without writing CSS by hand: a picker/slider row
(accent color, font, popup size, tile size) plus a row of toggle chips —
Flat tiles, Bigger tile text, AMOLED true black, One accent per category,
Squarer popup, Bigger popup title — one per remaining example below. Moving
any control regenerates a single marked block —

```css
/* ── quick controls — generated, safe to edit by hand ── */
...
/* ── end quick controls ── */
```

— and replaces just that block in place, leaving anything you've typed
above or below it untouched. "Reset controls" removes just that block.
"Reset to defaults" (next to the Live preview toggle) is the broader one —
it clears the whole Custom CSS box, hand-written rules included, after a
confirm.
The controls' on-screen values aren't read back out of the saved CSS on
reload (they always reopen at their defaults) — the block in the text is
what actually applies either way, so hand-editing it directly works too.

All selectors and CSS variables below are real, current names from
`react-dashboard/src/styles/global.css` — copy-paste, don't guess at class
names.

**Almost everything here needs `!important`, and it's not about
specificity.** `/custom.css`'s `<link>` is placed *before* the app's own
bundled stylesheet in `<head>` (see `server.js` / `dist/index.html`), so on
an equal-specificity tie the app's rule — loading second — wins. That bites
two different ways: a property set inline by React (`style={{...}}`) always
needs `!important`, since inline beats any external rule without it; but a
property set in `global.css` on the *exact same selector* — e.g. its own
bare `:root { --accent: ... }`, or `.device-tile { border-radius: ... }` —
needs it too, for the load-order reason above, even though nothing about
specificity would suggest that at a glance. Every snippet below was checked
against the actual rule in `global.css`, not assumed either way; the ones
without `!important` are the ones confirmed *not* to collide.

## Rounder, flatter tiles

`global.css`'s own `.device-tile` sets both properties already:

```css
.device-tile {
  border-radius: 20px !important;
  box-shadow: none !important;
}
```

## Custom accent color

Overrides the three variables everything else (toggles, active nav links,
focus rings) derives from. `global.css`'s dark-mode defaults for these live
in its own bare, unqualified `:root { }` (not behind a media query), so —
same selector, same specificity, later in the cascade — this needs
`!important` too:

```css
:root {
  --accent: #ff5470 !important;
  --accent-lt: #ff8099 !important;
  --accent-dim: rgba(255, 84, 112, 0.18) !important;
}
```

## More tiles per row

The device grid's column count is set inline by React:

```css
.device-grid {
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)) !important;
}
```

## Bigger text for a wall-mounted display

Useful on a tablet you read from across the room:

```css
.device-tile { font-size: 1.15em; }
.device-tile span { font-size: 1.1em !important; }
```

## True black background (AMOLED)

Scoped to dark mode only, so it doesn't leak into light mode. This one's
actually safe *without* `!important`, unlike most of this page: `:root:not(…)`
has higher specificity than `global.css`'s own bare `:root`, so it wins on
specificity alone regardless of load order:

```css
:root:not([data-theme="light"]) {
  --bg: #000000;
  --card: #0a0a0a;
  --card-grad: linear-gradient(180deg, #0a0a0a 0%, #050505 100%);
}
```

## One accent color for every device category

Every tile carries a `data-cat` attribute that sets `--cat-c` (see
`global.css`'s `[data-cat="Lighting"] { --cat-c: #ffb020; }` etc.) — this
collapses them all to your main accent instead of per-category colors:

```css
.device-tile[data-cat] { --cat-c: var(--accent) !important; }
```

## Customizing the device popup

Clicking a tile opens a modal (`DeviceModal.jsx`) — its card carries a
`.device-modal-glow` class, but most of its look (background, radius) is set
via inline `style`, so overrides need `!important` here too. The backdrop
behind it has no class at all (just an inline-styled `motion.div`), so it
isn't a reliable target — style the card instead:

```css
.device-modal-glow {
  border-radius: 10px !important;
  background: var(--card) !important;
}
```

The title's `font-size` is set inline, and `global.css`'s own
`.modal-device-title` rule sets `font-weight: 500` — both need `!important`:

```css
.modal-device-title { font-size: 24px !important; font-weight: 700 !important; }
```
