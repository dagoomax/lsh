function Toggle({ on, onChange }) {
  return (
    <div onClick={() => onChange(!on)} style={{
      width:42, height:24, borderRadius:12,
      background: on ? 'var(--purple)' : 'rgba(255,255,255,0.12)',
      position:'relative', cursor:'pointer',
      transition:'background 0.2s', flexShrink:0,
      boxShadow: on ? '0 0 10px rgba(124,58,237,0.5)' : 'none',
    }}>
      <div style={{
        position:'absolute', width:18, height:18, borderRadius:'50%',
        background:'#fff', top:3, left:3,
        boxShadow:'0 1px 4px rgba(0,0,0,0.5)',
        transition:'transform 0.2s cubic-bezier(0.4,0,0.2,1)',
        transform: on ? 'translateX(18px)' : 'none',
      }}/>
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
          <span style={{ fontSize:13, fontWeight:600 }}>Relay Control</span>
        </div>
        <span className={`badge ${activeCount>0?'badge-purple':'badge-gray'}`}>{activeCount} on</span>
      </div>

      {(!relays||relays.length===0) && (
        <div style={{ color:'var(--text3)', fontSize:12, textAlign:'center', padding:'8px 0' }}>
          No relays configured
        </div>
      )}

      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        {relays?.map(r => (
          <div key={r.index} style={{
            display:'flex', alignItems:'center', justifyContent:'space-between',
            padding:'10px 12px', borderRadius:10,
            background: r.on ? 'rgba(124,58,237,0.12)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${r.on ? 'rgba(124,58,237,0.25)' : 'var(--border)'}`,
            transition:'all 0.2s',
          }}>
            <div>
              <div style={{ fontSize:13, fontWeight:500, color: r.on ? 'var(--text)' : 'var(--text2)' }}>
                {r.name}
              </div>
              <div style={{ fontSize:11, marginTop:1,
                color: r.on ? 'var(--purple-lt)' : 'var(--text3)' }}>
                {r.on ? '● Active' : 'Inactive'}
              </div>
            </div>
            <Toggle on={r.on} onChange={state => onToggle(r.index, state)} />
          </div>
        ))}
      </div>
    </div>
  )
}
