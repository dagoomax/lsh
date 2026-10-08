import { useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import PageShell from './PageShell'
import { gt } from '../../i18n'

const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour12: false })
const pretty = (s) => { try { return JSON.stringify(JSON.parse(s), null, 2) } catch { return s ?? '' } }

// Live MQTT topic browser (src/mqtt-explorer.js): every topic seen on the
// configured broker, its latest value + history, and a publish form.
export default function MqttPage({ onClose }) {
  const [topics, setTopics] = useState(() => new Map()) // topic -> { value, ts, count }
  const [connected, setConnected] = useState(false)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState(null)
  const [history, setHistory] = useState([])
  const [rate, setRate] = useState(0)
  const [flash, setFlash] = useState(() => new Set())
  const rateCounter = useRef(0)
  const selectedRef = useRef(null)
  selectedRef.current = selected

  const loadHistory = (topic) =>
    fetch(`/api/mqtt-explorer/history?topic=${encodeURIComponent(topic)}`, { credentials: 'same-origin' })
      .then((r) => r.json()).then((j) => setHistory(j.data || [])).catch(() => {})

  useEffect(() => {
    fetch('/api/mqtt-explorer/topics', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((j) => {
        setConnected(!!j.connected)
        setTopics(new Map((j.data || []).map((t) => [t.topic, { value: t.value, ts: t.ts, count: t.count }])))
      })
      .catch(() => {})

    const socket = io('/', { transports: ['websocket', 'polling'] })
    socket.on('mqtt-explorer-status', ({ connected: c }) => setConnected(!!c))
    socket.on('mqtt-explorer-msg', ({ topic, payload, ts, count }) => {
      rateCounter.current++
      setTopics((prev) => { const next = new Map(prev); next.set(topic, { value: payload, ts, count }); return next })
      setFlash((prev) => new Set(prev).add(topic))
      setTimeout(() => setFlash((prev) => { const n = new Set(prev); n.delete(topic); return n }), 400)
      if (selectedRef.current === topic) loadHistory(topic)
    })
    socket.on('mqtt-explorer-clear', () => { setTopics(new Map()); setSelected(null); setHistory([]) })

    const rateTimer = setInterval(() => { setRate(rateCounter.current); rateCounter.current = 0 }, 1000)
    return () => { socket.disconnect(); clearInterval(rateTimer) }
  }, [])

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return [...topics.keys()].filter((t) => !q || t.toLowerCase().includes(q)).sort()
  }, [topics, filter])

  const select = (topic) => { setSelected(topic); setHistory([]); loadHistory(topic) }

  const clearAll = async () => {
    if (!window.confirm('Clear all retained topic data?')) return
    await fetch('/api/mqtt-explorer/clear', { method: 'POST', credentials: 'same-origin' })
  }

  const cur = selected ? topics.get(selected) : null

  const actions = (
    <>
      <span className={`pg-badge ${connected ? 'on' : ''}`}>{connected ? gt('mqtt_connected', 'Connected') : gt('mqtt_disconnected', 'Disconnected')}</span>
      <span className="pg-stat">{topics.size} topics</span>
      <span className="pg-stat">{rate} msg/s</span>
    </>
  )

  return (
    <PageShell title="MQTT" actions={actions} onClose={onClose}>
      <div className="mqtt-layout">
        <aside className="mqtt-side">
          <div className="mqtt-search">
            <input type="search" className="stg-input" placeholder={gt('mqtt_filter', 'Filter topics…')}
              value={filter} onChange={(e) => setFilter(e.target.value)}/>
            <button className="stg-btn stg-btn-secondary" onClick={clearAll}>{gt('mqtt_clear', 'Clear')}</button>
          </div>
          <div className="mqtt-list">
            {!topics.size && <div className="pg-empty">{gt('mqtt_waiting', 'Waiting for messages…')}</div>}
            {shown.map((t) => {
              const v = topics.get(t)
              return (
                <div key={t} className={`mqtt-row${t === selected ? ' active' : ''}${flash.has(t) ? ' flash' : ''}`} onClick={() => select(t)}>
                  <span className={`mqtt-dot${flash.has(t) ? ' pulse' : ''}`}/>
                  <span className="mqtt-path" title={t}>{t}</span>
                  <span className="mqtt-val">{v.value}</span>
                  <span className="mqtt-cnt">{v.count}</span>
                </div>
              )
            })}
          </div>
        </aside>
        <main className="mqtt-detail">
          {!selected
            ? <div className="pg-empty" style={{ margin: 'auto' }}>{gt('mqtt_select', 'Select a topic to inspect')}</div>
            : <TopicDetail topic={selected} cur={cur} history={history}/>}
        </main>
      </div>
    </PageShell>
  )
}

function TopicDetail({ topic, cur, history }) {
  const [pubTopic, setPubTopic] = useState(topic)
  const [payload, setPayload] = useState('')
  const [retain, setRetain] = useState(false)
  const [result, setResult] = useState(null)
  useEffect(() => { setPubTopic(topic); setResult(null) }, [topic])

  const publish = async (e) => {
    e.preventDefault()
    if (!pubTopic.trim()) return
    try {
      const r = await fetch('/api/mqtt-explorer/publish', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: pubTopic.trim(), payload, retain }),
      })
      const j = await r.json()
      setResult(j.success ? { ok: true, message: 'Published' } : { ok: false, message: j.error })
    } catch (err) {
      setResult({ ok: false, message: err.message })
    }
  }

  return (
    <div className="mqtt-detail-inner">
      <div>
        <div className="mqtt-detail-topic">{topic}</div>
        <div className="pg-stat">{cur?.count || 0} messages · last {cur?.ts ? fmtTime(cur.ts) : '—'}</div>
      </div>
      <pre className="mqtt-value">{pretty(cur?.value)}</pre>
      <div className="mqtt-history">
        <div className="mqtt-history-head">Message history</div>
        {!history.length && <div className="pg-empty" style={{ padding: 12 }}>No history</div>}
        {history.slice().reverse().map((h, i) => (
          <div key={i} className="mqtt-history-row">
            <span className="pg-stat">{fmtTime(h.ts)}</span>
            <span className="mqtt-history-val" title={h.payload}>{h.payload}</span>
          </div>
        ))}
      </div>
      <form className="mqtt-publish" onSubmit={publish}>
        <input className="stg-input" value={pubTopic} onChange={(e) => setPubTopic(e.target.value)} placeholder="topic/path"/>
        <input className="stg-input" value={payload} onChange={(e) => setPayload(e.target.value)} placeholder="value or JSON"/>
        <label className="pg-check"><input type="checkbox" checked={retain} onChange={(e) => setRetain(e.target.checked)}/> Retain</label>
        <button type="submit" className="stg-btn stg-btn-primary">Publish</button>
        {result && <span className={`stg-banner ${result.ok ? 'ok' : 'err'}`}>{result.ok ? '✓' : '✗'} {result.message}</span>}
      </form>
    </div>
  )
}
