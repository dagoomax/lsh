import { useState } from 'react'
import { SettingsCard, Field, Toggle, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { DenonIcon, SpeakerIcon } from '../../Icons'
import { gt } from '../../../i18n'

export default function MediaSection({ config, reload }) {
  return (
    <>
      <DenonCard denon={config.denon} reload={reload}/>
      <SonyCard sony={config.sony} reload={reload}/>
      <SonosCard sonos={config.sonos} reload={reload}/>
    </>
  )
}

function DenonCard({ denon, reload }) {
  const [host, setHost] = useState(denon?.host || '')
  const [name, setName] = useState(denon?.name || '')
  const [maxVolume, setMaxVolume] = useState(denon?.maxVolume ?? 80)
  const [inputsText, setInputsText] = useState((denon?.inputs || []).join('\n'))
  const test = useSettingsSave('/api/settings/test-denon')
  const save = useSettingsSave('/api/settings/denon')

  return (
    <SettingsCard icon={DenonIcon} title="Denon AVR" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Controls Denon (and Marantz) AV receivers over the local network via Telnet (port 23). Power, master volume, mute, and input selection.">
      <Field label="Receiver IP / Hostname" value={host} onChange={setHost} placeholder="192.168.1.100"/>
      <Field label="Display Name" hint="(optional)" value={name} onChange={setName} placeholder="Denon AVR-X2800H"/>
      <Field label="Max Volume" hint="(typically 80 or 98 depending on model)" type="number" value={maxVolume} onChange={setMaxVolume}/>
      <Field label="Input sources" hint="(Denon codes, one per line — e.g. CD, BD, NET, BT, GAME)" type="textarea" value={inputsText} onChange={setInputsText} placeholder={'CD\nBD\nNET\nBT\nGAME\nSAT/CBL'}/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy}
          onClick={() => save.save({ host, name, maxVolume: Number(maxVolume), inputs: inputsText.split('\n').map(s => s.trim()).filter(Boolean) }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <Button variant="secondary" busy={test.busy} onClick={() => test.save({ host })}>Test connection</Button>
        <ResultBanner result={save.result || test.result}/>
      </div>
    </SettingsCard>
  )
}

function SonyCard({ sony, reload }) {
  const [host, setHost] = useState(sony?.host || '')
  const [psk, setPsk] = useState(sony?.psk || '')
  const [name, setName] = useState(sony?.name || '')
  const [maxVolume, setMaxVolume] = useState(sony?.maxVolume ?? 100)
  const [pollInterval, setPollInterval] = useState(sony?.pollInterval ?? 10)
  const [inputsText, setInputsText] = useState(Object.entries(sony?.inputs || {}).map(([k, v]) => `${k}=${v}`).join('\n'))
  const test = useSettingsSave('/api/settings/test-sony')
  const save = useSettingsSave('/api/settings/sony')

  const parseInputs = () => Object.fromEntries(
    inputsText.split('\n').map(l => l.split('=').map(s => s.trim())).filter(([k, v]) => k && v),
  )

  return (
    <SettingsCard icon={SpeakerIcon} title="Sony Bravia TV" badge={{ label: gt('common.optional', 'Optional') }}
      desc={<>Controls a Sony Bravia Android/Google TV over its local REST API. On the TV: Settings → Network → IP control → enable "Pre-Shared Key".</>}>
      <Field label="TV IP / Hostname" value={host} onChange={setHost} placeholder="192.168.1.28"/>
      <Field label="Pre-Shared Key" type="password" value={psk} onChange={setPsk}/>
      <Field label="Display Name" hint="(optional)" value={name} onChange={setName} placeholder="Living Room TV"/>
      <Field label="Max Volume" type="number" value={maxVolume} onChange={setMaxVolume}/>
      <Field label="Poll Interval" hint="(seconds)" type="number" value={pollInterval} onChange={setPollInterval}/>
      <Field label="Input sources" hint="(optional, one per line — Name=URI)" type="textarea" value={inputsText} onChange={setInputsText} placeholder={'HDMI 1=extInput:hdmi?port=1\nHDMI 2=extInput:hdmi?port=2'}/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy}
          onClick={() => save.save({ host, psk, name, maxVolume: Number(maxVolume), pollInterval: Number(pollInterval), inputs: parseInputs() }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <Button variant="secondary" busy={test.busy} onClick={() => test.save({ host, psk })}>Test connection</Button>
        <ResultBanner result={save.result || test.result}/>
      </div>
    </SettingsCard>
  )
}

function SonosCard({ sonos, reload }) {
  const [hostsText, setHostsText] = useState((sonos?.hosts || []).join('\n'))
  const [discover, setDiscover] = useState(sonos?.discover !== false)
  const [pollInterval, setPollInterval] = useState(sonos?.pollInterval ?? 5)
  const save = useSettingsSave('/api/settings/sonos')

  return (
    <SettingsCard icon={SpeakerIcon} title="Sonos" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Controls Sonos speakers via UPnP (port 1400). Auto-discovers all Zone Players via SSDP, or specify IPs manually. No account required.">
      <Field label="Speaker IPs" hint="(one per line — leave empty to use auto-discovery only)" type="textarea" value={hostsText} onChange={setHostsText} placeholder={'192.168.1.50\n192.168.1.51'}/>
      <Toggle label="Auto-discover speakers via SSDP (recommended)" checked={discover} onChange={setDiscover}/>
      <Field label="Poll Interval" hint="(seconds, min 3)" type="number" value={pollInterval} onChange={setPollInterval}/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy}
          onClick={() => save.save({ hosts: hostsText.split('\n').map(s => s.trim()).filter(Boolean), discover, pollInterval: Number(pollInterval) }).then(reload)}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}
