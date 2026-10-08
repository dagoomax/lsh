import '../../styles/settings.css'
import '../../styles/pages.css'

// Full-page tool view chrome (Logs, MQTT, Flows) — same top bar as the
// Settings / Terminal pages: back to Dashboard, title, optional right-side
// actions, then the page body filling the rest of the screen.
export default function PageShell({ title, icon, actions, onClose, children }) {
  return (
    <div className="stg-page">
      <div className="stg-topbar">
        <button className="stg-back" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          Dashboard
        </button>
        <h1 className="stg-page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {icon}{title}
        </h1>
        <span className="stg-page-title-spacer"/>
        {actions && <div className="pg-actions">{actions}</div>}
      </div>
      <div className="pg-body">{children}</div>
    </div>
  )
}
