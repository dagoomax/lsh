import { useEffect, useMemo, useState } from 'react'
import { SettingsCard, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { LgAppliianceIcon } from '../../Icons'
import { gt, tr, getLang } from '../../../i18n'

// The countries come from the server (GET /api/settings/lgthinq → countries, src/lgthinq-client.js);
// the token only works with the account's own

const api = (url, body) => fetch(url, { credentials: 'include', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }).then((r) => r.json())

export default function LgThinqSection({ reload }) {
  const [st, setSt] = useState(null)
  const [token, setToken] = useState('')
  const [country, setCountry] = useState('')
  const [msg, setMsg] = useState(null)
  const save = useSettingsSave('/api/settings/lgthinq')
  const load = () => api('/api/settings/lgthinq').then((j) => { if (j.success) { setSt(j.data); setCountry((c) => c || (/^[A-Z]{2}$/.test(j.data.country) && j.data.country !== 'EU' ? j.data.country : '')) } }).catch(() => {})
  useEffect(() => { load() }, [])

  // names in the Settings language when the browser knows them, else the server's English ones
  const names = useMemo(() => {
    let dn = null
    try { dn = new Intl.DisplayNames([getLang() || 'en'], { type: 'region' }) } catch { /* old browser */ }
    return (st?.countries || []).map((c) => ({ value: c.code, label: `${dn?.of(c.code) || c.name} (${c.code})` })).sort((a, b) => a.label.localeCompare(b.label))
  }, [st?.countries])

  const doSave = () => save.save({ token: token || (st?.hasToken ? '••••••••' : ''), country })
    .then(() => { setToken(''); reload?.(); setTimeout(load, 4000) }).catch(() => {})
  const disconnect = async () => { const j = await api('/api/settings/lgthinq/disconnect', {}); setMsg({ ok: j.success, message: j.message || j.error }); load() }

  return (
    <SettingsCard icon={LgAppliianceIcon} title={gt('s.lgthinq_title', 'LG ThinQ')} badge={{ label: gt('common.optional', 'Optional') }}
      desc="Your LG appliances (fridge, air conditioner, washer, dryer, dishwasher, air purifier…) through LG’s official ThinQ Connect API. Each one shows what it reports and lets you change what LG allows — set temperatures, modes, power.">
      <ol className="stg-hint" style={{ margin: '4px 0 10px 18px', lineHeight: 1.7 }}>
        <li>{tr('Open')}{' '}<a href="https://connect-pat.lgthinq.com" target="_blank" rel="noopener noreferrer">connect-pat.lgthinq.com</a>{' '}{tr('and sign in with your LG account.')}</li>
        <li>{tr('Create a token with all permissions ticked and paste it below.')}</li>
      </ol>
      <Field label="Personal Access Token" type="password" value={token} onChange={(v) => setToken(v.trim())} autoComplete="off"
        placeholder={st?.hasToken ? `•••••••• ${tr('(saved — paste a new one to replace it)')}` : 'thinqpat_…'} />
      <Field label="Country" hint="(of your LG account)" type="select" value={country} onChange={setCountry}
        options={[{ value: '', label: '— pick —' }, ...names.map((n) => ({ ...n, raw: true }))]} />
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} disabled={!country || (!token && !st?.hasToken)} onClick={doSave}>{tr('Check & save')}</Button>
        {st?.hasToken && <Button onClick={disconnect}>{tr('Disconnect')}</Button>}
        <ResultBanner result={save.result || msg} />
      </div>
      {st?.devices?.length > 0 && (
        <div className="stg-field">
          <label>{tr('Appliances')}</label>
          <ul className="stg-hint" style={{ margin: '2px 0 0 18px', lineHeight: 1.7 }}>
            {st.devices.map((d) => <li key={d.key}><b>{d.label}</b> · {String(d.type || '').replace(/^DEVICE_/, '').replace(/_/g, ' ').toLowerCase()} · {tr('sensors: {n}', { n: d.sensors })}</li>)}
          </ul>
        </div>
      )}
    </SettingsCard>
  )
}
