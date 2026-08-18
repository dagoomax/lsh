// Precise 3D wall/window segments matching public/floorplan-base.svg's own
// wall paths, door gaps and window rects — same SVG coordinate space as
// planFurniture3D.js (100 units = 1 metre, viewBox origin -255,-231).
//
// Unlike the board's generic per-room wall boxes (one full-length wall per
// room side, no concept of openings), these segments are transcribed
// directly from the SVG's wall/door/window layout: exterior walls are split
// around every door and window opening, interior walls reuse the exact
// rects already drawn (which are themselves pre-split around doorways), and
// windows get their own translucent glass segment instead of a gap.
const SVG_OFFSET = { x: 255, y: 231 }
const M = 100
const WALL_H = 72 // px, fixed — taller than the generic per-room default (48px) since these
                   // walls carry the whole isometric read on their own, with no CSS-tilt fallback to lean on

const seg = (x, y, w, h, label) => ({
  x: (x + SVG_OFFSET.x) / M, y: (y + SVG_OFFSET.y) / M,
  w: w / M, d: h / M, height: WALL_H, label,
})

export const PLAN_WALLS_3D = {
  floor1: {
    walls: [
      // exterior north (split around the kitchen window, entry door, bedroom 1 window)
      seg(-20, -20, 100, 20), seg(300, -20, 240, 20), seg(640, -20, 210, 20), seg(1050, -20, 170, 20),
      // exterior south (split around the balcony door, bedroom 2 window)
      seg(-20, 900, 140, 20), seg(380, 900, 500, 20), seg(1080, 900, 140, 20),
      // exterior west (split around the living/dining window)
      seg(-20, -20, 20, 420), seg(-20, 650, 20, 270),
      // exterior east (split around the bath 1 window)
      seg(1200, -20, 20, 420), seg(1200, 490, 20, 430),
      // interior — same rects as the SVG's own <rect class="wall">, already
      // split around each doorway
      seg(515, 0, 10, 250), seg(515, 750, 10, 150),
      seg(695, 0, 10, 150), seg(695, 240, 10, 170), seg(695, 490, 10, 130), seg(695, 710, 10, 190),
      seg(695, 345, 315, 10), seg(1100, 345, 105, 10), seg(695, 545, 510, 10),
      seg(945, 345, 10, 210),
    ],
    windows: [
      seg(80, -20, 220, 20, 'Window'),
      seg(850, -20, 200, 20, 'Window'),
      seg(-20, 400, 20, 250, 'Window'),
      seg(1200, 400, 20, 90, 'Window'),
      seg(880, 900, 200, 20, 'Window'),
    ],
  },
}
