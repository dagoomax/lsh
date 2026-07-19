import { useEffect, useState } from 'react'
import './styles/global.css'
import { useLSH }            from './hooks/useLSH'
import Header                from './components/Header'
import PlatformBar           from './components/PlatformBar'
import DeviceList, { Toast } from './components/DeviceList'
import IncomingCall          from './components/IncomingCall'
import LockScreen            from './components/LockScreen'
import LoginScreen           from './components/LoginScreen'

// Single unified view: the "Rooms & Categories" device browser with the
// Energy flow + relays rendered as the top section (see DeviceList). No more
// split screen between devices and energy.
export default function App() {
  const { energy, devices, connection, connected, platforms, roomsMeta, toggleRelay, authRequired, onLogin } = useLSH()
  const [locked, setLocked] = useState(() => localStorage.getItem('lsh-locked') === '1')
  const lock   = () => { localStorage.setItem('lsh-locked', '1'); setLocked(true) }
  const unlock = () => { localStorage.setItem('lsh-locked', '0'); setLocked(false) }

  // Re-render the whole tree when the language changes (gt() reads it live)
  const [, setLangTick] = useState(0)
  useEffect(() => {
    const bump = () => setLangTick(t => t + 1)
    window.addEventListener('lsh-lang-changed', bump)
    return () => window.removeEventListener('lsh-lang-changed', bump)
  }, [])

  if (authRequired) {
    return <LoginScreen onLogin={onLogin}/>
  }

  if (locked) {
    return <LockScreen onUnlock={unlock}/>
  }

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', background:'var(--bg)', overflow:'hidden' }}>
      <Toast />
      <IncomingCall />
      <Header connection={connection} connected={connected} onLock={lock} />

      <div style={{ flex:1, paddingTop:56, overflow:'hidden', display:'flex', flexDirection:'column' }}>
        <PlatformBar platforms={platforms} />
        {devices.length === 0 && !energy
          ? <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text3)', fontSize:13 }}>Loading…</div>
          : <DeviceList devices={devices} energy={energy} roomsMeta={roomsMeta} onToggleRelay={toggleRelay} />
        }
      </div>
    </div>
  )
}
