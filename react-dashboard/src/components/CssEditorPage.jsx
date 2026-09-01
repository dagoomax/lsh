import { useEffect, useState } from 'react'
import CssEditor from './settings/CssEditor'
import { Button, ResultBanner } from './settings/primitives'
import { useSettingsSave } from '../hooks/useSettingsSave'
import { gt } from '../i18n'
import '../styles/settings.css'

// Full-page version of the Custom CSS field (see settings/CssEditor.jsx),
// reachable from Settings → Interface → "Open full-page editor". Gated to
// admin-role users client-side for UX (a viewer who somehow lands here sees
// "Admin access required" instead of an editor they can't use); the actual
// security boundary is unchanged and already server-side — POST
// /api/settings/ui already 403s non-admins (see requireAdmin in
// src/api-routes.js), this page can't bypass that.
export default function CssEditorPage({ onClose }) {
  const [access, setAccess] = useState('checking') // 'checking' | 'denied' | 'ok'
  const [css, setCss] = useState('')
  // hideMqtt/hideLogs live on this same /api/settings/ui endpoint — it
  // replaces both on every POST (see requireAdmin route in api-routes.js),
  // so saving from here has to round-trip the values this page didn't
  // touch, or they'd silently reset to false.
  const [otherUiFields, setOtherUiFields] = useState({ hideMqtt: false, hideLogs: false, hideCssEditor: false })
  const [loadError, setLoadError] = useState(null)
  const save = useSettingsSave('/api/settings/ui')

  useEffect(() => {
    (async () => {
      try {
        const meRes = await fetch('/api/auth/me', { credentials: 'include' })
        const me = await meRes.json()
        if (!me.success || me.data?.role !== 'admin') { setAccess('denied'); return }

        const cfgRes = await fetch('/api/settings', { credentials: 'include' })
        const cfg = await cfgRes.json()
        if (!cfg.success) throw new Error(cfg.error || 'Failed to load settings')
        setCss(cfg.data?.ui?.customCss || '')
        setOtherUiFields({
          hideMqtt: !!cfg.data?.ui?.hideMqtt,
          hideLogs: !!cfg.data?.ui?.hideLogs,
          hideCssEditor: !!cfg.data?.ui?.hideCssEditor,
        })
        setAccess('ok')
      } catch (err) {
        setLoadError(err.message)
        setAccess('denied')
      }
    })()
  }, [])

  return (
    <div className="stg-page">
      <div className="stg-topbar">
        <button className="stg-back" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          {gt('stg_back', 'Dashboard')}
        </button>
        <h1 className="stg-page-title">{gt('css_editor_title', 'Custom CSS')}</h1>
        <span className="stg-page-title-spacer"/>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <div style={{ maxWidth: 920, margin: '0 auto', width: '100%', padding: '24px 20px', boxSizing: 'border-box' }}>
          {access === 'checking' && <div className="stg-loading">{gt('stg_loading', 'Loading…')}</div>}

          {access === 'denied' && (
            <div className="stg-banner err">
              ✗ {loadError || gt('css_editor_denied', 'Admin access required — ask an admin to make changes here.')}
            </div>
          )}

          {access === 'ok' && (
            <>
              <p className="stg-hint" style={{ margin: '0 0 14px' }}>
                {gt('css_editor_desc', 'Applies to both dashboards, loaded as a real stylesheet — see docs/custom-css.md for ready-to-use examples.')}
              </p>
              <CssEditor value={css} onChange={setCss} rows={26}/>
              <div className="stg-actions" style={{ marginTop: 14 }}>
                <Button variant="primary" busy={save.busy} onClick={() => save.save({ ...otherUiFields, customCss: css })}>
                  {gt('common.save', 'Save')}
                </Button>
                <ResultBanner result={save.result}/>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
