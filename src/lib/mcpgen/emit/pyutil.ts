// Small helpers for writing Python source text. Everything that reaches generated Python as a
// string goes through pyStr (exact literals) or cleanText (docstrings and messages).
import { cleanSpecText, clipText, stripControl } from '../hygiene.js'
import { redactSecrets } from '../redact.js'

/** A valid Python string literal for any JS string. */
export function pyStr(s: string): string {
  return JSON.stringify(s).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

/** A number for Python source. Throws on anything but a finite number, so text can never reach the code. */
export function pyNum(x: unknown): string {
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error('A finite number is required in generated code.')
  return String(x)
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

/** A Python or SQL identifier. Throws on anything that is not a plain ASCII identifier. */
export function pyIdent(x: unknown): string {
  if (typeof x !== 'string' || !IDENT.test(x)) throw new Error('A plain identifier is required in generated code.')
  return x
}

/** A double-quoted SQL identifier. The plain-identifier rule means no quote can ever need doubling. */
export function sqlIdent(x: unknown): string {
  return `"${pyIdent(x)}"`
}

/** Python literal for JSON-like data (null -> None, true -> True). Objects keep insertion order. */
export function pyLit(v: unknown, indent = 0): string {
  if (v === null || v === undefined) return 'None'
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'None'
  if (typeof v === 'string') return pyStr(v)
  const pad = '    '.repeat(indent + 1)
  const end = '    '.repeat(indent)
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]'
    const flat = `[${v.map((x) => pyLit(x, indent + 1)).join(', ')}]`
    if (flat.length <= 88 && !flat.includes('\n')) return flat
    return `[\n${v.map((x) => `${pad}${pyLit(x, indent + 1)},`).join('\n')}\n${end}]`
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
    if (entries.length === 0) return '{}'
    return `{\n${entries
      .map(([k, x]) => `${pad}${pyStr(k)}: ${pyLit(x, indent + 1)},`)
      .join('\n')}\n${end}}`
  }
  return 'None'
}

/**
 * Text taken from the source model (descriptions, labels, summaries) is untrusted. This makes it
 * safe inside a triple-quoted docstring or a message literal: no control characters, no quotes,
 * no backslashes, no links of any scheme, no credential-like text (tokens, JWTs, `user:pass@`
 * userinfo, key assignments; see redact.ts), clipped to `max` characters.
 */
export function cleanText(s: unknown, max = 200): string {
  let t = typeof s === 'string' ? s : s === undefined || s === null ? '' : String(s)
  t = stripControl(clipText(t, 8192))
  t = t
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/\\/g, '/')
    .replace(/["`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  t = redactSecrets(t).trim()
  return t.length > max ? `${clipText(t, max - 3).trimEnd()}...` : t
}

/** cleanText for text that originates in the source document and is published in descriptions. */
export function cleanSource(s: unknown, max = 200): string {
  return cleanText(cleanSpecText(s, Math.min(8192, max * 4)), max)
}

/** Flatten string and string[] parts into text with a trailing newline. */
export function joinLines(...parts: (string | string[] | null | undefined)[]): string {
  const out: string[] = []
  for (const p of parts) {
    if (p === null || p === undefined) continue
    if (Array.isArray(p)) out.push(...p)
    else out.push(p)
  }
  return out.join('\n') + '\n'
}
