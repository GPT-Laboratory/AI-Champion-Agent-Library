// Credential scanner (design doc section 7). Line based, no fs, no network.
// Findings carry the rule code, line number and kind ONLY: the matched text is never
// kept, so nothing downstream (gaps, logs, API responses) can echo it.
//
// Every rule runs in time linear in the line length (review CR-01): keyword and token rules are
// hand-scanned from fixed anchors with bounded look-ahead, never "any prefix, then backtrack"
// regexes. Very long lines (minified specs) are scanned in overlapping windows, so the per-call
// work is bounded and a secret late in a long line is still found.
import type { Gap } from './types.js'

export interface CredentialFinding {
  code: 'credential-rejected'
  line: number
  kind: string
}

const MAX_FINDINGS = 20
/** Longest stretch scanned in one piece; longer lines are cut into overlapping windows. */
export const SCAN_WINDOW = 8192
const WINDOW_OVERLAP = 512
/** Longest value read after a key name (a longer value is judged on its first characters). */
const MAX_VALUE = 128

const isSpace = (c: number): boolean =>
  c === 32 ||
  (c >= 9 && c <= 13) ||
  c === 0xa0 ||
  c === 0x1680 ||
  (c >= 0x2000 && c <= 0x200a) ||
  c === 0x2028 ||
  c === 0x2029 ||
  c === 0x202f ||
  c === 0x205f ||
  c === 0x3000 ||
  c === 0xfeff
const isAlnum = (c: number): boolean => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
const isLetter = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122)

/** Trim whitespace, leading quotes and trailing quotes or separators. Loops, not regexes, to stay linear. */
function trimDecor(v: string): string {
  let a = 0
  let b = v.length
  while (a < b && (isSpace(v.charCodeAt(a)) || v[a] === '"' || v[a] === "'" || v[a] === '`')) a++
  while (b > a && (isSpace(v.charCodeAt(b - 1)) || '"\'`,;'.includes(v[b - 1]))) b--
  return v.slice(a, b)
}

function stripTrailingBackslashes(v: string): string {
  let b = v.length
  while (b > 0 && v[b - 1] === '\\') b--
  return v.slice(0, b)
}

/** Literal values that are placeholders, not secrets. Whole-value matches only (review WR-03). */
export function isPlaceholder(v: string): boolean {
  const s = trimDecor(v)
  if (s === '') return true
  if (/^\$\{?[A-Za-z_]/.test(s)) return true // ${NAME} or $NAME
  if (/^<[^>]*>?$/.test(s) || /^\{\{.*\}\}?$/.test(s) || /^\[.*\]$/.test(s)) return true
  if (/^%[A-Za-z_]+%$/.test(s) || /^%s$/.test(s)) return true
  // An env var NAME such as NAME_API_KEY (at least one underscore), or a bare key-word.
  if (/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(s) || /^(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD)$/.test(s)) return true
  if (/^(x{3,}|\*{3,}|\.{3,}|-+|null|none|true|false)$/i.test(s)) return true
  return /^(?:your[_-]|changeme|change[_-]me|example|placeholder|redacted|dummy)/i.test(s)
}

const KEYWORDS = /api[_-]?key|access[_-]?key|private[_-]?key|passphrase|passwd|password|token|secret|pwd|authorization|bearer/gi
/** Optional endings that keep a key name a key name (secret_key, token_value). `token_count` is not one. */
const KEY_SUFFIXES = ['_key', '-key', 'key', '_value', '_string']
/** An unquoted value ends at whitespace, a quote, a separator, `&` or `}`. Anchored on a short slice. */
const UNQUOTED_VALUE = /^[^\s"',;&}`]*/

function skipSpaces(s: string, p: number): number {
  while (p < s.length && isSpace(s.charCodeAt(p))) p++
  return p
}

/** Read the value starting at p: a quoted value in full, else up to a delimiter. Bounded. */
function readValue(s: string, p: number): string {
  const q = s[p]
  if (q === '"' || q === "'" || q === '`') {
    const window = s.slice(p + 1, p + 1 + MAX_VALUE)
    const end = window.indexOf(q)
    return stripTrailingBackslashes(end === -1 ? window : window.slice(0, end))
  }
  const m = UNQUOTED_VALUE.exec(s.slice(p, p + MAX_VALUE))
  return stripTrailingBackslashes(m ? m[0] : '')
}

/** After a key word: optional suffix, optional (escaped) quote, `:` or `=`, then the value. */
function valueAfterKey(s: string, end: number, suffixes: string[]): string | undefined {
  let p = end
  for (const suf of suffixes) {
    if (s.slice(p, p + suf.length).toLowerCase() === suf) {
      p += suf.length
      break
    }
  }
  while (s[p] === '\\') p++
  if (s[p] === '"' || s[p] === "'") p++
  p = skipSpaces(s, p)
  if (s[p] !== ':' && s[p] !== '=') return undefined
  p = skipSpaces(s, p + 1)
  while (s[p] === '\\') p++
  return readValue(s, p)
}

function flaggable(value: string | undefined, min: number): boolean {
  return value !== undefined && value.length >= min && !isPlaceholder(value)
}

/** Key-name driven rules: key-literal, authorization-header, bearer-token. One pass, bounded reads. */
function keywordKinds(s: string, kinds: Set<string>): void {
  KEYWORDS.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = KEYWORDS.exec(s)) !== null) {
    const kw = m[0].toLowerCase()
    const end = m.index + m[0].length
    const prev = m.index > 0 ? s.charCodeAt(m.index - 1) : 0
    if (kw === 'bearer') {
      if (isAlnum(prev)) continue
      const p = skipSpaces(s, end)
      if (p === end) continue // `bearer` must be followed by whitespace, then the token
      let e = p
      const limit = Math.min(s.length, p + MAX_VALUE)
      while (e < limit && /[A-Za-z0-9._~+/=-]/.test(s[e])) e++
      const value = s.slice(p, e)
      if (flaggable(value, 20)) kinds.add('bearer-token')
    } else if (kw === 'authorization') {
      let p = end
      while (s[p] === '\\') p++
      if (s[p] === '"' || s[p] === "'") p++
      p = skipSpaces(s, p)
      if (s[p] !== ':' && s[p] !== '=') continue
      p = skipSpaces(s, p + 1)
      while (s[p] === '\\') p++
      if (s[p] === '"' || s[p] === "'") p++
      const scheme = /^(?:bearer|basic|token)\s+/i.exec(s.slice(p, p + 12))
      if (scheme) p += scheme[0].length
      if (flaggable(readValue(s, p), 8)) kinds.add('authorization-header')
    } else {
      if (kw === 'pwd' && isLetter(prev)) continue
      if (flaggable(valueAfterKey(s, end, KEY_SUFFIXES), 8)) kinds.add('key-literal')
    }
  }
}

interface PrefixRule {
  kind: string
  prefixes: string[]
  /** characters allowed in the run that follows the prefix */
  run: (c: number) => boolean
  min: number
  /** the character before the prefix must not be a letter or digit */
  boundary: boolean
}

const b64url = (c: number): boolean => isAlnum(c) || c === 45 || c === 95
const upperDigit = (c: number): boolean => (c >= 48 && c <= 57) || (c >= 65 && c <= 90)

const PREFIX_RULES: PrefixRule[] = [
  { kind: 'sk-token', prefixes: ['sk-'], run: b64url, min: 16, boundary: true },
  { kind: 'payment-key', prefixes: ['sk_live_', 'sk_test_', 'rk_live_', 'rk_test_'], run: isAlnum, min: 16, boundary: true },
  { kind: 'aws-access-key', prefixes: ['AKIA', 'ASIA'], run: upperDigit, min: 16, boundary: false },
  { kind: 'github-token', prefixes: ['ghp_', 'gho_', 'ghs_', 'ghu_', 'ghr_'], run: isAlnum, min: 20, boundary: true },
  { kind: 'github-token', prefixes: ['github_pat_'], run: (c) => isAlnum(c) || c === 95, min: 20, boundary: false },
  { kind: 'slack-token', prefixes: ['xoxb-', 'xoxa-', 'xoxp-', 'xoxr-', 'xoxs-'], run: (c) => isAlnum(c) || c === 45, min: 10, boundary: true },
  { kind: 'google-api-key', prefixes: ['AIza'], run: b64url, min: 35, boundary: true },
  { kind: 'gitlab-token', prefixes: ['glpat-'], run: b64url, min: 20, boundary: true },
]

function runEnd(s: string, from: number, test: (c: number) => boolean): number {
  let e = from
  while (e < s.length && test(s.charCodeAt(e))) e++
  return e
}

/** True when `prefix` is followed by a run of at least `min` allowed characters. Linear. */
function hasPrefixedRun(s: string, rule: PrefixRule): boolean {
  for (const prefix of rule.prefixes) {
    let from = 0
    for (;;) {
      const i = s.indexOf(prefix, from)
      if (i < 0) break
      if (rule.boundary && i > 0 && isAlnum(s.charCodeAt(i - 1))) {
        from = i + 1
        continue
      }
      const start = i + prefix.length
      const e = runEnd(s, start, rule.run)
      if (e - start >= rule.min) return true
      from = Math.max(e, start)
    }
  }
  return false
}

/** Three dot-separated base64url segments that start with `eyJ`. Linear: skips past each run. */
function hasJwt(s: string): boolean {
  let from = 0
  for (;;) {
    const i = s.indexOf('eyJ', from)
    if (i < 0) return false
    const e1 = runEnd(s, i, b64url)
    from = Math.max(e1, i + 3)
    if (e1 - i < 13 || s[e1] !== '.') continue
    const e2 = runEnd(s, e1 + 1, b64url)
    if (e2 - (e1 + 1) < 10 || s[e2] !== '.') continue
    return true
  }
}

const AUTHORITY_STOP = new Set(['/', '?', '#', '"', "'", '<', '>', '\\'])

/** `scheme://user:password@host` (and `scheme://<long token>@host`). Bounded look-ahead per `://`. */
function hasUrlUserinfo(s: string): boolean {
  let from = 0
  for (;;) {
    const i = s.indexOf('://', from)
    if (i < 0) return false
    from = i + 3
    let a = i
    while (a > 0 && i - a < 32 && (isAlnum(s.charCodeAt(a - 1)) || '+.-'.includes(s[a - 1]))) a--
    if (a === i) continue // no scheme in front
    let e = from
    const limit = Math.min(s.length, from + 256)
    while (e < limit && !isSpace(s.charCodeAt(e)) && !AUTHORITY_STOP.has(s[e])) e++
    const authority = s.slice(from, e)
    const at = authority.lastIndexOf('@')
    if (at <= 0) continue
    const userinfo = authority.slice(0, at)
    const colon = userinfo.indexOf(':')
    if (colon >= 0) {
      if (!isPlaceholder(userinfo.slice(colon + 1))) return true
    } else if (userinfo.length >= 20 && !isPlaceholder(userinfo)) return true
  }
}

function hasPrivateKey(s: string): boolean {
  let from = 0
  for (;;) {
    const i = s.indexOf('-----BEGIN ', from)
    if (i < 0) return false
    from = i + 11
    if (/^[A-Z ]*PRIVATE KEY-----/.test(s.slice(from, from + 40))) return true
  }
}

const ENV_ASSIGNMENT = /^\s*(?:export\s+)?[A-Z][A-Z0-9_]*_KEY\s*=\s*["']?([^\s"']+)/

function scanWindow(s: string, first: boolean, kinds: Set<string>): void {
  if (hasPrivateKey(s)) kinds.add('private-key')
  for (const rule of PREFIX_RULES) if (hasPrefixedRun(s, rule)) kinds.add(rule.kind)
  if (hasJwt(s)) kinds.add('jwt')
  if (hasUrlUserinfo(s)) kinds.add('url-credentials')
  keywordKinds(s, kinds)
  if (first) {
    const m = ENV_ASSIGNMENT.exec(s)
    if (m && flaggable(m[1], 8)) kinds.add('env-assignment')
  }
}

function scanLine(line: string): Set<string> {
  const kinds = new Set<string>()
  if (line.length <= SCAN_WINDOW) {
    scanWindow(line, true, kinds)
    return kinds
  }
  const stride = SCAN_WINDOW - WINDOW_OVERLAP
  for (let start = 0; start < line.length; start += stride) {
    scanWindow(line.slice(start, start + SCAN_WINDOW), start === 0, kinds)
    if (start + SCAN_WINDOW >= line.length) break
  }
  return kinds
}

export function scanForCredentials(text: string): CredentialFinding[] {
  const findings: CredentialFinding[] = []
  if (typeof text !== 'string' || text === '') return findings
  const lines = text.split(/\r\n|\r|\n/)
  for (let i = 0; i < lines.length && findings.length < MAX_FINDINGS; i++) {
    for (const kind of scanLine(lines[i])) {
      if (findings.length < MAX_FINDINGS) {
        findings.push({ code: 'credential-rejected', line: i + 1, kind })
      }
    }
  }
  return findings
}

export function toGaps(findings: CredentialFinding[]): Gap[] {
  return findings.map((f) => ({
    code: 'credential-rejected',
    severity: 'error' as const,
    message: `Credential-like value (${f.kind}) on line ${f.line}. Remove it and use an env-var placeholder such as <NAME>_API_KEY; the value is not shown or stored.`,
    path: `line ${f.line}`,
  }))
}

/**
 * Environment-file names that no mcpgen input path may read (CR-34, CR-55): `.env`, `.env.*`, `.envrc`, `*.env`
 * and the bare `env.<stage>` spellings. Ordinary documents about environments (`environment.md`) are not matched.
 * One implementation for the library, the pack collector and both CLIs.
 */
export function isEnvFileName(path: string): boolean {
  const n = (String(path).split(/[\\/]/).pop() ?? '').toLowerCase()
  return n === 'env' || n.startsWith('.env') || n.endsWith('.env') || /^env\.(?:local|production|prod|development|dev|test|staging|stage)$/.test(n)
}
