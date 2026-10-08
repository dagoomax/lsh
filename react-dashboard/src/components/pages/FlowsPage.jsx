import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import PageShell from './PageShell'
import { TYPES, ICONS, withDefaults } from './flowTypes'
import '../../styles/flows.css'

// Node-RED-style editor for automation flows (src/automation-engine.js runs
// them; /api/automation/flows stores them in automations.json).

const GRID = 22
const NODE_W = 216
// Port geometry — kept here (not only in CSS) so wire endpoints are computed
// from node x/y directly instead of measuring the DOM on every drag frame.
// +1 = the node's 1px border (ports are positioned inside it).
const IN_PORT = { left: -8, top: 15 }
const outTop = (outs, p) => (outs === 1 ? 18 : 14 + p * 22)
const inCenter = (n) => ({ x: n.x + 1 + IN_PORT.left + 7.5, y: n.y + 1 + IN_PORT.top + 7.5 })
const outCenter = (n, outs, p) => ({ x: n.x + 1 + NODE_W - 2 - 7 + 7.5, y: n.y + 1 + outTop(outs, p) + 7.5 })
const wirePath = (a, b) => {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5)
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`
}
const newId = () => 'n' + Math.random().toString(36).slice(2, 8)
const blankFlow = () => ({ id: null, name: 'New flow', enabled: true, nodes: [] })

export default function FlowsPage({ onClose }) {
  const [flows, setFlows] = useState([])
  const [current, setCurrent] = useState(null)
  const [ctx, setCtx] = useState({ scenes: [], virtualDevices: [], pagingRooms: [] })
  const [lists, setLists] = useState({ storeKeys: [], deviceKeys: [] })
  const [gridOn, setGridOn] = useState(() => { try { return localStorage.getItem('flow-grid') !== '0' } catch { return true } })
  const [result, setResult] = useState(null)
  const [tempWire, setTempWire] = useState(null)
  const [debug, setDebug] = useState([])
  const [debugOpen, setDebugOpen] = useState(true)
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const snap = useCallback((v) => (gridOn ? Math.round(v / GRID) * GRID : v), [gridOn])

  const loadFlows = useCallback(async () => {
    try {
      const j = await (await fetch('/api/automation/flows', { credentials: 'same-origin' })).json()
      setFlows(j.data || [])
      return j.data || []
    } catch { setFlows([]); return [] }
  }, [])

  useEffect(() => {
    (async () => {
      const get = (u) => fetch(u, { credentials: 'same-origin' }).then((r) => r.json()).catch(() => ({}))
      const [devs, scenes, rooms] = await Promise.all([get('/api/devices'), get('/api/automation/scenes'), get('/api/paging/rooms')])
      const storeKeys = new Set(), deviceKeys = new Set(), virtualDevices = []
      for (const d of devs.data || []) {
        deviceKeys.add(d.key)
        for (const p of Object.keys(d.readings || {})) storeKeys.add(`${d.key}/${p}`)
        if (d.type === 'virtual') {
          const s = (d.sensors || []).find((x) => x.path === 'value')
          virtualDevices.push({ key: d.key, label: d.label || d.key, valueType: s?.type || 'text' })
        }
      }
      setLists({ storeKeys: [...storeKeys].sort(), deviceKeys: [...deviceKeys].sort() })
      setCtx({ scenes: scenes.data || [], virtualDevices, pagingRooms: rooms.data || [] })
      const list = await loadFlows()
      setCurrent(list.length ? structuredClone(list[0]) : blankFlow())
    })()

    const socket = io('/', { transports: ['websocket', 'polling'] })
    socket.on('flow-debug', (d) => {
      setDebug((prev) => [{ ...d, _id: Math.random() }, ...prev].slice(0, 200))
      setDebugOpen(true)
    })
    return () => socket.disconnect()
  }, [loadFlows])

  useEffect(() => { try { localStorage.setItem('flow-grid', gridOn ? '1' : '0') } catch { /* ignore */ } }, [gridOn])

  const flash = (ok, message) => { setResult({ ok, message }); setTimeout(() => setResult(null), 3000) }

  // ── Node edits ──────────────────────────────────────────
  const updateNode = (id, fn) => setCurrent((c) => ({ ...c, nodes: c.nodes.map((n) => (n.id === id ? fn(n) : n)) }))
  const setConfig = (id, key, value, refresh) => updateNode(id, (n) => {
    let cfg = { ...withDefaults(n, ctx), [key]: value }
    if (refresh) cfg = refresh(cfg)
    return { ...n, config: cfg }
  })

  const addNode = (type) => {
    const t = TYPES[type]
    const wrap = wrapRef.current
    setCurrent((c) => {
      const base = c || blankFlow()
      const k = base.nodes.length % 5
      const node = {
        id: newId(), type, x: snap((wrap?.scrollLeft || 0) + 80 + k * 30), y: snap((wrap?.scrollTop || 0) + 80 + k * 30),
        wires: Array.from({ length: t.outs }, () => []),
      }
      node.config = withDefaults({ ...node, config: {} }, ctx)
      return { ...base, nodes: [...base.nodes, node] }
    })
  }

  const deleteNode = (id) => setCurrent((c) => ({
    ...c,
    nodes: c.nodes.filter((n) => n.id !== id).map((n) => ({ ...n, wires: (n.wires || []).map((w) => (w || []).filter((t) => t !== id)) })),
  }))

  const removeWire = (fromId, port, toId) => updateNode(fromId, (n) => {
    const wires = [...(n.wires || [])]
    wires[port] = (wires[port] || []).filter((t) => t !== toId)
    return { ...n, wires }
  })

  // ── Drag: move node ─────────────────────────────────────
  const startNodeDrag = (e, node) => {
    if (e.button !== 0) return
    e.preventDefault()
    const cr = canvasRef.current.getBoundingClientRect()
    const ox = e.clientX - cr.left - node.x, oy = e.clientY - cr.top - node.y
    const move = (ev) => updateNode(node.id, (n) => ({
      ...n, x: Math.max(0, snap(ev.clientX - cr.left - ox)), y: Math.max(0, snap(ev.clientY - cr.top - oy)),
    }))
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up) }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  // ── Drag: connect out-port → in-port ────────────────────
  const startWire = (e, node, port) => {
    e.preventDefault(); e.stopPropagation()
    const cr = canvasRef.current.getBoundingClientRect()
    const a = outCenter(node, TYPES[node.type].outs, port)
    const move = (ev) => setTempWire({ a, b: { x: ev.clientX - cr.left, y: ev.clientY - cr.top } })
    const up = (ev) => {
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up)
      setTempWire(null)
      const target = ev.target.closest?.('[data-in-port]')?.dataset.inPort
      if (!target || target === node.id) return
      updateNode(node.id, (n) => {
        const wires = [...(n.wires || [])]
        wires[port] = wires[port] || []
        if (!wires[port].includes(target)) wires[port] = [...wires[port], target]
        return { ...n, wires }
      })
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  // ── Flow actions ────────────────────────────────────────
  const selectFlow = (id) => {
    if (id === '__new') return setCurrent(blankFlow())
    const f = flows.find((x) => x.id === id)
    setCurrent(f ? { ...structuredClone(f), nodes: f.nodes || [] } : blankFlow())
  }

  const deploy = async () => {
    if (!current) return null
    const body = { ...current, name: current.name.trim() || 'Flow', nodes: current.nodes.map((n) => ({ ...n, config: withDefaults(n, ctx) })) }
    const j = await (await fetch('/api/automation/flows', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })).json()
    if (!j.success) { flash(false, j.error); return null }
    setCurrent(j.data)
    await loadFlows()
    flash(true, 'Deployed')
    return j.data
  }

  const testRun = async () => {
    const flow = current?.id ? current : await deploy()
    if (!flow?.id) return
    const j = await (await fetch(`/api/automation/flows/${flow.id}/run`, { method: 'POST', credentials: 'same-origin' })).json()
    flash(j.success, j.success ? 'Test fired' : j.error)
  }

  const deleteFlow = async () => {
    if (!current?.id) return setCurrent(blankFlow())
    if (!window.confirm(`Delete flow "${current.name}"?`)) return
    await fetch(`/api/automation/flows/${current.id}`, { method: 'DELETE', credentials: 'same-origin' })
    const list = await loadFlows()
    setCurrent(list.length ? structuredClone(list[0]) : blankFlow())
  }

  const wires = useMemo(() => {
    if (!current) return []
    const byId = new Map(current.nodes.map((n) => [n.id, n]))
    const out = []
    for (const n of current.nodes) {
      const t = TYPES[n.type]
      if (!t) continue
      ;(n.wires || []).forEach((targets, port) => {
        for (const tid of targets || []) {
          const target = byId.get(tid)
          if (!target || port >= t.outs) continue
          out.push({ key: `${n.id}:${port}:${tid}`, from: n.id, port, to: tid, color: t.color, d: wirePath(outCenter(n, t.outs, port), inCenter(target)) })
        }
      })
    }
    return out
  }, [current])

  const actions = (
    <>
      {result && <span className={`stg-banner ${result.ok ? 'ok' : 'err'}`}>{result.ok ? '✓' : '✗'} {result.message}</span>}
      <button className="stg-btn stg-btn-secondary" onClick={testRun} disabled={!current}>Test run</button>
      <button className="stg-btn stg-btn-danger" onClick={deleteFlow} disabled={!current}>Delete</button>
      <button className="stg-btn stg-btn-primary" onClick={deploy} disabled={!current}>Deploy</button>
    </>
  )

  return (
    <PageShell title="Flows" actions={actions} onClose={onClose}>
      <datalist id="fe-store-keys">{lists.storeKeys.map((k) => <option key={k} value={k}/>)}</datalist>
      <datalist id="fe-device-keys">{lists.deviceKeys.map((k) => <option key={k} value={k}/>)}</datalist>
      <div className="fe-wrap">
        <aside className="fe-palette">
          <h3>Nodes</h3>
          {Object.entries(TYPES).map(([type, t]) => (
            <button key={type} className="fe-palette-node" style={{ '--pc': t.color }} onClick={() => addNode(type)}>
              <span className="dot" style={{ background: t.color, boxShadow: `0 0 9px ${t.color}` }}/>
              {ICONS[type]} {t.label}
            </button>
          ))}
          <h3 style={{ marginTop: 18 }}>Tip</h3>
          <p className="fe-tip">
            Click a node to add it. Drag from a node's <b>right</b> dot to another's <b>left</b> dot to wire them.
            A <b>Trigger</b> starts the flow when a value changes. Click a wire to remove it.
          </p>
        </aside>

        <main className="fe-main">
          <div className="fe-toolbar">
            <select className="stg-input" value={current?.id || '__new'} onChange={(e) => selectFlow(e.target.value)}>
              {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              <option value="__new">— New flow —</option>
            </select>
            <button className="stg-btn stg-btn-secondary" onClick={() => setCurrent(blankFlow())}>+ New</button>
            <input className="stg-input fe-name" placeholder="Flow name" value={current?.name || ''}
              onChange={(e) => setCurrent((c) => ({ ...c, name: e.target.value }))}/>
            <label className="pg-check">
              <input type="checkbox" checked={current?.enabled !== false}
                onChange={(e) => setCurrent((c) => ({ ...c, enabled: e.target.checked }))}/> Enabled
            </label>
            <label className="pg-check">
              <input type="checkbox" checked={gridOn} onChange={(e) => setGridOn(e.target.checked)}/> Grid
            </label>
          </div>

          <div className={`fe-canvas-wrap${gridOn ? ' grid' : ''}`} ref={wrapRef}>
            <div className="fe-canvas" ref={canvasRef}>
              <svg className="fe-wires">
                {wires.map((w) => (
                  <g key={w.key}>
                    <path className="fe-wire" d={w.d} style={{ stroke: w.color, filter: `drop-shadow(0 0 5px ${w.color})` }}
                      onClick={() => removeWire(w.from, w.port, w.to)}/>
                    <path className="fe-wire-anim" d={w.d}/>
                  </g>
                ))}
                {tempWire && <path className="fe-wire-temp" d={wirePath(tempWire.a, tempWire.b)}/>}
              </svg>
              {current && !current.nodes.length && (
                <div className="fe-empty">Add a <b>Trigger</b> node, then an action, and wire them together.</div>
              )}
              {current?.nodes.map((n) => (
                <FlowNode key={n.id} node={n} ctx={ctx}
                  onDrag={(e) => startNodeDrag(e, n)} onDelete={() => deleteNode(n.id)}
                  onWire={(e, p) => startWire(e, n, p)} onSet={(k, v, refresh) => setConfig(n.id, k, v, refresh)}/>
              ))}
            </div>
          </div>

          <section className={`fe-debug${debugOpen ? '' : ' collapsed'}`}>
            <div className="fe-debug-head">
              <span className="dbg-title">🐞 Debug</span>
              <span className="dbg-count">{debug.length}</span>
              <span style={{ flex: 1 }}/>
              <button className="stg-btn stg-btn-secondary" onClick={() => setDebug([])}>Clear</button>
              <button className="stg-btn stg-btn-secondary" onClick={() => setDebugOpen((o) => !o)}>{debugOpen ? '▾' : '▴'}</button>
            </div>
            <div className="fe-debug-log">
              {!debug.length && <div className="dbg-empty">Add a <b>Debug</b> node and wire a node's output into it — messages flowing through appear here live.</div>}
              {debug.map((d) => (
                <div key={d._id} className="dbg-row">
                  <span className="dbg-time">{new Date(d.time || Date.now()).toLocaleTimeString()}</span>
                  <span className="dbg-name">{d.label || 'debug'}</span>
                  <span className="dbg-msg">
                    {d.key && <><span className="k">{d.key}</span> = </>}
                    <span className="v">{typeof d.payload === 'object' ? JSON.stringify(d.payload) : String(d.payload)}</span>
                  </span>
                </div>
              ))}
            </div>
          </section>
        </main>
      </div>
    </PageShell>
  )
}

function FlowNode({ node, ctx, onDrag, onDelete, onWire, onSet }) {
  const t = TYPES[node.type]
  // A node type this build doesn't know (saved by a newer version) still
  // renders — draggable and deletable — so the rest of the flow does too.
  const color = t?.color || '#ff4d5e'
  const cfg = t ? withDefaults(node, ctx) : {}
  return (
    <div className="fe-node" style={{ left: node.x || 0, top: node.y || 0, width: NODE_W, '--nc': color }}>
      <div className="fe-head" onMouseDown={onDrag}>
        <span className="fe-ico">{t ? ICONS[node.type] || '●' : '❔'}</span>
        <span className="fe-title">{t?.label || node.type || 'unknown'}</span>
        <span className="fe-del" title="Delete" onMouseDown={(e) => e.stopPropagation()} onClick={onDelete}>✕</span>
      </div>
      <div className="fe-body">
        {t ? t.fields(cfg, ctx).map((f, i) => <Field key={i} f={f} cfg={cfg} onSet={onSet}/>)
          : <div className="fe-hint">Unknown node type — reload the page to get the latest editor.</div>}
      </div>
      <div className="fe-port in" data-in-port={node.id} style={IN_PORT}/>
      {Array.from({ length: t?.outs || 0 }, (_, p) => (
        <div key={p} className="fe-port out" style={{ left: NODE_W - 2 - 7, top: outTop(t.outs, p) }}
          onMouseDown={(e) => onWire(e, p)}/>
      ))}
    </div>
  )
}

function Field({ f, cfg, onSet }) {
  if (f.kind === 'hint') return <div className="fe-hint">{f.text}</div>
  if (f.kind === 'row') return <div className="fe-row">{f.items.map((x, i) => <Field key={i} f={x} cfg={cfg} onSet={onSet}/>)}</div>
  const v = cfg[f.key]
  let input
  if (f.kind === 'select') {
    input = (
      <select value={v ?? f.def ?? f.options[0]?.[0] ?? ''} onChange={(e) => onSet(f.key, e.target.value, f.refresh)}>
        {f.options.map(([val, text]) => <option key={val} value={val}>{text}</option>)}
      </select>
    )
  } else if (f.kind === 'bool') {
    input = (
      <select value={v === false ? f.labels[1] : f.labels[0]} onChange={(e) => onSet(f.key, e.target.value === f.labels[0])}>
        {f.labels.map((l) => <option key={l} value={l}>{l}</option>)}
      </select>
    )
  } else if (f.kind === 'textarea') {
    input = <textarea rows={f.rows || 3} placeholder={f.ph} value={v ?? ''} onChange={(e) => onSet(f.key, e.target.value)}/>
  } else {
    input = (
      <input type={f.kind} placeholder={f.ph} list={f.list} value={v ?? ''}
        onChange={(e) => onSet(f.key, f.kind === 'number' ? Number(e.target.value) : e.target.value)}/>
    )
  }
  return <div className="fe-field"><label>{f.label}</label>{input}</div>
}
