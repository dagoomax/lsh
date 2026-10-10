import { useEffect, useRef, useState } from 'react'
import { SettingsCard, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { SpeakerIcon } from '../../Icons'
import { gt } from '../../../i18n'

const api = (url, method = 'GET', body) => fetch(url, {
  method, credentials: 'include',
  ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
}).then((r) => r.json())

const fmt = (ms) => (ms == null ? '' : `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`)
const DEVICE_ICON = { Computer: '💻', Smartphone: '📱', Speaker: '🔊', TV: '📺', CastAudio: '📡', CastVideo: '📡', AVR: '🎛️', Tablet: '📱', Automobile: '🚗', GameConsole: '🎮' }

// Spotify: Client ID + sign-in (OAuth PKCE), then a small player — what's
// playing, controls, volume, device, playlists and search. Server:
// src/spotify-client.js, src/routes/spotify.js.
export default function SpotifySection({ reload }) {
  const [s, setS] = useState(null)
  const [st, setSt] = useState(null)
  const [devices, setDevices] = useState([])
  const [lists, setLists] = useState([])
  const [q, setQ] = useState('')
  const [found, setFound] = useState([])
  const [pasted, setPasted] = useState('')
  const [msg, setMsg] = useState(null)
  const [vol, setVol] = useState(null)
  const save = useSettingsSave('/api/settings/spotify')
  const volTimer = useRef(null)

  const loadSettings = () => api('/api/settings/spotify').then((j) => j.success && setS(j.data)).catch(() => {})
  const loadStatus = () => api('/api/spotify/status').then((j) => j.success && setSt(j.data)).catch(() => {})
  const loadLists = () => {
    api('/api/spotify/devices').then((j) => j.success && setDevices(j.data)).catch(() => {})
    api('/api/spotify/playlists').then((j) => j.success && setLists(j.data)).catch(() => {})
  }
  useEffect(() => { loadSettings(); loadStatus(); const iv = setInterval(loadStatus, 3000); return () => clearInterval(iv) }, [])
  useEffect(() => { if (st?.connected) loadLists() }, [st?.connected])

  const act = async (fn) => {
    setMsg(null)
    const j = await fn()
    if (!j.success) setMsg({ ok: false, message: j.error })
    setTimeout(loadStatus, 500)
    return j
  }
  const cmd = (path, value) => act(() => api(`/api/device/${encodeURIComponent('spotify/player')}/command`, 'POST', { sensor: path, value }))
  const play = (uri) => act(() => api('/api/spotify/play', 'POST', { uri }))
  const transfer = (deviceId) => act(async () => { const j = await api('/api/spotify/transfer', 'POST', { deviceId }); setTimeout(loadLists, 800); return j })
  const search = async (e) => {
    e?.preventDefault()
    if (!q.trim()) return setFound([])
    const j = await api(`/api/spotify/search?q=${encodeURIComponent(q.trim())}`)
    if (j.success) setFound(j.data); else setMsg({ ok: false, message: j.error })
  }
  const finish = async () => {
    const j = await api('/api/spotify/oauth/finish', 'POST', { url: pasted })
    setMsg({ ok: j.success, message: j.success ? `Connected as ${j.data?.name}` : j.error })
    if (j.success) { setPasted(''); loadStatus() }
  }
  const disconnect = async () => { await api('/api/spotify/disconnect', 'POST', {}); loadStatus() }
  const setVolume = (v) => {
    setVol(v)
    clearTimeout(volTimer.current)
    volTimer.current = setTimeout(() => { cmd('volume', v).then(() => setVol(null)) }, 300)
  }

  if (!s) return <SettingsCard icon={SpeakerIcon} title="Spotify"><p className="stg-hint">Loading…</p></SettingsCard>
  const p = st?.player, item = p?.item

  return (
    <SettingsCard icon={SpeakerIcon} title="Spotify" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Control Spotify from LSH — play / pause, skip, volume, shuffle, choose the speaker or phone it plays on, start playlists. The player also shows up as an LSH device, so dashboards, flows and Loxone can use it. Controlling playback needs Spotify Premium.">

      {!st?.connected && (
        <>
          <h4 className="stg-subheading">1 · Spotify app</h4>
          <ol className="stg-hint" style={{ margin: '4px 0 10px 18px', lineHeight: 1.7 }}>
            <li>Open <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener noreferrer">developer.spotify.com/dashboard</a> → <b>Create app</b> (any name; API: <b>Web API</b>).</li>
            <li>Add this <b>Redirect URI</b>: <code className="sp-code">{s.redirectUri}</code> <button type="button" className="sp-copy" onClick={() => navigator.clipboard?.writeText(s.redirectUri)}>Copy</button></li>
            <li>Copy the app’s <b>Client ID</b> here and save.</li>
          </ol>
          {/^http:\/\/127\.0\.0\.1/.test(s.redirectUri) && !/^(127\.0\.0\.1|\[::1\])/.test(window.location.hostname) && (
            <p className="stg-hint">Spotify only redirects to https or to 127.0.0.1. After you approve, your browser lands on a 127.0.0.1 page that may not load — that’s fine: copy that address from the address bar and paste it below.</p>
          )}
        </>
      )}
      <Field label="Client ID" value={s.clientId} onChange={(v) => setS({ ...s, clientId: v.trim() })} placeholder="32 hex characters" autoComplete="off"/>
      <details className="stg-hint">
        <summary>Advanced</summary>
        <Field label="Redirect URI (override)" value={s.customRedirect ? s.redirectUri : ''} onChange={(v) => setS({ ...s, redirectUri: v, customRedirect: !!v })} placeholder={s.redirectUri}
          hint="only if LSH is reached through your own https address"/>
        <Field label="Default device" value={s.defaultDevice} onChange={(v) => setS({ ...s, defaultDevice: v })} placeholder="e.g. Kitchen speaker" hint="used for Play when nothing is active"/>
      </details>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} onClick={() => save.save({ ...s, redirectUri: s.customRedirect ? s.redirectUri : '' }).then(() => { reload?.(); loadSettings(); setTimeout(loadStatus, 800) }).catch(() => {})}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result}/>
      </div>

      <h4 className="stg-subheading">{st?.connected ? 'Account' : '2 · Sign in'}</h4>
      {!st?.configured ? <p className="stg-hint">Save the Client ID first.</p> : st.connected ? (
        <div className="sp-account">
          <span>✓ Connected as <b>{st.user?.name}</b>{st.user?.product ? ` · ${st.user.product}` : ''}</span>
          {st.user?.product && st.user.product !== 'premium' && <span className="stg-hint" style={{ color: 'var(--orange)' }}>Without Premium, Spotify allows reading what plays but not controlling it.</span>}
          <Button onClick={disconnect}>Disconnect</Button>
        </div>
      ) : (
        <>
          <Button variant="primary" href="/api/spotify/oauth/start">🎵 Connect with Spotify</Button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 10 }}>
            <div style={{ flex: 1 }}><Field label="…or paste the address you were sent to" value={pasted} onChange={setPasted} placeholder="http://127.0.0.1:…/api/spotify/oauth/callback?code=…"/></div>
            <Button onClick={finish} disabled={!pasted}>Finish</Button>
          </div>
        </>
      )}
      {st?.error && st.connected && <p className="stg-hint" style={{ color: 'var(--red)' }}>{st.error}</p>}

      {st?.connected && (
        <>
          <h4 className="stg-subheading">Now playing</h4>
          <div className={`sp-player${p?.playing ? ' playing' : ''}`}>
            <div className="sp-art"><span>🎵</span>{item?.image && <img key={item.image} src={item.image} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }}/>}</div>
            <div className="sp-meta">
              <b>{item?.name || 'Nothing playing'}</b>
              <span>{item?.artist}{item?.album ? ` — ${item.album}` : ''}</span>
              {item && <span className="stg-hint">{fmt(p.progressMs)} / {fmt(item.durationMs)}{p.device ? ` · ${DEVICE_ICON[p.device.type] || '🔈'} ${p.device.name}` : ''}</span>}
              <div className="sp-ctrl">
                <button title="Shuffle" className={p?.shuffle ? 'on' : ''} onClick={() => cmd('shuffle', !p?.shuffle)}>🔀</button>
                <button title="Previous" onClick={() => cmd('prev', true)}>⏮</button>
                <button title={p?.playing ? 'Pause' : 'Play'} className="main" onClick={() => cmd('playing', !p?.playing)}>{p?.playing ? '⏸' : '▶'}</button>
                <button title="Next" onClick={() => cmd('next', true)}>⏭</button>
              </div>
              {p?.device && (
                <label className="sp-vol">🔈 <input type="range" min="0" max="100" value={vol ?? p.device.volume ?? 0} onChange={(e) => setVolume(Number(e.target.value))}/> {vol ?? p.device.volume ?? '—'}%</label>
              )}
            </div>
          </div>
          <ResultBanner result={msg}/>

          <div className="sp-row">
            <span className="stg-hint">Play on</span>
            {devices.length === 0 && <span className="stg-hint">No devices — open Spotify on a phone, computer or speaker.</span>}
            {devices.map((d) => (
              <button key={d.id} className={`sp-chip${d.active ? ' on' : ''}`} disabled={d.restricted} onClick={() => transfer(d.id)}>{DEVICE_ICON[d.type] || '🔈'} {d.name}</button>
            ))}
            <button className="sp-chip" onClick={loadLists} title="Refresh">↻</button>
          </div>

          <form className="sp-row" onSubmit={search}>
            <input className="stg-input" style={{ flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search songs, playlists, albums, artists"/>
            <Button type="submit">Search</Button>
          </form>
          {found.length > 0 && <div className="sp-grid">{found.map((x) => <Tile key={x.uri + x.kind} x={x} onPlay={play}/>)}</div>}

          {lists.length > 0 && (
            <>
              <h4 className="stg-subheading">Your playlists</h4>
              <div className="sp-grid">{lists.map((x) => <Tile key={x.uri} x={{ ...x, kind: 'playlist', sub: x.tracks != null ? `${x.tracks} tracks` : x.owner }} onPlay={play}/>)}</div>
            </>
          )}
          <p className="stg-hint">In flows and Loxone: device <code>spotify/player</code> — <code>playing</code>, <code>next</code>, <code>prev</code>, <code>volume</code>, <code>shuffle</code>; start a playlist with <code>POST /api/spotify/play {'{'} "uri": "spotify:playlist:…" {'}'}</code>.</p>
        </>
      )}
    </SettingsCard>
  )
}

function Tile({ x, onPlay }) {
  return (
    <button className="sp-tile" onClick={() => onPlay(x.uri)} title={`Play ${x.name}`}>
      <div className="sp-tile-art"><span>{x.kind === 'artist' ? '🎤' : x.kind === 'playlist' ? '📃' : '🎵'}</span>{x.image && <img src={x.image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }}/>}<i>▶</i></div>
      <b>{x.name}</b>
      <span>{x.kind !== 'playlist' ? `${x.kind}${x.sub ? ' · ' : ''}` : ''}{x.sub}</span>
    </button>
  )
}
