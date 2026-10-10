import { useEffect, useState, lazy, Suspense } from 'react'
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
import CssEditorPage         from './components/CssEditorPage'
import ClaudeCodePage        from './components/ClaudeCodePage'
import SetupScreen           from './components/SetupScreen'
const TerminalPage = lazy(() => import('./components/TerminalPage'))
const LogsPage  = lazy(() => import('./components/pages/LogsPage'))
const MqttPage  = lazy(() => import('./components/pages/MqttPage'))
const FlowsPage = lazy(() => import('./components/pages/FlowsPage'))
const MusicPage = lazy(() => import('./components/pages/MusicPage'))

// Full-screen views, each with its own URL under /react/ (the server serves
// index.html for every /react/* path) so they can be bookmarked and the
// browser back button works.
const VIEWS = ['dashboard', 'settings', 'wall', 'css-editor', 'claude-code', 'terminal', 'logs', 'mqtt', 'flows', 'music']
const viewFromPath = () => {
  const seg = window.location.pathname.replace(/^\/react\/?/, '').split('/')[0]
  return VIEWS.includes(seg) ? seg : 'dashboard'
}

// Single unified view: the "Rooms & Categories" device browser with the
// Energy flow + relays rendered as the top section (see DeviceList). No more
// split screen between devices and energy.
export default function App() {
  const { energy, devices, connection, connected, platforms, roomsMeta, toggleRelay, authRequired, setupRequired, onLogin, scenes, runScene } = useLSH()
  const [locked, setLocked] = useState(() => localStorage.getItem('lsh-locked') === '1')
  const lock   = () => { localStorage.setItem('lsh-locked', '1'); setLocked(true) }
  const unlock = () => { localStorage.setItem('lsh-locked', '0'); setLocked(false) }
  const [view, setViewState] = useState(viewFromPath)
  const setView = (v) => {
    setViewState(v)
    const path = v === 'dashboard' ? '/react/' : `/react/${v}`
    if (window.location.pathname !== path) window.history.pushState({}, '', path)
  }
  useEffect(() => {
    const onPop = () => setViewState(viewFromPath())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const paging = usePaging()
  const [pagingOpen, setPagingOpen] = useState(false)

  // Re-render the whole tree when the language changes (gt() reads it live)
  const [, setLangTick] = useState(0)
  useEffect(() => {
    const bump = () => setLangTick(t => t + 1)
    window.addEventListener('lsh-lang-changed', bump)
    return () => window.removeEventListener('lsh-lang-changed', bump)
  }, [])

  if (setupRequired) {
    return <SetupScreen onDone={() => window.location.reload()}/>
  }

  if (authRequired) {
    return <LoginScreen onLogin={onLogin}/>
  }

  if (locked) {
    return <LockScreen onUnlock={unlock}/>
  }

  if (view === 'settings') {
    return (
      <div style={{ height:'100%', background:'var(--bg)', overflow:'hidden' }}>
        <SettingsPage onClose={() => setView('dashboard')} onOpenCssEditor={() => setView('css-editor')}/>
      </div>
    )
  }

  if (view === 'css-editor') {
    return (
      <div style={{ height:'100%', background:'var(--bg)', overflow:'hidden' }}>
        <CssEditorPage onClose={() => setView('dashboard')}/>
      </div>
    )
  }

  if (view === 'claude-code') {
    return (
      <div style={{ height:'100%', background:'var(--bg)', overflow:'hidden' }}>
        <ClaudeCodePage onClose={() => setView('dashboard')}/>
      </div>
    )
  }

  if (view === 'terminal') {
    return (
      <div style={{ height:'100%', background:'var(--bg)', overflow:'hidden' }}>
        <Suspense fallback={<div style={{ padding: 24, color: 'var(--text3)' }}>Loading…</div>}>
          <TerminalPage onClose={() => setView('dashboard')}/>
        </Suspense>
      </div>
    )
  }

  const ToolPage = { logs: LogsPage, mqtt: MqttPage, flows: FlowsPage, music: MusicPage }[view]
  if (ToolPage) {
    return (
      <div style={{ height:'100%', background:'var(--bg)', overflow:'hidden' }}>
        <Suspense fallback={<div style={{ padding: 24, color: 'var(--text3)' }}>Loading…</div>}>
          <ToolPage onClose={() => setView('dashboard')}/>
        </Suspense>
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
        onOpenCssEditor={() => setView('css-editor')} onOpenClaudeCode={() => setView('claude-code')} onOpenTerminal={() => setView('terminal')}
        onOpenView={setView}
        pagingRoomCount={paging.rooms.length} pagingMessageCount={paging.messages.length} onTogglePaging={() => setPagingOpen(o => !o)} />

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
