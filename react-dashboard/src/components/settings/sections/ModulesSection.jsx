import { useEffect, useMemo, useState } from 'react'
import { SettingsCard, Button } from '../primitives'
import { gt } from '../../../i18n'

// Integration modules fetched on demand from GitHub (src/module-manager.js).
// Configured ones are auto-installed at startup; this list is for browsing,
// pre-installing before configuring, and re-fetching (update).
export default function ModulesSection() {
  const [mods, setMods] = useState(null)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(null)       // module id being installed
  const [results, setResults] = useState({})   // id -> { ok, message }

  const load = () =>
    fetch('/api/modules', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((j) => { if (!j.success) throw new Error(j.error); setMods(j.data) })
      .catch((e) => setError(e.message))

  useEffect(() => { load() }, [])

  const install = async (id, update) => {
    setBusy(id)
    try {
      const res = await fetch(`/api/modules/${encodeURIComponent(id)}/install`, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ update }),
      })
      const j = await res.json()
      setResults((r) => ({ ...r, [id]: { ok: j.success, message: j.success ? j.message : j.error } }))
      if (j.success) setMods((list) => list.map((m) => (m.id === id ? j.data : m)))
    } catch (e) {
      setResults((r) => ({ ...r, [id]: { ok: false, message: e.message } }))
    } finally {
      setBusy(null)
    }
  }

  const shown = useMemo(() => {
    if (!mods) return []
    const q = filter.trim().toLowerCase()
    return mods
      .filter((m) => !q || m.id.includes(q) || m.configKeys.some((k) => k.toLowerCase().includes(q)))
      // configured first, then installed, then the rest — alphabetical within
      .sort((a, b) => (b.configured - a.configured) || (b.installed - a.installed) || a.id.localeCompare(b.id))
  }, [mods, filter])

  const installedCount = mods?.filter((m) => m.installed).length ?? 0

  return (
    <SettingsCard title={gt('s.modules_title', 'Integration Modules')}
      badge={mods ? `${installedCount}/${mods.length}` : null}
      desc="Integrations are downloaded from GitHub when you need them. Anything configured in config.json is installed automatically at startup; install here to get one ready before configuring it. Restart LSH after installing.">
      {error && <div className="stg-banner err">✗ {error}</div>}
      {!mods && !error && <p className="stg-hint">Loading…</p>}
      {mods && (
        <>
          <input className="stg-input stg-mod-filter" placeholder="Filter modules…" value={filter}
            onChange={(e) => setFilter(e.target.value)}/>
          <div className="stg-mod-list">
            {shown.map((m) => {
              const partial = !m.installed && m.missingFiles.length === 0
              const r = results[m.id]
              return (
                <div key={m.id} className="stg-mod-row">
                  <div className="stg-mod-main">
                    <div className="stg-mod-name">
                      {m.id}
                      {m.configured && <span className="stg-mod-chip cfg">configured</span>}
                      <span className={`stg-mod-chip ${m.installed ? 'ok' : partial ? 'warn' : ''}`}>
                        {m.installed ? 'installed' : partial ? 'missing npm deps' : 'not installed'}
                      </span>
                    </div>
                    <div className="stg-hint stg-mod-meta">
                      config: <code>{m.configKeys.join(', ')}</code>
                      {m.deps.length > 0 && <> · npm: {m.deps.join(', ')}</>}
                      {m.ref && <> · from {m.ref}</>}
                    </div>
                    {r && <div className={`stg-banner ${r.ok ? 'ok' : 'err'}`}>{r.ok ? '✓' : '✗'} {r.message}</div>}
                  </div>
                  <Button variant={m.installed ? 'secondary' : 'primary'} busy={busy === m.id}
                    disabled={busy !== null && busy !== m.id}
                    onClick={() => install(m.id, m.installed)}>
                    {m.installed ? 'Update' : 'Install'}
                  </Button>
                </div>
              )
            })}
          </div>
        </>
      )}
    </SettingsCard>
  )
}
