import { useState } from 'react'

// Scene run strip — mirrors the vanilla dashboard's #scene-strip (public/app.js),
// shown above the device list. Only scenes explicitly not disabled are shown
// here (enabled defaults to true for scenes that predate the field, so an
// old scene without `enabled` set still shows up) — this lets flow-generated
// scenes (Flows editor "Scene Generator" node) stay hidden until reviewed.
export default function SceneStrip({ scenes, runScene }) {
  const [runningId, setRunningId] = useState(null)
  const visible = (scenes || []).filter(s => s.enabled !== false)
  if (!visible.length) return null

  const run = async (id) => {
    setRunningId(id)
    try { await runScene(id) }
    finally { setTimeout(() => setRunningId(r => (r === id ? null : r)), 600) }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      padding: '8px 20px 0', flexShrink: 0,
    }}>
      {visible.map(s => (
        <button key={s.id} className="scene-chip" data-running={String(runningId === s.id)}
          onClick={() => run(s.id)} title={`Run scene: ${s.name}`}>
          <span>{s.icon || '🎬'}</span>
          {s.name}
        </button>
      ))}
    </div>
  )
}
