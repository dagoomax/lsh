import Box3D from './Box3D'
import { PLAN_WALLS_3D } from '../planWalls3D'

// Precise 3D wall + window layer matching the exact openings drawn in
// public/floorplan-base.svg — replaces HomePlan's generic per-room wall
// boxes (which know nothing about doors/windows and would otherwise pave
// solid extruded wall right over an opening).
export default function PlanWalls3D({ floorKey, U }) {
  const plan = PLAN_WALLS_3D[floorKey]
  if (!plan) return null
  return (
    <div className="plan-wall3d-layer">
      {plan.walls.map((s, i) => (
        <Box3D key={`w${i}`} className="plan-wall3d-seg" x={s.x} y={s.y} w={s.w} d={s.d} h={s.height} color="#b6bcc0" U={U} />
      ))}
      {plan.windows.map((s, i) => (
        <Box3D key={`g${i}`} className="plan-wall3d-win" x={s.x} y={s.y} w={s.w} d={s.d} h={s.height}
          color="rgba(180,214,235,0.55)" label={s.label} U={U} />
      ))}
    </div>
  )
}
