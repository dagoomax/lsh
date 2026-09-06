import { useEffect, useState } from 'react'
import { SettingsCard, Field, Button, ResultBanner, Toggle } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { gt } from '../../../i18n'

export default function MatterSection({ config, reload }) {
  const [bridgeEnabled, setBridgeEnabled] = useState(!!config.matter?.bridge?.enabled)
  const [port, setPort] = useState(config.matter?.bridge?.port || 5540)
  const [passcode, setPasscode] = useState(config.matter?.bridge?.passcode || '')
  const [discriminator, setDiscriminator] = useState(config.matter?.bridge?.discriminator || '')
  const [controllerEnabled, setControllerEnabled] = useState(!!config.matter?.controller?.enabled)
  const save = useSettingsSave('/api/settings/matter')

  const [setupInfo, setSetupInfo] = useState(null)
  const [setupError, setSetupError] = useState('')

  useEffect(() => {
    if (!bridgeEnabled) return
    let cancelled = false
    fetch('/api/matter/bridge/setup', { credentials: 'include' }).then((r) => r.json()).then((d) => {
      if (cancelled) return
      if (!d.success) { setSetupError(d.error); return }
      setSetupInfo(d.data)
    }).catch((err) => setSetupError(err.message))
    return () => { cancelled = true }
  }, [bridgeEnabled])

  return (
    <SettingsCard title={gt('s.matter_title', 'Matter & Thread')}
      desc={gt('sdesc.d43', 'Bridge exposes LSH devices to Apple Home / Google Home / Alexa / SmartThings as one Matter node. Controller connects to Matter/Thread devices already commissioned onto LSH via a one-time script.')}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{gt('s.matter_bridge', 'Bridge (expose LSH devices)')}</div>
      <Toggle label={gt('s.matter_bridge_enabled', 'Enable Matter bridge')} checked={bridgeEnabled} onChange={setBridgeEnabled}/>
      {bridgeEnabled && (
        <>
          <Field label={gt('s.matter_port', 'Port')} type="number" value={port} onChange={setPort} placeholder="5540"/>
          <Field label={gt('s.matter_passcode', 'Passcode')} hint="(leave blank to auto-generate; set to pin a fixed code)" value={passcode} onChange={setPasscode} placeholder="20202021"/>
          <Field label={gt('s.matter_discriminator', 'Discriminator')} hint="(leave blank to auto-generate)" value={discriminator} onChange={setDiscriminator} placeholder="3840"/>

          {setupInfo && !setupInfo.isCommissioned && (
            <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
              {setupInfo.qrDataUri
                ? <img src={setupInfo.qrDataUri} alt="Matter pairing QR code" width={180} height={180} style={{ borderRadius: 12, flexShrink: 0 }}/>
                : <div style={{ width: 180, height: 180, background: '#161b22', borderRadius: 12, flexShrink: 0 }}/>}
              <div>
                <div className="stg-hint" style={{ textTransform: 'uppercase', fontWeight: 700, fontSize: 11 }}>{gt('s.matter_pairing_code', 'Manual Pairing Code')}</div>
                <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '0.05em' }}>{setupInfo.manualPairingCodeFormatted || setupInfo.manualPairingCode || '--'}</div>
                <p className="stg-hint" style={{ marginTop: 10 }}>Scan with a phone's Home app, or enter the code manually when adding a Matter accessory.</p>
              </div>
            </div>
          )}
          {setupInfo?.isCommissioned && <p className="stg-hint">Already commissioned by a controller — decommission it from that app (e.g. Apple Home) to re-pair.</p>}
          {setupError && <p className="stg-banner err">{setupError}</p>}
        </>
      )}

      <div style={{ margin: '14px 0', borderTop: '1px solid var(--border, rgba(255,255,255,0.14))' }}/>

      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{gt('s.matter_controller', 'Controller (connect to Matter devices)')}</div>
      <Toggle label={gt('s.matter_controller_enabled', 'Enable Matter controller')} checked={controllerEnabled} onChange={setControllerEnabled}/>
      {controllerEnabled && (
        <p className="stg-hint" style={{ marginTop: 4 }}>
          Commission a device first (one-time, per device — needs terminal access): <code>node scripts/matter-commission.js</code>. Already-commissioned devices reconnect automatically on every LSH start.
        </p>
      )}

      <div className="stg-actions">
        <Button variant="primary" busy={save.busy}
          onClick={() => save.save({
            bridge: { enabled: bridgeEnabled, port: Number(port), passcode, discriminator },
            controller: { enabled: controllerEnabled },
          }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}
