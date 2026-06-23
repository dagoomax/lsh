function Toggle({ on, onChange }) {
  return (
    <div onClick={()=>onChange(!on)} style={{
      width:51, height:31, borderRadius:16,
      background: on ? 'var(--green)' : 'var(--bg4)',
      position:'relative', cursor:'pointer',
      transition:'background 0.2s', flexShrink:0,
    }}>
      <div style={{
        position:'absolute', width:27, height:27, borderRadius:'50%',
        background:'#fff', top:2, left:2,
        boxShadow:'0 2px 6px rgba(0,0,0,0.45)',
        transition:'transform 0.2s cubic-bezier(0.4,0,0.2,1)',
        transform: on ? 'translateX(20px)' : 'none',
      }}/>
    </div>
  )
}

export default function RelayPanel({ relays, onToggle }) {
  const activeCount = relays?.filter(r=>r.on).length ?? 0
  return (
    <div style={{ padding:'14px 20px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
        <span style={{ fontSize:13, fontWeight:600, letterSpacing:'-0.2px' }}>Relay Control</span>
        <span className={`badge ${activeCount>0?'badge-green':'badge-gray'}`}>{activeCount} on</span>
      </div>
      {(!relays||relays.length===0) && (
        <div style={{ color:'var(--text3)', fontSize:13 }}>No relays configured</div>
      )}
      {relays?.map((r,i) => (
        <div key={r.index}>
          {i>0 && <div style={{ height:1, background:'var(--sep)', margin:'10px 0' }}/>}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <div>
              <div style={{ fontSize:14, fontWeight:500 }}>{r.name}</div>
              <div style={{ fontSize:11, color:r.on?'var(--green)':'var(--text3)', marginTop:1 }}>
                {r.on ? '● On' : 'Off'}
              </div>
            </div>
            <Toggle on={r.on} onChange={state=>onToggle(r.index,state)}/>
          </div>
        </div>
      ))}
    </div>
  )
}
