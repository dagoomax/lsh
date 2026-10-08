import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SettingsCard, Button } from '../primitives'
import { DEVICES, CONNECTORS, WIRE_COLORS, toolsFor } from '../wiring/devices.js'
import { simulate, initialState, check, steps, portName, wallBoxPlan } from '../wiring/sim.js'
import WiringCanvas, { wagoGeo } from '../wiring/WiringCanvas.jsx'
import { t } from '../wiring/i18n.js'
import WiringInfo from '../wiring/WiringInfo.jsx'
import { getLang } from '../../../i18n'

const NONE = []

// Place connectors side by side in the free area right of the module
function placeConnectors(parts, startX = 545, y = 372) {
  let x = startX
  return parts.map((p) => { const w = wagoGeo({ ...p, x: 0, y: 0 }).width; const out = { ...p, x: x + w / 2, y }; x += w + 14; return out })
}

// Settings → System → Wiring emulator — wiring assistant + circuit emulator
// for Z-Wave in-wall modules, built from the manufacturers' manuals
// (wiring/devices.js; manuals on demand via /api/manuals).
//
// Assistant: the manual's diagram, wire by wire.  Practice: wire it yourself
// (click two connection points), check it, then switch the power on and use
// the wall switch — lamps light, motors run, shorts trip the breaker.

export default function WiringSection() {
  const [devId, setDevId] = useState(DEVICES[0].id)
  const device = DEVICES.find((d) => d.id === devId)
  const [scnId, setScnId] = useState(device.scenarios[0].id)
  const scenario = device.scenarios.find((s) => s.id === scnId) || device.scenarios[0]
  const [mode, setMode] = useState('assist') // 'assist' | 'practice'
  const [step, setStep] = useState(0)
  const [userWires, setUserWires] = useState([])
  const [pending, setPending] = useState(null)
  const [power, setPower] = useState(false)
  const [switches, setSwitches] = useState({})
  const [sim, setSim] = useState(null)
  const [tripped, setTripped] = useState(null)
  const [result, setResult] = useState(null)
  const [shutterPos, setShutterPos] = useState(50)
  const stateRef = useRef(initialState(device))
  const [tick, setTick] = useState(0)
  const [realBox, setRealBox] = useState(false)
  const [userParts, setUserParts] = useState([])
  const [draft, setDraft] = useState(null) // { from, points, cursor }
  const [color, setColor] = useState('auto')
  const [checked, setChecked] = useState({})
  const [big, setBig] = useState(false)
  const [info, setInfo] = useState(false)

  const plan = useMemo(() => { const p = wallBoxPlan(device, scenario); return { ...p, parts: placeConnectors(p.parts) } }, [device, scenario])
  const lang = getLang()
  const stepList = useMemo(() => steps(device, scenario, realBox ? plan : null), [device, scenario, realBox, plan, lang])
  const wires = useMemo(() => (mode === 'assist' ? (realBox ? plan.wires : scenario.wires).slice(0, step + 1) : userWires), [mode, scenario, step, userWires, realBox, plan])
  const extras = mode === 'assist' ? (realBox ? plan.parts : NONE) : userParts
  const kit = useMemo(() => toolsFor(device, scenario, plan), [device, scenario, plan, lang])

  // Reset when the device or diagram changes
  useEffect(() => { setScnId(device.scenarios[0].id) }, [devId])
  useEffect(() => {
    stateRef.current = initialState(device)
    setStep(mode === 'assist' ? (realBox ? plan.wires : scenario.wires).length - 1 : 0); setUserWires([]); setUserParts([]); setDraft(null); setPending(null); setPower(false); setSwitches({}); setSim(null); setTripped(null); setResult(null); setShutterPos(50)
  }, [devId, scnId, mode, realBox])
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      setDraft((d) => { if (!d) setBig(false); return null })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    if (!big) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [big])

  // Run the circuit
  useEffect(() => {
    if (!power) { setSim(null); stateRef.current = { ...stateRef.current, prevInputs: {} }; return }
    const r = simulate(device, scenario, wires, switches, stateRef.current, extras, { realBox })
    stateRef.current = r.state
    if (r.short) { setTripped(r.short); setPower(false); setSim(null); return }
    setSim(r)
  }, [power, wires, switches, tick, device, scenario, extras, realBox])

  // Blind travel
  const motorDir = sim && Object.values(sim.motors || {})[0]
  useEffect(() => {
    if (!motorDir || motorDir === 'both') return
    const iv = setInterval(() => setShutterPos((p) => Math.max(0, Math.min(100, p + (motorDir === 'up' ? 4 : -4)))), 120)
    return () => clearInterval(iv)
  }, [motorDir])
  // Limit switches: stop the module at the end of travel
  useEffect(() => {
    const dir = stateRef.current.shutter?.dir
    if (dir && ((dir === 'up' && shutterPos >= 100) || (dir === 'down' && shutterPos <= 0))) {
      stateRef.current = { ...stateRef.current, shutter: { dir: null } }; setTick((n) => n + 1)
    }
  }, [shutterPos])

  const setKey = (id, k, v) => setSwitches((s) => { const a = [...(s[id] || [])]; a[k] = v; return { ...s, [id]: a } })
  const remote = (fn) => { stateRef.current = fn(stateRef.current); setTick((n) => n + 1) }

  // Drawing: click a point to start, click empty space to bend, click the target to finish
  const onPort = (p) => {
    if (mode !== 'practice') return
    if (!draft) return setDraft({ from: p, points: [], cursor: null })
    if (draft.from === p) return setDraft(null)
    const exists = userWires.some(([a, b]) => (a === draft.from && b === p) || (a === p && b === draft.from))
    if (!exists) setUserWires((w) => [...w, [draft.from, p, { points: draft.points, color }]])
    setDraft(null); setResult(null)
  }
  const onCanvasPoint = (pt) => {
    if (!draft) return
    if (!pt) return setDraft(null)
    setDraft((d) => ({ ...d, points: [...d.points, pt] }))
  }
  const addConnector = (c) => {
    const n = userParts.length
    setUserParts((ps) => [...ps, { id: `u${Date.now().toString(36)}`, kind: 'wago', poles: c.poles, model: c.model, label: '', x: 560 + (n % 3) * 130, y: 360 + Math.floor(n / 3) * 4 }])
  }
  const removeConnector = (id) => {
    setUserParts((ps) => ps.filter((p) => p.id !== id))
    setUserWires((ws) => ws.filter(([a, b]) => !a.startsWith(`${id}:`) && !b.startsWith(`${id}:`)))
  }

  const findings = sim?.findings || []
  const manualUrl = `/api/manuals/${device.manual}/pdf`

  const toolbar = (
<div className="lan-toolbar">
        <div className="lan-filters" style={{ margin: 0 }}>
          {device.scenarios.map((s) => <button key={s.id} className={`lan-filter${s.id === scenario.id ? ' active' : ''}`} onClick={() => setScnId(s.id)}>{t(s.title)}</button>)}
        </div>
        <label className="emu-inline" title={t('Incoming cable has one L, one N and one PE conductor — splits need connectors')}>
          <input type="checkbox" checked={realBox} onChange={(e) => setRealBox(e.target.checked)}/> {t('Real wall box (connectors)')}
        </label>
        <button className="wr-info-btn" onClick={() => setInfo(true)} title={t('How the wiring emulator works')}>ℹ {t('Info')}</button>
        <div className="lan-viewtoggle" style={{ marginLeft: 'auto' }}>
          <button className={mode === 'assist' ? 'active' : ''} onClick={() => setMode('assist')}>📖 {t('Assistant')}</button>
          <button className={mode === 'practice' ? 'active' : ''} onClick={() => setMode('practice')}>🧪 {t('Practice')}</button>
        </div>
      </div>
  )

  return (
    <SettingsCard title={t('Wiring emulator')}
      desc={t('Wiring assistant and circuit emulator for Z-Wave in-wall modules, built from the manufacturers’ installation manuals. Follow the diagram wire by wire, or wire it yourself and test it: switch the power on, use the wall switch, and see what lights up — or what trips. Practice only: always follow the manual and local regulations, and leave mains work to a qualified electrician.')}>
      <div className="wr-devices">
        {DEVICES.map((d) => (
          <button key={d.id} className={`wr-dev${d.id === devId ? ' active' : ''}`} style={{ '--g': d.color }} onClick={() => setDevId(d.id)}>
            <span className="wr-dev-icon">{{ relay: '🔌', dimmer: '💡', shutter: '🪟' }[d.kind]}</span>
            <span><b>{d.name}</b><small>{d.manufacturer} {d.model}</small></span>
          </button>
        ))}
      </div>

      {!big && toolbar}
      {big && <div className="wr-placeholder"><span>{t('The emulator is open in a large window.')}</span><Button onClick={() => setBig(false)}>{t('Bring it back')}</Button></div>}
      {(() => {
        const stage = (
      <div className={`wr-stage${big ? ' big' : ''}`}>
        <div className="wr-canvas">
          {!big && <button className="lan-expand wr-expand" onClick={() => setBig(true)} title={t('Enlarge')}>⤢</button>}
          <WiringCanvas zoomable={big} device={device} scenario={scenario} wires={wires} highlight={mode === 'assist' && !power ? step : null}
            sim={sim} powered={power} switches={switches} interactive={mode === 'practice'} pending={draft?.from || pending}
            extras={extras} draft={draft} draftColor={color} onCanvasPoint={onCanvasPoint} onPointerMove={(pt) => setDraft((d) => (d ? { ...d, cursor: pt } : d))}
            onExtraMove={(id, x, y) => setUserParts((ps) => ps.map((p) => (p.id === id ? { ...p, x, y } : p)))} onExtraRemove={removeConnector}
            onPress={(id, k) => setKey(id, k, true)} onRelease={(id, k) => setKey(id, k, false)} onToggle={(id, k) => setKey(id, k, !(switches[id] || [])[k])}
            onPort={onPort} onWireClick={(i) => { setUserWires((w) => w.filter((_, j) => j !== i)); setResult(null) }}
            shutterPos={device.kind === 'shutter' ? shutterPos : null}/>
          {tripped && (
            <div className="wr-trip" onClick={() => setTripped(null)}>
              <b>⚡ {t('Breaker tripped')}</b><span>{tripped}</span><small>{t('Fix the wiring, then switch the power on again.')}</small>
            </div>
          )}
          {mode === 'practice' && (
            <div className="wr-palette">
              <span className="wr-pal-title">{t('Wire')}</span>
              {WIRE_COLORS.map((c) => (
                <button key={c.id} className={`wr-swatch sw-${c.id}${color === c.id ? ' active' : ''}`} title={t(c.label)} onClick={() => setColor(c.id)}>{c.id === 'auto' ? t('auto') : ''}</button>
              ))}
              <span className="wr-pal-title" style={{ marginLeft: 10 }}>{t('Connector')}</span>
              {CONNECTORS.map((c) => (
                <button key={c.model} className="wr-conn" title={`${c.model} — ${t(c.spec)}${c.note ? `. ${t(c.note)}` : ''}`} onClick={() => addConnector(c)}>
                  <b>{c.model === 'WAGO 221-2411' ? '1' : c.poles}</b><small>{c.model.replace('WAGO ', '')}</small>
                </button>
              ))}
              {draft && <span className="stg-hint">{t('Drawing from {p} · click to bend · click the target · Esc / right-click cancels', { p: portName(device, scenario, draft.from, extras) })}</span>}
            </div>
          )}
          <div className="wr-controls">
            <button className={`wr-power${power ? ' on' : ''}`} onClick={() => { setTripped(null); setPower(!power) }}>{power ? `⏻ ${t('Power on')}` : `⏻ ${t('Power off')}`}</button>
            {power && sim?.powered && (device.channels || []).map((c) => (
              <button key={c.id} className={`wr-zw${stateRef.current.channels[c.id] ? ' on' : ''}`} onClick={() => remote((s) => ({ ...s, channels: { ...s.channels, [c.id]: !s.channels[c.id] } }))}>
                Z-Wave · {t(c.label)}: {stateRef.current.channels[c.id] ? t('ON') : t('OFF')}
              </button>
            ))}
            {power && sim?.powered && device.kind === 'dimmer' && (
              <label className="wr-level">{t('Level')} <input type="range" min="1" max="100" value={stateRef.current.level} onChange={(e) => remote((s) => ({ ...s, level: Number(e.target.value) }))}/> {stateRef.current.level}%</label>
            )}
            {power && sim?.powered && device.shutter && ['up', null, 'down'].map((d) => (
              <button key={String(d)} className="wr-zw" onClick={() => remote((s) => ({ ...s, shutter: { dir: d } }))}>Z-Wave {d === 'up' ? '▲' : d === 'down' ? '▼' : '■'}</button>
            ))}
            {power && sim && !sim.powered && <span className="stg-hint">{t('Module has no power.')}</span>}
            {power && sim?.twoWire && <span className="lan-kind">{t('2-wire mode')}</span>}
          </div>
        </div>

        <aside className="wr-side">
          {mode === 'assist' ? (
            <div className="wr-panel">
              <div className="ble-dd-title">{t('Step {n} of {total}', { n: Math.min(step + 1, stepList.length), total: stepList.length })}</div>
              <ol className="wr-steps">
                {stepList.map((s, i) => (
                  <li key={i} className={i === step ? 'cur' : i < step ? 'done' : ''} onClick={() => setStep(i)}>
                    <span>{s.text}</span>{i === step && s.hint && <small>{s.hint}</small>}
                  </li>
                ))}
              </ol>
              <div className="stg-actions" style={{ marginTop: 6 }}>
                <Button onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>← {t('Back')}</Button>
                <Button variant="primary" onClick={() => setStep(Math.min(stepList.length - 1, step + 1))} disabled={step >= stepList.length - 1}>{t('Next wire')} →</Button>
                <Button onClick={() => setStep(0)}>{t('Restart')}</Button>
              </div>
              <div className="stg-hint" style={{ marginTop: 8 }}>{step >= stepList.length - 1 ? t('All wires in — switch the power on and try the wall switch.') : t('Tip: the highlighted wire is the current step.')}</div>
            </div>
          ) : (
            <div className="wr-panel">
              <div className="ble-dd-title">{t('Your wiring · wires: {n}', { n: userWires.length })}</div>
              <div className="stg-hint">{draft ? t('From {p} — click empty space to add bends, then the point where it ends.', { p: portName(device, scenario, draft.from, extras) }) : t('Click a connection point to start a wire, click empty space to route it, click the end point to finish. Rails (L / N / PE) are mains. Click a wire to remove it. Add connectors from the palette and drag them where you like.')}</div>
              <div className="stg-actions" style={{ marginTop: 8 }}>
                <Button variant="primary" onClick={() => setResult(check(device, scenario, userWires, userParts))}>✓ {t('Check wiring')}</Button>
                <Button onClick={() => { const src = realBox ? plan : { parts: [], wires: scenario.wires }; setUserParts(src.parts.map((p) => ({ ...p }))); setUserWires(src.wires.map((w) => [...w])); setResult(null) }}>{t('Show solution')}</Button>
                <Button onClick={() => { setUserWires([]); setUserParts([]); setResult(null); setPower(false) }}>{t('Clear')}</Button>
              </div>
              {result && (result.ok
                ? <div className="stg-banner ok" style={{ marginTop: 8 }}>✓ {t('Matches the manual’s diagram. Switch the power on to test it.')}</div>
                : (
                  <div className="wr-result">
                    {result.missing.map(([a, b], i) => <div key={`m${i}`} className="wr-f warn">＋ {t('Connect {a} to {b}', { a: portName(device, scenario, a, userParts), b: portName(device, scenario, b, userParts) })}</div>)}
                    {result.extra.map(([a, b], i) => <div key={`e${i}`} className="wr-f danger">✕ {t('{a} must not be connected to {b}', { a: portName(device, scenario, a, userParts), b: portName(device, scenario, b, userParts) })}</div>)}
                  </div>
                ))}
            </div>
          )}

          {findings.length > 0 && (
            <div className="wr-panel">
              <div className="ble-dd-title">{t('Emulator says')}</div>
              {findings.map((f, i) => <div key={i} className={`wr-f ${f.level}`}>{f.level === 'danger' ? '⚠ ' : f.level === 'warn' ? '△ ' : 'ℹ '}{f.text}</div>)}
            </div>
          )}

          <div className="wr-panel">
            <div className="ble-dd-title">{t('Tools to mount it')}</div>
            {kit.tools.map((x) => (
              <label key={x.id} className="wr-check"><input type="checkbox" checked={!!checked[x.id]} onChange={(e) => setChecked({ ...checked, [x.id]: e.target.checked })}/><span>{x.text}</span></label>
            ))}
            <div className="ble-dd-title" style={{ marginTop: 10 }}>{t('Materials (as built in a real wall box)')}</div>
            {kit.materials.map((m) => (
              <label key={m.id} className="wr-check"><input type="checkbox" checked={!!checked[`m-${m.id}`]} onChange={(e) => setChecked({ ...checked, [`m-${m.id}`]: e.target.checked })}/><span>{m.text}</span></label>
            ))}
          </div>

          <div className="wr-panel">
            <div className="ble-dd-title">{t('{device} — essentials', { device: `${device.manufacturer} ${device.model}` })}</div>
            {device.specs.map(([k, v]) => <div key={k} className="ble-dd-kv"><span className="stg-hint">{t(k)}</span><span>{t(v)}</span></div>)}
            <ul className="wr-rules">{device.rules.map((r, i) => <li key={i}>{t(r)}</li>)}</ul>
            <div className="wr-terms">
              {device.terminals.map((x) => <div key={x.id}><b className={`role-${x.role}`}>{x.label}</b> {t(x.desc)}</div>)}
            </div>
            <div className="stg-actions" style={{ marginTop: 8 }}>
              <a className="stg-btn stg-btn-secondary" href={manualUrl} target="_blank" rel="noopener noreferrer">📄 {t('Open the manual')}</a>
            </div>
          </div>
        </aside>
      </div>
        )
        if (!big) return stage
        return createPortal(
          <div className="lan-popup-backdrop" onClick={() => setBig(false)}>
            <div className="lan-popup wr-popup" onClick={(e) => e.stopPropagation()}>
              <div className="lan-popup-head">
                <b>{device.manufacturer} {device.name} · {t(scenario.title)}</b>
                <span className="stg-hint">{mode === 'practice' ? t('Practice') : t('Assistant')}{realBox ? ` · ${t('real wall box')}` : ''} · {t('scroll to zoom, drag the background to pan · Esc closes')}</span>
                <button className="lan-popup-close" onClick={() => setBig(false)} title={t('Close (Esc)')}>✕</button>
              </div>
              <div className="wr-popup-tools">{toolbar}</div>
              <div className="wr-popup-body">{stage}</div>
            </div>
          </div>,
          document.body,
        )
      })()}
      {info && <WiringInfo onClose={() => setInfo(false)}/>}
    </SettingsCard>
  )
}
