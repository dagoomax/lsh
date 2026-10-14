import { useEffect, useState } from 'react'
import { SettingsCard, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { MonitorIcon } from '../../Icons'
import { gt, tr } from '../../../i18n'

const api = (url, body) => fetch(url, { credentials: 'include', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }).then((r) => r.json())

// LG webOS TVs: the list (address, name, MAC for switching on), discovery,
// pairing state. Server: src/lgwebos-client.js, src/routes/lgwebos.js.
export default function LgWebosSection({ reload }) {
  const [tvs, setTvs] = useState(null)
  const [found, setFound] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const save = useSettingsSave('/api/settings/lgwebos')
  const load = () => api('/api/settings/lgwebos').then((j) => j.success && setTvs(j.data)).catch(() => setTvs([]))
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t) }, [])

  const edit = (i, patch) => setTvs(tvs.map((t, k) => (k === i ? { ...t, ...patch } : t)))
  const add = (t = { host: '', name: '', mac: '' }) => { if (!tvs.some((x) => x.host && x.host === t.host)) setTvs([...tvs, t]) }
  const doSave = () => save.save({ tvs: tvs.map(({ host, name, mac }) => ({ host, name, mac })) }).then(() => { reload?.(); setTimeout(load, 1500) }).catch(() => {})
  const discover = async () => { setBusy(true); setFound(null); const j = await api('/api/lgwebos/discover', {}).catch(() => ({})); setFound(j.data || []); setBusy(false) }
  const repair = async (host) => { const j = await api('/api/lgwebos/pair', { host }); setMsg({ ok: j.success, message: j.message || j.error }) }

  if (!tvs) return <SettingsCard icon={MonitorIcon} title="LG webOS TVs"><p className="stg-hint">{tr('Loading…')}</p></SettingsCard>
  const statusText = (s) => ({ connected: tr('Connected'), 'accept on the TV': tr('Allow LSH on the TV screen'), off: tr('Off or unreachable'), connecting: tr('Connecting…'), 'pairing refused on the TV': tr('Refused on the TV') })[s] || s

  return (
    <SettingsCard icon={MonitorIcon} title="LG webOS TVs" badge={{ label: gt('common.optional', 'Optional') }}
      desc="LG TVs with webOS, controlled on your network: power, volume, mute, apps, inputs, channels, playback, the remote's arrows / OK / back / home, and messages on the screen. Each TV is an LSH device for the dashboard, flows and Loxone.">
      <ol className="stg-hint" style={{ margin: '4px 0 10px 18px', lineHeight: 1.7 }}>
        <li>{tr('On the TV turn on')}{' '}<b>{tr('Turn on via Wi-Fi')}</b>{' '}{tr('(or LG Connect Apps / Mobile TV On) so LSH can switch it on.')}</li>
        <li>{tr('Add the TV and save — the TV asks once to allow LSH; accept with the remote.')}</li>
      </ol>
      {tvs.map((t, i) => (
        <div key={i} className="stg-subfields" style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 8 }}>
            <Field label="Address" value={t.host} onChange={(v) => edit(i, { host: v.trim() })} placeholder="192.168.1.50" />
            <Field label="Name" value={t.name} onChange={(v) => edit(i, { name: v })} placeholder="Salon TV" />
          </div>
          <Field label="MAC address" hint="(for switching on; LSH learns it once paired)" value={t.mac || t.live?.mac || ''} onChange={(v) => edit(i, { mac: v.trim() })} placeholder="a8:23:fe:12:34:56" />
          <div className="stg-actions" style={{ alignItems: 'center' }}>
            {t.live && <span className="stg-hint" style={{ color: t.live.status === 'connected' ? 'var(--green)' : t.live.status === 'accept on the TV' ? 'var(--orange)' : 'var(--text2)' }}>● {statusText(t.live.status)}{t.live.paired ? ` · ${tr('paired')}` : ''}{t.live.apps ? ` · ${tr('apps')}: ${t.live.apps}` : ''}</span>}
            {t.live && <Button onClick={() => repair(t.host)}>{tr('Pair again')}</Button>}
            <Button onClick={() => setTvs(tvs.filter((_, k) => k !== i))}>{tr('Remove')}</Button>
          </div>
        </div>
      ))}
      <div className="stg-actions">
        <Button onClick={() => add()}>{tr('+ Add a TV')}</Button>
        <Button busy={busy} onClick={discover}>{tr('Find TVs')}</Button>
      </div>
      {found && (found.length
        ? <div className="sp-row">{found.map((f) => <button key={f.host} type="button" className="sp-chip" onClick={() => add({ host: f.host, name: '', mac: '' })}>+ 📺 {f.host}</button>)}</div>
        : <p className="stg-hint">{tr('No LG TV answered — is it on, and on the same network? You can type its address instead.')}</p>)}
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} onClick={doSave}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result || msg} />
      </div>
    </SettingsCard>
  )
}
