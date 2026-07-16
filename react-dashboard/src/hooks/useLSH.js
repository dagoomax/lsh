import { useEffect, useState, useCallback } from 'react'
import { io } from 'socket.io-client'

// Auth: /react is served same-origin as /api, so requests carry the
// `lsh-session` cookie automatically. If unauthenticated, bounce to login.
async function apiFetch(path) {
  try {
    const r = await fetch(path, { credentials: 'same-origin' })
    if (r.status === 401) { window.location.href = `/login.html?next=${encodeURIComponent('/react/')}`; return null }
    const j = await r.json(); return j.success ? j.data : null
  } catch { return null }
}

export function useLSH() {
  const [energy,    setEnergy]    = useState(null)
  const [devices,   setDevices]   = useState([])
  const [connection,setConn]      = useState(null)
  const [connected, setConnected] = useState(false)
  const [lastUpdate,setLastUpdate]= useState(null)
  const [platforms, setPlatforms] = useState({})
  const [roomsMeta, setRoomsMeta] = useState({})

  const fetchAll = useCallback(async () => {
    const [status, conn, devs] = await Promise.all([
      apiFetch('/api/status'),
      apiFetch('/api/connection'),
      apiFetch('/api/devices'),
    ])
    if (status) setEnergy({
      battery: status.battery,
      solar:   status.solar,
      grid:    status.grid,
      loads:   status.acLoads,
      relays:  status.relays,
    })
    if (conn)  setConn(conn)
    if (devs)  setDevices(devs)
    setLastUpdate(new Date())
  }, [])

  useEffect(() => {
    fetchAll()
    const iv = setInterval(fetchAll, 15000)

    const socket = io('/', { transports: ['websocket','polling'] })
    socket.on('connect',    () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))
    socket.on('connection-status', d => setConn(d))
    socket.on('devices', readings => {
      if (Array.isArray(readings) && readings.length) setDevices(readings)
    })
    // Live per-sensor updates: server emits { "<deviceKey>/<sensorPath>": value }
    // on every store change — merge into the matching device readings so tiles
    // refresh immediately instead of waiting for the 15s poll.
    socket.on('update', changes => {
      if (!changes || typeof changes !== 'object') return
      setDevices(prev => {
        let touched = false
        const next = prev.map(d => {
          let readings = d.readings
          let devTouched = false
          const apply = (path, sensor) => {
            const full = `${d.key}/${path}`
            if (!(full in changes)) return
            if (!devTouched) { readings = { ...(readings || {}) }; devTouched = true }
            readings[path] = { ...(readings[path] || sensor || {}), value: changes[full] }
          }
          Object.keys(d.readings || {}).forEach(p => apply(p))
          ;(d.sensors || []).forEach(s => { if (!(d.readings || {})[s.path]) apply(s.path, s) })
          if (!devTouched) return d
          touched = true
          return { ...d, readings }
        })
        return touched ? next : prev
      })
    })
    socket.on('platform-status', s => setPlatforms(s || {}))
    socket.on('rooms', r => setRoomsMeta(r || {}))

    return () => { clearInterval(iv); socket.disconnect() }
  }, [fetchAll])

  const toggleRelay = useCallback(async (index, state) => {
    setEnergy(prev => prev ? {
      ...prev, relays: prev.relays?.map(r => r.index===index ? {...r,on:state} : r)
    } : prev)
    await fetch(`/api/relay/${index}/state`, {
      method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({state}),
    })
  }, [])

  return { energy, devices, connection, connected, lastUpdate, platforms, roomsMeta, toggleRelay }
}
