# Custom CSS examples

The Custom CSS field (**Settings → Interface**, in both the classic dashboard
and the React dashboard) is loaded as a real `<link>` stylesheet — see
`GET /custom.css` in `server.js` and `ui.customCss` in `config.json` — so it
applies on every page, including login/setup, before first paint.

In the React dashboard this field is now a small built-in editor
(`react-dashboard/src/components/settings/CssEditor.jsx`): line numbers, Tab
inserts spaces instead of leaving the field, a dropdown to insert any example
below with one click, and a "Live preview on this page" toggle that applies
the CSS instantly (before you hit Save) so you can see the effect while you
tweak it. The classic dashboard (`public/settings.html`) still uses a plain
textarea — paste any of these there too, it's the same stylesheet either way.

All selectors and CSS variables below are real, current names from
`react-dashboard/src/styles/global.css` — copy-paste, don't guess at class
names.

## Rounder, flatter tiles

```css
.device-tile {
  border-radius: 20px;
  box-shadow: none;
}
```

## Custom accent color

Overrides the three variables everything else (toggles, active nav links,
focus rings) derives from:

```css
:root {
  --accent: #ff5470;
  --accent-lt: #ff8099;
  --accent-dim: rgba(255, 84, 112, 0.18);
}
```

## More tiles per row

The device grid's column count is set inline by React, so this needs
`!important` to win — a stylesheet rule with `!important` does override an
inline style, which a plain override without it can't:

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

Scoped to dark mode only, so it doesn't leak into light mode:

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

The title has a real class, but its `font-size` is also set inline — `font-weight` isn't, so that one doesn't need `!important`:

```css
.modal-device-title { font-size: 24px !important; font-weight: 700; }
```
