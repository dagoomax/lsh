import { useState } from 'react'
import { SettingsCard, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { HomeIcon } from '../../Icons'
import { gt } from '../../../i18n'

export default function SmartThingsSection({ config, reload }) {
  const st = config.smartthings || {}
  const [token, setToken] = useState(st.token || '')
  const [deviceIdsText, setDeviceIdsText] = useState((st.deviceIds || []).join(', '))
  const test = useSettingsSave('/api/settings/test-smartthings')
  const save = useSettingsSave('/api/settings/smartthings')

  const deviceIds = () => deviceIdsText.split(',').map(s => s.trim()).filter(Boolean)

  return (
    <SettingsCard icon={HomeIcon} title={gt('s.st_title', 'Samsung SmartThings')}
      badge={{ label: gt('common.optional', 'Optional') }}
      desc={<>{gt('sdesc.d3', 'Adds SmartThings devices (switches, power meters, sensors) to the dashboard.')} Get a Personal Access Token from <strong>account.smartthings.com/tokens</strong>.</>}>
      <Field label={gt('s.st_token', 'Personal Access Token')} type="password" value={token} onChange={setToken}
        placeholder="••••••••••••••••••••••••••••••••••••"/>
      <Field label={gt('s.st_device_ids', 'Device IDs to sync')} hint={gt('s.st_device_ids_hint', '(comma-separated — leave blank for all devices)')}
        value={deviceIdsText} onChange={setDeviceIdsText} placeholder="abc123-..., def456-..."/>
      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy} onClick={() => test.save({ token })}>
          {gt('common.test', 'Test Connection')}
        </Button>
        <Button variant="primary" busy={save.busy}
          onClick={() => save.save({ token, deviceIds: deviceIds() }).then(reload)}>
          {gt('common.save', 'Save')}
        </Button>
        <ResultBanner result={test.result || save.result}/>
      </div>
    </SettingsCard>
  )
}
