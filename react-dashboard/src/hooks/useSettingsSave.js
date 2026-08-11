import { useCallback, useState } from 'react'

// Generic POST-and-report hook for every Settings section's Save/Test button:
// tracks busy + a transient success/error result, the React equivalent of
// the vanilla page's inline "✓/✗ …" <span class="test-result">. `endpoint`
// is the default target; pass { endpoint, method } to override per call
// (e.g. a section with both a Save and a Test button sharing one hook).
export function useSettingsSave(endpoint) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null) // { ok, message } | null

  const save = useCallback(async (payload, opts = {}) => {
    const url = opts.endpoint || endpoint
    const method = opts.method || 'POST'
    // fetch() throws if a body is set on GET/HEAD — those never send one.
    const canHaveBody = method !== 'GET' && method !== 'HEAD'
    setBusy(true); setResult(null)
    try {
      const res = await fetch(url, {
        method,
        credentials: 'include',
        ...(canHaveBody
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload ?? {}) }
          : {}),
      })
      const data = await res.json().catch(() => ({}))
      if (!data.success) throw new Error(data.error || `HTTP ${res.status}`)
      setResult({ ok: true, message: data.message || 'Saved' })
      return data
    } catch (err) {
      setResult({ ok: false, message: err.message })
      throw err
    } finally {
      setBusy(false)
    }
  }, [endpoint])

  return { save, busy, result, setResult }
}
