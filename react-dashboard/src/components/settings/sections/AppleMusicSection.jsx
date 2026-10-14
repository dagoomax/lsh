import { useEffect, useState } from 'react'
import { SettingsCard, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { SpeakerIcon } from '../../Icons'
import { gt, tr } from '../../../i18n'

const api = (url) => fetch(url, { credentials: 'include' }).then((r) => r.json())

// Apple Music: the MusicKit key LSH signs developer tokens with. Music plays
// in the dashboard's Music page (/react/music). Server: src/apple-music.js.
export default function AppleMusicSection({ reload }) {
  const [s, setS] = useState(null)
  const [st, setSt] = useState(null)
  const save = useSettingsSave('/api/settings/apple-music')
  const set = (k) => (v) => setS((p) => ({ ...p, [k]: v }))
  const loadStatus = () => api('/api/apple-music/status').then((j) => j.success && setSt(j.data)).catch(() => {})
  useEffect(() => {
    api('/api/settings/apple-music').then((j) => j.success && setS(j.data)).catch(() => {})
    loadStatus()
    const iv = setInterval(loadStatus, 5000)
    return () => clearInterval(iv)
  }, [])

  if (!s) return <SettingsCard icon={SpeakerIcon} title="Apple Music"><p className="stg-hint">{tr('Loading…')}</p></SettingsCard>

  return (
    <SettingsCard icon={SpeakerIcon} title="Apple Music" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Apple Music in LSH: the Music page (top bar) plays Apple Music in the browser — search, your library and playlists, signed in with the listener’s Apple ID. While a Music page is open, LSH shows it as a device that dashboards and flows can control. Apple has no API to control the Music app or HomePods remotely, so the music plays where the page is open (a wall tablet, a computer).">
      <h4 className="stg-subheading">{tr('MusicKit key')}</h4>
      <ol className="stg-hint" style={{ margin: '4px 0 10px 18px', lineHeight: 1.7 }}>
        <li>{tr('Needs a paid')}{' '}<a href="https://developer.apple.com/programs/" target="_blank" rel="noopener noreferrer">{tr('Apple Developer')}</a> membership.</li>
        <li><a href="https://developer.apple.com/account/resources/identifiers/list/musicId" target="_blank" rel="noopener noreferrer">{tr('Identifiers → Media IDs')}</a>{' '}{tr('→ add one (any name) with')}{' '}<b>MusicKit</b> enabled.</li>
        <li><a href="https://developer.apple.com/account/resources/authkeys/list" target="_blank" rel="noopener noreferrer">{tr('Keys')}</a> → <b>+</b>{' '}{tr('→ enable')}{' '}<b>{tr('Media Services (MusicKit…)')}</b>{tr(', pick that Media ID → download the')}{' '}<code>.p8</code>{' '}{tr('file (only once!). Note the')}{' '}<b>{tr('Key ID')}</b>.</li>
        <li>{tr('Your')}{' '}<b>{tr('Team ID')}</b>{' '}{tr('is under')}{' '}<a href="https://developer.apple.com/account#MembershipDetailsCard" target="_blank" rel="noopener noreferrer">{tr('Membership details')}</a>.</li>
      </ol>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 160 }}><Field label="Team ID" value={s.teamId} onChange={(v) => set('teamId')(v.trim())} placeholder="10 characters" autoComplete="off"/></div>
        <div style={{ flex: 1, minWidth: 160 }}><Field label="Key ID" value={s.keyId} onChange={(v) => set('keyId')(v.trim())} placeholder="10 characters" autoComplete="off"/></div>
        <div style={{ width: 120 }}><Field label="Storefront" value={s.storefront} onChange={set('storefront')} placeholder="pl" hint="country"/></div>
      </div>
      {s.privateKey && s.privateKey.includes('•')
        ? <div className="stg-hint" style={{ margin: '8px 0' }}>{tr('Private key: saved ✓')}{' '}<Button onClick={() => set('privateKey')('')}>{tr('Replace')}</Button></div>
        : <Field label="Private key (.p8)" type="textarea" value={s.privateKey} onChange={set('privateKey')} placeholder={'-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----'}
            hint="open the .p8 file in a text editor and paste all of it — it stays on this LSH server"/>}
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} onClick={() => save.save(s).then(() => { reload?.(); loadStatus(); api('/api/settings/apple-music').then((j) => j.success && setS(j.data)) }).catch(() => {})}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result}/>
      </div>

      <h4 className="stg-subheading">{tr('Status')}</h4>
      {!st?.configured ? <p className="stg-hint">{tr('Not set up.')}</p> : (
        <>
          <p className="stg-hint">
            {st.check?.ok ? <span style={{ color: 'var(--green)' }}>{tr('✓ Apple accepts the developer token (storefront {storefront})', { storefront: st.storefront })}</span>
              : st.check ? <span style={{ color: 'var(--red)' }}>✗ {st.check.error}</span> : tr('Checking…')}
          </p>
          <p className="stg-hint">
            {st.active ? <>{tr('Playing on')}{' '}<b>{st.active.name}</b>: {st.active.track ? `${st.active.track} — ${st.active.artist}` : 'nothing'}{st.active.playing ? ' ▶' : ''}</> : tr('No Music page is open right now.')}
            {' '}<a href="/react/music">{tr('Open the Music page →')}</a>
          </p>
        </>
      )}
    </SettingsCard>
  )
}
