import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import { gt } from '../i18n'

// Home-view card with the imported 3D floor-plan model (the GLB/OBJ uploaded
// in Plan → Import model, served from /api/plan-model/file/…). three.js and
// the model are only fetched once the card scrolls near the viewport, so the
// dashboard itself loads as fast as before. The model turns slowly until
// someone drags it; ⤢ makes it full screen, "Open plan" jumps to the Plan view.
const PlanModelViewer = lazy(() => import('./PlanModelViewer'))

export default function HomeModel3D({ onOpenPlan, devices, groupOf, onOpen }) {
  const [model, setModel] = useState(undefined) // undefined = loading, null = none imported
  const [near, setNear] = useState(false)
  const [full, setFull] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    fetch('/api/home-plan', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setModel(d.plan?.model?.url ? d.plan.model : null))
      .catch(() => setModel(null))
  }, [])

  // The 3D view exists only while the card is on (or near) the screen: scrolled
  // away, its WebGL context and textures are released (hundreds of MB of GPU
  // memory on a wall tablet), and it's rebuilt from the browser cache on return.
  useEffect(() => {
    if (!model || !ref.current) return
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return }
    const io = new IntersectionObserver((es) => setNear(es.some((e) => e.isIntersecting)), { rootMargin: '400px' })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [model])

  if (!model) return null
  return (
    <div className="card hm3d" ref={ref} data-full={full || undefined}>
      <div className="hm3d-head">
        <span className="tile-sec-title">{gt('home_sec_model', '3D model')}</span>
        <span className="hm3d-name">{model.name}</span>
        <span style={{ flex: 1 }} />
        {onOpenPlan && !full && (
          <button type="button" className="home-edit-btn" onClick={onOpenPlan}>{gt('plan_open', 'Open plan')}</button>
        )}
        {!full && (
          <button type="button" className="hm3d-btn" onClick={() => setFull(true)}
            title={gt('fullscreen', 'Full screen')} aria-label={gt('fullscreen', 'Full screen')}>⤢</button>
        )}
      </div>
      <div className="hm3d-stage">
        {near || full
          ? <Suspense fallback={<div className="hm3d-wait">{gt('loading', 'Loading…')}</div>}>
              <PlanModelViewer model={model} autoRotate transparent showHint={full}
                devices={devices} groupOf={groupOf} onOpen={onOpen} compact={!full}
                onClose={full ? () => setFull(false) : undefined} />
            </Suspense>
          : <div className="hm3d-wait">{gt('loading', 'Loading…')}</div>}
      </div>
    </div>
  )
}
