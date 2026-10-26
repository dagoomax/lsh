import { useEffect, useState } from 'react'
import { SettingsCard, ListEditor, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { gt, tr } from '../../../i18n'

// Settings → UniFi Access (doors) and Settings → UniFi Play (audio).
// Server: src/unifi-access-client.js, src/unifi-play-client.js (each in its
// own process), src/routes/unifi-access.js.

const useStatus = (url) => {
  const [status, setStatus] = useState(null)
  const load = () => fetch(url, { credentials: 'include' }).then((r) => r.json()).then((j) => setStatus(j.data || null)).catch(() => {})
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t) }, [url])
  return [status, load]
}

const ruleLabel = (r) => ({ keep_lock: tr('Keep locked'), keep_unlock: tr('Keep unlocked'), custom: tr('Unlocked for a while'), schedule: tr('Unlock schedule'), lock_early: tr('Locked early') })[r] || null

export default function UnifiAccessSection({ config, reload }) {
  const a = config.unifiAccess || {}
  const [host, setHost] = useState(a.host || config.unifi?.host || '')
  const [apiKey, setApiKey] = useState(a.apiKey || '')
  const [status, load] = useStatus('/api/unifi-access/status')
  const save = useSettingsSave('/api/settings/unifi-access')
  const test = useSettingsSave('/api/unifi-access/test')
  const doSave = () => save.save({ host, apiKey }).then(() => { setTimeout(load, 4000); reload?.() }).catch(() => {})
  const doors = status?.doors || []

  return (
    <SettingsCard title="UniFi Access" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Doors of UniFi Access (UA Hub, Ultra, Gate, Intercom, readers) through the console's local API on port 12445. Every door becomes a device: door open/closed, lock (unlock = one remote unlock, lock = lock now), doorbell, keep unlocked, keep locked, unlock for N minutes and who opened it last. Lockdown and evacuation switch every door at once. Rings and door changes arrive live. Create the token in UniFi Access: Settings → General → Advanced → API Token, with the door, device and system log permissions.">
      <Field label="Console address" placeholder="192.168.1.1" value={host} onChange={setHost}/>
      <Field label="API token" type="password" value={apiKey} onChange={setApiKey}/>

      {doors.length > 0 && <>
        <h4 className="stg-subheading">{tr('Doors')}</h4>
        <div className="stg-mod-list">
          {doors.map((d) => (
            <div key={d.key} className="stg-mod-row">
              <div className="stg-mod-main">
                <div className="stg-mod-name">
                  {d.label}
                  {d.contact != null && <span className={`stg-mod-chip ${d.contact ? 'warn' : 'ok'}`}>{d.contact ? tr('open') : tr('closed')}</span>}
                  {d.lock != null && <span className={`stg-mod-chip ${d.lock ? 'ok' : 'warn'}`}>{d.lock ? tr('locked') : tr('unlocked')}</span>}
                </div>
                <div className="stg-hint stg-mod-meta">
                  {[ruleLabel(d.lockRule), d.lastAccess ? tr('Last: {x}', { x: d.lastAccess }) : null].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
            </div>
          ))}
        </div>
        {(status.lockdown || status.evacuation) ? <p className="stg-hint" style={{ color: 'var(--red, #e74c3c)' }}>{status.lockdown ? tr('Lockdown is on') : tr('Evacuation is on')}</p> : null}
      </>}

      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy} onClick={() => test.save({ host, apiKey }).catch(() => {})}>{tr('Test connection')}</Button>
        <Button variant="primary" busy={save.busy} onClick={doSave}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result || test.result}/>
      </div>
    </SettingsCard>
  )
}

const SPEAKER_FIELDS = [
  { key: 'name', label: 'Name', placeholder: 'Kitchen' },
  { key: 'host', label: 'IP address', placeholder: '192.168.1.60' },
]

export function UnifiPlaySection({ config, reload }) {
  const p = config.unifiPlay || {}
  const [host, setHost] = useState(p.host || config.unifi?.host || '')
  const [apiKey, setApiKey] = useState(p.apiKey || '')
  const [devices, setDevices] = useState(p.devices || [])
  const [certFile, setCert] = useState(p.mqtt?.certFile || '')
  const [keyFile, setKey] = useState(p.mqtt?.keyFile || '')
  const [status, load] = useStatus('/api/unifi-play/status')
  const save = useSettingsSave('/api/settings/unifi-play')
  const test = useSettingsSave('/api/unifi-play/test')
  const doSave = () => save.save({ host, apiKey, devices, certFile, keyFile }).then(() => { setTimeout(load, 4000); reload?.() }).catch(() => {})
  const list = status?.devices || []

  return (
    <SettingsCard title="UniFi Play" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Ubiquiti's audio: PowerAmp, PoE Audio Port and other UniFi Play devices. With the console's API key (UniFi OS → Control Plane → Integrations) LSH reads each device's volume, input, streaming service and what's playing. Volume, mute, input, play/pause/next and locate need control over each device's own MQTT connection, which accepts only a client certificate signed by Ubiquiti — LSH doesn't include one; give the paths of the certificate and key files on the LSH host. Ubiquiti has no public API for UniFi Play, so this can stop working after a firmware update. To play announcements or chimes on them, add them under AirPlay Speakers.">
      <Field label="Console address" placeholder="192.168.1.1" value={host} onChange={setHost}/>
      <Field label="Console API key" type="password" value={apiKey} onChange={setApiKey}/>
      <h4 className="stg-subheading">{tr('Control (MQTT)')}</h4>
      <Field label="Client certificate file" placeholder="/home/lsh/unifi-play/client.crt" value={certFile} onChange={setCert}/>
      <Field label="Client key file" placeholder="/home/lsh/unifi-play/client.key" value={keyFile} onChange={setKey}/>
      <p className="stg-hint">{tr('Speakers without a console, or a PoE Audio Port the console lists without an address, can be added by IP:')}</p>
      <ListEditor rows={devices} onChange={setDevices} fields={SPEAKER_FIELDS} addLabel="Add speaker"/>

      {list.length > 0 && <>
        <h4 className="stg-subheading">{tr('Devices')}</h4>
        <div className="stg-mod-list">
          {list.map((d) => (
            <div key={d.key} className="stg-mod-row">
              <div className="stg-mod-main">
                <div className="stg-mod-name">
                  {d.label}
                  <span className={`stg-mod-chip ${d.online ? 'ok' : 'warn'}`}>{d.online ? (d.playing ? tr('playing') : tr('online')) : tr('offline')}</span>
                </div>
                <div className="stg-hint stg-mod-meta">
                  {[d.model, d.volume != null ? tr('volume {x}%', { x: d.volume }) : null, d.source || null, d.title ? [d.title, d.artist].filter(Boolean).join(' — ') : null].filter(Boolean).join(' · ')}
                </div>
              </div>
            </div>
          ))}
        </div>
        {!status.control && <p className="stg-hint">{tr('Read-only — add the client certificate to control them.')}</p>}
      </>}

      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy} onClick={() => test.save({ host, apiKey }).catch(() => {})}>{tr('Test connection')}</Button>
        <Button variant="primary" busy={save.busy} onClick={doSave}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result || test.result}/>
      </div>
    </SettingsCard>
  )
}
