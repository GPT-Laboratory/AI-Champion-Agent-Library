// Security helpers for untrusted submissions (Phase 13). Pure functions; no fs, no network,
// nothing from author input is ever executed or imported.

const REDACTED = '[redacted]'

/**
 * Keys whose string values are secrets. Matching is key-path aware: once an ancestor key
 * matches, every descendant string is treated as secret too (CR-01), so `secrets: {db: x}`
 * and `auth: {value: x}` are caught even though the child keys look harmless.
 */
const KEY_DENY =
  /(api[_-]?key|authorization|bearer|passw(or)?d|pwd|secret|token|credential|private[_-]?key|cookie|session)/i
/** `auth` is only a secret key as a whole word (`author` must not match). */
const KEY_AUTH = /(^|[_.-])auth($|[_.-])/i
const SK_VALUE = /^sk-.{8,}/

/** Inline token shapes recognised inside free text. The one shared list: every redaction surface applies it (G2, D-440). */
export const INLINE_TOKEN_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
]
const MAX_DEPTH = 20

export function isSecretKey(key: string | null): boolean {
  return key !== null && (KEY_DENY.test(key) || KEY_AUTH.test(key))
}

/** Replace inline secret-looking tokens in free text. Idempotent. */
export function redactText(text: string): string {
  let out = text
  for (const re of INLINE_TOKEN_PATTERNS) out = out.replace(re, REDACTED)
  return out
}

function flagged(deny: boolean, value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0 || value === REDACTED) return false
  if (deny) return true
  return SK_VALUE.test(value) || redactText(value) !== value
}

/** JSON-paths of values that look like secrets (key-path denylist, or inline token shapes). */
export function scanSecrets(value: unknown): string[] {
  const out: string[] = []
  const seen = new WeakSet<object>()
  const walk = (v: unknown, path: string, deny: boolean, depth: number): void => {
    if (depth > MAX_DEPTH) return
    if (typeof v === 'string') {
      if (flagged(deny, v)) out.push(path)
      return
    }
    if (typeof v !== 'object' || v === null) return
    if (seen.has(v)) return
    seen.add(v)
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${path}[${i}]`, deny, depth + 1))
      return
    }
    for (const [k, item] of Object.entries(v as Record<string, unknown>)) {
      walk(item, path === '$' ? `$.${k}` : `${path}.${k}`, deny || isSecretKey(k), depth + 1)
    }
  }
  try {
    walk(value, '$', false, 0)
  } catch {
    /* never throw */
  }
  return out
}

/**
 * Paths where the depth limit (or a cycle) stops the secret walk. Such values are replaced by
 * "[truncated]" in redactSecrets, so nothing below the limit is ever stored; this lets callers
 * report that the walk did not inspect them (CR-01).
 */
export function scanTruncated(value: unknown): string[] {
  const out: string[] = []
  const seen = new WeakSet<object>()
  const walk = (v: unknown, path: string, depth: number): void => {
    if (typeof v !== 'object' || v === null) return
    if (depth >= MAX_DEPTH || seen.has(v)) {
      out.push(path)
      return
    }
    seen.add(v)
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${path}[${i}]`, depth + 1))
      return
    }
    for (const [k, item] of Object.entries(v as Record<string, unknown>)) {
      walk(item, path === '$' ? `$.${k}` : `${path}.${k}`, depth + 1)
    }
  }
  try {
    walk(value, '$', 0)
  } catch {
    /* never throw */
  }
  return out
}

/** Deep copy with flagged values replaced by "[redacted]"; deep or cyclic input is truncated. */
export function redactSecrets<T>(value: T): T {
  const seen = new WeakSet<object>()
  const walk = (v: unknown, deny: boolean, depth: number): unknown => {
    if (typeof v === 'string') {
      if (v.length > 0 && deny) return REDACTED
      return SK_VALUE.test(v) ? REDACTED : redactText(v)
    }
    if (typeof v !== 'object' || v === null) return v
    if (depth >= MAX_DEPTH || seen.has(v)) return '[truncated]'
    seen.add(v)
    if (Array.isArray(v)) return v.map((item) => walk(item, deny, depth + 1))
    const o: Record<string, unknown> = {}
    for (const [k, item] of Object.entries(v as Record<string, unknown>)) {
      if (k === '__proto__') continue
      o[k] = walk(item, deny || isSecretKey(k), depth + 1)
    }
    return o
  }
  try {
    return walk(value, false, 0) as T
  } catch {
    return '[truncated]' as unknown as T
  }
}

/**
 * A message safe to print or log: inline secret shapes redacted, control characters removed,
 * length capped. Zod and YAML error messages echo submitted values, so every message that is
 * logged or reported goes through this (IN-05).
 */
export function sanitizeMessage(message: unknown, maxChars = 300): string {
  let t = redactText(typeof message === 'string' ? message : String(message))
  t = t.replace(/[\u0000-\u001f\u007f]+/g, ' ')
  return t.length > maxChars ? `${t.slice(0, maxChars)}...` : t
}

/** Truncate text to at most maxBytes of UTF-8 without splitting a character. */
export function capText(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const buf = Buffer.from(text, 'utf8')
  if (buf.length <= maxBytes) return { text, truncated: false }
  let end = Math.max(0, maxBytes)
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) end--
  return { text: buf.subarray(0, end).toString('utf8'), truncated: true }
}

/**
 * Assign an author-controlled key without ever touching the prototype chain. `__proto__` is
 * dropped; everything else becomes an own data property (WR-06).
 */
export function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === '__proto__') return
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}
