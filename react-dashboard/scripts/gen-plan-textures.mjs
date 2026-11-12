// Generates src/styles/plan-html-textures.css: tileable material textures for
// the HTML floor-plan model (PlanHtmlModel.jsx), as SVG data URIs — nothing is
// downloaded and no image files ship. Run: node scripts/gen-plan-textures.mjs
//
// Every texture is a transparent overlay of darker and lighter marks, so it
// sits on top of a face's own (already sun-shaded) colour: one oak texture
// serves the lit top of a table and its shadowed side alike.
//
// Units: 4 SVG units per CSS pixel at the model's 56 px/m, so 224 units = 1 m.
// Noise uses stitchTiles so the tiles repeat without seams.

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const M = 224 // units per metre
const rnd = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646

// black (or white) noise whose opacity follows the turbulence: alpha = gain·n + bias
const noise = (id, freq, octaves, seed, gain, bias, white = false) => `<filter id="${id}" x="0" y="0" width="100%" height="100%">` +
  `<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${octaves}" seed="${seed}" stitchTiles="stitch"/>` +
  `<feColorMatrix values="0 0 0 0 ${white ? 1 : 0}  0 0 0 0 ${white ? 1 : 0}  0 0 0 0 ${white ? 1 : 0}  ${gain} 0 0 0 ${bias}"/></filter>`
// thin lines where the noise crosses its middle value — veins, cracks
const veins = (id, freq, octaves, seed, strength) => `<filter id="${id}" x="0" y="0" width="100%" height="100%">` +
  `<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${octaves}" seed="${seed}" stitchTiles="stitch"/>` +
  `<feColorMatrix values="0 0 0 0 0.25  0 0 0 0 0.25  0 0 0 0 0.3  1 0 0 0 0"/>` +
  `<feComponentTransfer><feFuncA type="table" tableValues="0 0 0 0 0 ${strength * 0.35} ${strength} ${strength * 0.35} 0 0 0 0 0"/></feComponentTransfer></filter>`
const fill = (w, h, id) => `<rect width="${w}" height="${h}" filter="url(#${id})"/>`
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`

// Floorboards running along x: 14 cm boards, staggered butt joints, each board its own tone
function planks(seed) {
  const r = rnd(seed), w = 2 * M, bw = 31, n = 4, h = bw * n
  let s = `<defs>${noise('g', '0.004 0.11', 3, seed, 0.5, -0.17)}${noise('f', '0.02 0.9', 2, seed + 1, 0.2, -0.05)}</defs>`
  for (let i = 0; i < n; i++) {
    const joint = Math.round(r() * w)
    for (const [x0, len] of [[joint - w, w], [joint, w]]) {
      const t = r()
      s += `<rect x="${x0}" y="${i * bw}" width="${len}" height="${bw}" fill="${t > 0.5 ? '#fff' : '#000'}" fill-opacity="${(Math.abs(t - 0.5) * 0.26).toFixed(3)}"/>`
    }
    s += `<path d="M${joint} ${i * bw}v${bw}" stroke="#000" stroke-opacity=".32" stroke-width="1.6"/>`
    s += `<path d="M0 ${i * bw + 0.8}H${w}" stroke="#000" stroke-opacity=".3" stroke-width="1.6"/><path d="M0 ${i * bw + 2.4}H${w}" stroke="#fff" stroke-opacity=".14" stroke-width="1.4"/>`
  }
  return svg(w, h, s + fill(w, h, 'g') + fill(w, h, 'f'))
}
// Furniture wood: long grain with the odd darker streak, no board seams
const grain = (seed) => svg(M, M, `<defs>${noise('g', '0.006 0.16', 4, seed, 0.55, -0.19)}${noise('f', '0.03 1.1', 2, seed + 2, 0.18, -0.04)}${noise('l', '0.004 0.05', 2, seed + 5, 0.3, -0.16, true)}</defs>` +
  fill(M, M, 'g') + fill(M, M, 'f') + fill(M, M, 'l'))
// 60 cm floor tiles: light grout, each tile a slightly different tone with a soft sheen
function tiles(seed) {
  const r = rnd(seed), t = 134, w = t * 2
  let s = `<defs>${noise('n', '0.035', 3, seed, 0.2, -0.07)}<linearGradient id="s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".07"/></linearGradient></defs>`
  for (let i = 0; i < 4; i++) {
    const x = (i % 2) * t, y = (i >> 1) * t, v = r()
    s += `<rect x="${x}" y="${y}" width="${t}" height="${t}" fill="${v > 0.5 ? '#fff' : '#000'}" fill-opacity="${(Math.abs(v - 0.5) * 0.12).toFixed(3)}"/>`
    s += `<rect x="${x + 2}" y="${y + 2}" width="${t - 4}" height="${t - 4}" fill="url(#s)"/>`
    s += `<rect x="${x + 1.5}" y="${y + 1.5}" width="${t - 3}" height="${t - 3}" fill="none" stroke="#33414a" stroke-opacity=".5" stroke-width="3"/>`
    s += `<rect x="${x + 3.5}" y="${y + 3.5}" width="${t - 7}" height="${t - 7}" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="1"/>`
  }
  return svg(w, w, s + fill(w, w, 'n'))
}
// Marble / quartz: clouding plus two scales of veining
const marble = (seed) => svg(2 * M, 2 * M, `<defs>${noise('c', '0.006', 4, seed, 0.3, -0.12)}${veins('v', '0.0045', 5, seed + 3, 0.34)}${veins('w', '0.012', 4, seed + 7, 0.13)}</defs>` +
  fill(2 * M, 2 * M, 'c') + fill(2 * M, 2 * M, 'v') + fill(2 * M, 2 * M, 'w'))
// Painted plaster: fine grain and faint roller clouding
const plaster = (seed) => svg(M, M, `<defs>${noise('n', '0.22', 3, seed, 0.12, -0.035)}${noise('c', '0.012', 3, seed + 1, 0.14, -0.055)}</defs>` + fill(M, M, 'n') + fill(M, M, 'c'))
// Concrete: coarse aggregate, blotches and pinholes
const concrete = (seed) => svg(M, M, `<defs>${noise('n', '0.5', 4, seed, 0.35, -0.12)}${noise('c', '0.02', 4, seed + 1, 0.4, -0.15)}${noise('l', '0.03', 3, seed + 2, 0.3, -0.13, true)}</defs>` +
  fill(M, M, 'c') + fill(M, M, 'l') + fill(M, M, 'n'))
// Woven cloth: warp and weft threads with slubs
function weave(seed, pitch, strength) {
  const w = 96
  let s = `<defs>${noise('n', '0.09 0.5', 3, seed, 0.3, -0.11)}${noise('m', '0.5 0.09', 3, seed + 1, 0.3, -0.11)}</defs>`
  for (let i = 0; i < w; i += pitch) {
    s += `<path d="M0 ${i + pitch / 4}H${w}" stroke="#000" stroke-opacity="${strength}" stroke-width="${pitch / 2.4}"/>`
    s += `<path d="M${i + pitch / 4} 0V${w}" stroke="#000" stroke-opacity="${strength * 0.75}" stroke-width="${pitch / 3}"/>`
    s += `<path d="M0 ${i + pitch * 0.75}H${w}" stroke="#fff" stroke-opacity="${strength * 0.55}" stroke-width="${pitch / 4}"/>`
  }
  return svg(w, w, s + fill(w, w, 'n') + fill(w, w, 'm'))
}
// Rug pile: tufted speckle over a loose weave
const pile = (seed) => svg(M / 2, M / 2, `<defs>${noise('n', '0.7', 2, seed, 0.5, -0.18)}${noise('l', '0.6', 2, seed + 4, 0.4, -0.17, true)}${noise('c', '0.03', 3, seed + 2, 0.3, -0.12)}</defs>` +
  fill(M / 2, M / 2, 'c') + fill(M / 2, M / 2, 'n') + fill(M / 2, M / 2, 'l'))
// Brushed metal: long horizontal scratches
const brushed = (seed) => svg(M, M / 2, `<defs>${noise('n', '0.003 0.9', 3, seed, 0.4, -0.14)}${noise('l', '0.003 0.7', 2, seed + 3, 0.35, -0.14, true)}</defs>` + fill(M, M / 2, 'n') + fill(M, M / 2, 'l'))
// Foliage: clumps of light and shade
const leaves = (seed) => svg(M / 2, M / 2, `<defs>${noise('n', '0.11', 3, seed, 0.9, -0.33)}${noise('l', '0.13', 3, seed + 5, 0.8, -0.33, true)}</defs>` + fill(M / 2, M / 2, 'n') + fill(M / 2, M / 2, 'l'))

const uri = (s) => `url("data:image/svg+xml,${encodeURIComponent(s).replace(/%20/g, ' ').replace(/%3D/g, '=').replace(/%3A/g, ':').replace(/%2F/g, '/').replace(/%2C/g, ',')}")`
const px = (u) => +(u / 4).toFixed(2)
const rule = (name, s, extra = '') => {
  const [, w, h] = /width="([\d.]+)" height="([\d.]+)"/.exec(s)
  return `.phm-t-${name} { --tex: ${uri(s)}; --tex-size: ${px(w)}px ${px(h)}px;${extra} }`
}
// the same floorboards turned a quarter, for rooms deeper than they are wide
const turned = (s) => {
  const [, w, h, body] = /width="([\d.]+)" height="([\d.]+)" viewBox="[^"]*">(.*)<\/svg>$/s.exec(s)
  return svg(h, w, `<g transform="translate(${h} 0) rotate(90)">${body}</g>`)
}

const oak = planks(11)
const css = `/* Generated by scripts/gen-plan-textures.mjs — do not edit by hand.
   Material textures for the HTML floor-plan model, applied by
   .phm[data-tex] in plan-html-model.css. */
${rule('planks', oak)}
${rule('planks-v', turned(oak))}
${rule('grain', grain(23))}
${rule('tile', tiles(5))}
${rule('stone', marble(41))}
${rule('plaster', plaster(7))}
${rule('concrete', concrete(13))}
${rule('linen', weave(17, 8, 0.05))}
${rule('fabric', weave(29, 12, 0.09))}
${rule('rug', pile(31))}
${rule('steel', brushed(37))}
${rule('leaf', leaves(43))}
`
const out = fileURLToPath(new URL('../src/styles/plan-html-textures.css', import.meta.url))
writeFileSync(out, css)
console.log(`${out}: ${(css.length / 1024).toFixed(1)} kB`)
