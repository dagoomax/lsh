import { useEffect, useState } from 'react'
import { SettingsCard, Field, Toggle, Button, ResultBanner } from '../primitives'
import { gt, tr } from '../../../i18n'

// Settings → n8n & Webhooks: the n8n community nodes (integrations/n8n-nodes-lsh)
// and the outgoing webhooks LSH sends device changes to — added here by hand
// or by n8n's LSH Trigger when a workflow is activated. Server:
// src/webhooks.js, src/routes/webhooks.js.

const api = (url, opts = {}) => fetch(url, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...opts })
  .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok || j.success === false) throw new Error(j.error || `HTTP ${r.status}`); return j })

const host = (u) => { try { return new URL(u).host } catch { return u } }

export default function WebhooksSection() {
  const [list, setList] = useState(null)
  const [form, setForm] = useState({ name: '', url: '', keys: '', throttleSeconds: '' })
  const [created, setCreated] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(null)

  const load = () => api('/api/webhooks').then((j) => setList(j.data || [])).catch(() => setList([]))
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [])

  const add = async () => {
    setMsg(null); setBusy('add')
    try {
      const j = await api('/api/webhooks', { method: 'POST', body: JSON.stringify({ ...form, keys: form.keys.split(/[\n,]/).map((x) => x.trim()).filter(Boolean) }) })
      setCreated(j.data); setForm({ name: '', url: '', keys: '', throttleSeconds: '' }); load()
    } catch (err) { setMsg({ ok: false, message: err.message }) }
    setBusy(null)
  }
  const act = async (id, fn, label) => {
    setMsg(null); setBusy(id + label)
    try { await fn(); if (label === 'test') setMsg({ ok: true, message: tr('Test event delivered.') }) } catch (err) { setMsg({ ok: false, message: err.message }) }
    setBusy(null); load()
  }

  return (
    <>
      <SettingsCard title="n8n" badge={{ label: gt('common.optional', 'Optional') }}
        desc="Use LSH in n8n workflows. The LSH node reads devices, sends commands and runs scenes and flows; the LSH Trigger starts a workflow when device values change — activating the workflow registers its webhook below, deactivating removes it.">
        <ol className="stg-steps">
          <li>{tr('Download the n8n nodes and install them where n8n keeps its nodes: in ~/.n8n/nodes run npm install ./n8n-nodes-lsh-0.1.0.tgz, then restart n8n.')}</li>
          <li>{tr('Create an API token in Security & Authentication → API tokens.')}</li>
          <li>{tr('In n8n add an “LSH API” credential with this LSH’s address and the token.')}</li>
          <li>{tr('The trigger needs LSH to reach n8n’s webhook URL (WEBHOOK_URL in n8n).')}</li>
        </ol>
        <div className="stg-actions">
          <Button variant="primary" href="/api/webhooks/n8n-nodes-lsh.tgz" download="n8n-nodes-lsh-0.1.0.tgz">{tr('Download the n8n nodes')}</Button>
        </div>
      </SettingsCard>

      <SettingsCard title="Webhooks"
        desc="LSH posts JSON to these addresses when matching values change, batched for half a second and signed with the webhook’s secret (header X-LSH-Signature: sha256=HMAC of the body). Keys are “device key/value”: * matches one segment, ** any number. After 20 failed deliveries in a row a webhook is paused.">
        {list?.length > 0 && (
          <div className="stg-mod-list">
            {list.map((w) => (
              <div key={w.id} className="stg-mod-row">
                <div className="stg-mod-main">
                  <div className="stg-mod-name">{w.name}
                    {!w.enabled && <span className="stg-mod-chip err">{tr('paused')}</span>}
                    {w.enabled && w.last && <span className={`stg-mod-chip ${w.last.error ? 'err' : 'ok'}`}>{w.last.error || `HTTP ${w.last.status}`}</span>}
                  </div>
                  <div className="stg-hint stg-mod-meta">{host(w.url)} · {w.keys.join(', ')}{w.throttleSeconds ? ` · ${tr('at most every {n} s', { n: w.throttleSeconds })}` : ''}</div>
                  {w.last && <div className="stg-hint stg-mod-meta">{tr('Last delivery: {when}', { when: new Date(w.last.at).toLocaleString() })}</div>}
                </div>
                <Toggle label="On" checked={w.enabled} onChange={(v) => act(w.id, () => api(`/api/webhooks/${w.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: v }) }), 'on')}/>
                <Button variant="secondary" busy={busy === w.id + 'test'} onClick={() => act(w.id, () => api(`/api/webhooks/${w.id}/test`, { method: 'POST' }), 'test')}>{tr('Test')}</Button>
                <Button variant="secondary" onClick={() => act(w.id, () => api(`/api/webhooks/${w.id}`, { method: 'DELETE' }), 'del')}>{tr('Delete')}</Button>
              </div>
            ))}
          </div>
        )}
        {list?.length === 0 && <p className="stg-hint">{tr('No webhooks yet. Activate a workflow with the LSH Trigger in n8n, or add one here.')}</p>}

        <h4 className="stg-subheading">{tr('Add a webhook')}</h4>
        <Field label="Name" placeholder="Make scenario" value={form.name} onChange={(v) => setForm({ ...form, name: v })}/>
        <Field label="URL" placeholder="https://hook.eu1.make.com/…" value={form.url} onChange={(v) => setForm({ ...form, url: v })}/>
        <Field label="Keys" hint="(one per line)" type="textarea" placeholder="shelly/*/power" value={form.keys} onChange={(v) => setForm({ ...form, keys: v })}/>
        <Field label="At most once every (seconds)" hint="(per value, 0 = every change)" type="number" min={0} max={3600} value={form.throttleSeconds} onChange={(v) => setForm({ ...form, throttleSeconds: v })}/>
        <div className="stg-actions">
          <Button variant="primary" busy={busy === 'add'} disabled={!form.url || !form.keys.trim()} onClick={add}>{tr('Add')}</Button>
          <ResultBanner result={msg}/>
        </div>
        {created && (
          <p className="stg-hint">{tr('Secret for “{name}” — shown once, use it to check X-LSH-Signature:', { name: created.name })} <code className="stg-code">{created.secret}</code></p>
        )}
      </SettingsCard>
    </>
  )
}
