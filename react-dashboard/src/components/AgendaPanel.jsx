import { useState } from 'react'
import { gt } from '../i18n'

const KIND_ICON = { calendar: '📅', private: '📝', call: '📞', motion: '🚶' }

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json().catch(() => ({}))
}

// Inline add-event form for private (locally-added, never synced to/from
// Google) events — kept to the 3 fields the backend actually stores
// (title/date/time), no recurrence/reminders.
function AddEventForm({ onAdded, onCancel }) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [time, setTime] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!title.trim() || !date) return
    setBusy(true)
    const d = await postJson('/api/agenda/private', { title: title.trim(), date, time: time || null })
    setBusy(false)
    if (d.success) onAdded()
  }

  return (
    <form className="wall-agenda-add-form" onSubmit={submit}>
      <input className="wall-agenda-add-input" placeholder={gt('event_title', 'Event title')}
        value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      <div className="wall-agenda-add-row">
        <input className="wall-agenda-add-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <input className="wall-agenda-add-input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </div>
      <div className="wall-agenda-add-row">
        <button type="button" className="wall-agenda-add-btn" onClick={onCancel}>{gt('cancel', 'Cancel')}</button>
        <button type="submit" className="wall-agenda-add-btn primary" disabled={busy || !title.trim()}>
          {busy ? '…' : gt('add', 'Add')}
        </button>
      </div>
    </form>
  )
}

// Right-edge agenda panel: merges Google Calendar events, locally-added
// private events, missed calls, and motion-detector events into one
// time-sorted list (src/api-routes.js GET /api/agenda) — each row's `kind`
// picks the icon. Private events (the only kind with an `id`) get a remove
// control; the "+" opens a 3-field add form posting straight to the backend.
export default function AgendaPanel({ events = [], onRefresh }) {
  const [adding, setAdding] = useState(false)

  const remove = async (id) => {
    await fetch(`/api/agenda/private/${id}`, { method: 'DELETE', credentials: 'same-origin' })
    onRefresh?.()
  }

  return (
    <div className="wall-agenda">
      <div className="wall-agenda-header">
        <div className="wall-agenda-title">{gt('agenda', 'Agenda')}</div>
        <button className="wall-agenda-add-toggle" onClick={() => setAdding((v) => !v)} title={gt('add_event', 'Add event')}>
          {adding ? '✕' : '＋'}
        </button>
      </div>

      {adding && (
        <AddEventForm
          onAdded={() => { setAdding(false); onRefresh?.() }}
          onCancel={() => setAdding(false)}
        />
      )}

      {!adding && events.length === 0 && (
        <div className="wall-agenda-empty">
          {gt('agenda_empty', 'No calendar connected yet')}
        </div>
      )}
      {events.map((ev, i) => (
        <div key={ev.id || i} className="wall-agenda-item">
          <div className="wall-agenda-date">
            {KIND_ICON[ev.kind] || ''} {ev.date}
          </div>
          <div className="wall-agenda-item-title">{ev.title}</div>
          {ev.time && <div className="wall-agenda-item-time">{ev.time}</div>}
          {ev.kind === 'private' && ev.id && (
            <button className="wall-agenda-item-remove" onClick={() => remove(ev.id)} title={gt('remove', 'Remove')}>✕</button>
          )}
        </div>
      ))}
    </div>
  )
}
