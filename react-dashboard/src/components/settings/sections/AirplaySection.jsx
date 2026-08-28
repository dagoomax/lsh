import { useEffect, useState } from 'react'
import { SettingsCard, ListEditor, Toggle, Button, ResultBanner, Field } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { SpeakerIcon } from '../../Icons'
import { gt } from '../../../i18n'

const FIELDS = [
  { key: 'id',       label: 'ID',     placeholder: 'living-room' },
  { key: 'name',     label: 'Name',   placeholder: 'Living Room' },
  { key: 'host',     label: 'Host',   placeholder: '192.168.1.50' },
  { key: 'port',     label: 'Port',   type: 'number', placeholder: '5000', default: 5000 },
  { key: 'volume',   label: 'Volume', type: 'number', placeholder: '60', default: 60 },
  { key: 'airplay2', label: 'AirPlay 2', type: 'checkbox', default: true },
]

// mDNS scan (GET /api/airplay/discover, browses _raop._tcp + _airplay._tcp)
// for AirPlay receivers on the LAN, with one-click "Add" into the speaker
// list above — the actual answer to "how do I find speakers on my network".
// Purely additive: never edits or removes existing rows, only appends.
function DiscoverTool({ speakers, onAdd }) {
  const [scanning, setScanning] = useState(false)
  const [found, setFound] = useState(null) // null = not scanned yet this visit
  const [error, setError] = useState(null)

  const scan = async () => {
    setScanning(true); setError(null)
    try {
      const res = await fetch('/api/airplay/discover', { credentials: 'same-origin' })
      const json = await res.json()
      if (!json?.success) throw new Error(json?.error || 'Scan failed')
      setFound(json.data || [])
    } catch (err) {
      setError(err.message)
      setFound([])
    } finally {
      setScanning(false)
    }
  }

  const known = new Set(speakers.map(s => s.host))

  return (
    <div style={{ marginBottom: 14 }}>
      <div className="stg-actions">
        <Button variant="secondary" busy={scanning} onClick={scan}>
          {gt('s.airplay_scan', 'Scan network')}
        </Button>
        {scanning && <span className="stg-hint">{gt('s.airplay_scanning', 'Listening for mDNS replies (a few seconds)…')}</span>}
        {error && <ResultBanner result={{ ok: false, message: error }}/>}
      </div>
      {found && found.length === 0 && !error && (
        <div className="stg-hint" style={{ marginTop: 6 }}>
          {gt('s.airplay_scan_none', 'No AirPlay receivers responded. They may be on a different subnet/VLAN than this server, or blocking mDNS/multicast — add them manually below if so.')}
        </div>
      )}
      {found && found.length > 0 && (
        <div className="stg-list" style={{ marginTop: 6 }}>
          {found.map(d => {
            const already = known.has(d.host)
            return (
              <div key={d.host} className="stg-list-row"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {d.name}
                    {d.airplay2 && <span className="stg-hint"> · AirPlay 2</span>}
                  </div>
                  <div className="stg-hint">{d.host}:{d.port}{d.model ? ` · ${d.model}` : ''}</div>
                </div>
                <Button variant={already ? 'secondary' : 'primary'} disabled={already} onClick={() => onAdd(d)}>
                  {already ? gt('common.added', 'Added') : gt('common.add', 'Add')}
                </Button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Below the speaker list: a "send it right now" tool, independent of the
// list editor above — plays against whatever's actually loaded server-side
// (GET /api/airplay/speakers), not the unsaved edits in the form, since a
// newly-added speaker only takes effect after Save + restart anyway.
function SendAudioTool() {
  const [speakers, setSpeakers] = useState([])
  const [speakerId, setSpeakerId] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null) // { ok, message } | null

  useEffect(() => {
    fetch('/api/airplay/speakers', { credentials: 'same-origin' })
      .then(r => r.json()).then(j => setSpeakers(j?.data || [])).catch(() => {})
  }, [])

  const send = async () => {
    if (!speakerId || !file) return
    setBusy(true); setResult(null)
    try {
      const res = await fetch(`/api/airplay/${encodeURIComponent(speakerId)}/play`, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': file.type || 'audio/mpeg' },
        body: file,
      })
      const json = await res.json()
      if (!json?.success) throw new Error(json?.error || 'Playback failed')
      setResult({ ok: true, message: gt('s.airplay_sent', 'Sent.') })
    } catch (err) {
      setResult({ ok: false, message: err.message })
    } finally {
      setBusy(false)
    }
  }

  if (!speakers.length) {
    return (
      <div className="stg-hint" style={{ marginTop: 4 }}>
        {gt('s.airplay_none_loaded', 'No speakers currently loaded on the server — save at least one below, then restart LSH, before this tool has anything to play to.')}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
      <Field label={gt('s.airplay_speaker', 'Speaker')} type="select" value={speakerId} onChange={setSpeakerId}
        options={[{ value: '', label: gt('s.airplay_choose', 'Choose…') }, ...speakers.map(s => ({ value: s.id, label: s.name }))]}/>
      <div className="stg-field">
        <label>{gt('s.airplay_file', 'Audio file')}</label>
        <input className="stg-input" type="file" accept="audio/*"
          onChange={e => setFile(e.target.files?.[0] || null)}/>
      </div>
      <div className="stg-actions">
        <Button variant="primary" busy={busy} disabled={!speakerId || !file} onClick={send}>
          {gt('s.airplay_play', 'Play on speaker')}
        </Button>
        <ResultBanner result={result}/>
      </div>
    </div>
  )
}

export default function AirplaySection({ config, reload }) {
  const airplay = config.airplay || {}
  const [enabled, setEnabled] = useState(!!airplay.enabled)
  const [speakers, setSpeakers] = useState(airplay.speakers || [])
  const save = useSettingsSave('/api/settings/airplay')

  const addDiscovered = (d) => {
    if (speakers.some(s => s.host === d.host)) return
    const slug = (d.name || d.host).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '')
      || d.host.replace(/\./g, '-')
    const existingIds = new Set(speakers.map(s => s.id))
    let id = slug, n = 1
    while (existingIds.has(id)) id = `${slug}-${++n}`
    setSpeakers([...speakers, {
      id, name: d.name || d.host, host: d.host, port: d.port || 5000,
      airplay2: d.airplay2 !== false, volume: 60,
    }])
  }

  return (
    <SettingsCard icon={SpeakerIcon} title={gt('s.airplay_title', 'AirPlay Speakers')} badge={{ label: gt('common.optional', 'Optional') }}
      desc={gt('sdesc.d42', 'Play prerecorded audio (e.g. paging voice messages) out loud on AirPlay 1/2 speakers over RAOP. Scan the network to find receivers automatically, or add them manually — the saved list stays fixed either way, so playback never depends on discovery succeeding at runtime.')}>
      <Toggle label={gt('s.airplay_enabled', 'Enable AirPlay')} checked={enabled} onChange={setEnabled}/>
      <DiscoverTool speakers={speakers} onAdd={addDiscovered}/>
      <ListEditor rows={speakers} onChange={setSpeakers} fields={FIELDS} addLabel="+ Add Speaker"/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy}
          onClick={() => save.save({
            enabled,
            speakers: speakers.filter(s => s.id && s.host),
          }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result}/>
      </div>

      <div style={{ margin: '14px 0', borderTop: '1px solid var(--border, rgba(255,255,255,0.14))' }}/>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{gt('s.airplay_send_title', 'Send audio now')}</div>
      <SendAudioTool/>
    </SettingsCard>
  )
}
