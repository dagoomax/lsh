import { useEffect, useMemo, useRef, useState } from 'react'
import { SettingsCard, Button } from '../primitives'
import { DEVICES } from '../wiring/devices.js'
import { simulate, initialState, check, steps, portName } from '../wiring/sim.js'
import WiringCanvas from '../wiring/WiringCanvas.jsx'

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

  const stepList = useMemo(() => steps(device, scenario), [device, scenario])
  const wires = useMemo(() => (mode === 'assist' ? scenario.wires.slice(0, step + 1) : userWires), [mode, scenario, step, userWires])

  // Reset when the device or diagram changes
  useEffect(() => { setScnId(device.scenarios[0].id) }, [devId])
  useEffect(() => {
    stateRef.current = initialState(device)
    setStep(mode === 'assist' ? scenario.wires.length - 1 : 0); setUserWires([]); setPending(null); setPower(false); setSwitches({}); setSim(null); setTripped(null); setResult(null); setShutterPos(50)
  }, [devId, scnId, mode])

  // Run the circuit
  useEffect(() => {
    if (!power) { setSim(null); stateRef.current = { ...stateRef.current, prevInputs: {} }; return }
    const r = simulate(device, scenario, wires, switches, stateRef.current)
    stateRef.current = r.state
    if (r.short) { setTripped(r.short); setPower(false); setSim(null); return }
    setSim(r)
  }, [power, wires, switches, tick, device, scenario])

  // Blind travel
  const motorDir = sim && Object.values(sim.motors || {})[0]
  useEffect(() => {
    if (!motorDir || motorDir === 'both') return
    const t = setInterval(() => setShutterPos((p) => Math.max(0, Math.min(100, p + (motorDir === 'up' ? 4 : -4)))), 120)
    return () => clearInterval(t)
  }, [motorDir])
  // Limit switches: stop the module at the end of travel
  useEffect(() => {
    const dir = stateRef.current.shutter?.dir
    if (dir && ((dir === 'up' && shutterPos >= 100) || (dir === 'down' && shutterPos <= 0))) {
      stateRef.current = { ...stateRef.current, shutter: { dir: null } }; setTick((t) => t + 1)
    }
  }, [shutterPos])

  const setKey = (id, k, v) => setSwitches((s) => { const a = [...(s[id] || [])]; a[k] = v; return { ...s, [id]: a } })
  const remote = (fn) => { stateRef.current = fn(stateRef.current); setTick((t) => t + 1) }

  const onPort = (p) => {
    if (mode !== 'practice') return
    if (!pending) return setPending(p)
    if (pending === p) return setPending(null)
    const exists = userWires.some(([a, b]) => (a === pending && b === p) || (a === p && b === pending))
    if (!exists) setUserWires((w) => [...w, [pending, p]])
    setPending(null); setResult(null)
  }

  const findings = sim?.findings || []
  const manualUrl = `/api/manuals/${device.manual}/pdf`

  return (
    <SettingsCard title="Wiring emulator"
      desc="Wiring assistant and circuit emulator for Z-Wave in-wall modules, built from the manufacturers' installation manuals. Follow the diagram wire by wire, or wire it yourself and test it: switch the power on, use the wall switch, and see what lights up — or what trips. Practice only: always follow the manual and local regulations, and leave mains work to a qualified electrician.">
      <div className="wr-devices">
        {DEVICES.map((d) => (
          <button key={d.id} className={`wr-dev${d.id === devId ? ' active' : ''}`} style={{ '--g': d.color }} onClick={() => setDevId(d.id)}>
            <span className="wr-dev-icon">{{ relay: '🔌', dimmer: '💡', shutter: '🪟' }[d.kind]}</span>
            <span><b>{d.name}</b><small>{d.manufacturer} {d.model}</small></span>
          </button>
        ))}
      </div>

      <div className="lan-toolbar">
        <div className="lan-filters" style={{ margin: 0 }}>
          {device.scenarios.map((s) => <button key={s.id} className={`lan-filter${s.id === scenario.id ? ' active' : ''}`} onClick={() => setScnId(s.id)}>{s.title}</button>)}
        </div>
        <div className="lan-viewtoggle" style={{ marginLeft: 'auto' }}>
          <button className={mode === 'assist' ? 'active' : ''} onClick={() => setMode('assist')}>📖 Assistant</button>
          <button className={mode === 'practice' ? 'active' : ''} onClick={() => setMode('practice')}>🧪 Practice</button>
        </div>
      </div>

      <div className="wr-stage">
        <div className="wr-canvas">
          <WiringCanvas device={device} scenario={scenario} wires={wires} highlight={mode === 'assist' && !power ? step : null}
            sim={sim} powered={power} switches={switches} interactive={mode === 'practice'} pending={pending}
            onPress={(id, k) => setKey(id, k, true)} onRelease={(id, k) => setKey(id, k, false)} onToggle={(id, k) => setKey(id, k, !(switches[id] || [])[k])}
            onPort={onPort} onWireClick={(i) => { setUserWires((w) => w.filter((_, j) => j !== i)); setResult(null) }}
            shutterPos={device.kind === 'shutter' ? shutterPos : null}/>
          {tripped && (
            <div className="wr-trip" onClick={() => setTripped(null)}>
              <b>⚡ Breaker tripped</b><span>{tripped}</span><small>Fix the wiring, then switch the power on again.</small>
            </div>
          )}
          <div className="wr-controls">
            <button className={`wr-power${power ? ' on' : ''}`} onClick={() => { setTripped(null); setPower(!power) }}>{power ? '⏻ Power on' : '⏻ Power off'}</button>
            {power && sim?.powered && (device.channels || []).map((c) => (
              <button key={c.id} className={`wr-zw${stateRef.current.channels[c.id] ? ' on' : ''}`} onClick={() => remote((s) => ({ ...s, channels: { ...s.channels, [c.id]: !s.channels[c.id] } }))}>
                Z-Wave · {c.label}: {stateRef.current.channels[c.id] ? 'ON' : 'OFF'}
              </button>
            ))}
            {power && sim?.powered && device.kind === 'dimmer' && (
              <label className="wr-level">Level <input type="range" min="1" max="100" value={stateRef.current.level} onChange={(e) => remote((s) => ({ ...s, level: Number(e.target.value) }))}/> {stateRef.current.level}%</label>
            )}
            {power && sim?.powered && device.shutter && ['up', null, 'down'].map((d) => (
              <button key={String(d)} className="wr-zw" onClick={() => remote((s) => ({ ...s, shutter: { dir: d } }))}>Z-Wave {d === 'up' ? '▲' : d === 'down' ? '▼' : '■'}</button>
            ))}
            {power && sim && !sim.powered && <span className="stg-hint">Module has no power.</span>}
            {power && sim?.twoWire && <span className="lan-kind">2-wire mode</span>}
          </div>
        </div>

        <aside className="wr-side">
          {mode === 'assist' ? (
            <div className="wr-panel">
              <div className="ble-dd-title">Step {Math.min(step + 1, stepList.length)} of {stepList.length}</div>
              <ol className="wr-steps">
                {stepList.map((s, i) => (
                  <li key={i} className={i === step ? 'cur' : i < step ? 'done' : ''} onClick={() => setStep(i)}>
                    <span>{s.text}</span>{i === step && s.hint && <small>{s.hint}</small>}
                  </li>
                ))}
              </ol>
              <div className="stg-actions" style={{ marginTop: 6 }}>
                <Button onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>← Back</Button>
                <Button variant="primary" onClick={() => setStep(Math.min(stepList.length - 1, step + 1))} disabled={step >= stepList.length - 1}>Next wire →</Button>
                <Button onClick={() => setStep(0)}>Restart</Button>
              </div>
              <div className="stg-hint" style={{ marginTop: 8 }}>{step >= stepList.length - 1 ? 'All wires in — switch the power on and try the wall switch.' : 'Tip: the highlighted wire is the current step.'}</div>
            </div>
          ) : (
            <div className="wr-panel">
              <div className="ble-dd-title">Your wiring · {userWires.length} wire{userWires.length === 1 ? '' : 's'}</div>
              <div className="stg-hint">{pending ? <>From <b>{portName(device, scenario, pending)}</b> — click where it goes (or the same point to cancel).</> : 'Click a connection point, then another, to run a wire. Click a rail (L / N / PE) to connect to mains. Click a wire to remove it.'}</div>
              <div className="stg-actions" style={{ marginTop: 8 }}>
                <Button variant="primary" onClick={() => setResult(check(device, scenario, userWires))}>✓ Check wiring</Button>
                <Button onClick={() => { setUserWires(scenario.wires.map((w) => [...w])); setResult(null) }}>Show solution</Button>
                <Button onClick={() => { setUserWires([]); setResult(null); setPower(false) }}>Clear</Button>
              </div>
              {result && (result.ok
                ? <div className="stg-banner ok" style={{ marginTop: 8 }}>✓ Matches the manual’s diagram. Switch the power on to test it.</div>
                : (
                  <div className="wr-result">
                    {result.missing.map(([a, b], i) => <div key={`m${i}`} className="wr-f warn">＋ Connect {portName(device, scenario, a)} to {portName(device, scenario, b)}</div>)}
                    {result.extra.map(([a, b], i) => <div key={`e${i}`} className="wr-f danger">✕ {portName(device, scenario, a)} must not be connected to {portName(device, scenario, b)}</div>)}
                  </div>
                ))}
            </div>
          )}

          {findings.length > 0 && (
            <div className="wr-panel">
              <div className="ble-dd-title">Emulator says</div>
              {findings.map((f, i) => <div key={i} className={`wr-f ${f.level}`}>{f.level === 'danger' ? '⚠ ' : f.level === 'warn' ? '△ ' : 'ℹ '}{f.text}</div>)}
            </div>
          )}

          <div className="wr-panel">
            <div className="ble-dd-title">{device.manufacturer} {device.model} — essentials</div>
            {device.specs.map(([k, v]) => <div key={k} className="ble-dd-kv"><span className="stg-hint">{k}</span><span>{v}</span></div>)}
            <ul className="wr-rules">{device.rules.map((r, i) => <li key={i}>{r}</li>)}</ul>
            <div className="wr-terms">
              {device.terminals.map((t) => <div key={t.id}><b className={`role-${t.role}`}>{t.label}</b> {t.desc}</div>)}
            </div>
            <div className="stg-actions" style={{ marginTop: 8 }}>
              <a className="stg-btn stg-btn-secondary" href={manualUrl} target="_blank" rel="noopener noreferrer">📄 Open the manual</a>
            </div>
          </div>
        </aside>
      </div>
    </SettingsCard>
  )
}
