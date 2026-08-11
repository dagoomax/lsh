import { useEffect, useState } from 'react'
import { SettingsCard, Field, Toggle, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { ShieldIcon } from '../../Icons'
import { gt } from '../../../i18n'

// The single worst-case section in the classic page — 6 unrelated
// sub-features fanning out to 6 endpoints. Split into independent cards so
// each keeps its own local state/save-result instead of one giant form.
export default function SecuritySection({ config }) {
  return (
    <>
      <ChangePasswordCard/>
      <PinCard
        title={gt('s.edit_pin_title', 'Dashboard Edit PIN')}
        desc="Locks room / icon / name edits in the dashboard behind a PIN. Leave empty to allow editing without a PIN."
        endpoint="/api/settings/edit-pin" placeholder="••••"/>
      <PinCard
        title={gt('s.dashboard_pin_title', 'Dashboard Lock PIN')}
        desc={<>PIN for the padlock screen-lock in the dashboard header. Default when unset: <code>0000</code>.</>}
        endpoint="/api/settings/dashboard-pin" placeholder="0000"/>
      <UsersCard/>
      <TokensCard/>
      <HttpsCard server={config.server}/>
    </>
  )
}

function ChangePasswordCard() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const save = useSettingsSave('/api/auth/change-password')

  const submit = () => {
    if (next !== confirm) { save.setResult({ ok: false, message: "New passwords don't match" }); return }
    save.save({ currentPassword: current, newPassword: next }).then(() => {
      setCurrent(''); setNext(''); setConfirm('')
    }).catch(() => {})
  }

  return (
    <SettingsCard icon={ShieldIcon} title={gt('s.change_pw', 'Change Password')}>
      <Field label={gt('s.current_pw', 'Current Password')} type="password" value={current} onChange={setCurrent} autoComplete="current-password"/>
      <Field label={gt('s.new_pw', 'New Password')} hint={gt('s.new_pw_hint', '(min. 8 characters)')} type="password" value={next} onChange={setNext} autoComplete="new-password"/>
      <Field label={gt('s.confirm_new_pw', 'Confirm New Password')} type="password" value={confirm} onChange={setConfirm} autoComplete="new-password"/>
      <div className="stg-actions">
        <Button variant="secondary" busy={save.busy} onClick={submit}>{gt('s.btn_change_pw', 'Change Password')}</Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}

function PinCard({ title, desc, endpoint, placeholder }) {
  const [pin, setPin] = useState('')
  const save = useSettingsSave(endpoint)

  return (
    <SettingsCard title={title} desc={desc}>
      <Field label="PIN" hint="(4–8 digits, empty = disabled)" type="password" inputMode="numeric"
        value={pin} onChange={setPin} placeholder={placeholder} maxLength={8}/>
      <div className="stg-actions">
        <Button variant="secondary" busy={save.busy} onClick={() => save.save({ pin })}>{gt('s.save_pin', 'Save PIN')}</Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}

function UsersCard() {
  const [users, setUsers] = useState(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('viewer')
  const create = useSettingsSave('/api/auth/users')
  const del = useSettingsSave('')

  const load = () => fetch('/api/auth/users', { credentials: 'include' }).then(r => r.json())
    .then(d => setUsers(d.success ? d.data : []))
  useEffect(() => { load() }, [])

  const addUser = () => create.save({ username, password, role }).then(() => {
    setUsername(''); setPassword(''); load()
  }).catch(() => {})

  const removeUser = (id) => {
    if (!window.confirm('Delete this user?')) return
    del.save(undefined, { endpoint: `/api/auth/users/${id}`, method: 'DELETE' }).then(load).catch(() => {})
  }

  return (
    <SettingsCard title={gt('s.users', 'Users')}>
      <div className="stg-token-list">
        {users == null && <span className="stg-token-empty">Loading…</span>}
        {users?.length === 0 && <span className="stg-token-empty">No users</span>}
        {users?.map(u => (
          <div className="stg-token-row" key={u.id}>
            <span className="stg-token-name">{u.username}</span>
            <span className="stg-token-role">{u.role}</span>
            <button className="stg-token-delete" onClick={() => removeUser(u.id)}>✕</button>
          </div>
        ))}
      </div>
      <Field label={gt('s.new_username', 'New Username')} value={username} onChange={setUsername}/>
      <Field label={gt('s.new_user_pw', 'Password')} type="password" value={password} onChange={setPassword} autoComplete="new-password"/>
      <Field label={gt('s.new_user_role', 'Role')} type="select" value={role} onChange={setRole}
        options={[{ value: 'admin', label: gt('s.role_admin', 'Admin – full access') }, { value: 'viewer', label: gt('s.role_viewer', 'Viewer – read-only') }]}/>
      <div className="stg-actions">
        <Button variant="secondary" busy={create.busy} onClick={addUser}>{gt('s.add_user', 'Add User')}</Button>
        <ResultBanner result={create.result || del.result}/>
      </div>
    </SettingsCard>
  )
}

function TokensCard() {
  const [tokens, setTokens] = useState(null)
  const [name, setName] = useState('')
  const [revealed, setRevealed] = useState(null)
  const create = useSettingsSave('/api/auth/tokens')
  const del = useSettingsSave('')

  const load = () => fetch('/api/auth/tokens', { credentials: 'include' }).then(r => r.json())
    .then(d => setTokens(d.success ? d.data : []))
  useEffect(() => { load() }, [])

  const createToken = () => {
    if (!name.trim()) return
    create.save({ name }).then(res => { setRevealed(res.token); setName(''); load() }).catch(() => {})
  }

  const removeToken = (id) => {
    if (!window.confirm('Delete this token? Anything using it will stop working.')) return
    del.save(undefined, { endpoint: `/api/auth/tokens/${id}`, method: 'DELETE' }).then(load).catch(() => {})
  }

  return (
    <SettingsCard title={gt('s.api_tokens', 'API Tokens')}
      desc={<>Bearer tokens for scripts &amp; integrations. Use header: <code>Authorization: Bearer &lt;token&gt;</code></>}>
      <div className="stg-token-list">
        {tokens == null && <span className="stg-token-empty">Loading…</span>}
        {tokens?.length === 0 && <span className="stg-token-empty">No tokens</span>}
        {tokens?.map(t => (
          <div className="stg-token-row" key={t.id}>
            <span className="stg-token-name">{t.name}</span>
            <button className="stg-token-delete" onClick={() => removeToken(t.id)}>✕</button>
          </div>
        ))}
      </div>
      <Field label={gt('s.token_name', 'Token Name')} value={name} onChange={setName} placeholder="e.g. Home Assistant"/>
      <div className="stg-actions">
        <Button variant="secondary" busy={create.busy} onClick={createToken}>{gt('s.create_token', 'Create Token')}</Button>
        <ResultBanner result={create.result || del.result}/>
      </div>
      {revealed && (
        <div className="stg-token-reveal">
          <span className="stg-hint">Save this token — it will <strong>not</strong> be shown again:</span>
          <div className="stg-token-value-box">
            <code>{revealed}</code>
            <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(revealed)}>{gt('common.copy', 'Copy')}</Button>
          </div>
        </div>
      )}
    </SettingsCard>
  )
}

function HttpsCard({ server }) {
  const [httpsEnabled, setHttpsEnabled] = useState(!!server?.https?.enabled)
  const [httpsPort, setHttpsPort] = useState(server?.https?.port || 3443)
  const [certFile, setCertFile] = useState(server?.https?.certFile || '')
  const [keyFile, setKeyFile] = useState(server?.https?.keyFile || '')
  const [leEnabled, setLeEnabled] = useState(!!server?.letsEncrypt?.enabled)
  const [leDomain, setLeDomain] = useState(server?.letsEncrypt?.domain || '')
  const [leEmail, setLeEmail] = useState(server?.letsEncrypt?.email || '')
  const [lePort, setLePort] = useState(server?.letsEncrypt?.port || 443)
  const [leCertsDir, setLeCertsDir] = useState(server?.letsEncrypt?.certsDir || './certs')
  const [leStaging, setLeStaging] = useState(!!server?.letsEncrypt?.staging)
  const save = useSettingsSave('/api/settings/https')

  return (
    <SettingsCard title={gt('s.https_tls', 'HTTPS / TLS')}>
      <Toggle label={gt('s.enable_https', 'Enable HTTPS with custom certificate')} checked={httpsEnabled} onChange={setHttpsEnabled}/>
      {httpsEnabled && (
        <div className="stg-subfields">
          <Field label={gt('s.https_port', 'HTTPS Port')} type="number" value={httpsPort} onChange={setHttpsPort} placeholder="3443"/>
          <Field label={gt('s.https_cert', 'Certificate File Path')} value={certFile} onChange={setCertFile} placeholder="/etc/ssl/certs/cert.pem"/>
          <Field label={gt('s.https_key', 'Private Key File Path')} value={keyFile} onChange={setKeyFile} placeholder="/etc/ssl/private/key.pem"/>
        </div>
      )}
      <Toggle label={gt('s.enable_le', "Enable Let's Encrypt (auto certificate)")} checked={leEnabled} onChange={setLeEnabled}/>
      {leEnabled && (
        <div className="stg-subfields">
          <p className="stg-hint">⚠ Requires port 80 accessible from the internet for HTTP-01 challenge.</p>
          <Field label={gt('s.le_domain', 'Domain')} value={leDomain} onChange={setLeDomain} placeholder="dashboard.example.com"/>
          <Field label={gt('s.le_email', "Email (Let's Encrypt account)")} type="email" value={leEmail} onChange={setLeEmail} placeholder="admin@example.com"/>
          <Field label={gt('s.le_port', 'HTTPS Port')} type="number" value={lePort} onChange={setLePort} placeholder="443"/>
          <Field label={gt('s.le_certs_dir', 'Certs Directory')} value={leCertsDir} onChange={setLeCertsDir} placeholder="./certs"/>
          <Toggle label={gt('s.le_staging', "Use Let's Encrypt staging (for testing)")} checked={leStaging} onChange={setLeStaging}/>
        </div>
      )}
      <div className="stg-actions">
        <Button variant="secondary" busy={save.busy} onClick={() => save.save({
          httpsEnabled, httpsPort: Number(httpsPort), certFile, keyFile,
          leEnabled, lePort: Number(lePort), leDomain, leEmail, leStaging, leCertsDir,
        })}>{gt('s.save_https', 'Save HTTPS Settings')}</Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
  )
}
