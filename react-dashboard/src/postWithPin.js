import { gt } from './i18n'

// POST JSON to a PIN-gated endpoint. On 403 the user is prompted for the
// edit PIN (up to twice) and the request is retried with the entered value.
// Returns the parsed response, or null if the user cancelled the prompt.
export async function postWithPin(url, body) {
  let pin = sessionStorage.getItem('lsh-edit-pin') || ''
  for (let prompts = 0; ; prompts++) {
    const res = await fetch(url, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, pin }),
    })
    if (res.status !== 403 || prompts >= 2) return res.json().catch(() => ({}))
    const entered = window.prompt(gt('pin_prompt', 'Enter edit PIN'))
    if (entered == null) return null
    pin = entered.trim()
    sessionStorage.setItem('lsh-edit-pin', pin)
  }
}
