// Generic extruded 3D box: a top face plus 4 folded side faces (the same
// rotateX/rotateY-around-own-edge technique HomePlan's room walls pioneered),
// parameterized so it can render furniture, wall segments, or window panes.
// x/y/w/d are board metres, h is a fixed stylized pixel height (not scaled by
// zoom — same convention the original wall extrusion used).
export default function Box3D({ x, y, w, d, h, color, opacity = 1, round = false, label, U, className = '' }) {
  const ww = Math.max(4, w * U)
  const dd = Math.max(4, d * U)
  return (
    <div className={`plan-box3d ${className}`} title={label} style={{ left: x * U, top: y * U, width: ww, height: dd, opacity }}>
      <div className="plan-box3d-face plan-box3d-n" style={{ height: h, background: color, filter: 'brightness(.8)' }} />
      <div className="plan-box3d-face plan-box3d-s" style={{ height: h, background: color, filter: 'brightness(.92)' }} />
      <div className="plan-box3d-face plan-box3d-w" style={{ width: h, background: color, filter: 'brightness(.6)' }} />
      <div className="plan-box3d-face plan-box3d-e" style={{ width: h, background: color, filter: 'brightness(.7)' }} />
      <div className="plan-box3d-face plan-box3d-top" style={{
        background: color, transform: `translateZ(${h}px)`,
        borderRadius: round ? '50%' : undefined,
      }} />
    </div>
  )
}
