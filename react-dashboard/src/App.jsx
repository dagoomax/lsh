import { useEffect, useState } from 'react'
import './styles/global.css'
import { useLSH }            from './hooks/useLSH'
import { usePaging }         from './hooks/usePaging'
import Header                from './components/Header'
import PlatformBar           from './components/PlatformBar'
import SceneStrip            from './components/SceneStrip'
import DeviceList, { Toast } from './components/DeviceList'
import IncomingCall          from './components/IncomingCall'
import { PagingPanel }       from './components/PagingWidget'
import LockScreen            from './components/LockScreen'
import LoginScreen           from './components/LoginScreen'
import SettingsPage          from './components/settings/SettingsPage'
import WallDashboard         from './components/WallDashboard'

// Single unified view: the "Rooms & Categories" device browser with the
// Energy flow + relays rendered as the top section (see DeviceList). No more
// split screen between devices and energy.
export default function App() {
  const { energy, devices, connection, connected, platforms, roomsMeta, toggleRelay, authRequired, onLogin, scenes, runScene } = useLSH()
  const [locked, setLocked] = useState(() => localStorage.getItem('lsh-locked') === '1')
  const lock   = () => { localStorage.setItem('lsh-locked', '1'); setLocked(true) }
  const unlock = () => { localStorage.setItem('lsh-locked', '0'); setLocked(false) }
  const [view, setView] = useState('dashboard') // 'dashboard' | 'settings' | 'wall'
  const paging = usePaging()
  const [pagingOpen, setPagingOpen] = useState(false)

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

  if (view === 'settings') {
    return (
      <div style={{ height:'100%', background:'var(--bg)', overflow:'hidden' }}>
        <SettingsPage onClose={() => setView('dashboard')}/>
      </div>
    )
  }

  if (view === 'wall') {
    return <WallDashboard devices={devices} energy={energy} roomsMeta={roomsMeta} onClose={() => setView('dashboard')}/>
  }

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', background:'var(--bg)', overflow:'hidden' }}>
      <Toast />
      <IncomingCall />
      <PagingPanel {...paging} open={pagingOpen} setOpen={setPagingOpen} anchorTop />
      <Header connection={connection} connected={connected} onLock={lock} onOpenSettings={() => setView('settings')} onOpenWall={() => setView('wall')}
        pagingRoomCount={paging.rooms.length} onTogglePaging={() => setPagingOpen(o => !o)} />

      <div style={{ flex:1, paddingTop:56, overflow:'hidden', display:'flex', flexDirection:'column' }}>
        <PlatformBar platforms={platforms} />
        <SceneStrip scenes={scenes} runScene={runScene} />
        {devices.length === 0 && !energy
          ? <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text3)', fontSize:13 }}>Loading…</div>
          : <DeviceList devices={devices} energy={energy} roomsMeta={roomsMeta} onToggleRelay={toggleRelay} />
        }
      </div>
    </div>
  )
}
