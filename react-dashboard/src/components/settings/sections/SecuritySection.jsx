import { useEffect, useState } from 'react'
import { SettingsCard, Field, Toggle, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { ShieldIcon, RouterIcon, TerminalIcon } from '../../Icons'
import { gt, tr } from '../../../i18n'

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
        desc={<>{tr('PIN for the padlock screen-lock in the dashboard header. Default when unset:')}{' '}<code>0000</code>.</>}
        endpoint="/api/settings/dashboard-pin" placeholder="0000"/>
      <UsersCard/>
      <TokensCard/>
      <TerminalCard terminal={config.terminal}/>
      <McpCard mcp={config.mcp}/>
      <HttpsCard server={config.server}/>
    </>
  )
}

const MCP_CLIENTS = [
  { value: 'claude', label: 'Claude (Claude Code / Claude Desktop / claude.ai)' },
  { value: 'gemini', label: 'Gemini (Gemini CLI)' },
  { value: 'chatgpt', label: 'ChatGPT (custom connector, OAuth)' },
  { value: 'other', label: 'Other MCP client' },
]

// How to plug a bot into each client. Token clients get the header; ChatGPT
// (and claude.ai in the browser) only do OAuth — they get the URL and sign in.
function McpSetup({ client, url, token }) {
  const t = token || '<bot token>'
  const blocks = {
    claude: [
      ['Claude Code', `claude mcp add --transport http lsh ${url} --header "Authorization: Bearer ${t}"`],
      ['Claude Desktop (claude_desktop_config.json)', JSON.stringify({ mcpServers: { lsh: { command: 'npx', args: ['-y', 'mcp-remote', url, '--header', 'Authorization:${LSH_AUTH}'], env: { LSH_AUTH: `Bearer ${t}` } } } }, null, 2)],
      ['claude.ai (Settings → Connectors → Add custom connector)', `${url}\n→ sign in to LSH and pick this bot when asked (OAuth, needs HTTPS)`],
    ],
    gemini: [
      ['Gemini CLI (~/.gemini/settings.json)', JSON.stringify({ mcpServers: { lsh: { httpUrl: url, headers: { Authorization: 'Bearer $LSH_MCP_TOKEN' } } } }, null, 2)],
      ['then, in your shell', `export LSH_MCP_TOKEN=${t}`],
    ],
    chatgpt: [
      ['ChatGPT (Developer mode) → add a custom connector', `MCP server URL: ${url}\nAuthentication: OAuth\n→ sign in to LSH and pick this bot when asked (needs HTTPS)`],
    ],
    other: [['Any MCP client (Streamable HTTP)', `URL: ${url}\nHeader: Authorization: Bearer ${t}\n(or OAuth 2.1 with PKCE — discovery at /.well-known/oauth-protected-resource)`]],
  }
  return (blocks[client] || blocks.other).map(([title, code]) => (
    <div key={title} style={{ marginTop: 8 }}>
      <div className="stg-hint" style={{ marginBottom: 4 }}>{title}</div>
      <div className="stg-token-value-box" style={{ alignItems: 'flex-start' }}>
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 12, flex: 1 }}><code>{code}</code></pre>
        <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(code)}>{gt('common.copy', 'Copy')}</Button>
      </div>
    </div>
  ))
}

function McpCard({ mcp }) {
  const [enabled, setEnabled] = useState(!!mcp?.enabled)
  const [publicUrl, setPublicUrl] = useState(mcp?.publicUrl || '')
  const [allowApiTokens, setAllowApiTokens] = useState(mcp?.allowApiTokens === true)
  const [bots, setBots] = useState(null)
  const [rooms, setRooms] = useState([])
  const [audit, setAudit] = useState(null)
  const [form, setForm] = useState({ name: '', client: 'claude', access: 'read', sensitive: false, rooms: [] })
  const [revealed, setRevealed] = useState(null) // { bot, token }
  const save = useSettingsSave('/api/settings/mcp')
  const act = useSettingsSave('/api/mcp-bots')

  const base = (publicUrl || window.location.origin).replace(/\/+$/, '')
  const url = `${base}/api/mcp`
  const load = () => fetch('/api/mcp-bots', { credentials: 'include' }).then(r => r.json()).then(d => setBots(d.success ? d.data.bots : [])).catch(() => setBots([]))
  useEffect(() => {
    load()
    fetch('/api/devices', { credentials: 'include' }).then(r => r.json())
      .then(d => setRooms([...new Set((d.data || []).map(x => x.room).filter(Boolean))].sort())).catch(() => {})
  }, [])

  const create = () => {
    if (!form.name.trim()) return
    act.save(form).then(r => { setRevealed(r.data); setForm({ ...form, name: '' }); load() }).catch(() => {})
  }
  const call = (path, method = 'POST', body) => act.save(body, { endpoint: `/api/mcp-bots/${path}`, method })
  const rotate = (b) => window.confirm(`New token for “${b.name}”? The old one stops working at once.`) && call(`${b.id}/rotate`).then(r => { setRevealed(r.data); load() }).catch(() => {})
  const remove = (b) => window.confirm(`Remove “${b.name}”? Its token and every connector signed in as it stop working.`) && call(b.id, 'DELETE').then(load).catch(() => {})
  const toggle = (b) => call(b.id, 'PUT', { enabled: b.enabled === false }).then(load).catch(() => {})
  const revokeOAuth = (b) => window.confirm(`Sign out every OAuth connector (ChatGPT / claude.ai) using “${b.name}”?`) && call(`${b.id}/revoke-oauth`).then(load).catch(() => {})
  const showAudit = () => fetch('/api/mcp-bots/audit?limit=50', { credentials: 'include' }).then(r => r.json()).then(d => setAudit(d.data || []))
  const insecure = !base.startsWith('https://') && !/\/\/(localhost|127\.0\.0\.1)/.test(base)

  return (
    <SettingsCard icon={RouterIcon} title="MCP Server & AI bots" badge={{ label: gt('common.optional', 'Optional') }}
      desc={<>{tr('Lets AI assistants (Claude, Gemini, ChatGPT) read and control the house through MCP at')}{' '}<code>POST /api/mcp</code>{tr('. Each assistant gets its own')}{' '}<b>{tr('bot')}</b>{tr(': a separate credential that works only for MCP, with its own permissions — read only or control, limited to chosen rooms, and locks / alarm / gates / doors blocked unless you allow them. Every call is rate-limited and logged.')}</>}>
      <Toggle label="Enable MCP server" checked={enabled} onChange={setEnabled}/>
      <Field label="Public HTTPS address" hint="(for ChatGPT / claude.ai — the https:// URL those services reach LSH at; leave empty for this address)" value={publicUrl} onChange={setPublicUrl} placeholder="https://lsh.example.ts.net"/>
      <Toggle label="Also accept plain API tokens (legacy, full admin access)" hint="Off = only bots can use MCP. Turn on only for an old setup that still uses an API token." checked={allowApiTokens} onChange={setAllowApiTokens}/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} onClick={() => save.save({ enabled, publicUrl, allowApiTokens })}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result}/>
      </div>
      {insecure && <div className="stg-banner err" style={{ marginTop: 8 }}>{tr('⚠ This address is plain http. Tokens would travel unencrypted outside your LAN, and ChatGPT / claude.ai need HTTPS — set up HTTPS (or Tailscale) and fill in the public address.')}</div>}

      <div className="stg-field" style={{ marginTop: 16 }}>
        <label>{tr('Bots')}</label>
        <div className="stg-token-list">
          {bots == null && <span className="stg-token-empty">{tr('Loading…')}</span>}
          {bots?.length === 0 && <span className="stg-token-empty">{tr('No bots yet — create one per assistant below')}</span>}
          {bots?.map(b => (
            <div className="stg-token-row" key={b.id} style={{ flexWrap: 'wrap', gap: 6, opacity: b.enabled === false ? 0.55 : 1 }}>
              <span className="stg-token-name" style={{ flex: '1 1 200px' }}>
                <b>{b.name}</b> · {MCP_CLIENTS.find(c => c.value === b.client)?.label.split(' (')[0] || b.client} · {b.access === 'control' ? tr('control') : tr('read only')}
                {b.sensitive ? ' ' + tr('· locks/alarm allowed') : ''}{b.rooms?.length ? ` · ${b.rooms.join(', ')}` : ' ' + tr('· all rooms')}
                <span className="stg-hint"> — {b.tokenHint}{b.oauthGrants ? ` · ${b.oauthGrants} OAuth sign-in(s)` : ''}{' '}{tr('· last used')}{' '}{b.lastUsedAt ? new Date(b.lastUsedAt).toLocaleString() : tr('never')}</span>
              </span>
              <Button variant="secondary" onClick={() => toggle(b)}>{b.enabled === false ? tr('Enable') : tr('Disable')}</Button>
              <Button variant="secondary" onClick={() => rotate(b)}>{tr('New token')}</Button>
              {b.oauthGrants > 0 && <Button variant="secondary" onClick={() => revokeOAuth(b)}>{tr('Sign out OAuth')}</Button>}
              <button className="stg-token-delete" title={tr('Remove bot')} onClick={() => remove(b)}>✕</button>
            </div>
          ))}
        </div>
      </div>

      <Field label="New bot name" value={form.name} onChange={v => setForm({ ...form, name: v })} placeholder="e.g. Claude — kitchen & living room"/>
      <Field label="Assistant" type="select" value={form.client} onChange={v => setForm({ ...form, client: v })} options={MCP_CLIENTS}/>
      <Field label="Permissions" type="select" value={form.access} onChange={v => setForm({ ...form, access: v })}
        options={[{ value: 'read', label: 'Read only — see devices and history, change nothing' }, { value: 'control', label: 'Control — may switch devices and run scenes' }]}/>
      {form.access === 'control' && <Toggle label="Allow locks, alarm, gates and doors" hint="Off (recommended): those stay read-only for this bot, and scenes that touch them are refused." checked={form.sensitive} onChange={v => setForm({ ...form, sensitive: v })}/>}
      <div className="stg-field">
        <label>{tr('Rooms')}{' '}<span className="stg-hint">{tr('(none checked = all rooms)')}</span></label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
          {rooms.length === 0 && <span className="stg-hint">{tr('No rooms assigned to devices yet')}</span>}
          {rooms.map(r => (
            <label key={r} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, cursor: 'pointer' }}>
              <input type="checkbox" className="stg-checkbox" checked={form.rooms.includes(r)}
                onChange={() => setForm({ ...form, rooms: form.rooms.includes(r) ? form.rooms.filter(x => x !== r) : [...form.rooms, r] })}/>{r}
            </label>
          ))}
        </div>
      </div>
      <div className="stg-actions">
        <Button variant="secondary" busy={act.busy} onClick={create}>{tr('Create bot')}</Button>
        <Button variant="secondary" onClick={showAudit}>{tr('Show recent bot activity')}</Button>
        <ResultBanner result={act.result}/>
      </div>

      {revealed && (
        <div className="stg-token-reveal">
          <span className="stg-hint">{tr('Token for')}{' '}<b>{revealed.bot.name}</b>{' '}{tr('— copy it now, it will')}{' '}<strong>{tr('not')}</strong>{' '}{tr('be shown again. Treat it like a password: anyone with it can do what this bot can.')}</span>
          <McpSetup client={revealed.bot.client} url={url} token={revealed.token}/>
          <div className="stg-actions"><Button variant="secondary" onClick={() => setRevealed(null)}>{tr('Done')}</Button></div>
        </div>
      )}

      {audit && (
        <div className="stg-field" style={{ marginTop: 12 }}>
          <label>{tr('Recent bot activity')}{' '}<span className="stg-hint">{tr('(since the last restart)')}</span></label>
          <div style={{ maxHeight: 260, overflow: 'auto', fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>
            {audit.length === 0 && <span className="stg-hint">{tr('Nothing yet')}</span>}
            {audit.map((e, i) => (
              <div key={i} style={{ color: e.ok ? 'inherit' : 'var(--danger, #d33)' }}>
                {new Date(e.at).toLocaleTimeString()} · {e.bot} · {e.tool} {e.args && Object.keys(e.args).length ? JSON.stringify(e.args) : ''} {e.ok ? '✓' : `✗ ${e.error || ''}`}
              </div>
            ))}
          </div>
        </div>
      )}
    </SettingsCard>
  )
}

function TerminalCard({ terminal }) {
  const [enabled, setEnabled] = useState(!!terminal?.enabled)
  const [installerMode, setInstallerMode] = useState(false)
  const save = useSettingsSave('/api/settings/terminal')

  useEffect(() => {
    fetch('/api/auth/users', { credentials: 'include' }).then(r => r.json())
      .then(d => setInstallerMode(!!d.installerMode)).catch(() => {})
  }, [])

  return (
    <SettingsCard icon={TerminalIcon} title="Embedded Terminal" badge={{ label: gt('common.optional', 'Optional') }}
      desc="A real interactive Linux shell, run as this server's own OS user, streamed straight into the dashboard — no SSH client needed. Off by default: needs this toggle here, admin + the per-user 'Terminal' permission below (only grantable while installer mode is on), and localhost/LAN access — never reachable over remote access.">
      <div className={`stg-banner ${installerMode ? 'ok' : ''}`} style={{ marginBottom: 4 }}>
        {installerMode
          ? tr('🔓 Installer mode is ON — this toggle is editable.')
          : <>{tr('🔒 Installer mode is OFF. Set')}{' '}<code>"installerMode": true</code>{' '}{tr('in')}{' '}<code>config.json</code>{' '}{tr('to change it (no in-app toggle, by design).')}</>}
      </div>
      <Toggle label="Enable embedded terminal" checked={enabled} onChange={installerMode ? setEnabled : () => {}}/>
      <div className="stg-actions">
        <Button variant="primary" busy={save.busy} disabled={!installerMode} onClick={() => save.save({ enabled })}>{gt('common.save', 'Save')}</Button>
        <ResultBanner result={save.result}/>
      </div>
    </SettingsCard>
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
  const [installerMode, setInstallerMode] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('viewer')
  const create = useSettingsSave('/api/auth/users')
  const del = useSettingsSave('')
  const perms = useSettingsSave('')

  const load = () => fetch('/api/auth/users', { credentials: 'include' }).then(r => r.json())
    .then(d => { setUsers(d.success ? d.data : []); setInstallerMode(!!d.installerMode) })
  useEffect(() => { load() }, [])

  const addUser = () => create.save({ username, password, role }).then(() => {
    setUsername(''); setPassword(''); load()
  }).catch(() => {})

  const removeUser = (id) => {
    if (!window.confirm('Delete this user?')) return
    del.save(undefined, { endpoint: `/api/auth/users/${id}`, method: 'DELETE' }).then(load).catch(() => {})
  }

  const togglePermission = (id, key, value) => {
    perms.save({ [key]: value }, { endpoint: `/api/auth/users/${id}/permissions`, method: 'PUT' }).then(load).catch(() => {})
  }

  return (
    <SettingsCard title={gt('s.users', 'Users')}
      desc="Flows, Claude Code, and Terminal need an extra permission beyond Admin, shown below each user — granting it requires installer mode.">
      <div className={`stg-banner ${installerMode ? 'ok' : ''}`} style={{ marginBottom: 4 }}>
        {installerMode
          ? tr('🔓 Installer mode is ON — permission checkboxes below are editable.')
          : <>{tr('🔒 Installer mode is OFF — permissions are read-only. Set')}{' '}<code>"installerMode": true</code>{' '}{tr('in')}{' '}<code>config.json</code>{' '}{tr('to change them (no in-app toggle, by design).')}</>}
      </div>
      <div className="stg-token-list">
        {users == null && <span className="stg-token-empty">{tr('Loading…')}</span>}
        {users?.length === 0 && <span className="stg-token-empty">{tr('No users')}</span>}
        {users?.map(u => (
          <div className="stg-token-row" key={u.id} style={{ flexWrap: 'wrap', rowGap: 6 }}>
            <span className="stg-token-name">{u.username}</span>
            <span className="stg-token-role">{u.role}</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text2)' }}>
              <input type="checkbox" className="stg-checkbox" checked={!!u.permissions?.flows} disabled={!installerMode}
                onChange={(e) => togglePermission(u.id, 'flows', e.target.checked)}/>
              {tr('Flows')}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text2)' }}>
              <input type="checkbox" className="stg-checkbox" checked={!!u.permissions?.claudeCode} disabled={!installerMode}
                onChange={(e) => togglePermission(u.id, 'claudeCode', e.target.checked)}/>
              {tr('Claude Code')}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text2)' }}>
              <input type="checkbox" className="stg-checkbox" checked={!!u.permissions?.terminal} disabled={!installerMode}
                onChange={(e) => togglePermission(u.id, 'terminal', e.target.checked)}/>
              {tr('Terminal')}
            </label>
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
        <ResultBanner result={create.result || del.result || perms.result}/>
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
      desc={<>{tr('Bearer tokens for scripts & integrations. Use header:')}{' '}<code>Authorization: Bearer &lt;token&gt;</code></>}>
      <div className="stg-token-list">
        {tokens == null && <span className="stg-token-empty">{tr('Loading…')}</span>}
        {tokens?.length === 0 && <span className="stg-token-empty">{tr('No tokens')}</span>}
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
          <span className="stg-hint">{tr('Save this token — it will')}{' '}<strong>{tr('not')}</strong>{' '}{tr('be shown again:')}</span>
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
          <p className="stg-hint">{tr('⚠ Requires port 80 accessible from the internet for HTTP-01 challenge.')}</p>
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
