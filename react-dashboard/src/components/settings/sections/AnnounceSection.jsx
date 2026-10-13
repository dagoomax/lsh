import { useEffect, useMemo, useRef, useState } from 'react'
import { SettingsCard, Field, Toggle, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { SpeakerIcon } from '../../Icons'
import { gt } from '../../../i18n'

const api = (url, method = 'GET', body) => fetch(url, {
  method, credentials: 'include',
  ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
}).then((r) => r.json())

const LANGS = [['pl', 'Polski'], ['en', 'English'], ['de', 'Deutsch'], ['fr', 'Français'], ['es', 'Español'], ['it', 'Italiano'], ['uk', 'Українська'], ['cs', 'Čeština'], ['nl', 'Nederlands']]
const ENGINES = [['auto', 'Automatic'], ['say', 'macOS voice (offline)'], ['espeak', 'eSpeak NG (offline)'], ['google', 'Google voice (online)'], ['url', 'My own TTS server']]
const WHEN = [['on', 'turns on'], ['change', 'changes'], ['equals', 'becomes']]

function Speakers({ all, value = [], onChange, hint }) {
  return (
    <div className="an-chips">
      {all.map((s) => {
        const on = value.includes(s.id)
        return <button type="button" key={s.id} className={`an-chip${on ? ' on' : ''}`} onClick={() => onChange(on ? value.filter((x) => x !== s.id) : [...value, s.id])}>🔊 {s.name}</button>
      })}
      {hint && !value.length && <span className="stg-hint">{hint}</span>}
    </div>
  )
}

// Spoken announcements on AirPlay speakers (HomePod…), triggered from Loxone,
// rules on LSH values, flows or here. Server: src/announcer.js.
export default function AnnounceSection({ reload }) {
  const [s, setS] = useState(null)
  const [st, setSt] = useState(null)
  const [speakers, setSpeakers] = useState([])
  const [devices, setDevices] = useState([])
  const [tokens, setTokens] = useState([])
  const [tokenId, setTokenId] = useState('')
  const [text, setText] = useState('')
  const [to, setTo] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const audio = useRef(null)
  const save = useSettingsSave('/api/settings/announce')
  const set = (k) => (v) => setS((p) => ({ ...p, [k]: v }))
  const setItem = (list, i, k) => (v) => setS((p) => ({ ...p, [list]: p[list].map((x, j) => (j === i ? { ...x, [k]: v } : x)) }))

  const loadStatus = () => api('/api/announce/status').then((j) => j.success && setSt(j.data)).catch(() => {})
  useEffect(() => {
    api('/api/settings/announce').then((j) => j.success && setS(j.data)).catch(() => {})
    api('/api/airplay/speakers').then((j) => j.success && setSpeakers(j.data)).catch(() => {})
    api('/api/devices').then((j) => j.success && setDevices((j.data || []).filter(Boolean).filter((d) => d.key !== 'announce/lsh'))).catch(() => {})
    api('/api/auth/tokens').then((j) => { const t = j.data || []; setTokens(t); if (t.length) setTokenId(t[0].id) }).catch(() => {})
    loadStatus()
    const iv = setInterval(loadStatus, 4000)
    return () => clearInterval(iv)
  }, [])
  const devOptions = useMemo(() => [...devices].sort((a, b) => (a.type === 'loxone' ? -1 : 0) - (b.type === 'loxone' ? -1 : 0) || String(a.label).localeCompare(String(b.label))), [devices])

  if (!s) return <SettingsCard icon={SpeakerIcon} title="Announcements"><p className="stg-hint">Loading…</p></SettingsCard>

  const preview = () => {
    if (!text.trim()) return
    if (audio.current) audio.current.pause()
    audio.current = new Audio(`/api/announce/preview?text=${encodeURIComponent(text.trim())}&chime=${s.chime ? 1 : 0}`)
    audio.current.play().catch((err) => setMsg({ ok: false, message: err.message }))
  }
  const announce = async () => {
    setBusy(true); setMsg(null)
    try {
      const j = await api('/api/announce', 'POST', { text, speakers: to })
      const res = j.data?.results || {}
      setMsg({ ok: j.success, message: j.success ? `${j.data.status}${Object.entries(res).filter(([, r]) => r !== 'ok').map(([id, r]) => ` · ${id}: ${r}`).join('')}` : j.error })
    } finally { setBusy(false); loadStatus() }
  }
  const host = window.location.host
  const xmlUrl = `/api/loxone/outputs.xml?type=announce&host=${encodeURIComponent(host)}&tokenId=${encodeURIComponent(tokenId)}`
  const running = !!st?.enabled

  return (
    <SettingsCard icon={SpeakerIcon} title="Announcements" badge={{ label: gt('common.optional', 'Optional') }}
      desc="LSH speaks on your AirPlay speakers — HomePod, Apple TV, AirPlay 2 speakers: a short chime, then the message. Loxone triggers announcements through a Virtual Output, LSH rules speak when a value changes (a Loxone alarm, a door, a sensor), and flows can use them too.">
      <Toggle label="Enable announcements" checked={s.enabled} onChange={set('enabled')}/>
      {speakers.length === 0 && <p className="stg-hint" style={{ color: 'var(--orange)' }}>No AirPlay speakers yet — add them in Settings → Media → AirPlay Speakers (Scan network).</p>}
      <div className="stg-hint" style={{ margin: '8px 0 4px' }}>Speak on</div>
      <Speakers all={speakers} value={s.speakers} onChange={set('speakers')} hint="none chosen = the first speaker"/>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="an-field">Volume <input type="range" min="0" max="100" value={s.volume} onChange={(e) => set('volume')(Number(e.target.value))}/> {s.volume}%</label>
        <Toggle label="Chime first" checked={s.chime} onChange={set('chime')}/>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 150 }}><Field label="Language" type="select" value={s.lang} onChange={set('lang')} options={LANGS.map(([v, l]) => ({ value: v, label: l }))}/></div>
        <div style={{ minWidth: 210 }}><Field label="Voice engine" type="select" value={s.engine} onChange={set('engine')}
          options={ENGINES.map(([v, l]) => ({ value: v, label: `${l}${st?.engines && v !== 'auto' && st.engines[v] === false ? ' — not available here' : ''}` }))}/></div>
        {(s.engine === 'say' || (s.engine === 'auto' && st?.engine === 'say')) && st?.voices?.length > 0 && (
          <div style={{ minWidth: 150 }}><Field label="Voice" type="select" value={s.voice} onChange={set('voice')} options={[{ value: '', label: 'Default' }, ...st.voices.map((v) => ({ value: v, label: v }))]}/></div>
        )}
      </div>
      {s.engine === 'url' && <Field label="TTS URL template" value={s.urlTemplate} onChange={set('urlTemplate')} placeholder="http://piper.local:5000/api/tts?lang={lang}&text={text}" hint="must return audio; {text} and {lang} are filled in"/>}
      {s.engine === 'google' && <p className="stg-hint">The text is sent to Google to be spoken.</p>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <span className="stg-hint" style={{ paddingBottom: 10 }}>Quiet hours</span>
        <div style={{ width: 110 }}><Field label="from" value={s.quietHours?.from || ''} onChange={(v) => set('quietHours')({ ...s.quietHours, from: v })} placeholder="22:00"/></div>
        <div style={{ width: 110 }}><Field label="to" value={s.quietHours?.to || ''} onChange={(v) => set('quietHours')({ ...s.quietHours, to: v })} placeholder="07:00"/></div>
        <span className="stg-hint" style={{ paddingBottom: 10 }}>only urgent ones are spoken then</span>
      </div>

      <h4 className="stg-subheading">Saved messages</h4>
      <p className="stg-hint">Each one becomes a command Loxone (and flows, dashboards) can fire. Put <code>{'{v}'}</code> in the text to speak the value Loxone sends, e.g. “Basen ma {'{v}'} stopni”.</p>
      {s.messages.map((m, i) => (
        <div key={i} className="an-row">
          <div className="an-row-top">
            <input className="stg-input" style={{ width: 130 }} value={m.id} onChange={(e) => setItem('messages', i, 'id')(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))} placeholder="id, e.g. doorbell"/>
            <input className="stg-input" style={{ flex: 1, minWidth: 160 }} value={m.label || ''} onChange={(e) => setItem('messages', i, 'label')(e.target.value)} placeholder="Name in Loxone"/>
            <label className="an-small"><input type="checkbox" checked={!!m.urgent} onChange={(e) => setItem('messages', i, 'urgent')(e.target.checked)}/> urgent</label>
            <button className="an-x" title="Remove" onClick={() => setS((p) => ({ ...p, messages: p.messages.filter((_, j) => j !== i) }))}>✕</button>
          </div>
          <input className="stg-input" value={m.text} onChange={(e) => setItem('messages', i, 'text')(e.target.value)} placeholder="Text to say"/>
          <Speakers all={speakers} value={m.speakers || []} onChange={setItem('messages', i, 'speakers')} hint="default speakers"/>
        </div>
      ))}
      <Button onClick={() => setS((p) => ({ ...p, messages: [...p.messages, { id: '', label: '', text: '', speakers: [] }] }))}>+ Message</Button>

      <h4 className="stg-subheading">Speak when something happens</h4>
      <p className="stg-hint">Any LSH value — Loxone inputs, alarms, doors, sensors from other systems. <code>{'{device}'}</code>, <code>{'{sensor}'}</code> and <code>{'{value}'}</code> are filled in.</p>
      {s.rules.map((r, i) => {
        const dev = devices.find((d) => d.key === r.deviceKey)
        return (
          <div key={i} className="an-row">
            <div className="an-row-top">
              <select className="stg-input" style={{ flex: 2, minWidth: 180 }} value={r.deviceKey} onChange={(e) => { setItem('rules', i, 'deviceKey')(e.target.value); setItem('rules', i, 'path')('') }}>
                <option value="">Device…</option>
                {devOptions.map((d) => <option key={d.key} value={d.key}>{d.type === 'loxone' ? '◆ ' : ''}{d.label || d.key}</option>)}
              </select>
              <select className="stg-input" style={{ flex: 1, minWidth: 130 }} value={r.path} onChange={(e) => setItem('rules', i, 'path')(e.target.value)} disabled={!dev}>
                <option value="">Value…</option>
                {(dev?.sensors || []).map((x) => <option key={x.path} value={x.path}>{x.label || x.path}</option>)}
              </select>
              <select className="stg-input" style={{ width: 120 }} value={r.when} onChange={(e) => setItem('rules', i, 'when')(e.target.value)}>
                {WHEN.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              {r.when === 'equals' && <input className="stg-input" style={{ width: 80 }} value={r.value || ''} onChange={(e) => setItem('rules', i, 'value')(e.target.value)} placeholder="value"/>}
              <label className="an-small"><input type="checkbox" checked={!!r.urgent} onChange={(e) => setItem('rules', i, 'urgent')(e.target.checked)}/> urgent</label>
              <button className="an-x" title="Remove" onClick={() => setS((p) => ({ ...p, rules: p.rules.filter((_, j) => j !== i) }))}>✕</button>
            </div>
            <input className="stg-input" value={r.text} onChange={(e) => setItem('rules', i, 'text')(e.target.value)} placeholder="{device}: open"/>
            <Speakers all={speakers} value={r.speakers || []} onChange={setItem('rules', i, 'speakers')} hint="default speakers"/>
          </div>
        )
      })}
      <Button onClick={() => setS((p) => ({ ...p, rules: [...p.rules, { deviceKey: '', path: '', when: 'on', text: '', speakers: [] }] }))}>+ Rule</Button>

      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} onClick={() => save.save(s).then(() => { reload?.(); setTimeout(loadStatus, 600) }).catch(() => {})}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result}/>
      </div>

      <h4 className="stg-subheading">Try it</h4>
      {!running ? <p className="stg-hint">Enable and save first.</p> : (
        <>
          <textarea className="stg-input" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Dinner is ready!"/>
          <Speakers all={speakers} value={to} onChange={setTo} hint="default speakers"/>
          <div className="stg-actions" style={{ marginTop: 6 }}>
            <Button onClick={preview} disabled={!text.trim()}>▶ Listen here</Button>
            <Button variant="primary" busy={busy} onClick={announce} disabled={!text.trim()}>📢 Announce</Button>
          </div>
          <ResultBanner result={msg}/>
          <p className="stg-hint">Voice: {st.engine}{st.quiet ? ' · quiet hours now' : ''}{st.speaking ? ' · speaking…' : ''}</p>
        </>
      )}

      <h4 className="stg-subheading">From Loxone</h4>
      <ol className="stg-hint" style={{ margin: '4px 0 8px 18px', lineHeight: 1.7 }}>
        <li><b>Saved messages</b> — download the Virtual Output and import it in Loxone Config (Virtual Outputs → Import). Each message is a command; connect a pulse (doorbell, alarm, scene) — or an analog value for messages with {'{v}'}.</li>
        <li><b>Any text</b> — a Virtual Output Command with <code>/api/announce/say?text=Garage%20is%20open&speakers=kitchen&token=YOUR_API_TOKEN</code>.</li>
        <li><b>Without touching Loxone Config</b> — a rule above on a Loxone value LSH already reads (◆ in the list).</li>
      </ol>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 200 }}><Field label="API token for Loxone" type="select" value={tokenId} onChange={setTokenId} options={tokens.map((t) => ({ value: t.id, label: t.name || t.id }))}/></div>
        <Button href={tokenId ? xmlUrl : undefined} download="lsh-announcements.xml" disabled={!tokenId || !running || !s.messages.length}>⬇ Virtual Output XML</Button>
      </div>
      {!tokens.length && <p className="stg-hint">Create an API token first (Security → API Tokens).</p>}

      <details className="stg-hint" style={{ marginTop: 10 }}>
        <summary>HomePod doesn’t play?</summary>
        In the Home app: Home Settings → Speakers & TV → Allow Speaker & TV Access → <b>Everyone</b> (or Anyone on the Same Network), no password. With “Only People Sharing This Home” a HomePod accepts AirPlay only from your Apple devices.
      </details>

      {st?.history?.length > 0 && (
        <>
          <h4 className="stg-subheading">Recent</h4>
          {st.history.slice(0, 8).map((h, i) => (
            <div key={i} className="an-hist">
              <span>{new Date(h.at).toLocaleTimeString()}</span>
              <b>{h.text}</b>
              <span className={`an-st ${h.status.startsWith('played') ? 'ok' : /fail/.test(h.status) ? 'bad' : ''}`}>{h.status}</span>
              <span className="stg-hint">{h.source}{h.error ? ` · ${h.error}` : ''}{Object.entries(h.results || {}).filter(([, r]) => r !== 'ok').map(([id, r]) => ` · ${id}: ${r}`).join('')}</span>
            </div>
          ))}
        </>
      )}
    </SettingsCard>
  )
}
