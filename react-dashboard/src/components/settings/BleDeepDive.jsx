import { useEffect, useState } from 'react'
import { Button } from './primitives'
import Sparkline from '../Sparkline'

// Deep dive on one BLE device (POST /api/lsh-ble/inspect): watches its
// advertisements for a few seconds, shows everything BlueZ knows, decodes
// known formats, and optionally connects to read GATT (read-only).
export default function BleDeepDive({ mac }) {
  const [state, setState] = useState({ busy: true, data: null, error: null })
  const [gatt, setGatt] = useState({ busy: false, data: null, error: null })

  const inspect = async (withGatt) => {
    const r = await fetch('/api/lsh-ble/inspect', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mac, seconds: 8, gatt: withGatt }),
    }).then((x) => x.json()).catch((e) => ({ success: false, error: e.message }))
    return r
  }

  useEffect(() => {
    let alive = true
    inspect(false).then((r) => alive && setState({ busy: false, data: r.success ? r.data : null, error: r.success ? null : r.error }))
    return () => { alive = false }
  }, [mac])

  const readGatt = async () => {
    setGatt({ busy: true, data: null, error: null })
    const r = await inspect(true)
    setGatt({ busy: false, data: r.success ? r.data.gatt : null, error: r.success ? r.data.gatt?.error : r.error })
  }

  if (state.busy) return <div className="ble-dd stg-hint">Watching {mac} for 8 s…</div>
  if (state.error) return <div className="ble-dd"><div className="stg-banner err">✗ {state.error}</div></div>
  const d = state.data
  const points = d.rssi.samples.map((s) => [s.t, s.rssi])

  return (
    <div className="ble-dd">
      <Section title="Identity">
        <KV k="Name" v={d.name}/>
        <KV k="Address" v={`${d.mac} · ${d.addressType || '?'}${d.randomAddress ? ` (${d.randomAddress})` : ''}`}/>
        <KV k="Appearance" v={d.appearance}/>
        <KV k="State" v={[d.connected && 'connected', d.paired && 'paired', d.trusted && 'trusted', d.blocked && 'blocked'].filter(Boolean).join(', ') || 'not connected'}/>
        <KV k="TX power" v={d.txPower != null ? `${d.txPower} dBm` : null}/>
      </Section>

      <Section title={`Signal (${d.watchedSeconds} s)`}>
        <KV k="RSSI" v={d.rssi.current != null ? `${d.rssi.current} dBm · min ${d.rssi.min ?? '–'} / avg ${d.rssi.avg ?? '–'} / max ${d.rssi.max ?? '–'}` : null}/>
        <KV k="Adverts" v={`${d.rssi.advertsPerSecond}/s`}/>
        <KV k="Distance" v={d.rssi.estimatedDistance}/>
        {points.length > 2 && <div style={{ marginTop: 6 }}><Sparkline points={points} height={34} color="var(--green)" gradientId={`ble-${d.mac}`}/></div>}
      </Section>

      {d.services.length > 0 && (
        <Section title="Advertised services">
          {d.services.map((s) => <div key={s} className="ble-dd-mono">{s}</div>)}
        </Section>
      )}

      {d.manufacturerData.map((m) => (
        <Section key={m.id} title={`Manufacturer data · ${m.company || m.id}`}>
          <KV k="Company id" v={m.id}/>
          <KV k="Payload" v={<span className="ble-dd-mono">{m.hex} ({m.length} B{m.variants > 1 ? `, ${m.variants} variants seen` : ''})</span>}/>
          {m.decoded.map((x) => <Decoded key={x.format} x={x}/>)}
        </Section>
      ))}

      {d.serviceData.map((s) => (
        <Section key={s.uuid} title={`Service data · ${s.uuid}`}>
          <KV k="Payload" v={<span className="ble-dd-mono">{s.hex} ({s.length} B{s.variants > 1 ? `, ${s.variants} variants seen` : ''})</span>}/>
          {s.decoded.map((x) => <Decoded key={x.format} x={x}/>)}
        </Section>
      ))}

      <Section title="GATT">
        {!gatt.data && (
          <div className="stg-actions" style={{ marginTop: 0 }}>
            <Button variant="secondary" busy={gatt.busy} onClick={readGatt}>Connect &amp; read GATT</Button>
            <span className="stg-hint">Read-only: connects without pairing, reads, disconnects. Many phones/beacons don't accept connections.</span>
          </div>
        )}
        {gatt.error && <div className="stg-banner err">✗ {gatt.error}</div>}
        {gatt.data?.services?.map((s) => (
          <div key={s.uuid} className="ble-dd-svc">
            <div className="ble-dd-svc-name">{s.uuid}{s.primary ? '' : ' (secondary)'}</div>
            {s.characteristics.map((c) => (
              <div key={c.uuid} className="ble-dd-char">
                <span className="ble-dd-mono">{c.uuid}</span>
                <span className="stg-hint"> [{c.flags.join(', ')}]</span>
                {c.value && (
                  <div className="ble-dd-mono ble-dd-val">
                    {c.value.error ? <span style={{ color: 'var(--orange)' }}>{c.value.error}</span>
                      : <>{c.value.text != null && <b>{c.value.text} </b>}<span className="stg-hint">{c.value.hex}</span></>}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </Section>
    </div>
  )
}

function Section({ title, children }) {
  return <div className="ble-dd-sec"><div className="ble-dd-title">{title}</div>{children}</div>
}

function KV({ k, v }) {
  if (v == null || v === '') return null
  return <div className="ble-dd-kv"><span className="stg-hint">{k}</span><span>{v}</span></div>
}

function Decoded({ x }) {
  return (
    <div className="ble-dd-decoded">
      <div className="ble-dd-fmt">{x.format}</div>
      {Object.entries(x.fields).map(([k, v]) => <KV key={k} k={k} v={v == null ? '—' : String(v)}/>)}
      {x.note && <div className="stg-hint">{x.note}</div>}
    </div>
  )
}
