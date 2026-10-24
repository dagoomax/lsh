import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import { gt } from '../i18n'

// Home-view card with the imported 3D floor-plan model (the GLB/OBJ uploaded
// in Plan → Import model, served from /api/plan-model/file/…). three.js and
// the model are only fetched once the card scrolls near the viewport, so the
// dashboard itself loads as fast as before. The model turns slowly until
// someone drags it; ⤢ makes it full screen, "Open plan" jumps to the Plan view.
const PlanModelViewer = lazy(() => import('./PlanModelViewer'))

export default function HomeModel3D({ onOpenPlan }) {
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

  useEffect(() => {
    if (!model || near || !ref.current) return
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setNear(true) }, { rootMargin: '300px' })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [model, near])

  useEffect(() => {
    if (!full) return
    const onKey = (e) => { if (e.key === 'Escape') setFull(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [full])

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
        <button type="button" className="hm3d-btn" onClick={() => setFull((f) => !f)}
          title={full ? gt('close', 'Close') : gt('fullscreen', 'Full screen')} aria-label={full ? gt('close', 'Close') : gt('fullscreen', 'Full screen')}>
          {full ? '✕' : '⤢'}
        </button>
      </div>
      <div className="hm3d-stage">
        {near
          ? <Suspense fallback={<div className="hm3d-wait">{gt('loading', 'Loading…')}</div>}>
              <PlanModelViewer model={model} autoRotate transparent showHint={full} />
            </Suspense>
          : <div className="hm3d-wait">{gt('loading', 'Loading…')}</div>}
      </div>
    </div>
  )
}
