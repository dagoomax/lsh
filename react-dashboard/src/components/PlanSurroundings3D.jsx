import Box3D from './Box3D'
import { PLAN_SURROUNDINGS_3D } from '../planSurroundings3D'

// Stylized neighboring houses/trees in the margin around the apartment —
// see planSurroundings3D.js for what this is (and isn't: atmosphere, not a
// surveyed reconstruction of the real address).
export default function PlanSurroundings3D({ floorKey, U }) {
  const items = PLAN_SURROUNDINGS_3D[floorKey]
  if (!items?.length) return null
  return (
    <div className="plan-surround3d-layer">
      {items.map((item, i) => (
        <Box3D key={i} x={item.x} y={item.y} w={item.w} d={item.d} h={item.height}
          color={item.color} round={item.shape === 'round'} U={U} />
      ))}
    </div>
  )
}
