import { useCallback, useEffect, useRef, useState } from 'react'
import PageShell from './PageShell'
import { gt } from '../../i18n'

const LINE_RE = /^(\S+) \[(INFO|ERROR|WARN)\] ([\s\S]*)$/
const LINE_OPTIONS = [100, 300, 500, 1000, 2000]

// Per-category server logs (src/logger.js → logs/*.log), via /api/logs.
export default function LogsPage({ onClose }) {
  const [cats, setCats] = useState([])
  const [active, setActive] = useState('app')
  const [lines, setLines] = useState(null)
  const [limit, setLimit] = useState(300)
  const [auto, setAuto] = useState(true)
  const [error, setError] = useState(null)
  const [refreshedAt, setRefreshedAt] = useState(null)
  const outRef = useRef(null)

  useEffect(() => {
    fetch('/api/logs', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((j) => {
        const list = j.categories || []
        setCats(list)
        if (list.length && !list.includes('app')) setActive(list[0])
      })
      .catch((e) => setError(e.message))
  }, [])

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/logs/${encodeURIComponent(active)}?lines=${limit}`, { credentials: 'same-origin' })
      const j = await r.json()
      if (j.success === false) throw new Error(j.error)
      setLines(j.lines || [])
      setRefreshedAt(new Date())
      setError(null)
    } catch (e) {
      setError(e.message)
    }
  }, [active, limit])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!auto) return
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [auto, load])

  // Stick to the bottom (newest) after each load
  useEffect(() => {
    const el = outRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  const download = () => {
    const blob = new Blob([(lines || []).join('\n') + '\n'], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${active}.log`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  const clear = async () => {
    if (!window.confirm(`Clear the "${active}" log?`)) return
    await fetch(`/api/logs/${encodeURIComponent(active)}`, { method: 'DELETE', credentials: 'same-origin' })
    load()
  }

  const actions = (
    <>
      <label className="pg-check">
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)}/>
        {gt('logs_auto_refresh', 'Auto-refresh')}
      </label>
      <select className="stg-input pg-select" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
        {LINE_OPTIONS.map((n) => <option key={n} value={n}>{n.toLocaleString()} lines</option>)}
      </select>
      <button className="stg-btn stg-btn-secondary" onClick={load}>↺ {gt('logs_refresh', 'Refresh')}</button>
      <button className="stg-btn stg-btn-secondary" onClick={download} disabled={!lines?.length}>⬇ {gt('logs_download', 'Download')}</button>
      <button className="stg-btn stg-btn-danger" onClick={clear}>✕ {gt('logs_clear', 'Clear')}</button>
    </>
  )

  return (
    <PageShell title={gt('nav_logs', 'Logs')} actions={actions} onClose={onClose}>
      <div className="pg-tabs">
        {cats.map((c) => (
          <button key={c} className={`pg-tab${c === active ? ' active' : ''}`} onClick={() => setActive(c)}>{c}</button>
        ))}
      </div>
      {error && <div className="stg-banner err" style={{ padding: '8px 20px' }}>✗ {error}</div>}
      <pre className="logs-out" ref={outRef}>
        {lines && !lines.length && <span className="logs-empty">{gt('logs_empty', 'No log entries yet.')}</span>}
        {lines?.map((line, i) => {
          const m = line.match(LINE_RE)
          if (!m) return <span key={i} className="log-info">{line}{'\n'}</span>
          const [, ts, level, msg] = m
          return (
            <span key={i} className={`log-${level.toLowerCase()}`}>
              <span className="log-ts">{ts}</span> <span className="log-level">[{level}]</span> {msg}{'\n'}
            </span>
          )
        })}
      </pre>
      <div className="pg-footer">
        {lines ? `${lines.length} lines` : '—'}{refreshedAt && ` — last refreshed ${refreshedAt.toLocaleTimeString()}`}
      </div>
    </PageShell>
  )
}
