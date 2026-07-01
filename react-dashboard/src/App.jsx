import './styles/global.css'
import { useLSH }            from './hooks/useLSH'
import Header                from './components/Header'
import DeviceList, { Toast } from './components/DeviceList'

// Single unified view: the "Rooms & Categories" device browser with the
// Energy flow + relays rendered as the top section (see DeviceList). No more
// split screen between devices and energy.
export default function App() {
  const { energy, devices, connection, connected, toggleRelay } = useLSH()

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', background:'var(--bg)', overflow:'hidden' }}>
      <Toast />
      <Header connection={connection} connected={connected} />

      <div style={{ flex:1, paddingTop:56, overflow:'hidden', display:'flex', flexDirection:'column' }}>
        {devices.length === 0 && !energy
          ? <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text3)', fontSize:13 }}>Loading…</div>
          : <DeviceList devices={devices} energy={energy} onToggleRelay={toggleRelay} />
        }
      </div>
    </div>
  )
}
