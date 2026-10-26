import { useEffect, useState } from 'react'
import { SettingsCard, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { gt, tr } from '../../../i18n'

// Settings → Helvar. Server: src/helvar-client.js (own process), src/routes/helvar.js.
export default function HelvarSection({ config, reload }) {
  const h = config.helvar || {}
  const [host, setHost] = useState(h.host || '')
  const [port, setPort] = useState(h.port || 50000)
  const [fade, setFade] = useState(h.fade ?? 1)
  const [pollSeconds, setPoll] = useState(h.pollSeconds || 30)
  const [status, setStatus] = useState(null)
  const save = useSettingsSave('/api/settings/helvar')
  const test = useSettingsSave('/api/helvar/test')

  const load = () => fetch('/api/helvar/status', { credentials: 'include' }).then((r) => r.json()).then((j) => setStatus(j.data || null)).catch(() => {})
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t) }, [])
  const doSave = () => save.save({ host, port, fade, pollSeconds }).then(() => { setTimeout(load, 5000); reload?.() }).catch(() => {})

  const groups = status?.groups || []
  const devices = status?.devices || []
  return (
    <SettingsCard title="Helvar" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Helvar lighting (DALI, Digidim, Imagine) through a Helvar router (905, 910, 920, 950) and its HelvarNet interface, TCP port 50000. LSH reads the groups, scenes and devices programmed in Designer: every group becomes a light with brightness and scene recall (by number, block.scene or name), every ballast, dimmer or relay a light with brightness, power use and lamp-fault alarm, and multisensors give motion and light level. To see changes made from wall panels and sensors at once, set Push Messages to True in Designer (root node → HelvarNet); otherwise LSH picks them up on the next refresh.">
      <Field label="Router IP address" placeholder="10.254.1.1" value={host} onChange={setHost}/>
      <Field label="Port" type="number" value={port} onChange={setPort}/>
      <Field label="Fade time" hint="(s)" type="number" value={fade} onChange={setFade}/>
      <Field label="Refresh every" hint="(s)" type="number" value={pollSeconds} onChange={setPoll}/>

      {groups.length > 0 && <>
        <h4 className="stg-subheading">{tr('Groups')}</h4>
        <div className="stg-mod-list">
          {groups.map((g) => (
            <div key={g.key} className="stg-mod-row">
              <div className="stg-mod-main">
                <div className="stg-mod-name">
                  {g.label}
                  {g.level != null && <span className={`stg-mod-chip ${g.level ? 'ok' : ''}`}>{g.level ? `${g.level}%` : tr('off')}</span>}
                </div>
                <div className="stg-hint stg-mod-meta">
                  {[g.lastScene ? tr('Last scene: {x}', { x: g.lastScene }) : null, g.scenes?.length ? tr('Scenes: {x}', { x: g.scenes.join(', ') }) : null].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </>}
      {devices.length > 0 && <p className="stg-hint">
        {tr('{n} device(s)', { n: devices.length })}
        {devices.some((d) => d.fault) ? ` · ${tr('lamp fault: {x}', { x: devices.filter((d) => d.fault).map((d) => d.label).join(', ') })}` : ''}
      </p>}

      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy} onClick={() => test.save({ host, port }).catch(() => {})}>{tr('Test connection')}</Button>
        <Button variant="primary" busy={save.busy} onClick={doSave}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result || test.result}/>
      </div>
    </SettingsCard>
  )
}
