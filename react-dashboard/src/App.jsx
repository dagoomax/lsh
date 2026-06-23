import './styles/global.css'
import { useLSH } from './hooks/useLSH'
import Header from './components/Header'
import EnergyFlow from './components/EnergyFlow'
import RelayPanel from './components/RelayPanel'
import DeviceList from './components/DeviceList'

export default function App() {
  const { energy, devices, connection, connected, toggleRelay } = useLSH()

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <Header connection={connection} connected={connected} />

      <div style={{ flex: 1, display: 'flex', paddingTop: 52, overflow: 'hidden', gap: 0 }}>

        {/* Left panel — Energy */}
        <div style={{ width: '52%', display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 8px 16px 16px', overflow: 'hidden' }}>

          {/* Energy flow card */}
          <div className="card" style={{ flex: 1 }}>
            {energy
              ? <EnergyFlow energy={energy} />
              : <div style={{ padding: 24, color: 'var(--text2)', fontSize: 13 }}>Loading energy data…</div>
            }
          </div>

          {/* Battery detail strip */}
          {energy?.battery && (
            <div className="card" style={{ padding: '14px 20px' }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text2)', marginBottom: 12 }}>
                Battery Detail
              </div>
              <div style={{ display: 'flex', gap: 0 }}>
                {[
                  { label: 'SoC', value: `${energy.battery.soc ?? '—'} %`, color: 'var(--green)' },
                  { label: 'Voltage', value: `${energy.battery.voltage?.toFixed(1) ?? '—'} V`, color: 'var(--blue)' },
                  { label: 'Current', value: `${energy.battery.current?.toFixed(1) ?? '—'} A`, color: 'var(--orange)' },
                  { label: 'Daily Solar', value: `${energy.solar?.dailyYield?.toFixed(2) ?? '—'} kWh`, color: 'var(--yellow)' },
                ].map((m, i, arr) => (
                  <div key={m.label} style={{
                    flex: 1, textAlign: 'center',
                    borderRight: i < arr.length - 1 ? '1px solid var(--sep)' : 'none',
                    padding: '0 12px',
                  }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: m.color, fontVariantNumeric: 'tabular-nums' }}>{m.value}</div>
                    <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{m.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Relays */}
          <div className="card">
            <RelayPanel relays={energy?.relays} onToggle={toggleRelay} />
          </div>
        </div>

        {/* Right panel — Devices */}
        <div style={{ flex: 1, padding: '16px 16px 16px 8px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div className="card" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <DeviceList devices={devices} />
          </div>
        </div>
      </div>
    </div>
  )
}
