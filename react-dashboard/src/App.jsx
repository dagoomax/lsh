import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import './styles/luxury.css'
import './App.css'
import { useSocket } from './hooks/useSocket'
import Header from './components/Header'
import EnergyBar from './components/EnergyBar'
import FloorPlan3D from './components/FloorPlan3D'
import RoomPanel from './components/RoomPanel'

export default function App() {
  const { status, sensors, connected } = useSocket()
  const [selectedRoom, setSelectedRoom] = useState(null)

  const source = status?.source === 'vrm' ? 'VRM Cloud'
               : status?.source === 'mqtt' ? 'MQTT Local'
               : null

  return (
    <div className="app">
      <Header connected={connected} source={source} />
      <EnergyBar status={status} />
      <div className="main-area">
        <div className="canvas-wrapper">
          <FloorPlan3D
            sensors={sensors}
            selectedRoom={selectedRoom}
            onRoomSelect={room => setSelectedRoom(prev => prev?.id === room.id ? null : room)}
          />
        </div>
        <AnimatePresence>
          {selectedRoom && (
            <RoomPanel
              room={selectedRoom}
              sensors={sensors}
              onClose={() => setSelectedRoom(null)}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
