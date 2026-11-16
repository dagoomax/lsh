import { useState, useEffect, useCallback } from 'react'
import { SettingsCard, Field, Toggle, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { SpeakerIcon } from '../../Icons'
import { gt, tr } from '../../../i18n'

// Settings → Media → Music Assistant. Connects LSH to a Music Assistant
// server: every player becomes a media device (play/pause, skip, volume, now
// playing). Shows the live connection and the discovered players, and saves
// config.musicAssistant via /api/settings/music-assistant (restart to apply).
export default function MusicAssistantSection({ config, reload }) {
  const ma = config.musicAssistant
  const [url, setUrl] = useState(ma?.url || '')
  const [token, setToken] = useState(ma?.token || '')
  const [playersText, setPlayersText] = useState((ma?.players || []).join('\n'))
  const [includeHidden, setIncludeHidden] = useState(!!ma?.includeHidden)
  const [status, setStatus] = useState(null)
  const [players, setPlayers] = useState([])
  const test = useSettingsSave('/api/settings/test-music-assistant')
  const save = useSettingsSave('/api/settings/music-assistant')

  const refresh = useCallback(() => {
    fetch('/api/music-assistant/status', { credentials: 'include' }).then((r) => r.json()).then((j) => setStatus(j.data || null)).catch(() => {})
    fetch('/api/music-assistant/players', { credentials: 'include' }).then((r) => r.json()).then((j) => setPlayers(j.data || [])).catch(() => {})
  }, [])
  useEffect(() => { refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t) }, [refresh])

  const connected = status?.connected
  const configured = !!ma?.url
  const stateLabel = { playing: tr('playing'), paused: tr('paused') }

  return (
    <SettingsCard icon={SpeakerIcon} title="Music Assistant" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Connects to a Music Assistant server and adds every player as a media device: play, pause, skip, volume and what is playing. The server requires a long-lived access token — create one in Music Assistant under Settings → Users → Long-lived access tokens.">

      {configured && (
        <div className={`stg-banner ${connected ? 'ok' : 'err'}`} style={{ marginBottom: 10 }}>
          {connected
            ? tr('Connected to {server} {version} · {n} player(s)', { server: status.server || 'Music Assistant', version: status.version || '', n: status.players })
            : (status?.error ? `✗ ${status.error}` : tr('Not connected — save the address and token, then restart LSH'))}
        </div>
      )}

      <Field label="Server address" value={url} onChange={setUrl} placeholder="http://localhost:8095"/>
      <Field label="Long-lived access token" type="password" value={token} onChange={setToken}/>
      <Field label="Only these players" hint="(optional, one name or id per line — leave empty for all)" type="textarea" value={playersText} onChange={setPlayersText}/>
      <Toggle label="Also add players hidden in Music Assistant" checked={includeHidden} onChange={setIncludeHidden}/>

      <div className="stg-actions">
        <Button variant="primary" busy={save.busy}
          onClick={() => save.save({ url, token, players: playersText.split('\n').map((s) => s.trim()).filter(Boolean), includeHidden }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <Button variant="secondary" busy={test.busy} onClick={() => test.save({ url, token })}>{tr('Test connection')}</Button>
        <ResultBanner result={save.result || test.result}/>
      </div>

      {connected && players.length > 0 && (
        <div className="stg-ma-players">
          <div className="stg-hint" style={{ margin: '6px 0 4px' }}>{tr('Players')}</div>
          {players.map((p) => (
            <div key={p.id} className="stg-ma-player">
              <span className={`stg-ma-dot${p.available ? '' : ' off'}${p.state === 'playing' ? ' live' : ''}`}/>
              <span className="stg-ma-name">{p.name}</span>
              {p.title && <span className="stg-ma-now">{stateLabel[p.state] || ''} {p.artist ? `${p.artist} — ${p.title}` : p.title}</span>}
              {p.volume != null && <span className="stg-ma-vol">{p.muted ? tr('muted') : `${p.volume}%`}</span>}
            </div>
          ))}
        </div>
      )}
    </SettingsCard>
  )
}
