import { useRef, useState } from 'react'
import { SettingsCard, Button, ResultBanner } from '../primitives'
import { useSettingsSave } from '../../../hooks/useSettingsSave'
import { gt } from '../../../i18n'

export default function BackupRestoreSection() {
  const fileRef = useRef(null)
  const [filename, setFilename] = useState('')
  const [parsed, setParsed] = useState(null)
  const [parseError, setParseError] = useState(null)
  const restore = useSettingsSave('/api/settings/import')

  const onFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFilename(file.name)
    setParseError(null); setParsed(null); restore.setResult(null)
    const reader = new FileReader()
    reader.onload = () => {
      try { setParsed(JSON.parse(reader.result)) }
      catch { setParseError('Not valid JSON') }
    }
    reader.readAsText(file)
  }

  const cancel = () => {
    setParsed(null); setFilename(''); setParseError(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const confirm = () => {
    restore.save(parsed).then(() => cancel()).catch(() => {})
  }

  return (
    <SettingsCard title={gt('s.backup_title', 'Backup & Restore')}
      desc="Save your entire configuration to a file or restore from a previous backup.">
      <div className="stg-backup-row">
        <div className="stg-backup-item">
          <div className="stg-backup-label">{gt('s.export', 'Export')}</div>
          <p className="stg-hint">Download <code>config.json</code> including all credentials and settings.</p>
          <Button variant="secondary" href="/api/settings/export" download>⬇ {gt('s.download_config', 'Download Config')}</Button>
        </div>
        <div className="stg-backup-divider"/>
        <div className="stg-backup-item">
          <div className="stg-backup-label">{gt('s.import_lbl', 'Import')}</div>
          <p className="stg-hint">Restore from a previously exported config file.</p>
          <label className="stg-btn stg-btn-secondary">
            ⬆ {gt('s.choose_file', 'Choose File…')}
            <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onFile}/>
          </label>
        </div>
      </div>

      {parseError && <div className="stg-banner err" style={{ marginTop: 12 }}>✗ {parseError}</div>}

      {parsed && (
        <div className="stg-import-preview">
          <div className="stg-import-preview-title">
            <span>{filename}</span>
            <span className="stg-import-preview-badge">{gt('s.preview_badge', 'Preview')}</span>
          </div>
          <div className="stg-import-preview-grid">
            <ImportKV label={gt('s.ip_mqtt_host', 'MQTT Host')} value={parsed.mqtt?.host}/>
            <ImportKV label={gt('s.ip_vrm_email', 'VRM Email')} value={parsed.vrm?.email}/>
            <ImportKV label={gt('s.ip_vrm_id', 'Installation ID')} value={parsed.vrm?.installationId}/>
            <ImportKV label={gt('s.ip_relays', 'Relays')} value={Array.isArray(parsed.relays) ? parsed.relays.length : undefined}/>
            <ImportKV label={gt('s.ip_hk_pin', 'HomeKit PIN')} value={parsed.homekit?.pin}/>
            <ImportKV label={gt('s.ip_server_port', 'Server Port')} value={parsed.server?.port}/>
          </div>
          <div className="stg-actions">
            <Button variant="primary" busy={restore.busy} onClick={confirm}>{gt('s.restore_config', 'Restore This Config')}</Button>
            <Button variant="secondary" onClick={cancel}>{gt('common.cancel', 'Cancel')}</Button>
            <ResultBanner result={restore.result}/>
          </div>
        </div>
      )}
    </SettingsCard>
  )
}

function ImportKV({ label, value }) {
  return (
    <div className="stg-import-kv">
      <span>{label}</span>
      <strong>{value === undefined || value === null || value === '' ? '—' : String(value)}</strong>
    </div>
  )
}
