import { useEffect, useRef, useState } from 'react'
import { SettingsCard, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { gt } from '../../../i18n'

// Mirrors the vanilla page's approach exactly (public/settings.html loads the
// same CDN script) rather than adding a new npm dependency just for this one
// QR code.
const QRCODEJS_SRC = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js'
let qrcodejsPromise = null
function loadQrcodejs() {
  if (window.QRCode) return Promise.resolve()
  if (!qrcodejsPromise) {
    qrcodejsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = QRCODEJS_SRC
      s.onload = resolve
      s.onerror = () => reject(new Error('Failed to load QR library'))
      document.head.appendChild(s)
    })
  }
  return qrcodejsPromise
}

export default function HomeKitSection({ config, reload }) {
  const [pin, setPin] = useState(config.homekit?.pin || '')
  const [port, setPort] = useState(config.homekit?.port || 47128)
  const [username, setUsername] = useState(config.homekit?.username || '')
  const [setupId, setSetupId] = useState('')
  const [qrError, setQrError] = useState('')
  const qrRef = useRef(null)
  const save = useSettingsSave('/api/settings')

  useEffect(() => {
    let cancelled = false
    fetch('/api/homekit/setup-uri', { credentials: 'include' }).then(r => r.json()).then(async d => {
      if (!d.success || cancelled) return
      setSetupId(d.data.setupID)
      try {
        await loadQrcodejs()
        if (cancelled || !qrRef.current) return
        qrRef.current.innerHTML = ''
        // eslint-disable-next-line no-undef
        new window.QRCode(qrRef.current, {
          text: d.data.uri, width: 180, height: 180,
          colorDark: '#e6edf3', colorLight: '#161b22', correctLevel: window.QRCode.CorrectLevel.M,
        })
      } catch (err) { setQrError(err.message) }
    }).catch(err => setQrError(err.message))
    return () => { cancelled = true }
  }, [])

  return (
    <SettingsCard title={gt('s.hk_title', 'HomeKit Integration')}
      desc={gt('sdesc.d35', 'Pair the relay bridge in Apple Home using the PIN below.')}>
      <Field label={gt('s.hk_pin', 'Pairing PIN')} value={pin} onChange={setPin} placeholder="031-45-154" maxLength={10}/>
      <Field label={gt('s.hk_port', 'Bridge Port')} type="number" value={port} onChange={setPort} placeholder="47128"/>
      <Field label={gt('s.hk_username', 'Bridge MAC')} value={username} onChange={setUsername} placeholder="CC:22:3D:E3:CE:F6"/>

      <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
        <div ref={qrRef} style={{ width: 180, height: 180, background: '#161b22', borderRadius: 12, flexShrink: 0 }}/>
        <div>
          <div className="stg-hint" style={{ textTransform: 'uppercase', fontWeight: 700, fontSize: 11 }}>{gt('s.hk_pin_code', 'PIN Code')}</div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '0.05em' }}>{pin || '--'}</div>
          <p className="stg-hint" style={{ marginTop: 10 }}>Scan with iPhone Camera or open <strong>Home → Add Accessory</strong> and scan this code.</p>
          <p className="stg-hint" style={{ marginTop: 6 }}>Or choose <strong>More Options</strong> and enter the PIN manually.</p>
          {setupId && <p className="stg-hint">Setup ID: {setupId}</p>}
          {qrError && <p className="stg-banner err">QR error: {qrError}</p>}
        </div>
      </div>

      <div className="stg-actions">
        <Button variant="primary" busy={save.busy}
          onClick={() => save.save({ homekit: { pin, port: Number(port), username } }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}
