import { useCallback, useEffect, useRef, useState } from 'react'
import { getLang } from '../i18n'

// Dashboard media player: play internet radio / a stream / an audio file URL on
// a Chromecast (Google Home, Nest, Chromecast-built-in) or AirPlay speaker
// (HomePod, Apple TV, AirPlay 2), with pause / stop / volume and saved stations.
// Server: src/routes/media.js. Hidden when no speaker is configured.
export default function MediaPlayer() {
  const [data, setData] = useState(null)
  const [sel, setSel] = useState(() => { try { return localStorage.getItem('lsh-media-target') || '' } catch { return '' } })
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [vol, setVol] = useState(null)
  const volTimer = useRef(null)

  const load = useCallback(() => fetch('/api/media/targets', { credentials: 'include' })
    .then((r) => r.json()).then((j) => { if (j.success && Array.isArray(j.data?.targets)) setData(j.data) }).catch(() => {}), [])
  useEffect(() => {
    load()
    const t = setInterval(() => { if (!document.hidden) load() }, 5000)
    return () => clearInterval(t)
  }, [load])

  const targets = data?.targets || []
  const target = targets.find((t) => t.id === sel) || targets[0]
  useEffect(() => { if (!volTimer.current) setVol(target?.volume ?? null) }, [target?.id, target?.volume])
  if (!targets.length) return null

  const pick = (id) => { setSel(id); try { localStorage.setItem('lsh-media-target', id) } catch { /* private mode */ } }
  const call = async (path, body) => {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch(`/api/media/${path}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      setMsg(j.success ? null : { err: true, text: j.error || `HTTP ${r.status}` })
      setTimeout(load, 800)
      return j.success
    } finally { setBusy(false) }
  }
  const play = (u, title) => call('play', { target: target.id, url: u, title })
  const changeVolume = (v) => {
    setVol(v)
    clearTimeout(volTimer.current)
    volTimer.current = setTimeout(() => { volTimer.current = null; call('volume', { target: target.id, volume: v }) }, 350)
  }
  const saveStation = async () => {
    const stations = [...(data.stations || []).filter((s) => s.url !== url.trim()), { name: name.trim() || url.trim(), url: url.trim() }]
    if (await call('stations', { stations })) { setName(''); load() }
  }
  const removeStation = (s) => call('stations', { stations: data.stations.filter((x) => x.url !== s.url) }).then(load)

  const playingNow = ['playing', 'buffering'].includes(target.state)
  const paused = target.state === 'paused'
  const validUrl = /^https?:\/\/\S+$/i.test(url.trim())

  return (
    <div className="card sm-card media-player">
      <div className="sm-head">
        <div className="sm-host-icon" style={{ background: playingNow ? '#30d158' : 'var(--white-10)', color: playingNow ? '#fff' : 'var(--text2)' }}>
          <NoteIcon />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="sm-title">{T('title')}</div>
          <div className="sm-status" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <span style={{ background: playingNow ? '#30d158' : paused ? '#ff9f0a' : 'var(--text3)' }} />
            {target.title ? `${T(playingNow ? 'playing' : paused ? 'paused' : 'idle')} · ${target.title}` : T('idle')}
          </div>
        </div>
      </div>

      {/* speakers */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {targets.map((t) => (
          <button key={t.id} onClick={() => pick(t.id)} className="media-chip" data-on={String(t.id === target.id)} title={t.kind === 'airplay' ? 'AirPlay' : 'Chromecast'}>
            {t.kind === 'airplay' ? <AirPlayIcon /> : <CastIcon />}
            <span>{t.name}</span>
            {['playing', 'buffering'].includes(t.state) && <span className="media-eq" aria-hidden="true"><i /><i /><i /></span>}
          </button>
        ))}
      </div>

      {/* transport + volume */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {target.kind === 'chromecast' && (playingNow || paused) && (
          <RoundBtn disabled={busy} label={paused ? T('resume') : T('pause')} onClick={() => call(paused ? 'resume' : 'pause', { target: target.id })}>
            {paused ? <PlayIcon /> : <PauseIcon />}
          </RoundBtn>
        )}
        {(playingNow || paused) && <RoundBtn disabled={busy} label={T('stop')} onClick={() => call('stop', { target: target.id })}><StopIcon /></RoundBtn>}
        {vol != null && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 160 }}>
            <span style={{ fontSize: 12, color: 'var(--text2)' }}>{T('volume')}</span>
            <input type="range" min="0" max="100" value={vol} onChange={(e) => changeVolume(Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent)' }} aria-label={T('volume')} />
            <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', width: 32, textAlign: 'right' }}>{vol}%</span>
          </label>
        )}
      </div>

      {/* stations */}
      {data.stations?.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {data.stations.map((s) => (
            <span key={s.url} className="media-station">
              <button disabled={busy} onClick={() => play(s.url, s.name)} title={s.url}>▶ {s.name}</button>
              <button className="media-station-x" onClick={() => removeStation(s)} aria-label={`${T('remove')} ${s.name}`} title={T('remove')}>×</button>
            </span>
          ))}
        </div>
      )}

      {/* any URL */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <input className="media-input" style={{ flex: 3, minWidth: 200 }} placeholder={T('urlPh')} value={url} onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && validUrl) play(url.trim(), name.trim() || undefined) }} />
        <input className="media-input" style={{ flex: 1, minWidth: 110 }} placeholder={T('namePh')} value={name} onChange={(e) => setName(e.target.value)} />
        <button className="media-btn primary" disabled={busy || !validUrl} onClick={() => play(url.trim(), name.trim() || undefined)}>{T('play')}</button>
        <button className="media-btn" disabled={busy || !validUrl} onClick={saveStation}>{T('save')}</button>
      </div>
      {msg?.err && <div style={{ fontSize: 12.5, color: 'var(--red)' }}>✗ {msg.text}</div>}
    </div>
  )
}

function RoundBtn({ children, onClick, disabled, label }) {
  return <button className="media-round" onClick={onClick} disabled={disabled} title={label} aria-label={label}>{children}</button>
}

const svg = (d, fill) => (p) => <svg width="18" height="18" viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>{d}</svg>
const NoteIcon = svg(<><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>)
const PlayIcon = svg(<path d="M7 4l13 8-13 8z" />, true)
const PauseIcon = svg(<><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></>, true)
const StopIcon = svg(<rect x="5" y="5" width="14" height="14" rx="2" />, true)
const CastIcon = svg(<><path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" /><line x1="2" y1="20" x2="2.01" y2="20" /></>)
const AirPlayIcon = svg(<><path d="M5 17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-1" /><polygon points="12 15 17 21 7 21 12 15" /></>)

const TX = {
  en: { title: 'Media player', playing: 'Playing', paused: 'Paused', idle: 'Nothing playing', pause: 'Pause', resume: 'Resume', stop: 'Stop', volume: 'Volume', play: 'Play', save: 'Save station', remove: 'Remove', urlPh: 'Stream or audio URL (https://…)', namePh: 'Name' },
  pl: { title: 'Odtwarzacz', playing: 'Gra', paused: 'Pauza', idle: 'Nic nie gra', pause: 'Pauza', resume: 'Wznów', stop: 'Stop', volume: 'Głośność', play: 'Odtwórz', save: 'Zapisz stację', remove: 'Usuń', urlPh: 'Adres strumienia lub pliku (https://…)', namePh: 'Nazwa' },
  de: { title: 'Mediaplayer', playing: 'Spielt', paused: 'Pausiert', idle: 'Keine Wiedergabe', pause: 'Pause', resume: 'Fortsetzen', stop: 'Stopp', volume: 'Lautstärke', play: 'Abspielen', save: 'Sender speichern', remove: 'Entfernen', urlPh: 'Stream- oder Audio-URL (https://…)', namePh: 'Name' },
  fr: { title: 'Lecteur multimédia', playing: 'Lecture', paused: 'En pause', idle: 'Rien en lecture', pause: 'Pause', resume: 'Reprendre', stop: 'Arrêt', volume: 'Volume', play: 'Lire', save: 'Enregistrer la station', remove: 'Supprimer', urlPh: 'URL de flux ou de fichier audio (https://…)', namePh: 'Nom' },
  es: { title: 'Reproductor', playing: 'Reproduciendo', paused: 'En pausa', idle: 'No suena nada', pause: 'Pausa', resume: 'Reanudar', stop: 'Detener', volume: 'Volumen', play: 'Reproducir', save: 'Guardar emisora', remove: 'Quitar', urlPh: 'URL de stream o audio (https://…)', namePh: 'Nombre' },
  it: { title: 'Lettore multimediale', playing: 'In riproduzione', paused: 'In pausa', idle: 'Niente in riproduzione', pause: 'Pausa', resume: 'Riprendi', stop: 'Stop', volume: 'Volume', play: 'Riproduci', save: 'Salva stazione', remove: 'Rimuovi', urlPh: 'URL di stream o file audio (https://…)', namePh: 'Nome' },
  uk: { title: 'Медіаплеєр', playing: 'Грає', paused: 'Пауза', idle: 'Нічого не грає', pause: 'Пауза', resume: 'Продовжити', stop: 'Стоп', volume: 'Гучність', play: 'Відтворити', save: 'Зберегти станцію', remove: 'Видалити', urlPh: 'URL потоку або аудіофайлу (https://…)', namePh: 'Назва' },
}
function T(k) { return (TX[getLang()] || TX.en)[k] || TX.en[k] }
