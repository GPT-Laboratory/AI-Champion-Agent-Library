// The restricted selector grammar of composite tools (docs/mcp-generator-proposals.md).
//
//   selector := root ( "." key | "[" index "]" )*
//   root     := "input" | "item" | step-id
//   key      := [A-Za-z][A-Za-z0-9_]{0,63}      (no underscore start, so no dunder name can match)
//   index    := 0 .. 99  or  -1                 (the last item)
//
// A selector is parsed into a path of keys and indexes. The emitter writes that path as a Python
// tuple literal and the generated server walks dictionaries and lists with a fixed helper (`_sel`):
// no attribute access, no calls, no expressions, no eval. Anything outside the grammar fails to
// parse; there is no escape syntax and no partial acceptance. Linear time, never throws.
import type { SelectorPath } from './model.js'

export const MAX_SELECTOR_LENGTH = 120
export const MAX_SELECTOR_DEPTH = 8
const KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
const ROOT = /^[a-z][a-z0-9_]{0,15}$/

export type ParsedSelector = { ok: true; path: SelectorPath } | { ok: false; reason: string }

export function parseSelector(text: unknown): ParsedSelector {
  if (typeof text !== 'string') return { ok: false, reason: 'not text' }
  if (text.length === 0 || text.length > MAX_SELECTOR_LENGTH) return { ok: false, reason: 'length' }
  // Whitelist the alphabet first: letters, digits, underscore, dot, brackets and a minus sign.
  if (!/^[A-Za-z0-9_.[\]-]+$/.test(text)) return { ok: false, reason: 'character outside the grammar' }
  const path: SelectorPath = []
  let i = 0
  let end = i
  while (end < text.length && text[end] !== '.' && text[end] !== '[') end++
  const root = text.slice(i, end)
  if (!ROOT.test(root) || root.includes('__')) return { ok: false, reason: 'root' }
  path.push(root)
  i = end
  while (i < text.length) {
    if (path.length > MAX_SELECTOR_DEPTH) return { ok: false, reason: 'too deep' }
    if (text[i] === '.') {
      let e = i + 1
      while (e < text.length && text[e] !== '.' && text[e] !== '[') e++
      const key = text.slice(i + 1, e)
      if (!KEY.test(key) || key.includes('__')) return { ok: false, reason: 'key' }
      path.push(key)
      i = e
    } else if (text[i] === '[') {
      const close = text.indexOf(']', i)
      if (close < 0) return { ok: false, reason: 'unclosed index' }
      const raw = text.slice(i + 1, close)
      if (!/^(?:-1|[0-9]{1,2})$/.test(raw)) return { ok: false, reason: 'index' }
      path.push(Number(raw))
      i = close + 1
    } else return { ok: false, reason: 'unexpected character' }
  }
  if (path.length > MAX_SELECTOR_DEPTH) return { ok: false, reason: 'too deep' }
  return { ok: true, path }
}

/** Text form of a parsed selector (stable; used in reviews and the inventory). */
export function selectorText(path: SelectorPath): string {
  return path.map((s, i) => (typeof s === 'number' ? `[${s}]` : i === 0 ? s : `.${s}`)).join('')
}
