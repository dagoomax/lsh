import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import SipDemo from './components/SipDemo'

// Demo mode (?demo=sip) renders the SIP intercom mockup instead of the live
// dashboard, so it never mounts the real data/socket hooks.
const isSipDemo = new URLSearchParams(window.location.search).get('demo') === 'sip'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>{isSipDemo ? <SipDemo /> : <App />}</React.StrictMode>
)
