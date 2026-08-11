import { useEffect, useState } from 'react'
import { SettingsCard, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { CameraIcon } from '../../Icons'
import { gt } from '../../../i18n'

export default function AeotecSection({ reload }) {
  const [name, setName] = useState('')
  const [ip, setIp] = useState('')
  const [user, setUser] = useState('admin')
  const [pass, setPass] = useState('')
  const [token, setToken] = useState(null)
  const [tokenMeta, setTokenMeta] = useState('')
  const test = useSettingsSave('/api/settings/test-aeotec')
  const add = useSettingsSave('')

  useEffect(() => {
    fetch('/api/settings/smartthings-token', { credentials: 'include' }).then(r => r.json()).then(d => {
      if (d.success) {
        setToken(d.token)
        if (d.deliveredAt) setTokenMeta(`Delivered ${new Date(d.deliveredAt).toLocaleString()} — refreshed automatically every 24h.`)
      } else setToken('Not available')
    }).catch(() => setToken('Not available'))
  }, [])

  const cred = pass ? `${user}:${pass}@` : `${user}@`
  const rtsp = ip ? `rtsp://${cred}${ip}:554/stream1` : ''
  const rtspSub = ip ? `rtsp://${cred}${ip}:554/stream2` : ''
  const snapshot = ip ? `http://${cred}${ip}/snapshot.jpg` : ''

  const addToCameras = async () => {
    if (!ip) return
    try {
      const camsRes = await fetch('/api/cameras', { credentials: 'include' })
      const { data } = await camsRes.json()
      const existing = (data || []).filter(c => !c._smartthings)
      const filtered = existing.filter(c => !c.url?.includes(ip) && !c.snapshotUrl?.includes(ip))
      filtered.push({ name: name || `Aeotec ${ip}`, url: rtsp, snapshotUrl: snapshot, mjpegUrl: '', webrtcUrl: '' })
      await add.save(filtered, { endpoint: '/api/settings/cameras' })
      reload?.()
    } catch (err) { add.setResult({ ok: false, message: err.message }) }
  }

  return (
    <SettingsCard icon={CameraIcon} title="Aeotec 360 Camera" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Add an Aeotec Indoor Camera 360° by local IP. Sensor data (motion, sound) flows via SmartThings; the local RTSP stream is added to your Cameras list for live video.">
      <div className="stg-field">
        <label>SmartThings API Token</label>
        <div className="stg-token-value-box">
          <code>{token ?? 'Loading…'}</code>
          {token && token !== 'Not available' &&
            <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(token)}>{gt('common.copy', 'Copy')}</Button>}
        </div>
        {tokenMeta && <span className="stg-hint">{tokenMeta}</span>}
      </div>
      <Field label="Camera Name" value={name} onChange={setName} placeholder="Living Room"/>
      <Field label="Camera IP Address" value={ip} onChange={setIp} placeholder="192.168.x.x"/>
      <Field label="Username" hint="(default: admin)" value={user} onChange={setUser}/>
      <Field label="Password" type="password" value={pass} onChange={setPass}/>

      {ip && (
        <div className="stg-import-preview">
          <div className="stg-import-kv"><span>RTSP (main stream)</span><strong>{rtsp}</strong></div>
          <div className="stg-import-kv"><span>RTSP (sub stream)</span><strong>{rtspSub}</strong></div>
          <div className="stg-import-kv"><span>Snapshot URL</span><strong>{snapshot}</strong></div>
        </div>
      )}

      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy} onClick={() => test.save({ ip, username: user, password: pass })}>{gt('common.test', 'Test Connection')}</Button>
        <Button variant="primary" busy={add.busy} onClick={addToCameras} disabled={!ip}>Add to Cameras</Button>
        <ResultBanner result={test.result || add.result}/>
      </div>
    </SettingsCard>
  )
}
