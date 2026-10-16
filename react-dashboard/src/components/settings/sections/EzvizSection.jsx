import { useEffect, useState } from 'react'
import { SettingsCard, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { CameraIcon } from '../../Icons'
import { gt, tr } from '../../../i18n'

const api = (url, body) => fetch(url, { credentials: 'include', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }).then((r) => r.json())
const REGIONS = [['eu', 'Europe'], ['us', 'Americas'], ['sa', 'South America'], ['as', 'Asia'], ['ru', 'Russia']]

// EZVIZ: the account (cloud: device list, motion events, privacy / sleep,
// siren, PTZ, plugs), each camera's verification code (local video), and
// adding the cameras to LSH's camera list. Server: src/ezviz-client.js, src/routes/ezviz.js.
export default function EzvizSection({ reload }) {
  const [s, setS] = useState(null)
  const [codes, setCodes] = useState({})
  const [mfa, setMfa] = useState('')
  const [msg, setMsg] = useState(null)
  const save = useSettingsSave('/api/settings/ezviz')
  const load = () => api('/api/settings/ezviz').then((j) => { if (j.success) { setS(j.data); setCodes(j.data.codes || {}) } }).catch(() => {})
  useEffect(() => { load() }, [])
  const act = async (url, body) => { setMsg(null); const j = await api(url, body); setMsg({ ok: j.success, message: j.message || j.error }); load(); return j }

  if (!s) return <SettingsCard icon={CameraIcon} title="EZVIZ"><p className="stg-hint">{tr('Loading…')}</p></SettingsCard>
  const st = s.status || {}
  const devs = st.devices || []

  return (
    <SettingsCard icon={CameraIcon} title="EZVIZ" badge={{ label: gt('common.optional', 'Optional') }}
      desc="EZVIZ cameras, battery cameras, doorbells, base stations and smart plugs. With your EZVIZ account LSH lists every device and gets motion events with pictures, privacy and sleep mode, motion detection on / off, the siren, lights, pan & tilt and plug power. Live video comes straight from each camera on your network — add its verification code (on the sticker) and the camera to LSH's camera list.">
      <Field label="EZVIZ account" hint="(e-mail or phone, as in the EZVIZ app)" value={s.username} onChange={(v) => setS({ ...s, username: v })} autoComplete="off" />
      <Field label="Password" type="password" value={s.password} onChange={(v) => setS({ ...s, password: v })} autoComplete="off" />
      <Field label="Region" type="select" value={s.region} onChange={(v) => setS({ ...s, region: v })} options={REGIONS.map(([v, l]) => ({ value: v, label: l }))} />
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} onClick={() => save.save({ username: s.username, password: s.password, region: s.region, pollInterval: s.pollInterval }).then(() => { reload?.(); load() }).catch(() => load())}>{tr('Save & sign in')}</Button>
        <ResultBanner result={save.result} />
      </div>

      {st.mfaPending && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}><Field label="Verification code" hint="(EZVIZ sent it to your e-mail / phone)" value={mfa} onChange={(v) => setMfa(v.trim())} placeholder="123456" /></div>
          <Button variant="primary" disabled={!mfa} onClick={() => act('/api/ezviz/verify', { code: mfa })}>{tr('Confirm')}</Button>
        </div>
      )}
      {st.error && !st.mfaPending && <p className="stg-hint" style={{ color: 'var(--red)' }}>{st.error}</p>}

      {devs.length > 0 && (
        <>
          <h4 className="stg-subheading">{tr('Devices')}</h4>
          <div className="lox-media">
            {devs.map((d) => (
              <div key={d.serial} className="lox-media-row">
                <span className="lox-media-ok" style={{ color: d.online ? 'var(--green)' : 'var(--text3)' }}>●</span>
                <div className="lox-media-main">
                  <b>{d.name}</b>
                  <small>{[d.kind, d.model, d.serial, d.localIp].filter(Boolean).join(' · ')}</small>
                </div>
                {d.camera && (
                  <input className="stg-input" style={{ width: 120 }} value={codes[d.serial] || ''} placeholder={tr('code')} aria-label={`${d.name} — ${tr('verification code')}`}
                    onChange={(e) => setCodes({ ...codes, [d.serial]: e.target.value.trim().toUpperCase() })} />
                )}
              </div>
            ))}
          </div>
          <p className="stg-hint">{tr('The verification code is the 6 capital letters on the camera’s sticker (or in the EZVIZ app: device → Settings → Device information). Battery cameras sleep and don’t offer local video.')}</p>
          <div className="stg-actions">
            <Button onClick={() => act('/api/ezviz/codes', { codes })}>{tr('Save codes')}</Button>
            <Button variant="primary" onClick={() => act('/api/ezviz/add-cameras', {})}>{tr('Add cameras to LSH')}</Button>
            <ResultBanner result={msg} />
          </div>
        </>
      )}
    </SettingsCard>
  )
}
