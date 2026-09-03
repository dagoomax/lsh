import { useEffect, useState } from 'react'

// Embeds a Sketchfab model via Sketchfab's own embed iframe (no file
// download/redistribution — same mechanism as embedding a YouTube video).
// Requires internet access to load; unlike the procedural model this can't
// react to live charging state since the viewer runs cross-origin inside
// Sketchfab's own page.
const DEFAULT_MODEL_ID = 'f583b5bfc17346c08573dc4f1edebefe'
const DEFAULT_MODEL_NAME = '2025 Mercedes-Benz G-Class AMG G63'

// modelId/modelName are optional — pass them when the caller already fetched
// the selection (e.g. EnergyFlow, which also shows the name as a caption
// next to the model). Omit them and this component fetches its own default,
// so it still works standalone.
export default function GWagenEmbed({ height = 190, modelId: modelIdProp, modelName: modelNameProp }) {
  const [fetched, setFetched] = useState(null)

  useEffect(() => {
    if (modelIdProp) return // caller already supplied a selection — no need to fetch our own
    let cancelled = false
    fetch('/api/ev-visual')
      .then(r => r.json())
      .then(d => { if (!cancelled && d?.success) setFetched(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [modelIdProp])

  const modelId = modelIdProp || fetched?.modelId || DEFAULT_MODEL_ID
  const modelName = modelNameProp || fetched?.modelName || DEFAULT_MODEL_NAME

  return (
    <div style={{ width: '100%', height, borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: '#0b0c0e' }}>
      <iframe
        title={modelName}
        src={`https://sketchfab.com/models/${modelId}/embed?autospin=0&autostart=1&ui_theme=dark`
          + '&ui_infos=0&ui_controls=0&ui_stop=0&ui_inspector=0&ui_watermark=0&ui_watermark_link=0'
          + '&ui_ar=0&ui_vr=0&ui_help=0&ui_settings=0&ui_fullscreen=0&ui_annotations=0&ui_hint=0'}
        frameBorder="0"
        allow="autoplay; fullscreen; xr-spatial-tracking"
        allowFullScreen
        style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
      />
    </div>
  )
}
