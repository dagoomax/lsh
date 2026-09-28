import { useState } from 'react'
import { SettingsCard, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { CameraIcon } from '../../Icons'
import { gt } from '../../../i18n'

export default function YaleSection({ config, reload }) {
  const yale = config.yale || {}
  const [username, setUsername] = useState(yale.username || '')
  const [password, setPassword] = useState(yale.password || '')
  const [loginMethod, setLoginMethod] = useState(yale.loginMethod || 'email')
  const [pollInterval, setPollInterval] = useState(yale.pollInterval ?? 30)
  const [code, setCode] = useState('')
  const [needsCode, setNeedsCode] = useState(false)

  const test = useSettingsSave('/api/settings/test-yale')
  const verify = useSettingsSave('/api/settings/verify-yale')
  const save = useSettingsSave('/api/settings/yale')
  const payload = () => ({ username, password, loginMethod, pollInterval: Number(pollInterval) })

  return (
    <SettingsCard icon={CameraIcon} title="Yale Doorbell Cameras" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Yale Access / Yale Connect doorbell cameras (the ex-August-made line) — not the Yale Sync alarm hub and not the generic 'Yale View' NVR app, which are separate, unrelated apps/backends. Each doorbell gets a Status, Online, and Battery sensor plus a snapshot image. No live RTSP stream — this is a cloud snapshot API, not a local one.">
      <Field label="Login Method" type="select" value={loginMethod} onChange={setLoginMethod}
        options={[{ value: 'email', label: 'Email' }, { value: 'phone', label: 'Phone' }]}/>
      <Field label={loginMethod === 'phone' ? 'Phone Number' : 'Email'} value={username} onChange={setUsername}
        placeholder={loginMethod === 'phone' ? '+1234567890' : 'you@example.com'}/>
      <Field label="Password" type="password" value={password} onChange={setPassword}/>
      <Field label="Poll Interval" hint="(seconds, min 10)" type="number" value={pollInterval} onChange={setPollInterval}/>

      <div className="stg-hint" style={{ marginBottom: 8 }}>
        {gt('sdesc.yale_hint', 'First-time setup needs a one-time verification code from Yale — click "Test Connection" below to send it, then enter it and click "Verify".')}
      </div>

      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy} onClick={() => {
          setNeedsCode(false)
          test.save(payload()).then((data) => { if (data.requiresVerification) setNeedsCode(true) }).catch(() => {})
        }}>{gt('common.test', 'Test Connection')}</Button>
        <Button variant="primary" busy={save.busy} onClick={() => save.save(payload()).then(reload)}>{gt('common.save', 'Save')}</Button>
      </div>
      <ResultBanner result={test.result || save.result}/>

      {needsCode && (
        <>
          <Field label="Verification Code" value={code} onChange={setCode} placeholder="123456"/>
          <div className="stg-actions">
            <Button variant="secondary" busy={verify.busy}
              onClick={() => verify.save({ ...payload(), code }).then(() => setNeedsCode(false)).catch(() => {})}>
              {gt('common.verify', 'Verify')}
            </Button>
          </div>
          <ResultBanner result={verify.result}/>
        </>
      )}
    </SettingsCard>
  )
}
