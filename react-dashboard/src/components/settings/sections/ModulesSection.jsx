import { useEffect, useMemo, useState } from 'react'
import { SettingsCard, Button } from '../primitives'
import { gt, tr } from '../../../i18n'

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
    <>
    <ModuleProcesses />
    <SettingsCard title={gt('s.modules_title', 'Integration Modules')}
      badge={mods ? `${installedCount}/${mods.length}` : null}
      desc="Integrations are downloaded from GitHub when you need them. Anything configured in config.json is installed automatically at startup; install here to get one ready before configuring it. Restart LSH after installing.">
      {error && <div className="stg-banner err">✗ {error}</div>}
      {!mods && !error && <p className="stg-hint">{tr('Loading…')}</p>}
      {mods && (
        <>
          <input className="stg-input stg-mod-filter" placeholder={tr('Filter modules…')} value={filter}
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
                      {m.configured && <span className="stg-mod-chip cfg">{tr('configured')}</span>}
                      <span className={`stg-mod-chip ${m.installed ? 'ok' : partial ? 'warn' : ''}`}>
                        {m.installed ? tr('installed') : partial ? tr('missing npm deps') : tr('not installed')}
                      </span>
                    </div>
                    <div className="stg-hint stg-mod-meta">
                      config: <code>{m.configKeys.join(', ')}</code>
                      {m.deps.length > 0 && <>{tr('· npm:')}{' '}{m.deps.join(', ')}</>}
                      {m.ref && <>{tr('· from')}{' '}{m.ref}</>}
                    </div>
                    {r && <div className={`stg-banner ${r.ok ? 'ok' : 'err'}`}>{r.ok ? '✓' : '✗'} {r.message}</div>}
                  </div>
                  <Button variant={m.installed ? 'secondary' : 'primary'} busy={busy === m.id}
                    disabled={busy !== null && busy !== m.id}
                    onClick={() => install(m.id, m.installed)}>
                    {m.installed ? tr('Update') : tr('Install')}
                  </Button>
                </div>
              )
            })}
          </div>
        </>
      )}
    </SettingsCard>
    </>
  )
}

// Integrations running in their own processes (src/module-host.js): the
// watchdog restarts one that crashes, hangs or outgrows its memory limit.
const fmtUp = (ms) => {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s} s`
  if (s < 3600) return `${Math.floor(s / 60)} min`
  if (s < 86400) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`
  return `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h`
}
const STATE_CHIP = { running: 'ok', starting: 'warn', restarting: 'warn', failed: 'err', stopped: '' }

function ModuleProcesses() {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(null)

  const load = () =>
    fetch('/api/modules/processes', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((j) => { if (j.success) setData(j.data) })
      .catch(() => {})

  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [])

  const restart = async (id) => {
    setBusy(id)
    try {
      await fetch(`/api/modules/processes/${encodeURIComponent(id)}/restart`, { method: 'POST', credentials: 'same-origin' })
      await load()
    } finally { setBusy(null) }
  }

  if (!data?.isolated) return null
  const stateLabel = {
    running: tr('running'), starting: tr('starting'), restarting: tr('restarting'), failed: tr('failed'), stopped: tr('stopped'),
  }
  const list = data.processes
  const total = list.reduce((n, p) => n + (p.rss || 0), 0)
  return (
    <SettingsCard title="Module processes" badge={`${list.filter((p) => p.state === 'running').length}/${list.length}`}
      desc="Each integration runs in its own process. If one crashes, stops responding for 30 seconds or uses too much memory, the watchdog restarts it without affecting the rest of LSH.">
      <div className="stg-hint">{tr('Total memory:')} {Math.round(total / 1048576)} MB</div>
      <div className="stg-mod-list">
        {list.map((p) => (
          <div key={p.id} className="stg-mod-row">
            <div className="stg-mod-main">
              <div className="stg-mod-name">
                {p.label}
                <span className={`stg-mod-chip ${STATE_CHIP[p.state] ?? ''}`}>{stateLabel[p.state] || p.state}</span>
                {p.restarts > 0 && <span className="stg-mod-chip warn">{tr('restarts: {n}', { n: p.restarts })}</span>}
              </div>
              <div className="stg-hint stg-mod-meta">
                {p.pid ? tr('PID {pid} · {mb} MB · up {up} · devices: {devices}', { pid: p.pid, mb: Math.round((p.rss || 0) / 1048576), up: fmtUp(p.uptime), devices: p.devices }) : '—'}
                {p.lastExit && <> · {tr('last exit:')} {p.lastExit.reason}, {new Date(p.lastExit.at).toLocaleString()}</>}
              </div>
              {p.error && <div className="stg-banner err">✗ {p.error.split('\n')[0]}</div>}
            </div>
            <Button variant="secondary" busy={busy === p.id} disabled={busy !== null && busy !== p.id}
              onClick={() => restart(p.id)}>
              {tr('Restart')}
            </Button>
          </div>
        ))}
      </div>
    </SettingsCard>
  )
}
