import './styles/global.css'
import { useState } from 'react'
import { useLSH }      from './hooks/useLSH'
import Header          from './components/Header'
import EnergyFlow      from './components/EnergyFlow'
import RelayPanel      from './components/RelayPanel'
import DeviceList, { Toast } from './components/DeviceList'
import { GridPowerIcon, HomeIcon, BulbIcon } from './components/Icons'

// ── Bottom tab bar (mobile only) ─────────────────────────────────────────────
function TabBar({ tab, setTab }) {
  const tabs = [
    { id:'devices', label:'Devices', Icon:HomeIcon },
    { id:'energy',  label:'Energy',  Icon:GridPowerIcon },
  ]
  return (
    <div style={{
      display:'flex',
      background:'rgba(13,14,26,0.96)',
      backdropFilter:'blur(20px)',
      WebkitBackdropFilter:'blur(20px)',
      borderTop:'1px solid rgba(124,58,237,0.15)',
      paddingBottom:'env(safe-area-inset-bottom)',
      flexShrink:0,
    }}>
      {tabs.map(({ id, label, Icon }) => {
        const active = tab === id
        return (
          <button key={id} onClick={() => setTab(id)} style={{
            flex:1, display:'flex', flexDirection:'column', alignItems:'center',
            gap:3, padding:'10px 0', border:'none', background:'none', cursor:'pointer',
            color: active ? 'var(--purple-lt)' : 'var(--text3)',
            transition:'color 0.15s',
          }}>
            <Icon size={22} color={active ? 'var(--purple-lt)' : 'var(--text3)'} />
            <span style={{ fontSize:10, fontWeight: active?600:400 }}>{label}</span>
          </button>
        )
      })}
    </div>
  )
}

export default function App() {
  const { energy, devices, connection, connected, lastUpdate, toggleRelay } = useLSH()
  const [mobileTab, setMobileTab] = useState('devices')

  const energyPanel = (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>
      <div style={{
        padding:'12px 16px 8px',
        borderBottom:'1px solid var(--border)',
        display:'flex', alignItems:'center', gap:8, flexShrink:0,
      }}>
        <GridPowerIcon size={15} color="var(--orange)" />
        <span style={{ fontSize:13, fontWeight:700 }}>Energy</span>
        {lastUpdate && (
          <span style={{ fontSize:10, color:'var(--text3)', marginLeft:'auto' }}>
            {lastUpdate.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
          </span>
        )}
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:'12px 14px' }}>
        {energy
          ? <EnergyFlow energy={energy} />
          : <div style={{ padding:20, color:'var(--text3)', fontSize:13, textAlign:'center' }}>Loading…</div>
        }
        {energy?.relays && (
          <div style={{
            marginTop:12, marginBottom:12,
            background:'var(--card)', border:'1px solid var(--border)',
            borderRadius:'var(--radius-lg)',
          }}>
            <RelayPanel relays={energy.relays} onToggle={toggleRelay} />
          </div>
        )}
      </div>
    </div>
  )

  const devicesPanel = (
    <div style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column' }}>
      {devices.length === 0
        ? <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text3)', fontSize:13 }}>Loading devices…</div>
        : <DeviceList devices={devices} />
      }
    </div>
  )

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', background:'var(--bg)', overflow:'hidden' }}>
      <Toast />
      <Header connection={connection} connected={connected} />

      {/* ── Desktop layout (≥768px): side by side ── */}
      <div className="layout-desktop" style={{ flex:1, display:'flex', paddingTop:56, overflow:'hidden' }}>
        {devicesPanel}
        <div style={{
          width:'45%', flexShrink:0,
          borderLeft:'1px solid var(--border)',
          overflow:'hidden', display:'flex', flexDirection:'column',
        }}>
          {energyPanel}
        </div>
      </div>

      {/* ── Mobile layout (<768px): tabs ── */}
      <div className="layout-mobile" style={{ flex:1, paddingTop:56, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <div style={{ flex:1, overflow:'hidden', display: mobileTab==='devices' ? 'flex' : 'none', flexDirection:'column' }}>
          {devicesPanel}
        </div>
        <div style={{ flex:1, overflow:'hidden', display: mobileTab==='energy' ? 'flex' : 'none', flexDirection:'column' }}>
          {energyPanel}
        </div>
        <TabBar tab={mobileTab} setTab={setMobileTab} />
      </div>
    </div>
  )
}
