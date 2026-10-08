import { useEffect, useMemo, useState } from 'react'
import { SettingsCard, Toggle, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'

// Settings → Controllers & Buses → Modbus emulator — LSH answers Modbus
// TCP/RTU register queries with live LSH values (src/modbus-emulator.js).
// Saving applies the map live. Shares the LAN scan look.

const TABLES = { holding: 'Holding', input: 'Input', coil: 'Coil', discrete: 'Discrete' }
const TYPES = ['u16', 'i16', 'u32', 'i32', 'f32', 'string']
const BAUDS = [2400, 4800, 9600, 19200, 38400, 57600, 115200]
const WIDTH = { u16: 1, i16: 1, bool: 1, u32: 2, i32: 2, f32: 2 }

const get = (url) => fetch(url, { credentials: 'include' }).then((r) => r.json()).catch((e) => ({ success: false, error: e.message }))
const fmt = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? v : Math.round(v * 1000) / 1000) : v === true ? 'on' : v === false ? 'off' : v ?? '—')

const newDevice = (n) => ({ name: `LSH Modbus ${n}`, transport: 'tcp', port: 1502 + n - 1, bindHost: '0.0.0.0', unitId: 1, enabled: true, strict: false, registers: [] })

function nextAddress(regs, table) {
  const used = regs.filter((r) => r.table === table)
  if (!used.length) return 0
  const last = used.reduce((a, r) => (Number(r.address) > Number(a.address) ? r : a))
  return Number(last.address) + (last.type === 'string' ? Number(last.length) || 8 : WIDTH[last.type] || 1)
}

function LiveGrid({ words, active }) {
  const cells = [...words, ...Array(Math.max(0, 40 - words.length)).fill(null)].slice(0, 40)
  return (
    <div className={`mb-grid${active ? ' scanning' : ''}`} aria-hidden="true">
      {cells.map((w, i) => <i key={i} style={{ animationDelay: `${((i * 37) % 40) * 0.09}s` }}>{w == null ? '····' : w.toString(16).padStart(4, '0').toUpperCase()}</i>)}
    </div>
  )
}

export default function ModbusEmuSection() {
  const [cfg, setCfg] = useState(null)
  const [status, setStatus] = useState([])
  const [templates, setTemplates] = useState(null)
  const [needsModule, setNeedsModule] = useState(false)
  const [sources, setSources] = useState([])
  const save = useSettingsSave('/api/settings/modbus-emu')

  useEffect(() => {
    get('/api/settings/modbus-emu').then((j) => j.success && setCfg(j.data))
    get('/api/modbus-emu/templates').then((j) => (j.success ? setTemplates(j.data) : setNeedsModule(!!j.needsModule)))
    get('/api/modbus-emu/sources').then((j) => j.success && setSources(j.data))
    const load = () => get('/api/modbus-emu/status').then((j) => j.success && setStatus(j.data))
    load()
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [])

  const srcMap = useMemo(() => new Map(sources.map((s) => [s.key, s])), [sources])
  if (!cfg) return <SettingsCard title="Modbus emulator"><p className="stg-hint">Loading…</p></SettingsCard>

  const setDev = (i, patch) => setCfg((c) => ({ ...c, devices: c.devices.map((d, j) => (j === i ? { ...d, ...patch } : d)) }))
  const setReg = (i, k, patch) => setDev(i, { registers: cfg.devices[i].registers.map((r, j) => (j === k ? { ...r, ...patch } : r)) })
  const running = status.filter((s) => s.endpoint)
  const totals = status.reduce((a, s) => ({ requests: a.requests + s.stats.requests, clients: a.clients + s.stats.clients, writes: a.writes + s.stats.writes }), { requests: 0, clients: 0, writes: 0 })
  const liveWords = status.flatMap((s) => s.registers.flatMap((r) => r.words))

  return (
    <SettingsCard title="Modbus emulator"
      desc="Makes LSH answer Modbus queries like a real device — a PLC, SCADA, Loxone, an inverter or any Modbus master can read LSH values as registers. Map registers to live LSH readings or constants, over Modbus TCP or as an RTU slave on RS-485. Writes are refused unless a register is marked writable.">
      <div className="lan-hero">
        <LiveGrid words={liveWords} active={running.length > 0 && totals.clients > 0}/>
        <div className="lan-hero-body">
          <div className="lan-hero-title">{running.length ? `${running.length} emulated device${running.length === 1 ? '' : 's'} online` : cfg.enabled ? 'Not running' : 'Emulator off'}</div>
          <div className="lan-hero-sub">{running.map((s) => `${s.name} · ${s.endpoint} · unit ${s.unitId}`).join('  ·  ') || 'Enable, add a device, map registers, save — applied live.'}</div>
          <div className="lan-stats">
            <div className="lan-stat"><b>{running.length}</b><span>devices</span></div>
            <div className="lan-stat ble-blue"><b>{totals.clients}</b><span>clients</span></div>
            <div className="lan-stat green"><b>{totals.requests}</b><span>requests</span></div>
            <div className={`lan-stat ${totals.writes ? 'orange' : ''}`}><b>{totals.writes}</b><span>writes</span></div>
          </div>
        </div>
      </div>

      {needsModule && <div className="stg-banner err" style={{ marginTop: 10 }}>Install the <b>modbus-emulator</b> module in Settings → Integration Modules first.</div>}

      <div style={{ marginTop: 12 }}>
        <Toggle label="Enable Modbus emulator" checked={!!cfg.enabled} onChange={(v) => setCfg({ ...cfg, enabled: v })}/>
      </div>

      {cfg.devices.map((d, i) => {
        const st = status.find((s) => s.id === d.id)
        const live = new Map((st?.registers || []).map((r) => [`${r.table}:${r.address}`, r]))
        return (
          <div key={i} className="lan-tile open emu-dev" style={{ '--g': st?.error ? '#ff453a' : st?.endpoint ? '#30d158' : '#8e8e93' }}>
            <div className="lan-tile-main">
              <div className="lan-tile-icon"><span>{d.transport === 'rtu' ? '🔌' : '🖧'}</span></div>
              <div className="lan-tile-text">
                <input className="emu-name" value={d.name} onChange={(e) => setDev(i, { name: e.target.value })}/>
                <div className="lan-tile-sub">
                  {st?.error ? <span style={{ color: 'var(--red)' }}>✗ {st.error}</span>
                    : st?.endpoint ? `${st.endpoint} · unit ${st.unitId} · ${st.stats.requests} requests${st.stats.lastClient ? ` · last from ${st.stats.lastClient}` : ''}`
                      : 'not running — save to apply'}
                </div>
              </div>
              <label className="emu-inline"><input type="checkbox" checked={d.enabled !== false} onChange={(e) => setDev(i, { enabled: e.target.checked })}/> on</label>
              <button className="emu-x" title="Remove device" onClick={() => setCfg({ ...cfg, devices: cfg.devices.filter((_, j) => j !== i) })}>✕</button>
            </div>

            <div className="mb-form">
              <label className="mid"><span>Transport</span>
                <select className="stg-input" value={d.transport} onChange={(e) => setDev(i, { transport: e.target.value })}><option value="tcp">Modbus TCP</option><option value="rtu">RTU (RS-485)</option></select>
              </label>
              {d.transport === 'tcp' ? (
                <>
                  <label className="narrow"><span>Port</span><input className="stg-input" type="number" value={d.port ?? 1502} onChange={(e) => setDev(i, { port: Number(e.target.value) })}/></label>
                  <label><span>Listen on</span><input className="stg-input" value={d.bindHost ?? '0.0.0.0'} onChange={(e) => setDev(i, { bindHost: e.target.value })}/></label>
                </>
              ) : (
                <>
                  <label><span>Serial port</span><input className="stg-input" value={d.serialPort || ''} placeholder="/dev/ttyUSB0" onChange={(e) => setDev(i, { serialPort: e.target.value })}/></label>
                  <label className="narrow"><span>Baud</span><select className="stg-input" value={d.baud || 9600} onChange={(e) => setDev(i, { baud: Number(e.target.value) })}>{BAUDS.map((b) => <option key={b}>{b}</option>)}</select></label>
                  <label className="narrow"><span>Parity</span><select className="stg-input" value={d.parity || 'none'} onChange={(e) => setDev(i, { parity: e.target.value })}>{['none', 'even', 'odd'].map((p) => <option key={p}>{p}</option>)}</select></label>
                </>
              )}
              <label className="narrow"><span>Unit ID</span><input className="stg-input" type="number" min="1" max="247" value={d.unitId ?? 1} onChange={(e) => setDev(i, { unitId: Number(e.target.value) })}/></label>
              {templates && (
                <label><span>Template</span>
                  <select className="stg-input" value="" onChange={(e) => {
                    const t = templates[e.target.value]
                    if (t) setDev(i, { registers: t.registers.map((r) => ({ ...r })), template: e.target.value })
                  }}>
                    <option value="">Apply template…</option>
                    {Object.entries(templates).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
                  </select>
                </label>
              )}
            </div>
            {d.port && d.port < 1024 && d.transport === 'tcp' && <div className="stg-hint">Ports below 1024 (like the standard 502) need root. Use 1502 and set the client to it, or redirect: <code>sudo iptables -t nat -A PREROUTING -p tcp --dport 502 -j REDIRECT --to-port 1502</code></div>}
            {templates?.[d.template]?.note && <div className="stg-hint">{templates[d.template].note}</div>}

            <div className="emu-regs">
              {d.registers.map((r, k) => {
                const lv = live.get(`${r.table}:${r.address}`)
                const bit = r.table === 'coil' || r.table === 'discrete'
                return (
                  <div key={k} className="emu-reg">
                    <input className="emu-in w-label" placeholder="label" value={r.label || ''} onChange={(e) => setReg(i, k, { label: e.target.value })}/>
                    <select className="emu-in" value={r.table} onChange={(e) => setReg(i, k, { table: e.target.value, ...(e.target.value === 'coil' || e.target.value === 'discrete' ? { type: 'bool' } : r.type === 'bool' ? { type: 'u16' } : {}) })}>{Object.entries(TABLES).map(([t, l]) => <option key={t} value={t}>{l}</option>)}</select>
                    <input className="emu-in w-num" type="number" min="0" max="65535" title="Address" value={r.address} onChange={(e) => setReg(i, k, { address: Number(e.target.value) })}/>
                    {!bit && (
                      <span className="emu-type">
                        <select className="emu-in" value={r.type} onChange={(e) => setReg(i, k, { type: e.target.value })}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
                        {WIDTH[r.type] === 2 && <select className="emu-in" title="Word order" value={r.wordOrder || 'be'} onChange={(e) => setReg(i, k, { wordOrder: e.target.value })}><option value="be">AB CD</option><option value="le">CD AB</option></select>}
                        {r.type === 'string' && <input className="emu-in w-num" type="number" min="1" max="64" title="Length (registers)" value={r.length || 8} onChange={(e) => setReg(i, k, { length: Number(e.target.value) })}/>}
                        <span className="emu-x-label">×</span>
                        <input className="emu-in w-num" type="number" step="any" title="Scale: raw = value × scale" value={r.scale ?? 1} onChange={(e) => setReg(i, k, { scale: Number(e.target.value) })}/>
                      </span>
                    )}
                    <span className="emu-src">
                      <input className="emu-in w-src" list={`emu-src-${i}`} placeholder="LSH value (store key)" value={r.source || ''} onChange={(e) => setReg(i, k, { source: e.target.value })}/>
                      {!r.source && <input className="emu-in w-num" placeholder="const" value={r.value ?? ''} onChange={(e) => setReg(i, k, { value: e.target.value })}/>}
                    </span>
                    {r.table !== 'input' && r.table !== 'discrete' && (
                      <label className="emu-inline" title="Allow Modbus masters to write this register">
                        <input type="checkbox" checked={!!r.writable} onChange={(e) => setReg(i, k, { writable: e.target.checked })}/> writable
                      </label>
                    )}
                    {r.writable && <input className="emu-in w-src" list={`emu-cmd-${i}`} placeholder="→ LSH device/sensor (optional)" value={r.command || ''} onChange={(e) => setReg(i, k, { command: e.target.value })}/>}
                    <span className="emu-live">{lv ? <><b>{fmt(lv.value)}</b><span>{lv.words.map((w) => w.toString(16).padStart(4, '0')).join(' ')}</span></> : <span className="stg-hint">—</span>}</span>
                    <button className="emu-x" title="Remove register" onClick={() => setDev(i, { registers: d.registers.filter((_, j) => j !== k) })}>✕</button>
                    {r.source && srcMap.get(r.source) && <div className="emu-src-hint">{srcMap.get(r.source).label}</div>}
                  </div>
                )
              })}
            </div>
            <datalist id={`emu-src-${i}`}>{sources.map((s) => <option key={s.key} value={s.key}>{`${s.label} = ${fmt(s.value)}${s.unit ? ` ${s.unit}` : ''}`}</option>)}</datalist>
            <datalist id={`emu-cmd-${i}`}>{sources.filter((s) => s.controllable).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</datalist>
            <div className="stg-actions" style={{ marginTop: 6 }}>
              <Button onClick={() => setDev(i, { registers: [...d.registers, { table: 'holding', address: nextAddress(d.registers, 'holding'), type: 'u16', label: '', source: '', scale: 1 }] })}>+ Register</Button>
              <label className="emu-inline"><input type="checkbox" checked={!!d.strict} onChange={(e) => setDev(i, { strict: e.target.checked })}/> strict (unmapped registers → exception 2, otherwise read as 0)</label>
            </div>
          </div>
        )
      })}

      <div className="stg-actions">
        <Button onClick={() => setCfg({ ...cfg, devices: [...cfg.devices, newDevice(cfg.devices.length + 1)] })}>+ Emulated device</Button>
        <Button variant="primary" busy={save.busy} onClick={() => save.save(cfg).then(() => get('/api/settings/modbus-emu').then((j) => j.success && setCfg(j.data))).catch(() => {})}>Save &amp; apply</Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}
