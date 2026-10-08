// Translations for the wiring emulator. Keys are the English text (also the
// fallback); {name} placeholders are filled from vars. Languages follow the
// dashboard (src/i18n.js LANGUAGES). test/wiring-sim.test.js checks every
// phrase used has all languages and the same placeholders.
import { getLang } from '../../../i18n.js'
import { WR } from './i18n-dict.js'

export function t(text, vars) {
  if (text == null) return text
  let s = WR[getLang()]?.[text] || text
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(v)
  return s
}
