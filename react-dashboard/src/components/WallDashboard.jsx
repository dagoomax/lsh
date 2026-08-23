import { useCallback, useEffect, useRef, useState } from 'react'
import HomePlan from './HomePlan'
import DeviceModal from './DeviceModal'
import { getGroup } from './DeviceList'
import EnergyRadial from './EnergyRadial'
import ThermostatPanel from './ThermostatPanel'
import WeatherClock from './WeatherClock'
import WeatherDetails from './WeatherDetails'
import ForecastStrip from './ForecastStrip'
import AgendaPanel from './AgendaPanel'
import PagingWidget from './PagingWidget'
import { gt } from '../i18n'

const AGENDA_POLL_MS = 5 * 60 * 1000

// Same fetch-and-poll convention as ForecastStrip.jsx's useForecast(): a
// module-level poll interval, a `stop` flag to avoid setState-after-unmount,
// silent catch. `refresh()` lets AgendaPanel pull immediately after an
// add/remove instead of waiting out the rest of the interval.
function useAgenda() {
  const [events, setEvents] = useState([])
  const load = useCallback(() => {
    return fetch('/api/agenda', { credentials: 'same-origin' })
      .then(r => r.ok ? r.json() : { data: [] })
      .then(j => setEvents(j?.data || []))
      .catch(() => {})
  }, [])
  useEffect(() => {
    load()
    const iv = setInterval(load, AGENDA_POLL_MS)
    return () => clearInterval(iv)
  }, [load])
  return [events, load]
}

async function sendCommand(key, sensor, value) {
  try {
    const res = await fetch(`/api/device/${key}/command`, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sensor, value }),
    })
    const json = await res.json().catch(() => ({}))
    return !!json.success
  } catch { return false }
}

// Small PIN gate over the exit button — reuses the same dashboard-lock PIN
// already in Settings → Security (POST /api/dashboard-pin/verify, default
// 0000) rather than a separate kiosk-specific PIN, so there's only one PIN
// to manage.
function ExitPinPrompt({ onConfirm, onCancel }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  const submit = async (e) => {
    e?.preventDefault()
    if (!pin || busy) return
    setBusy(true)
    try {
      const r = await fetch('/api/dashboard-pin/verify', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      })
      const d = await r.json()
      if (d.ok) { onConfirm(); return }
      setErr(true); setPin('')
      setTimeout(() => setErr(false), 900)
    } catch { setErr(true) }
    finally { setBusy(false) }
  }

  return (
    <div className="wall-pin-overlay" onClick={onCancel}>
      <form className={`wall-pin-card${err ? ' wall-pin-shake' : ''}`} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="wall-pin-title">{gt('enter_pin', 'Enter PIN')}</div>
        <input ref={inputRef} type="password" inputMode="numeric" autoComplete="off" maxLength={8}
          value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} className="wall-pin-input" />
        <div className="wall-pin-actions">
          <button type="button" className="wall-pin-btn" onClick={onCancel}>{gt('cancel', 'Cancel')}</button>
          <button type="submit" className="wall-pin-btn primary" disabled={busy || !pin}>{gt('unlock', 'Unlock')}</button>
        </div>
        {err && <div className="wall-pin-err">{gt('wrong_pin', 'Wrong PIN')}</div>}
      </form>
    </div>
  )
}

// Full-screen wall-tablet kiosk view, styled after the user's reference
// photo: energy widget top-left, weather+clock top-right, the isometric
// floor plan filling the center (HomePlan in `kiosk` mode — no toolbar, just
// a floating zoom pill), a forecast strip bottom-left, and an agenda panel
// on the right edge. No presence-avatar row: LSH has no person/distance
// tracking integration to feed one (see plan notes).
export default function WallDashboard({ devices, energy, roomsMeta, onClose }) {
  const [openKey, setOpenKey] = useState(null)
  const openDevice = openKey ? devices.find(d => d.key === openKey) : null
  const rooms = [...new Set(devices.map(d => d.room).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  const onCommand = useCallback((key, sensor, value) => { sendCommand(key, sensor, value) }, [])
  const [agendaEvents, refreshAgenda] = useAgenda()
  const [showExitPin, setShowExitPin] = useState(false)

  return (
    <div className="wall-dash">
      <button className="wall-exit" onClick={() => setShowExitPin(true)} title={gt('exit_wall', 'Exit wall view')}>✕</button>
      {showExitPin && <ExitPinPrompt onConfirm={onClose} onCancel={() => setShowExitPin(false)} />}

      <div className="wall-region wall-region-energy">
        <EnergyRadial energy={energy} />
        <ThermostatPanel devices={devices} onCommand={onCommand} />
      </div>
      <div className="wall-region wall-region-forecast"><ForecastStrip /></div>
      <div className="wall-region wall-region-rightcol">
        <WeatherClock devices={devices} />
        <WeatherDetails devices={devices} />
        <AgendaPanel events={agendaEvents} onRefresh={refreshAgenda} />
      </div>
      <div className="wall-region wall-region-plan">
        <HomePlan devices={devices} roomsMeta={roomsMeta} groupOf={getGroup} onOpen={setOpenKey} energy={energy} kiosk />
      </div>

      <DeviceModal device={openDevice} rooms={rooms} onClose={() => setOpenKey(null)} onCommand={onCommand} />
      <PagingWidget />
    </div>
  )
}
