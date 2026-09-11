import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { TerminalIcon } from './Icons'
import '@xterm/xterm/css/xterm.css'
import '../styles/settings.css'

// Full-page real Linux shell (src/terminal-server.js on the backend — a
// node-pty session streamed over the '/terminal' Socket.IO namespace).
// Gated server-side by admin role, the 'terminal' permission flag,
// localhost/LAN source IP, AND config.terminal.enabled — this page's own
// state machine just reflects whatever those gates report, same pattern as
// ClaudeCodePage.
export default function TerminalPage({ onClose }) {
  const [status, setStatus] = useState('checking') // checking | denied | disabled | ready | ended
  const [statusError, setStatusError] = useState(null)
  const containerRef = useRef(null)
  const termRef = useRef(null)
  const socketRef = useRef(null)

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/terminal/status', { credentials: 'include' })
        if (res.status === 403) {
          const data = await res.json().catch(() => null)
          setStatusError(data?.error || null)
          setStatus('denied')
          return
        }
        const data = await res.json()
        if (!data.success) { setStatusError(data.error); setStatus('denied'); return }
        if (!data.data.enabled) { setStatus('disabled'); return }
        setStatus('ready')
      } catch (err) {
        setStatusError(err.message)
        setStatus('denied')
      }
    })()
  }, [])

  useEffect(() => {
    if (status !== 'ready' || !containerRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      theme: { background: '#0d1117', foreground: '#e6e6e6', cursor: '#e6e6e6' },
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    fitAddon.fit()
    termRef.current = term

    const socket = io('/terminal', { withCredentials: true })
    socketRef.current = socket

    socket.on('terminal:data', (data) => term.write(data))
    socket.on('terminal:error', (message) => {
      term.write(`\r\n\x1b[31m✗ ${message}\x1b[0m\r\n`)
    })
    socket.on('terminal:exit', (code) => {
      term.write(`\r\n\x1b[2m[process exited with code ${code}]\x1b[0m\r\n`)
      setStatus('ended')
    })
    socket.on('connect_error', (err) => {
      term.write(`\r\n\x1b[31m✗ ${err.message}\x1b[0m\r\n`)
      setStatus('ended')
    })

    term.onData((data) => socket.emit('terminal:input', data))
    const sendResize = () => socket.emit('terminal:resize', { cols: term.cols, rows: term.rows })
    socket.on('connect', sendResize)

    const resizeObserver = new ResizeObserver(() => { fitAddon.fit(); sendResize() })
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      socket.disconnect()
      term.dispose()
      termRef.current = null
      socketRef.current = null
    }
  }, [status])

  return (
    <div className="stg-page">
      <div className="stg-topbar">
        <button className="stg-back" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          Dashboard
        </button>
        <h1 className="stg-page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <TerminalIcon size={17} color="var(--accent)"/>
          Terminal
        </h1>
        <span className="stg-page-title-spacer"/>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {status === 'checking' && <div className="stg-loading" style={{ padding: 24 }}>Loading…</div>}

        {status === 'denied' && (
          <div style={{ padding: 24 }}>
            <div className="stg-banner err">
              ✗ {statusError || 'Not available — this needs an admin account on localhost/LAN, not remote access.'}
            </div>
          </div>
        )}

        {status === 'disabled' && (
          <div style={{ padding: 24 }} className="stg-hint">
            The embedded terminal isn't enabled. Turn it on in Settings → Security ("Embedded Terminal"), or set <code>terminal.enabled: true</code> in <code>config.json</code> directly, then restart the server.
          </div>
        )}

        {(status === 'ready' || status === 'ended') && (
          <>
            <div className="callout" style={{ margin: '16px 20px 0' }}>
              A real shell, running as this server's own OS user — not confined to this repo. Anything you can do
              at a Linux prompt, this can do to the box LSH runs on. Only reachable from localhost/LAN, and only
              for admins with the Terminal permission.
            </div>
            <div style={{ flex: 1, minHeight: 0, margin: '12px 20px 20px', borderRadius: 10, overflow: 'hidden', background: '#0d1117', border: '1px solid var(--border)' }}>
              <div ref={containerRef} style={{ height: '100%', padding: 8 }}/>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
