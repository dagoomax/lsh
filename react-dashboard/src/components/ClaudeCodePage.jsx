import { useEffect, useRef, useState } from 'react'
import '../styles/settings.css'

// Full-page chat against the embedded Claude Code agent (src/claude-code-client.js
// on the backend) — a real coding assistant with read/write/bash access to this
// repo's own files. Gated server-side both by admin role and by source IP
// (localhost/LAN only — see requireLocalAdmin in api-routes.js); this page's
// own state machine just reflects whatever that gate reports, it enforces
// nothing itself.
export default function ClaudeCodePage({ onClose }) {
  const [status, setStatus] = useState('checking') // checking | denied | disabled | unconfigured | ready
  const [statusError, setStatusError] = useState(null)
  const [messages, setMessages] = useState([]) // [{role, text, toolLog?}]
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef(null)

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/claude-code/status', { credentials: 'include' })
        if (res.status === 403) { setStatus('denied'); return }
        const data = await res.json()
        if (!data.success) { setStatusError(data.error); setStatus('denied'); return }
        if (!data.data.enabled) { setStatus('disabled'); return }
        if (!data.data.configured) { setStatus('unconfigured'); return }

        const histRes = await fetch('/api/claude-code/history', { credentials: 'include' })
        const hist = await histRes.json()
        if (hist.success) {
          setMessages(toDisplayMessages(hist.data.messages))
        }
        setStatus('ready')
      } catch (err) {
        setStatusError(err.message)
        setStatus('denied')
      }
    })()
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', text }])
    setBusy(true)
    try {
      const res = await fetch('/api/claude-code/message', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })
      const data = await res.json()
      if (data.success) {
        setMessages((m) => [...m, { role: 'assistant', text: data.data.reply, toolLog: data.data.toolLog }])
      } else {
        setMessages((m) => [...m, { role: 'error', text: data.error }])
      }
    } catch (err) {
      setMessages((m) => [...m, { role: 'error', text: err.message }])
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    if (!window.confirm('Start a new conversation? This clears the current chat history.')) return
    await fetch('/api/claude-code/reset', { method: 'POST', credentials: 'include' })
    setMessages([])
  }

  return (
    <div className="stg-page">
      <div className="stg-topbar">
        <button className="stg-back" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          Dashboard
        </button>
        <h1 className="stg-page-title">Claude Code</h1>
        <span className="stg-page-title-spacer"/>
        {status === 'ready' && <button className="stg-back" onClick={reset}>New chat</button>}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', maxWidth: 860, margin: '0 auto', width: '100%' }}>
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
            Claude Code chat isn't enabled. Set <code>claudeCode.enabled: true</code> in <code>config.json</code> and restart the server.
          </div>
        )}

        {status === 'unconfigured' && (
          <div style={{ padding: 24 }} className="stg-hint">
            No Anthropic API key configured. Set <code>claudeCode.apiKey</code> in <code>config.json</code> (or the <code>ANTHROPIC_API_KEY</code> env var) and restart the server.
          </div>
        )}

        {status === 'ready' && (
          <>
            <div className="callout" style={{ margin: '16px 20px 0' }}>
              This talks to the real Anthropic API and can read, write, and run shell commands directly in this
              repository — including files this server is running from. Only reachable from localhost/LAN, and
              only for admins. It won't restart the server or touch git on its own.
            </div>

            <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {messages.length === 0 && (
                <div className="stg-hint" style={{ padding: '20px 0' }}>
                  Ask for a change — e.g. "add a toggle to hide the weather card" or "explain how relay-controller.js decides which client to use".
                </div>
              )}
              {messages.map((m, i) => <ChatBubble key={i} msg={m}/>)}
              {busy && <ChatBubble msg={{ role: 'assistant', text: '…', pending: true }}/>}
            </div>

            <div style={{ display: 'flex', gap: 10, padding: '12px 20px 20px' }}>
              <textarea
                className="stg-input"
                style={{ flex: 1, resize: 'none', fontFamily: 'inherit' }}
                rows={2}
                placeholder="Describe the change you want…"
                value={input}
                disabled={busy}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              />
              <button className="stg-disclosure" style={{ padding: '0 18px', fontWeight: 700 }} onClick={send} disabled={busy || !input.trim()}>
                Send
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ChatBubble({ msg }) {
  const isUser = msg.role === 'user'
  const isError = msg.role === 'error'
  return (
    <div style={{ alignSelf: isUser ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
      <div style={{
        padding: '10px 14px', borderRadius: 14, fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap',
        background: isUser ? 'var(--accent)' : isError ? 'var(--bad-bg, rgba(190,70,70,0.12))' : 'var(--white-05)',
        color: isUser ? '#fff' : isError ? '#c0554f' : 'var(--text)',
        border: isUser ? 'none' : '1px solid var(--border)',
        opacity: msg.pending ? 0.6 : 1,
      }}>
        {msg.text}
      </div>
      {msg.toolLog && msg.toolLog.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {msg.toolLog.map((t, i) => (
            <span key={i} title={JSON.stringify(t.input)} style={{
              fontSize: 11, fontFamily: 'ui-monospace, monospace', padding: '3px 8px', borderRadius: 999,
              background: 'var(--white-05)', border: '1px solid var(--border)', color: 'var(--text3)',
            }}>
              🔧 {t.name}{t.input?.path ? `(${t.input.path})` : t.input?.command ? `(${t.input.command.slice(0, 40)})` : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// The backend's raw message history mixes text with tool_use/tool_result
// content blocks — collapse that into the {role, text, toolLog} shape the
// UI renders, same as a fresh turn from sendMessage().
function toDisplayMessages(rawMessages) {
  const out = []
  for (const m of rawMessages || []) {
    const blocks = Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }]
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n')
    const toolLog = blocks.filter((b) => b.type === 'tool_use').map((b) => ({ name: b.name, input: b.input }))
    if (m.role === 'user' && text) out.push({ role: 'user', text })
    if (m.role === 'assistant' && (text || toolLog.length)) out.push({ role: 'assistant', text, toolLog })
  }
  return out
}
