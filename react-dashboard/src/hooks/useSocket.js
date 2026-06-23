import { useEffect, useState } from 'react'
import { io } from 'socket.io-client'

export function useSocket() {
  const [status, setStatus] = useState(null)
  const [sensors, setSensors] = useState([])
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const socket = io('/', { transports: ['websocket'] })

    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))
    socket.on('status', (data) => {
      setStatus(data)
      if (data.sensors) setSensors(Object.values(data.sensors))
    })
    socket.on('sensor-update', (data) => {
      setSensors(prev => {
        const idx = prev.findIndex(s => s.key === data.key)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = { ...next[idx], ...data }
          return next
        }
        return [...prev, data]
      })
    })

    fetch('/api/status')
      .then(r => r.json())
      .then(d => {
        setStatus(d)
        if (d.sensors) setSensors(Object.values(d.sensors))
      })
      .catch(() => {})

    return () => socket.disconnect()
  }, [])

  return { status, sensors, connected }
}
