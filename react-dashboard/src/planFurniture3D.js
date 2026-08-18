// 3D furniture blocks matching the pieces drawn in public/floorplan-base.svg —
// coordinates are lifted straight from that file's own <rect>/<circle> values
// (same 100-units-per-metre scale, same viewBox origin) so the two stay in
// sync; if the SVG geometry ever changes, update the matching entry here.
const SVG_OFFSET = { x: 255, y: 231 } // matches floorplan-base.svg's viewBox="-255 -231 …"
const M = 100 // svg units per metre

const rect = (x, y, w, h, height, color, label) => ({
  shape: 'box',
  x: (x + SVG_OFFSET.x) / M, y: (y + SVG_OFFSET.y) / M,
  w: w / M, d: h / M, height, color, label,
})
const disc = (cx, cy, r, height, color, label) => ({
  shape: 'round',
  x: (cx - r + SVG_OFFSET.x) / M, y: (cy - r + SVG_OFFSET.y) / M,
  w: (r * 2) / M, d: (r * 2) / M, height, color, label,
})

const WOOD = '#C9A876', DARKWOOD = '#8C6B4A', FABRIC = '#93A6B8'
const PORCELAIN = '#F3F2EE', METAL = '#B9C2C8', GLASS = '#DCE7EC', PLANT = '#6E9C6E'

export const PLAN_FURNITURE_3D = {
  floor1: [
    // kitchen
    rect(0, 0, 300, 65, 85, METAL, 'Counter'),
    rect(0, 65, 65, 335, 85, METAL, 'Counter'),
    rect(445, 5, 72, 70, 175, METAL, 'Fridge'),
    rect(160, 200, 230, 90, 95, WOOD, 'Island'),
    // dining
    rect(130, 400, 250, 120, 72, WOOD, 'Table'),
    rect(160, 358, 52, 36, 82, WOOD, 'Chair'),
    rect(298, 358, 52, 36, 82, WOOD, 'Chair'),
    rect(160, 526, 52, 36, 82, WOOD, 'Chair'),
    rect(298, 526, 52, 36, 82, WOOD, 'Chair'),
    rect(92, 435, 32, 50, 82, WOOD, 'Chair'),
    rect(386, 435, 32, 50, 82, WOOD, 'Chair'),
    // living
    rect(5, 690, 40, 170, 95, FABRIC, 'Sofa'),
    rect(335, 625, 95, 220, 95, FABRIC, 'Sofa'),
    disc(222, 718, 46, 45, WOOD, 'Coffee table'),
    rect(78, 592, 84, 84, 90, FABRIC, 'Armchair'),
    disc(472, 862, 25, 55, WOOD, 'Side table'),
    disc(196, 600, 6, 165, DARKWOOD, 'Lamp'),
    rect(10, 858, 100, 26, 110, DARKWOOD, 'Bookshelf'),
    // balcony
    disc(250, 985, 32, 68, DARKWOOD, 'Table'),
    rect(168, 962, 40, 46, 80, DARKWOOD, 'Chair'),
    rect(292, 962, 40, 46, 80, DARKWOOD, 'Chair'),
    disc(55, 985, 22, 55, PLANT, 'Planter'),
    disc(445, 985, 22, 55, PLANT, 'Planter'),
    // hall
    rect(532, 120, 38, 115, 80, WOOD, 'Console'),
    rect(660, 20, 28, 48, 48, WOOD, 'Bench'),
    // bedroom 1
    rect(880, 20, 160, 215, 58, FABRIC, 'Bed'),
    rect(812, 20, 55, 55, 62, WOOD, 'Nightstand'),
    rect(1053, 20, 55, 55, 62, WOOD, 'Nightstand'),
    rect(730, 285, 230, 58, 78, WOOD, 'Desk'),
    rect(1145, 130, 48, 110, 88, FABRIC, 'Chair'),
    // bath 1
    rect(855, 362, 85, 178, 55, PORCELAIN, 'Tub'),
    rect(737, 512, 58, 30, 78, PORCELAIN, 'Sink'),
    rect(758, 358, 118, 48, 85, PORCELAIN, 'Vanity'),
    rect(746, 452, 40, 56, 55, PORCELAIN, 'Toilet'),
    // bath 2
    rect(1105, 452, 90, 90, 190, GLASS, 'Shower'),
    rect(1028, 512, 58, 30, 78, PORCELAIN, 'Sink'),
    rect(958, 362, 48, 110, 168, WOOD, 'Closet'),
    rect(1037, 452, 40, 56, 55, PORCELAIN, 'Toilet'),
    // bedroom 2
    rect(1000, 565, 150, 210, 58, FABRIC, 'Bed'),
    rect(938, 565, 50, 50, 62, WOOD, 'Nightstand'),
    rect(720, 560, 200, 56, 78, WOOD, 'Desk'),
    rect(715, 748, 56, 148, 172, WOOD, 'Wardrobe'),
    rect(786, 800, 46, 46, 50, FABRIC, 'Pouf'),
    disc(1168, 868, 22, 88, PLANT, 'Plant'),
  ],
}
