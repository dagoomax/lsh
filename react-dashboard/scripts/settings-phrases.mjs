// Settings i18n tooling.
//   node scripts/settings-phrases.mjs extract          → every translatable English phrase in Settings (JSON on stdout)
//   node scripts/settings-phrases.mjs wrap [--write]   → wrap bare JSX text / DOM text attributes in tr('…')
// Phrases: JSX text, text attributes, the props the Settings primitives
// translate (title, desc, label, hint, placeholder, addLabel, message…), the
// English fallback of gt(), and tr() arguments. Wiring emulator files have
// their own phrase book (wiring/i18n-dict*.js) and are skipped.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { parse } from '@babel/parser'
import traverseMod from '@babel/traverse'
const traverse = traverseMod.default || traverseMod

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = path.join(ROOT, 'src/components/settings')
export const PROP_KEYS = new Set(['title', 'desc', 'label', 'hint', 'placeholder', 'addLabel', 'message', 'description', 'subtitle', 'help', 'text', 'empty', 'tooltip'])
const DOM_ATTRS = new Set(['title', 'placeholder', 'alt', 'aria-label'])

export function files() {
  const out = []
  const walk = (d) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f)
      if (fs.statSync(p).isDirectory()) { if (f !== 'wiring') walk(p) }
      else if (/\.(jsx?|mjs)$/.test(f)) out.push(p)
    }
  }
  walk(DIR)
  return out
}

// worth translating: has a word of 2+ letters, isn't a URL / path / identifier / sample value
// `words` = shown text (JSX text, branches of a JSX expression): a single
// lowercase word counts; in props it's usually an enum value, so not there
export function isPhrase(s, words = false) {
  const t = s.replace(/\s+/g, ' ').trim()
  if (!t || !/[A-Za-z]{2}/.test(t)) return false
  if (/"\w+":|=>|[{}]/.test(t.replace(/\{\w+\}/g, ''))) return false // code samples ({name} placeholders are fine)
  if (!words && /^[a-z]+$/.test(t)) return false
  if (/^(https?:\/\/|\/|\.\/|~\/|[\w.-]+@[\w.-]+$)/.test(t)) return false
  if (/^[\w.:/-]+$/.test(t) && (/[0-9_/.:]/.test(t) || /[a-z][A-Z]/.test(t))) return false // 192.168.1.x, /dev/ttyUSB0, camelCase keys
  if (/^[A-Z0-9_]+$/.test(t) && t.length <= 6) return false // acronyms: MQTT, KNX, RTSP
  return true
}
const norm = (s) => s.replace(/\s+/g, ' ').trim()
// string literal in the repo's style: single quotes unless the text has one
const q = (s) => (s.includes("'") ? JSON.stringify(s) : `'${s.replace(/\\/g, '\\\\')}'`)

function ast(code) { return parse(code, { sourceType: 'module', plugins: ['jsx'] }) }

// inside <code>, <pre>, <kbd>, <samp>: literal text, never translated
const CODE_TAGS = new Set(['code', 'pre', 'kbd', 'samp'])
const inCode = (p) => !!p.findParent((q) => q.isJSXElement() && CODE_TAGS.has(q.node.openingElement.name.name))

// a string literal shown as text: a branch of {cond ? 'a' : 'b'} / {x && 'a'} / {x || 'a'}
// directly inside JSX children (not an attribute, not a call argument)
function shownLiteral(p) {
  let q = p
  while (q.parentPath && (q.parentPath.isConditionalExpression() && q.key !== 'test' || q.parentPath.isLogicalExpression() && q.key === 'right')) q = q.parentPath
  return q !== p && q.parentPath?.isJSXExpressionContainer() && q.parentPath.parentPath?.isJSXElement() && !inCode(p)
}

export function extract() {
  const phrases = new Set()
  const add = (s, words) => { if (typeof s === 'string' && isPhrase(s, words)) phrases.add(norm(s)) }
  for (const f of files()) {
    const code = fs.readFileSync(f, 'utf8')
    traverse(ast(code), {
      JSXText(p) { if (!inCode(p)) add(p.node.value, true) },
      StringLiteral(p) { if (shownLiteral(p)) add(p.node.value, true) },
      JSXAttribute(p) {
        const n = p.node.name.name, v = p.node.value
        if (v?.type === 'StringLiteral' && (PROP_KEYS.has(n) || DOM_ATTRS.has(n))) add(v.value)
        if (v?.type === 'JSXExpressionContainer' && v.expression.type === 'StringLiteral' && (PROP_KEYS.has(n) || DOM_ATTRS.has(n))) add(v.expression.value)
        if (v?.type === 'JSXExpressionContainer' && v.expression.type === 'TemplateLiteral' && PROP_KEYS.has(n) && !v.expression.expressions.length) add(v.expression.quasis[0].value.cooked)
      },
      ObjectProperty(p) {
        const k = p.node.key.name || p.node.key.value
        if (PROP_KEYS.has(k) && p.node.value.type === 'StringLiteral') add(p.node.value.value)
      },
      CallExpression(p) {
        const c = p.node.callee.name
        if (c === 'gt' && p.node.arguments[1]?.type === 'StringLiteral') add(p.node.arguments[1].value)
        if ((c === 'tr' || c === 'trn') && p.node.arguments[0]?.type === 'StringLiteral') add(p.node.arguments[0].value, true)
      },
      // children of <Button>…</Button> are plain JSX text — covered by JSXText
    })
  }
  return [...phrases].sort()
}

// codemod: bare JSX text → {tr('…')}, DOM text attributes → attr={tr('…')}
export function wrap(write) {
  let total = 0
  for (const f of files()) {
    let code = fs.readFileSync(f, 'utf8')
    const edits = []
    traverse(ast(code), {
      JSXText(p) {
        const raw = p.node.value
        if (!isPhrase(raw, true) || inCode(p)) return
        const lead = raw.match(/^\s*/)[0], trail = raw.match(/\s*$/)[0]
        const text = norm(raw)
        // keep JSX's whitespace collapsing: a space next to an expression stays a space
        const pre = lead && !lead.includes('\n') ? ' ' : (lead.includes('\n') ? lead : '')
        const post = trail && !trail.includes('\n') ? ' ' : (trail.includes('\n') ? trail : '')
        const parent = p.parent
        const sibs = parent.children || []
        const i = sibs.indexOf(p.node)
        const needPreSpace = pre === ' ' && i > 0
        const needPostSpace = post === ' ' && i < sibs.length - 1
        edits.push([p.node.start, p.node.end,
          `${needPreSpace ? "{' '}" : pre === ' ' ? '' : pre}{tr(${q(text)})}${needPostSpace ? "{' '}" : post === ' ' ? '' : post}`])
      },
      StringLiteral(p) {
        // the literal's edge spaces separate it from the neighbouring value — keep them outside tr()
        const v = p.node.value
        if (shownLiteral(p) && isPhrase(v, true)) edits.push([p.node.start, p.node.end, `${/^\s/.test(v) ? "' ' + " : ''}tr(${q(norm(v))})${/\s$/.test(v) ? " + ' '" : ''}`])
      },
      JSXAttribute(p) {
        const n = p.node.name.name, v = p.node.value
        const el = p.parent.name
        const isDom = el.type === 'JSXIdentifier' && /^[a-z]/.test(el.name)
        if (isDom && DOM_ATTRS.has(n) && v?.type === 'StringLiteral' && isPhrase(v.value)) edits.push([v.start, v.end, `{tr(${q(v.value)})}`])
      },
    })
    if (!edits.length) continue
    edits.sort((a, b) => b[0] - a[0])
    for (const [s, e, r] of edits) code = code.slice(0, s) + r + code.slice(e)
    if (!/import \{[^}]*\btr\b[^}]*\} from '[./]+i18n'/.test(code)) {
      const rel = path.relative(path.dirname(f), path.join(ROOT, 'src/i18n')).replace(/\\/g, '/')
      const spec = rel.startsWith('.') ? rel : './' + rel
      const m = code.match(new RegExp(`import \\{([^}]*)\\} from '${spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`))
      if (m) code = code.replace(m[0], `import {${m[1].replace(/\s*$/, '')}, tr } from '${spec}'`)
      else {
        const lastImport = [...code.matchAll(/^import .*$/gm)].pop()
        const at = lastImport ? lastImport.index + lastImport[0].length : 0
        code = code.slice(0, at) + `\nimport { tr } from '${spec}'` + code.slice(at)
      }
    }
    total += edits.length
    if (write) fs.writeFileSync(f, code)
    else console.log(path.relative(ROOT, f), edits.length)
  }
  console.log(`${total} edits${write ? ' written' : ''}`)
}


// merge: a sentence split around values — {tr('Watching')}{' '}{mac}{' '}{tr('for 8 s…')} —
// becomes one phrase with placeholders: {tr('Watching {mac} for 8 s…', { mac })}, so it
// translates as a whole. Only elements whose children are text, tr() calls and plain
// expressions (no nested JSX) are merged. Writes the merges to stdout as JSON
// ({ phrase: [parts…] }) — parts are fragments or {name} — for drafting translations.
export function merge(write) {
  const merges = {}
  let total = 0
  for (const f of files()) {
    let code = fs.readFileSync(f, 'utf8')
    const edits = []
    traverse(ast(code), {
      JSXElement(p) {
        const kids = p.node.children
        const isTr = (e) => e?.type === 'CallExpression' && e.callee.name === 'tr' && e.arguments.length === 1 && e.arguments[0].type === 'StringLiteral'
        const isSpace = (e) => e?.type === 'StringLiteral' && /^\s*$/.test(e.value)
        let trs = 0, vals = 0, bad = false
        for (const k of kids) {
          if (k.type === 'JSXText') continue
          if (k.type !== 'JSXExpressionContainer' || k.expression.type === 'JSXEmptyExpression') { bad = true; break }
          const e = k.expression
          if (isTr(e)) { trs++; continue }
          if (isSpace(e)) continue
          let hasJsx = false
          traverse(e, { noScope: true, JSXElement() { hasJsx = true }, JSXFragment() { hasJsx = true } }, p.scope, p)
          if (hasJsx || e.type === 'JSXElement' || e.type === 'JSXFragment') { bad = true; break }
          vals++
        }
        if (bad || !trs || (!vals && trs < 2)) return
        // build the template, following JSX whitespace rules for text children
        let tpl = '', parts = [], names = new Map(), used = new Set()
        const nameFor = (e) => {
          const src = code.slice(e.start, e.end)
          if (names.has(src)) return names.get(src)
          let n = e.type === 'Identifier' ? e.name
            : e.type === 'MemberExpression' && !e.computed ? (e.property.name === 'length' && e.object.type !== 'ThisExpression' ? (e.object.property?.name || e.object.name || 'count') + 'Count' : e.property.name)
            : 'v'
          n = String(n).replace(/[^A-Za-z0-9_]/g, '') || 'v'
          let u = n, i = 2
          while (used.has(u)) u = n + i++
          used.add(u); names.set(src, u)
          return u
        }
        for (const k of kids) {
          if (k.type === 'JSXText') {
            let t = k.value
            if (/\n/.test(t)) t = t.split('\n').map((l) => l.trim()).filter(Boolean).join(' ')
            tpl += t; if (t.trim()) parts.push(t); continue
          }
          const e = k.expression
          if (isTr(e)) { tpl += e.arguments[0].value; parts.push(e.arguments[0].value); continue }
          if (isSpace(e)) { tpl += e.value; continue }
          const n = nameFor(e); tpl += `{${n}}`; parts.push(`{${n}}`)
        }
        const phrase = norm(tpl)
        if (!phrase) return
        // leave alone what wouldn't read as a sentence: values back to back, too many values,
        // or a value glued onto a word (an English plural suffix — use trn() there)
        const ph = phrase.match(/\{\w+\}/g) || []
        if (/\}\{/.test(phrase) || ph.length > 3 || /[A-Za-z]\{\w+\}/.test(phrase)) return
        const vars = [...names.entries()].map(([src, n]) => (src === n ? n : `${n}: ${src}`))
        const first = kids[0], last = kids[kids.length - 1]
        // keep leading / trailing line breaks of the element body
        const lead = first.type === 'JSXText' && /\n/.test(first.value) ? first.value.match(/^\s*/)[0] : ''
        const trail = last.type === 'JSXText' && /\n/.test(last.value) ? last.value.match(/\s*$/)[0] : ''
        edits.push([kids[0].start, last.end, `${lead}{tr(${q(phrase)}${vars.length ? `, { ${vars.join(', ')} }` : ''})}${trail}`])
        merges[phrase] = parts
        p.skip()
      },
    })
    if (!edits.length) continue
    edits.sort((a, b) => b[0] - a[0])
    for (const [s0, e0, r] of edits) code = code.slice(0, s0) + r + code.slice(e0)
    total += edits.length
    if (write) fs.writeFileSync(f, code)
    else console.error(path.relative(ROOT, f), edits.length)
  }
  console.error(`${total} merges${write ? ' written' : ''}`)
  console.log(JSON.stringify(merges, null, 1))
}

const cmd = process.argv[2]
if (cmd === 'extract') console.log(JSON.stringify(extract(), null, 1))
if (cmd === 'wrap') wrap(process.argv.includes('--write'))
if (cmd === 'merge') merge(process.argv.includes('--write'))

// check: every phrase is in the book (or SAME), every entry has all six languages
if (cmd === 'missing' || cmd === 'check' || cmd === 'unused') {
  const { BOOK, SAME, LANGS } = await import('../src/i18n/settings/index.js')
  const same = new Set(SAME)
  const used = new Set(extract())
  const missing = [...used].filter((p) => !BOOK[p] && !same.has(p))
  const unused = [...Object.keys(BOOK), ...SAME].filter((p) => !used.has(p))
  if (cmd === 'unused') unused.forEach((p) => console.log(p))
  if (unused.length) console.error(`${unused.length} unused (not in any Settings source): node scripts/settings-phrases.mjs unused`)
  if (cmd === 'check' && unused.length) process.exit(1)
  const ph = (s) => [...new Set(s.match(/\{\w+\}/g) || [])].sort().join()
  const bad = Object.entries(BOOK).filter(([en, t]) => !Array.isArray(t) || t.length !== LANGS.length || t.some((x) => !x || ph(x) !== ph(en)))
  if (cmd === 'missing') {
    const from = Number(process.argv[3]) || 0, n = Number(process.argv[4]) || 120
    missing.slice(from, from + n).forEach((p, i) => console.log(`${from + i}\t${p}`))
  }
  console.error(`${missing.length} missing, ${bad.length} malformed${bad.length ? ': ' + bad.slice(0, 5).map(([e]) => e).join(' | ') : ''}`)
  if (cmd === 'check' && (missing.length || bad.length)) process.exit(1)
}
