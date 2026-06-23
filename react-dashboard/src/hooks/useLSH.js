import { useEffect, useState, useCallback } from 'react'
import { io } from 'socket.io-client'

const TOKEN = 'e95b1a01b85f38a831d8a8b8d949e5e783bf32d3f52ff5d1d6a46ab25b28385e'
const authHeaders = { Authorization: `Bearer ${TOKEN}` }

async function apiFetch(path) {
  try {
    const r = await fetch(path, { headers: authHeaders })
    const j = await r.json()
    return j.success ? j.data : null
  } catch { return null }
}

export function useLSH() {
  const [energy,    setEnergy]    = useState(null)
  const [devices,   setDevices]   = useState([])
  const [connection,setConn]      = useState(null)
  const [connected, setConnected] = useState(false)

  const fetchEnergy = useCallback(async () => {
    const status = await apiFetch('/api/status')
    if (status) setEnergy({
      battery: status.battery,
      solar:   status.solar,
      grid:    status.grid,
      loads:   status.acLoads,
      relays:  status.relays,
    })
  }, [])

  useEffect(() => {
    fetchEnergy()
    apiFetch('/api/connection').then(d => { if (d) setConn(d) })
    apiFetch('/api/devices').then(d => { if (d) setDevices(d) })

    const interval = setInterval(fetchEnergy, 15000)

    const socket = io('/', {
      auth: { token: TOKEN },
      transports: ['websocket', 'polling'],
    })
    socket.on('connect',    () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))
    socket.on('connection-status', d => setConn(d))

    return () => { clearInterval(interval); socket.disconnect() }
  }, [fetchEnergy])

  const toggleRelay = useCallback(async (index, state) => {
    setEnergy(prev => prev ? {
      ...prev,
      relays: prev.relays?.map(r => r.index === index ? { ...r, on: state } : r)
    } : prev)
    await fetch(`/api/relay/${index}/state`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    })
  }, [])

  return { energy, devices, connection, connected, toggleRelay }
}
