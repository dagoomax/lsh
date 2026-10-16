import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../primitives'
import { t } from './i18n.js'
import { getLang } from '../../../i18n'

// Installation documentation that writes itself while the emulator is used —
// the wiring section calls log() at each step (wire done, check, power test,
// trip, checklist, pairing); this panel picks / starts the installation, shows
// its log and opens the as-built document. Server: src/wiring-docs.js.

const api = (url, method = 'GET', body) => fetch(url, {
  method, credentials: 'include',
  ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
}).then((r) => r.json())
const store = {
  get: () => { try { return localStorage.getItem('lsh-wiring-doc') } catch { return null } },
  set: (v) => { try { v ? localStorage.setItem('lsh-wiring-doc', v) : localStorage.removeItem('lsh-wiring-doc') } catch { /* private mode */ } },
}

// the doc being written, and log() for the section
export function useWiringDoc(device) {
  const [docs, setDocs] = useState([])
  const [docId, setDocId] = useState(() => store.get())
  const load = useCallback(() => api('/api/wiring/docs').then((j) => j.success && setDocs(j.data)).catch(() => {}), [])
  useEffect(() => { load() }, [load])
  const doc = docs.find((d) => d.id === docId) || null
  const active = !!doc && doc.device === device.id
  const pick = (id) => { setDocId(id || null); store.set(id || null) }
  const replace = (d) => setDocs((all) => (all.some((x) => x.id === d.id) ? all.map((x) => (x.id === d.id ? { ...d, hasDiagram: d.hasDiagram ?? !!d.diagram } : x)) : [...all, d]))
  const log = useCallback(async (type, text, data) => {
    if (!active) return
    const j = await api(`/api/wiring/docs/${doc.id}/events`, 'POST', { type, text, data }).catch(() => null)
    if (j?.success) replace(j.data)
  }, [active, doc?.id])
  // the emulator's SVG as built
  const snapshot = useCallback(async () => {
    if (!active) return
    const svg = document.querySelector('.wr-canvas svg')
    if (!svg) return
    const clone = svg.cloneNode(true)
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    // the drawing's colours and lines come from the dashboard's stylesheet — the
    // document has none, so each element carries its computed style inline
    const src = [svg, ...svg.querySelectorAll('*')], dst = [clone, ...clone.querySelectorAll('*')]
    src.forEach((el, i) => {
      const cs = getComputedStyle(el)
      const style = INLINE.map((p) => { const v = cs.getPropertyValue(p); return v && v !== 'normal' && v !== 'auto' ? `${p}:${v}` : '' }).filter(Boolean).join(';')
      if (style && dst[i]) dst[i].setAttribute('style', style)
      if (dst[i]) dst[i].removeAttribute('class')
    })
    // the emulator's own background, so its labels stay readable on the document's white page
    let bg = 'transparent'
    for (let el = svg; el && (bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)'); el = el.parentElement) bg = getComputedStyle(el).backgroundColor
    if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      const vb = (clone.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number)
      if (vb.length === 4) { rect.setAttribute('x', vb[0]); rect.setAttribute('y', vb[1]); rect.setAttribute('width', vb[2]); rect.setAttribute('height', vb[3]) } else { rect.setAttribute('width', '100%'); rect.setAttribute('height', '100%') }
      rect.setAttribute('style', `fill:${bg}`)
      clone.insertBefore(rect, clone.firstChild)
    }
    const box = svg.getBoundingClientRect()
    if (!clone.getAttribute('width')) { clone.setAttribute('width', Math.round(box.width)); clone.setAttribute('height', Math.round(box.height)) }
    const j = await api(`/api/wiring/docs/${doc.id}`, 'PATCH', { diagram: clone.outerHTML }).catch(() => null)
    if (j?.success) replace(j.data)
  }, [active, doc?.id])
  return { docs, doc, active, pick, load, replace, log, snapshot }
}

const LABELS = () => ({
  status: t('Status'), room: t('Room'), module: t('Module'), diagram: t('Diagram'), log: t('Log'), notes: t('Notes'), wiring: t('Wiring as built'),
  generated: t('Generated'), wires: t('Wires'), tested: t('Power test'), paired: t('Paired'), yes: t('yes'), no: t('no'), none: t('Nothing recorded yet.'), toc: t('Contents'),
  status_new: t('new'), 'status_in progress': t('in progress'), status_wired: t('wired'), status_tested: t('tested'), status_done: t('done'),
})
const exportUrl = (id, download) => {
  const q = new URLSearchParams({ lang: getLang() || 'en', labels: JSON.stringify(LABELS()), ...(id ? { id } : { title: t('Installation documentation') }), ...(download ? { download: '1' } : {}) })
  return `/api/wiring/docs/export.html?${q}`
}
const INLINE = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline', 'color', 'visibility', 'display']
const ICON = { start: '▶', step: '🔌', check: '✓', test: '⚡', trip: '⛔', checklist: '🧰', pair: '📡', note: '✎' }

export default function DocPanel({ wd, device, scenario, onSwitchDevice }) {
  const { docs, doc, active, pick, replace, log } = wd
  const [title, setTitle] = useState('')
  const [room, setRoom] = useState('')
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState(null)
  const listRef = useRef(null)
  useEffect(() => { setTitle(`${device.name} — ${t(scenario.title)}`) }, [device.id, scenario.id])
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight }, [doc?.events?.length])

  const create = async () => {
    const j = await api('/api/wiring/docs', 'POST', { title, room, device: device.id, deviceName: `${device.manufacturer} ${device.name} (${device.model})`, scenario: scenario.id, scenarioTitle: t(scenario.title), startText: t('Installation started: {m}, diagram “{d}”', { m: `${device.manufacturer} ${device.name}`, d: t(scenario.title) }) })
    if (j.success) { replace(j.data); pick(j.data.id); setMsg(null) } else setMsg(j.error)
  }
  const edit = async (patch) => { const j = await api(`/api/wiring/docs/${doc.id}`, 'PATCH', patch); if (j.success) replace(j.data) }
  const addNote = async () => { if (!note.trim()) return; await log('note', note.trim()); setNote('') }
  const del = async () => { await api(`/api/wiring/docs/${doc.id}`, 'DELETE'); pick(null); wd.load() }

  const p = doc?.progress || {}
  const fmt = (iso) => { try { return new Date(iso).toLocaleString(getLang(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) } catch { return iso } }

  return (
    <div className="wr-panel wr-doc">
      <div className="wr-doc-head">
        <b>📝 {t('Documentation')}</b>
        {doc && <span className={`wr-doc-status st-${(p.status || '').replace(' ', '-')}`}>{t(p.status === 'tested' ? 'tested' : p.status || 'new')}</span>}
      </div>

      {!doc && (
        <>
          <p className="stg-hint">{t('Start an installation and the documentation writes itself as you wire: each wire, checks, power tests, the checklist and pairing — then open it as a printable as-built document.')}</p>
          <div className="wr-doc-form">
            <input className="stg-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('Installation (e.g. Living room — blind)')} aria-label={t('Installation')} />
            <input className="stg-input" value={room} onChange={(e) => setRoom(e.target.value)} placeholder={t('Room')} aria-label={t('Room')} />
            <Button variant="primary" onClick={create} disabled={!title.trim()}>{t('Start documenting')}</Button>
          </div>
          {docs.length > 0 && (
            <div className="wr-doc-pick">
              <select className="stg-input" value="" onChange={(e) => pick(e.target.value)} aria-label={t('Continue an installation')}>
                <option value="">{t('Continue an installation…')}</option>
                {docs.map((d) => <option key={d.id} value={d.id}>{d.title}{d.room ? ` · ${d.room}` : ''}</option>)}
              </select>
              <a className="hub-btn small wr-doc-link" href={exportUrl(null)} target="_blank" rel="noopener noreferrer">{t('All installations')}</a>
            </div>
          )}
          {msg && <div className="stg-banner err">✗ {msg}</div>}
        </>
      )}

      {doc && (
        <>
          <div className="wr-doc-form">
            <input className="stg-input" defaultValue={doc.title} key={`t-${doc.id}`} onBlur={(e) => e.target.value !== doc.title && edit({ title: e.target.value })} aria-label={t('Installation')} />
            <input className="stg-input" defaultValue={doc.room} key={`r-${doc.id}`} onBlur={(e) => e.target.value !== doc.room && edit({ room: e.target.value })} placeholder={t('Room')} aria-label={t('Room')} />
          </div>
          {!active && (
            <div className="stg-banner warn">
              {t('This installation is for another module — recording is paused.')}{' '}
              <button type="button" className="hub-link" onClick={() => onSwitchDevice?.(doc.device)}>{t('Switch to it')}</button>
            </div>
          )}
          <div className="wr-doc-chips">
            <span className={p.wired ? 'ok' : ''}>🔌 {t('Wires')} {p.total ? `${p.steps}/${p.total}` : (p.wired ? '✓' : '—')}</span>
            <span className={p.tested ? 'ok' : ''}>⚡ {t('Power test')} {p.tested ? '✓' : '—'}</span>
            <span className={p.paired ? 'ok' : ''}>📡 {t('Paired')} {p.paired ? '✓' : '—'}</span>
            <span className={doc.hasDiagram ? 'ok' : ''}>🗺 {t('Diagram')} {doc.hasDiagram ? '✓' : '—'}</span>
          </div>
          <ol className="wr-doc-log" ref={listRef}>
            {(doc.events || []).map((e, i) => (
              <li key={i} className={`ev-${e.type}`}><time>{fmt(e.at)}</time><span>{ICON[e.type] || '•'}</span><span>{e.text}</span></li>
            ))}
          </ol>
          <div className="wr-doc-note">
            <input className="stg-input" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addNote() }} placeholder={t('Add a note (cable colours, where the box is, anything)')} aria-label={t('Note')} />
            <Button onClick={addNote} disabled={!note.trim()}>{t('Add')}</Button>
          </div>
          <div className="stg-actions">
            <a className="hub-btn small wr-doc-link" href={exportUrl(doc.id)} target="_blank" rel="noopener noreferrer">📄 {t('Open document')}</a>
            <a className="hub-btn small wr-doc-link" href={exportUrl(doc.id, true)}>⬇ {t('Download')}</a>
            <a className="hub-btn small wr-doc-link" href={exportUrl(null)} target="_blank" rel="noopener noreferrer">{t('All installations')}</a>
            <Button onClick={() => pick(null)}>{t('Stop recording')}</Button>
            <Button onClick={del}>{t('Delete')}</Button>
          </div>
        </>
      )}
    </div>
  )
}
