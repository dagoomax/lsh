import { useState } from 'react'
import { SettingsCard, Field, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { LockIcon } from '../../Icons'
import { gt } from '../../../i18n'

// TTLock (and Sciener-based lock brands) through the TTLock Open Platform
// cloud. Server: src/ttlock-client.js (own process), src/routes/ttlock.js.
export default function TtlockSection({ config, reload }) {
  const t = config.ttlock || {}
  const [form, setForm] = useState({
    clientId: t.clientId || '', clientSecret: t.clientSecret || '', username: t.username || '',
    password: t.password || '', region: t.region || 'eu', pollSeconds: t.pollSeconds || 60,
  })
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }))
  const save = useSettingsSave('/api/settings/ttlock')
  const test = useSettingsSave('/api/settings/test-ttlock')

  return (
    <SettingsCard icon={LockIcon} title="TTLock" badge={{ label: gt('common.optional', 'Optional') }}
      desc="Locks that use the TTLock app (many brands are TTLock inside), through the TTLock Open Platform cloud. Register an application at the TTLock open platform for a client ID and secret, then sign in with the TTLock app account the locks are in. Lock state, remote lock/unlock and passcodes need the lock connected to a TTLock gateway (G2, G3 or G4). The guest portal can create each stay's PIN as a passcode valid only during the stay.">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 12px' }}>
        <Field label="Client ID" value={form.clientId} onChange={set('clientId')}/>
        <Field label="Client secret" type="password" value={form.clientSecret} onChange={set('clientSecret')}/>
        <Field label="TTLock account" hint="(e-mail or phone)" value={form.username} onChange={set('username')} autoComplete="off"/>
        <Field label="Password" type="password" value={form.password} onChange={set('password')} autoComplete="new-password"/>
        <Field label="Region" type="select" value={form.region} onChange={set('region')}
          options={[{ value: 'eu', label: 'Europe / worldwide' }, { value: 'cn', label: 'China' }]}/>
        <Field label="Poll every" hint="(s)" type="number" value={form.pollSeconds} onChange={set('pollSeconds')}/>
      </div>
      <div className="stg-actions">
        <Button variant="secondary" busy={test.busy} onClick={() => test.save(form).catch(() => {})}>{gt('common.test', 'Test')}</Button>
        <Button variant="primary" busy={save.busy} onClick={() => save.save(form).then(reload).catch(() => {})}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result || test.result}/>
      </div>
    </SettingsCard>
  )
}
