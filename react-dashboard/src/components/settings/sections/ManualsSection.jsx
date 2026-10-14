import { useEffect, useState } from 'react'
import { SettingsCard, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { tr } from '../../../i18n'

// Settings → System → Device manuals — manufacturer manuals kept in a private
// GitHub repo, downloaded only when opened and then cached on this host
// (src/manuals.js).

const KIND = { relay: '🔌', dimmer: '💡', shutter: '🪟', controller: '🎛', sensor: '📡', siren: '🚨', meter: '⚡', bulb: '💡', remote: '🎚', stick: '🔑', thermostat: '🌡', extender: '📶' }
const COLOR = { FIBARO: '#0a84ff', Qubino: '#30d158', Shelly: '#ff375f', SmartBob: '#7c8cff', Aeotec: '#00a0e9' }
const kb = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} kB`)

export default function ManualsSection() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [needsToken, setNeedsToken] = useState(false)
  const [token, setToken] = useState('')
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(null)
  const save = useSettingsSave('/api/settings/manuals')

  const load = (refresh) => fetch(`/api/manuals${refresh ? '?refresh=1' : ''}`, { credentials: 'include' }).then((r) => r.json()).then((j) => {
    if (j.success) { setData(j.data); setError(null); setNeedsToken(false) } else { setError(j.error); setNeedsToken(!!j.needsToken) }
  }).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  const open = async (m, download) => {
    setBusy(m.id)
    // Make sure the download worked before opening a tab on an error page
    const r = await fetch(`/api/manuals/${m.id}/pdf`, { method: 'HEAD', credentials: 'include' }).catch(() => null)
    setBusy(null)
    if (!r || !r.ok) {
      const j = await fetch(`/api/manuals/${m.id}/pdf`, { credentials: 'include' }).then((x) => x.json()).catch(() => ({}))
      setError(j.error || 'Download failed'); setNeedsToken(!!j.needsToken); return
    }
    window.open(`/api/manuals/${m.id}/pdf${download ? '?download=1' : ''}`, '_blank', 'noopener')
    load()
  }
  const removeLocal = async (m) => { await fetch(`/api/manuals/${m.id}`, { method: 'DELETE', credentials: 'include' }); load() }

  const q = filter.trim().toLowerCase()
  const list = (data?.manuals || []).filter((m) => m.role !== 'photo').filter((m) => !q || [m.title, m.model, m.manufacturer, m.kind].some((x) => String(x).toLowerCase().includes(q)))
  const cached = (data?.manuals || []).filter((m) => m.cached)

  return (
    <SettingsCard title="Device manuals"
      desc="Installation manuals for Z-Wave modules, kept in a private GitHub repository. Nothing is stored on this host until you open a manual; it's then checked against its checksum and kept for offline use.">
      {(needsToken || (data && !data.tokenConfigured)) && (
        <div className="can-hints" style={{ marginTop: 0 }}>
          <div className="stg-hint">
            {tr('The manuals repository (')}<b>{data?.repo || 'dagoomax/lsh-manuals'}</b>{tr(') is private. Create a fine-grained GitHub token with')}{' '}<b>{tr('Contents: Read-only')}</b>{' '}{tr('on that one repository (github.com → Settings → Developer settings → Fine-grained tokens) and paste it here.')}
          </div>
          <div className="mb-form tight" style={{ marginBottom: 0 }}>
            <label><span>{tr('GitHub token')}</span><input className="stg-input" type="password" autoComplete="off" placeholder={tr('github_pat_…')} value={token} onChange={(e) => setToken(e.target.value)}/></label>
            <Button variant="primary" busy={save.busy} onClick={() => save.save({ githubToken: token }).then(() => { setToken(''); load(true) }).catch(() => {})}>{tr('Save token')}</Button>
          </div>
          <ResultBanner result={save.result}/>
        </div>
      )}
      {error && !needsToken && <div className="stg-banner err">✗ {error}</div>}
      {data?.stale && <div className="stg-hint">{tr('Offline copy of the list — {stale}', { stale: data.stale })}</div>}
      {data?.access && <div className="stg-hint">{tr('Access on this host: {v}', { v: data.access === 'deploy-key' ? tr('read-only deploy key (SSH)') : tr('GitHub token') })}</div>}

      {data && (
        <>
          <div className="lan-toolbar">
            <input className="stg-input lan-search" placeholder={tr('Search model, brand…')} value={filter} onChange={(e) => setFilter(e.target.value)}/>
            <span className="stg-hint">{tr('{manualsCount} manuals · {cachedCount} on this host ({v})', { manualsCount: data.manuals.length, cachedCount: cached.length, v: kb(cached.reduce((a, m) => a + m.bytes, 0)) })}</span>
            <Button onClick={() => load(true)}>↻</Button>
          </div>
          <div className="lan-grid">
            {list.map((m, i) => (
              <div key={m.id} className="lan-tile" style={{ '--g': COLOR[m.manufacturer] || '#8e8e93', animationDelay: `${i * 25}ms` }}>
                <div className="lan-tile-main" onClick={() => open(m)} title={tr('Open manual')}>
                  <div className="lan-tile-icon"><span>{KIND[m.kind] || '📄'}</span></div>
                  <div className="lan-tile-text">
                    <div className="lan-tile-name">{m.title}</div>
                    <div className="lan-tile-sub">{m.model} · {m.format && m.format !== 'pdf' ? m.format.toUpperCase() : `${m.pages} pages`} · {kb(m.bytes)} · {m.language.toUpperCase()}</div>
                  </div>
                  <span className={`lan-kind`}>{busy === m.id ? tr('downloading…') : m.cached ? tr('✓ on host') : tr('on demand')}</span>
                </div>
                <div className="lan-tile-chips">
                  <Button variant="primary" busy={busy === m.id} onClick={() => open(m)}>{tr('Open')}</Button>
                  <Button onClick={() => open(m, true)}>{tr('Download')}</Button>
                  {m.cached && <Button onClick={() => removeLocal(m)}>{tr('Remove local copy')}</Button>}
                  {m.productPage && <a className="lan-port" href={m.productPage} target="_blank" rel="noopener noreferrer">{tr('Z-Wave Alliance page ↗')}</a>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </SettingsCard>
  )
}
