import { useEffect, useState } from 'react'
import { SettingsCard, ListEditor, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { gt, tr } from '../../../i18n'

const api = (url, method = 'GET', body) => fetch(url, {
  method, credentials: 'include',
  ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
}).then((r) => r.json())

const GW_FIELDS = [
  { key: 'host', label: 'Gateway IP / host', placeholder: '192.168.1.60' },
  { key: 'name', label: 'Name', placeholder: '(optional)' },
]

const ago = (iso) => {
  if (!iso) return '—'
  const m = Math.round((Date.now() - Date.parse(iso)) / 60e3)
  return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}

// Aquilo liquid-level sensors (aquilo.pl) — read from the WiFi gateway on the
// LAN (GET http://<gateway>/state, no account). Server: src/aquilo-client.js.
export default function AquiloSection({ config, reload }) {
  const a = config.aquilo || {}
  const [gateways, setGateways] = useState(a.gateways || [])
  const [pollSeconds, setPoll] = useState(a.pollSeconds || 300)
  const [staleHours, setStale] = useState(a.staleHours || 24)
  const [overflowPct, setOverflow] = useState(a.overflowPct || 90)
  const [exclude, setExclude] = useState(a.exclude || [])
  const [names, setNames] = useState(a.names || {})
  const [status, setStatus] = useState(null)
  const [found, setFound] = useState([]) // tanks seen by Test (not saved yet)
  const save = useSettingsSave('/api/settings/aquilo')
  const test = useSettingsSave('/api/aquilo/test')

  const load = () => api('/api/aquilo/status').then((j) => setStatus(j.data)).catch(() => {})
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [])

  const runTest = async () => {
    const hosts = gateways.map((g) => g.host?.trim()).filter(Boolean)
    if (!hosts.length) { test.setResult({ ok: false, message: 'Add a gateway address first' }); return }
    const seen = []
    for (const host of hosts) {
      const r = await test.save({ host }).catch(() => null)
      if (r?.data?.tanks) seen.push(...r.data.tanks.map((t) => ({ ...t, gateway: host })))
    }
    setFound(seen)
  }

  const doSave = () => save.save({ gateways, pollSeconds, staleHours, overflowPct, exclude, names })
    .then(() => { load(); reload?.() }).catch(() => {})

  // Tanks: live ones from the client, plus ones only seen by Test, plus excluded ones
  const byId = new Map()
  for (const t of found) byId.set(t.id, t)
  for (const t of status?.tanks || []) byId.set(t.id, t)
  for (const id of exclude) if (!byId.has(id)) byId.set(id, { id })
  const tanks = [...byId.values()].sort((x, y) => String(x.name || x.id).localeCompare(String(y.name || y.id)))
  const gwState = new Map((status?.gateways || []).map((g) => [g.host, g]))

  return (
    <SettingsCard title="Aquilo" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Aquilo liquid-level sensors (septic tanks, rainwater tanks, wells). LSH reads the WiFi receiver on your LAN at http://<gateway>/state — no Aquilo account needed. Find the receiver's IP in your router (give it a fixed DHCP lease). Every tank becomes a device with fill %, level, battery, an overflow-risk alarm (HomeKit leak sensor) and a stale-data flag.">
      <h4 className="stg-subheading">{tr('Gateways')}</h4>
      <ListEditor rows={gateways} onChange={setGateways} fields={GW_FIELDS} addLabel="Add gateway"
        renderExtra={(row) => {
          const g = gwState.get(row.host?.trim())
          if (!g) return null
          return <span className="stg-hint" style={{ color: g.ok ? 'var(--green)' : 'var(--red)' }}>
            {g.ok ? `● online · ${(g.tankIds || []).length} tank(s)` : `● ${g.error || 'offline'}`}
          </span>
        }}/>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0 12px' }}>
        <Field label="Poll every" hint="(s)" type="number" value={pollSeconds} onChange={setPoll}/>
        <Field label="Stale after" hint="(h without a reading)" type="number" value={staleHours} onChange={setStale}/>
        <Field label="Overflow risk at" hint="(% full)" type="number" value={overflowPct} onChange={setOverflow}/>
      </div>

      {tanks.length > 0 && <>
        <h4 className="stg-subheading">{tr('Tanks')}</h4>
        <div style={{ overflowX: 'auto' }}>
          <table className="stg-table" style={{ width: '100%', fontSize: 12.5 }}>
            <thead><tr><th>{tr('In LSH')}</th><th>{tr('Name')}</th><th>{tr('Fill')}</th><th>{tr('Level')}</th><th>{tr('Battery')}</th><th>{tr('Last reading')}</th></tr></thead>
            <tbody>
              {tanks.map((t) => {
                const off = exclude.includes(t.id)
                const stale = t.stale ?? (t.lastRead ? Date.now() - Date.parse(t.lastRead) > staleHours * 3600e3 : false)
                return (
                  <tr key={t.id} style={{ opacity: off ? 0.5 : 1 }}>
                    <td><input type="checkbox" className="stg-checkbox" checked={!off}
                      onChange={() => setExclude((e) => (off ? e.filter((x) => x !== t.id) : [...e, t.id]))}/></td>
                    <td>
                      <input className="stg-input" style={{ minWidth: 120 }} value={names[t.id] ?? ''} placeholder={t.name || `Tank ${t.id}`}
                        onChange={(e) => setNames((n) => ({ ...n, [t.id]: e.target.value }))}/>
                      <div className="stg-hint">ID {t.id}</div>
                    </td>
                    <td>{t.fill != null ? <b style={{ color: (t.overflow ?? t.fill >= overflowPct) ? 'var(--red)' : 'inherit' }}>{t.fill}%</b> : '—'}</td>
                    <td>{t.level != null ? `${t.level} cm` : '—'}</td>
                    <td>{t.battery != null ? `${t.battery}%` : '—'}</td>
                    <td style={{ color: stale ? 'var(--orange, #f39c12)' : 'inherit' }}>{ago(t.lastRead)}{stale ? ' ' + tr('· stale') : ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </>}

      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy} onClick={runTest}>{tr('Test gateway')}</Button>
        <Button variant="primary" busy={save.busy} onClick={doSave}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result || test.result}/>
      </div>
    </SettingsCard>
  )
}
