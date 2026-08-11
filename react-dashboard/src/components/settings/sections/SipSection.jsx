import { useState } from 'react'
import { SettingsCard, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { PhoneIcon } from '../../Icons'
import { gt } from '../../../i18n'

export default function SipSection({ config, reload }) {
  const sip = config.sip || {}
  const [wsUrl, setWsUrl] = useState(sip.wsUrl || '')
  const [username, setUsername] = useState(sip.username || '')
  const [domain, setDomain] = useState(sip.domain || '')
  const [password, setPassword] = useState(sip.password || '')
  const [displayName, setDisplayName] = useState(sip.displayName || '')
  const [dtmfUnlock, setDtmfUnlock] = useState(sip.dtmfUnlock || '#')
  const [relayIndex, setRelayIndex] = useState(sip.relayIndex ?? '')
  const save = useSettingsSave('/api/settings/sip')

  return (
    <SettingsCard icon={PhoneIcon} title={gt('s.sip_title', '📞 SIP / Intercom')} badge={{ label: gt('common.optional', 'Optional') }}
      desc={gt('sdesc.d18', 'Register as a SIP extension on UniFi Talk, Loxone, or any SIP PBX with WebSocket transport. Incoming calls pop up with the matching camera feed and a one-tap unlock button.')}>
      <Field label={gt('s.sip_ws_url', 'WebSocket URL')} hint="wss://host:5443 (UniFi Talk) or ws://host:7778 (Loxone)" value={wsUrl} onChange={setWsUrl} placeholder="wss://192.168.1.1:5443"/>
      <Field label={gt('s.sip_username', 'Extension / Username')} value={username} onChange={setUsername} placeholder="101"/>
      <Field label={gt('s.sip_domain', 'SIP Domain')} hint={gt('s.sip_domain_hint', '(leave blank to use server host from URL)')} value={domain} onChange={setDomain} placeholder="192.168.1.1"/>
      <Field label={gt('s.sip_pass', 'Password')} type="password" value={password} onChange={setPassword}/>
      <Field label={gt('s.sip_display_name', 'Display Name')} hint={gt('s.sip_display_hint', '(shown to callee)')} value={displayName} onChange={setDisplayName} placeholder="Lightweight Smart Home"/>
      <Field label={gt('s.sip_dtmf', 'Unlock DTMF Tone')} hint={gt('s.sip_dtmf_hint', '(sent when you tap Unlock during a call)')} value={dtmfUnlock} onChange={setDtmfUnlock} maxLength={8} style={{ maxWidth: 120 }}/>
      <Field label={gt('s.sip_relay', 'Door Relay Index')} hint={gt('s.sip_relay_hint', '(pulse this relay on Unlock — leave blank for DTMF-only)')} type="number" value={relayIndex} onChange={setRelayIndex} placeholder="0" style={{ maxWidth: 120 }}/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy}
          onClick={() => save.save({
            wsUrl, username, domain, password, displayName, dtmfUnlock,
            relayIndex: relayIndex === '' ? null : Number(relayIndex),
          }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}
