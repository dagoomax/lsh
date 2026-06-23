import './styles/global.css'
import { useLSH } from './hooks/useLSH'
import Header     from './components/Header'
import EnergyFlow from './components/EnergyFlow'
import RelayPanel from './components/RelayPanel'
import DeviceList from './components/DeviceList'

function LastUpdate({ ts }) {
  if (!ts) return null
  const t = ts.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'})
  return (
    <div style={{ fontSize:11, color:'var(--text3)', textAlign:'right', padding:'4px 20px 0' }}>
      Updated {t}
    </div>
  )
}

export default function App() {
  const { energy, devices, connection, connected, lastUpdate, toggleRelay } = useLSH()

  return (
    <div style={{ height:'100vh', display:'flex', flexDirection:'column', background:'var(--bg)' }}>
      <Header connection={connection} connected={connected} />

      <div style={{ flex:1, display:'flex', paddingTop:52, overflow:'hidden' }}>

        {/* LEFT — Energy */}
        <div style={{ width:'56%', display:'flex', flexDirection:'column', gap:10, padding:'12px 6px 12px 12px', overflow:'hidden' }}>

          {/* Energy flow */}
          <div className="card" style={{ flex:1, overflow:'auto' }}>
            {energy
              ? <EnergyFlow energy={energy} />
              : <div style={{ padding:24, color:'var(--text2)', fontSize:13 }}>Loading…</div>
            }
            <LastUpdate ts={lastUpdate} />
          </div>

          {/* Bottom row: relays + quick stats */}
          <div style={{ display:'flex', gap:10, flexShrink:0 }}>
            <div className="card" style={{ flex:1 }}>
              <RelayPanel relays={energy?.relays} onToggle={toggleRelay} />
            </div>

            {/* Solar charger quick stats */}
            {(() => {
              const sc = devices.find(d=>d.type==='solarcharger')
              const r  = sc?.readings || {}
              return sc ? (
                <div className="card" style={{ flex:1, padding:'14px 16px' }}>
                  <div style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text2)', marginBottom:10 }}>
                    Solar Charger
                  </div>
                  {[
                    { label:'Panel voltage', value: r['Pv/V']?.value!=null ? `${Number(r['Pv/V'].value).toFixed(1)} V` : '—' },
                    { label:'Total yield',   value: r['Yield/Total']?.value!=null ? `${Number(r['Yield/Total'].value).toFixed(0)} kWh` : '—' },
                    { label:'State',         value: r.State?.value===2?'Active':r.State?.value===0?'Off':'Idle' },
                  ].map(row=>(
                    <div key={row.label} style={{ display:'flex', justifyContent:'space-between', padding:'4px 0', borderBottom:'1px solid var(--sep)', fontSize:13 }}>
                      <span style={{ color:'var(--text2)' }}>{row.label}</span>
                      <span style={{ fontVariantNumeric:'tabular-nums', fontWeight:500 }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              ) : null
            })()}
          </div>
        </div>

        {/* RIGHT — Devices */}
        <div style={{ flex:1, padding:'12px 12px 12px 6px', overflow:'hidden', display:'flex' }}>
          <div className="card" style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column' }}>
            <DeviceList devices={devices} />
          </div>
        </div>
      </div>
    </div>
  )
}
