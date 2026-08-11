import { useEffect, useState } from 'react'
import { SettingsCard, Field, Toggle, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { CameraIcon } from '../../Icons'
import { gt } from '../../../i18n'

export default function CamerasExtraSection({ config, reload }) {
  return (
    <>
      <UniFiCard unifi={config.unifi} reload={reload}/>
      <FFmpegRtspCard ffmpegRtsp={config.ffmpegRtsp} reload={reload}/>
    </>
  )
}

function UniFiCard({ unifi, reload }) {
  const [host, setHost] = useState(unifi?.host || '')
  const [apiKey, setApiKey] = useState(unifi?.apiKey || '')
  const [username, setUsername] = useState(unifi?.username || '')
  const [password, setPassword] = useState(unifi?.password || '')
  const test = useSettingsSave('/api/settings/test-unifi')
  const save = useSettingsSave('/api/settings/unifi')
  const payload = () => ({ host, apiKey, username, password })

  return (
    <SettingsCard icon={CameraIcon} title={gt('s.unifi_title', 'UniFi Protect')} badge={{ label: gt('common.optional', 'Optional') }}
      desc={gt('sdesc.d13', 'Auto-discovers cameras and sensors (door, motion, temperature, humidity) from a UniFi Dream Machine or UNVR.')}>
      <Field label={gt('s.unifi_host', 'Console Host / IP')} value={host} onChange={setHost} placeholder="192.168.1.1"/>
      <Field label={gt('s.unifi_apikey', 'API Key')} hint={gt('s.unifi_apikey_hint', '(preferred — UniFi OS → Control Plane → API Keys)')} type="password" value={apiKey} onChange={setApiKey}/>
      <Field label={gt('s.unifi_user', 'Username')} hint={gt('s.unifi_user_hint', '(fallback when no API key)')} value={username} onChange={setUsername}/>
      <Field label={gt('s.unifi_pass', 'Password')} type="password" value={password} onChange={setPassword}/>
      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy} onClick={() => test.save(payload())}>{gt('common.test', 'Test Connection')}</Button>
        <Button variant="primary" busy={save.busy} onClick={() => save.save(payload()).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={test.result || save.result}/>
      </div>
    </SettingsCard>
  )
}

function FFmpegRtspCard({ ffmpegRtsp, reload }) {
  const [enabled, setEnabled] = useState(!!ffmpegRtsp?.enabled)
  const [basePort, setBasePort] = useState(ffmpegRtsp?.basePort || 8554)
  const [ffmpegPath, setFfmpegPath] = useState(ffmpegRtsp?.ffmpegPath || 'ffmpeg')
  const [streams, setStreams] = useState(null)
  const save = useSettingsSave('/api/settings/ffmpeg-rtsp')

  const loadStreams = () => fetch('/api/rtsp-proxy', { credentials: 'include' }).then(r => r.json())
    .then(d => setStreams(d.enabled && d.streams?.length ? d.streams : null)).catch(() => {})
  useEffect(() => { if (enabled) loadStreams() }, [])

  const doSave = () => save.save({ enabled, basePort: Number(basePort), ffmpegPath }).then(res => {
    reload?.()
    if (enabled) loadStreams()
    return res
  })

  return (
    <SettingsCard title="FFmpeg RTSP Proxy" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Re-streams each camera's RTSP URL through a built-in RTSP server so Loxone (or any RTSP client) can connect to a single clean URL. Requires ffmpeg installed on the server.">
      <Toggle label="Enable RTSP Proxy" checked={enabled} onChange={setEnabled}/>
      <Field label="Base Port" type="number" value={basePort} onChange={setBasePort} placeholder="8554"/>
      <Field label="FFmpeg Path" hint="(leave as ffmpeg if it's on your PATH)" value={ffmpegPath} onChange={setFfmpegPath} placeholder="ffmpeg"/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} onClick={doSave}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result}/>
      </div>
      {streams && (
        <div className="stg-import-preview">
          <div className="stg-import-preview-title"><span>RTSP URLs for Loxone</span></div>
          {streams.map((s, i) => (
            <div className="stg-import-kv" key={i}>
              <span>{s.name} {s.active ? '● Live' : '◌ Waiting'}</span>
              <strong>rtsp://&lt;host&gt;:{s.port}/{s.slug}</strong>
            </div>
          ))}
        </div>
      )}
    </SettingsCard>
  )
}
