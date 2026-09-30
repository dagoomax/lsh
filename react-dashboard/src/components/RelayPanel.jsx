import { gt } from '../i18n'
function Toggle({ on, onChange }) {
  // Visuals: .ios-switch in global.css (padding/margin widen the tap target)
  return (
    <div role="switch" aria-checked={on} data-on={String(on)}
      onClick={e => { e.stopPropagation(); onChange(!on) }}
      style={{ padding:8, margin:-8, cursor:'pointer', WebkitTapHighlightColor:'transparent' }}>
      <div className="ios-switch" data-on={String(on)} />
    </div>
  )
}

export default function RelayPanel({ relays, onToggle }) {
  const activeCount = relays?.filter(r=>r.on).length ?? 0
  return (
    <div style={{ padding:'14px 16px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
        <div style={{ display:'flex', alignItems:'center', gap:7 }}>
          <span style={{ fontSize:16 }}>🔁</span>
          <span style={{ fontSize:13, fontWeight:600 }}>{gt('relay_control', 'Relay Control')}</span>
        </div>
        <span className={`badge ${activeCount>0?'badge-accent':'badge-gray'}`}>{activeCount} {gt('b_on', 'on')}</span>
      </div>

      {(!relays||relays.length===0) && (
        <div style={{ color:'var(--text3)', fontSize:12, textAlign:'center', padding:'8px 0' }}>
          {gt('no_relays', 'No relays configured')}
        </div>
      )}

      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        {relays?.map(r => (
          <div key={r.index} className="relay-row" data-on={String(r.on)}>
            <div>
              <div style={{ fontSize:13, fontWeight:500, color: r.on ? 'var(--text)' : 'var(--text2)' }}>
                {r.name}
              </div>
              <div style={{ fontSize:11, marginTop:1,
                color: r.on ? 'var(--accent-lt)' : 'var(--text3)' }}>
                {r.on ? '● ' + gt('active', 'Active') : gt('inactive', 'Inactive')}
              </div>
            </div>
            <Toggle on={r.on} onChange={state => onToggle(r.index, state)} />
          </div>
        ))}
      </div>
    </div>
  )
}
