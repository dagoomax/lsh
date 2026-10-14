import { useEffect, useState } from 'react'
import { SettingsCard, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { SpeakerIcon } from '../../Icons'
import { gt, tr } from '../../../i18n'

const api = (url, method = 'GET', body) => fetch(url, {
  method, credentials: 'include',
  ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
}).then((r) => r.json())

// TIDAL: app credentials + sign-in (OAuth PKCE). Browsing and search live in the
// dashboard's music hub. Server: src/tidal-client.js, src/routes/tidal.js.
export default function TidalSection({ reload }) {
  const [s, setS] = useState(null)
  const [st, setSt] = useState(null)
  const [pasted, setPasted] = useState('')
  const [msg, setMsg] = useState(null)
  const save = useSettingsSave('/api/settings/tidal')

  const loadSettings = () => api('/api/settings/tidal').then((j) => j.success && setS(j.data)).catch(() => {})
  const loadStatus = () => api('/api/tidal/status').then((j) => j.success && setSt(j.data)).catch(() => {})
  useEffect(() => { loadSettings(); loadStatus() }, [])

  const finish = async () => {
    const j = await api('/api/tidal/oauth/finish', 'POST', { url: pasted })
    setMsg({ ok: j.success, message: j.success ? tr('✓ Connected as') + ' ' + (j.data?.name || '') : j.error })
    if (j.success) { setPasted(''); loadStatus() }
  }
  const disconnect = async () => { await api('/api/tidal/disconnect', 'POST', {}); loadStatus() }

  if (!s) return <SettingsCard icon={SpeakerIcon} title="TIDAL"><p className="stg-hint">{tr('Loading…')}</p></SettingsCard>

  return (
    <SettingsCard icon={SpeakerIcon} title="TIDAL" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Browse and search TIDAL in the dashboard’s music hub — albums, tracks, playlists and artists, plus your own playlists and albums once you sign in. TIDAL doesn’t offer remote control to other apps, so Play opens the item in TIDAL (web player or app).">
      {!st?.connected && (
        <>
          <h4 className="stg-subheading">{tr('1 · TIDAL app')}</h4>
          <ol className="stg-hint" style={{ margin: '4px 0 10px 18px', lineHeight: 1.7 }}>
            <li>{tr('Open')}{' '}<a href="https://developer.tidal.com/dashboard" target="_blank" rel="noopener noreferrer">developer.tidal.com/dashboard</a> → <b>{tr('Create app')}</b>.</li>
            <li>{tr('Add this')}{' '}<b>{tr('Redirect URI')}</b>: <code className="sp-code">{s.redirectUri}</code> <button type="button" className="sp-copy" onClick={() => navigator.clipboard?.writeText(s.redirectUri)}>{tr('Copy')}</button></li>
            <li>{tr('Copy the app’s Client ID and Client Secret here and save.')}</li>
          </ol>
        </>
      )}
      <Field label="Client ID" value={s.clientId} onChange={(v) => setS({ ...s, clientId: v.trim() })} autoComplete="off" />
      <Field label="Client Secret" hint="(lets the hub search TIDAL before anyone signs in)" type="password" value={s.clientSecret} onChange={(v) => setS({ ...s, clientSecret: v })} autoComplete="off" />
      <details className="stg-hint">
        <summary>{tr('Advanced')}</summary>
        <Field label="Country" hint="(2 letters; empty = your account’s country)" value={s.countryCode} onChange={(v) => setS({ ...s, countryCode: v.trim().toUpperCase() })} placeholder="PL" />
        <Field label="Redirect URI (override)" value={s.customRedirect ? s.redirectUri : ''} onChange={(v) => setS({ ...s, redirectUri: v, customRedirect: !!v })} placeholder={s.redirectUri}
          hint="only if LSH is reached through your own https address" />
      </details>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} onClick={() => save.save({ ...s, redirectUri: s.customRedirect ? s.redirectUri : '' }).then(() => { reload?.(); loadSettings(); setTimeout(loadStatus, 800) }).catch(() => {})}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result} />
      </div>

      <h4 className="stg-subheading">{st?.connected ? tr('Account') : tr('2 · Sign in')}</h4>
      {!st?.configured ? <p className="stg-hint">{tr('Save the Client ID first.')}</p> : st.connected ? (
        <div className="sp-account">
          <span>{tr('✓ Connected as')}{' '}<b>{st.user?.name}</b>{st.user?.country ? ` · ${st.user.country}` : ''}</span>
          <Button onClick={disconnect}>{tr('Disconnect')}</Button>
        </div>
      ) : (
        <>
          <Button variant="primary" href="/api/tidal/oauth/start">{tr('Connect with TIDAL')}</Button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 10 }}>
            <div style={{ flex: 1 }}><Field label="…or paste the address you were sent to" value={pasted} onChange={setPasted} placeholder="…/api/tidal/oauth/callback?code=…" /></div>
            <Button onClick={finish} disabled={!pasted}>{tr('Finish')}</Button>
          </div>
        </>
      )}
      <ResultBanner result={msg} />
      {st?.error && <p className="stg-hint" style={{ color: 'var(--red)' }}>{st.error}</p>}
    </SettingsCard>
  )
}
