import Box3D from './Box3D'
import { PLAN_FURNITURE_3D } from '../planFurniture3D'

// Extruded 3D furniture blocks matching the pieces drawn into
// public/floorplan-base.svg. Board-relative (not room-relative): items are
// positioned directly in board metres, so they line up with the image
// regardless of which config room they sit in.
export default function PlanFurniture3D({ floorKey, U }) {
  const items = PLAN_FURNITURE_3D[floorKey]
  if (!items?.length) return null
  return (
    <div className="plan-furn3d-layer">
      {items.map((item, i) => (
        <Box3D key={i} x={item.x} y={item.y} w={item.w} d={item.d} h={item.height}
          color={item.color} label={item.label} round={item.shape === 'round'} U={U} />
      ))}
    </div>
  )
}
