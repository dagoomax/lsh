import { useEffect, useState } from 'react'
import { SettingsCard, Field, Toggle, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { ShieldIcon } from '../../Icons'
import { gt } from '../../../i18n'

const api = (url, method = 'GET', body) => fetch(url, {
  method, credentials: 'include',
  ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
}).then((r) => r.json())

const MODES = [['away', 'Away'], ['stay', 'Stay'], ['night', 'Night']]

// DSC PowerSeries Neo through a TL280 / TL2803G / 3G2080 communicator, ITv2
// protocol. The panel dials in to LSH. Server: src/dsc-client.js.
export default function DscSection({ reload }) {
  const [s, setS] = useState(null)
  const [status, setStatus] = useState(null)
  const [msg, setMsg] = useState(null)
  const save = useSettingsSave('/api/settings/dsc')
  const set = (k) => (v) => setS((p) => ({ ...p, [k]: v }))

  useEffect(() => { api('/api/settings/dsc').then((j) => j.success && setS(j.data)).catch(() => {}) }, [])
  useEffect(() => {
    const load = () => api('/api/dsc/status').then((j) => setStatus(j.data)).catch(() => {})
    load()
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [])

  const genKey = async () => {
    const j = await api('/api/settings/dsc/generate-key', 'POST', {})
    if (j.success) set('type2Key')(j.data.key)
  }
  const command = async (url, body) => {
    setMsg(null)
    const j = await api(url, 'POST', body)
    setMsg({ ok: j.success, message: j.success ? 'Sent' : j.error })
  }

  if (!s) return <SettingsCard icon={ShieldIcon} title="DSC PowerSeries Neo"><p className="stg-hint">Loading…</p></SettingsCard>

  const keyShown = s.type2Key && !s.type2Key.includes('•') ? s.type2Key.toUpperCase() : '(the key saved here)'
  const host = s.hostAddresses?.[0] || '<LSH IP>'
  const panel = status?.panel
  const zones = (status?.zones || []).filter((z) => z.label && !/^(zone|strefa)\s*0*\d+$/i.test(z.label) || z.open || z.alarm || z.tamper || z.bypass)

  return (
    <SettingsCard icon={ShieldIcon} title="DSC PowerSeries Neo" badge={{ label: gt('common.optional', 'Optional') }}
      desc="DSC Neo (HS2016/2032/2064/2128) through a TL280, TL2803G or 3G2080 communicator, using DSC's ITv2 integration protocol. The panel connects to LSH — nothing to poll, changes arrive instantly. Zones show up as contact/motion sensors (HomeKit too), partitions get an Arm switch.">
      <Toggle label="Enable DSC integration" checked={!!s.enabled} onChange={set('enabled')}/>
      <Field label="Name" value={s.name || ''} onChange={set('name')} placeholder="DSC alarm"/>
      <Field label="Listen port" type="number" value={s.port} onChange={set('port')} hint={`hex for [851][429]: ${(Number(s.port) || 3072).toString(16).toUpperCase().padStart(4, '0')}`}/>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <Field label="Type 2 access key" type="password" value={s.type2Key || ''} onChange={set('type2Key')} placeholder="32 hex characters — same as [851][700]" autoComplete="off"/>
        </div>
        <Button onClick={genKey}>Generate</Button>
      </div>
      <Field label="User code (arm / disarm)" type="password" value={s.userCode || ''} onChange={set('userCode')} placeholder="4–8 digits" inputMode="numeric" autoComplete="off"
        hint="a dedicated keypad user code for LSH; leave empty for read-only"/>
      <details className="stg-hint">
        <summary>Type 1 encryption (older communicator firmware)</summary>
        <Field label="Integration ID" value={s.integrationId || ''} onChange={set('integrationId')} placeholder="12 digits from [851][422]" inputMode="numeric"/>
        <Field label="Type 1 access code" type="password" value={s.type1Code || ''} onChange={set('type1Code')} placeholder="8 digits from [851][423]" inputMode="numeric"/>
      </details>
      <Toggle label="Show all zones" checked={!!s.allZones} onChange={set('allZones')} hint="otherwise only named zones (and ones that have been active)"/>

      <h4 className="stg-subheading">Panel programming</h4>
      <p className="stg-hint">At a keypad: <b>[*][8]</b> + installer code, then section <b>[851]</b> (integration group 1):</p>
      <ol className="stg-hint" style={{ margin: '4px 0 12px 18px', lineHeight: 1.7 }}>
        <li><b>[422]</b> Integration ID — read only, note it down</li>
        <li><b>[425]</b> Integration options — turn on <b>3, 4, 5</b> (integration over Ethernet/cellular, notifications, polling)</li>
        <li><b>[426]</b> Notifications — turn on <b>3</b> only</li>
        <li><b>[428]</b> Integration server IP — <b>{host}</b></li>
        <li><b>[429]</b> Integration server port — <b>{s.portHex}</b></li>
        <li><b>[700]</b> Type 2 access code — <b style={{ fontFamily: 'monospace' }}>{keyShown}</b></li>
      </ol>
      <p className="stg-hint">Exit with [#] and save here; the communicator connects within a minute or two.</p>

      <h4 className="stg-subheading">Status</h4>
      {!status ? <p className="stg-hint">Not running (enable, save and restart LSH).</p> : (
        <>
          <p className="stg-hint">
            {panel?.connected
              ? <span style={{ color: 'var(--green)' }}>✓ Connected from {panel.peer} · Integration ID {panel.integrationId} · Type {panel.encryptionType} · firmware {panel.firmware}</span>
              : <span>Listening on port {status.port}, waiting for the panel{panel?.error ? <span style={{ color: 'var(--red)' }}> — last error: {panel.error}</span> : ''}</span>}
          </p>
          {status.partitions.map((p) => (
            <div key={p.number} className="stg-row" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '6px 0' }}>
              <b style={{ minWidth: 120 }}>{p.label || `Partition ${p.number}`}</b>
              <span className="stg-hint">
                {p.alarm ? '🚨 ALARM' : p.armed ? `armed (${p.armMode})` : 'disarmed'}
                {p.exitDelay ? ' · exit delay' : ''}{p.entryDelay ? ' · entry delay' : ''}
                {p.ready ? ' · ready' : p.armed ? '' : ' · not ready'}{p.trouble ? ' · trouble' : ''}
              </span>
              {panel?.connected && (p.armed
                ? <Button onClick={() => command(`/api/dsc/partition/${p.number}/disarm`, {})}>Disarm</Button>
                : MODES.map(([m, l]) => <Button key={m} onClick={() => command(`/api/dsc/partition/${p.number}/arm`, { mode: m })}>Arm {l}</Button>))}
            </div>
          ))}
          {zones.length > 0 && (
            <table className="stg-table" style={{ width: '100%', marginTop: 8 }}>
              <thead><tr><th>#</th><th>Zone</th><th>State</th><th/></tr></thead>
              <tbody>
                {zones.map((z) => (
                  <tr key={z.number}>
                    <td>{z.number}</td>
                    <td>{z.label || `Zone ${z.number}`}</td>
                    <td>{[z.open ? 'open' : 'closed', z.alarm && 'alarm', z.tamper && 'tamper', z.lowBattery && 'low battery', z.bypass && 'bypassed'].filter(Boolean).join(' · ')}</td>
                    <td>{panel?.connected && <Button onClick={() => command(`/api/dsc/zone/${z.number}/bypass`, { bypass: !z.bypass })}>{z.bypass ? 'Unbypass' : 'Bypass'}</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <ResultBanner result={msg}/>
        </>
      )}

      <div className="stg-actions">
        <Button variant="primary" busy={save.busy}
          onClick={() => save.save(s).then(() => { reload?.(); return api('/api/settings/dsc').then((j) => j.success && setS(j.data)) }).catch(() => {})}>
          {gt('common.save', 'Save')}
        </Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}
