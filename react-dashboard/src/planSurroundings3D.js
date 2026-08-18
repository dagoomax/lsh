// Stylized 3D neighboring buildings/trees for the margin around the
// apartment — loosely evoking what the satellite layer actually shows there
// (pitched-roof houses, greenery, road density), not a surveyed
// reconstruction. The floor plan itself is a fictional generated layout
// (never surveyed against the real address), so there's no verified
// true-north alignment to reconstruct precisely against anyway — this is
// atmosphere, matching the satellite backdrop's general character.
//
// Board metres, same space as planFurniture3D.js/planWalls3D.js. Apartment
// footprint sits roughly x:2.55–14.55, y:2.31–12.91 within the 17.1×15.1
// board — everything here lives in the margin around that.
const TERRACOTTA = '#b5654a', SLATE = '#4a5560', BROWN = '#7a5a3a', TREE = '#3f7a4a'

const house = (x, y, w, d, color) => ({ shape: 'box', x, y, w, d, height: 112, color })
const tree = (x, y, r) => ({ shape: 'round', x: x - r, y: y - r, w: r * 2, d: r * 2, height: 90, color: TREE })

export const PLAN_SURROUNDINGS_3D = {
  floor1: [
    // north margin
    house(1.5, 0.3, 2.2, 1.6, TERRACOTTA),
    house(5.5, 0.2, 2.4, 1.7, SLATE),
    house(9.5, 0.3, 2.0, 1.5, BROWN),
    tree(4.2, 1.0, 0.6),
    tree(8.0, 0.9, 0.7),
    // south margin
    house(2.0, 13.3, 2.3, 1.6, SLATE),
    house(6.5, 13.2, 2.5, 1.7, TERRACOTTA),
    house(10.5, 13.3, 2.2, 1.6, BROWN),
    tree(4.5, 14.3, 0.6),
    // west margin
    house(0.3, 4.0, 1.7, 2.3, TERRACOTTA),
    tree(1.0, 7.5, 0.6),
    tree(1.0, 10.5, 0.5),
    // east margin
    house(15.2, 4.5, 1.6, 2.2, SLATE),
    house(15.1, 8.0, 1.7, 2.0, BROWN),
    tree(16.3, 6.0, 0.6),
  ],
}
