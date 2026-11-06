// Shared text-hygiene primitives and the filter for spec-derived descriptions (Phase 21).
// Text taken from a source document is untrusted and is published to the model that uses the generated
// server. cleanSpecText removes or replaces what must not reach a description: links, markup, template
// syntax, credential-shaped text, control characters and instruction-like phrases. The proposal gate
// (proposals/hygiene.ts) reuses the detection primitives below and keeps its stricter reject behaviour.
// Pure, linear, never throws, never returns the offending text.
import { INSTRUCTION_REMOVED, LINK_REMOVED, redactSecrets, sanitizeSourceText } from './redact.js'

/** Longest text the filter looks at; callers clip to far less. */
const MAX_INPUT = 8192

// Control characters except tab and newline, plus characters a human cannot see but a model reads
// (zero-width, bidi, soft hyphen, variation selectors, interlinear annotation, Unicode tag characters), and
// the BOM. By code point, so this file holds no invisible characters (review CR-39).
export function isControlCode(c: number): boolean {
  if (c <= 0x08 || (c >= 0x0b && c <= 0x1f) || (c >= 0x7f && c <= 0x9f)) return true
  if (c === 0x00ad || c === 0x061c || c === 0x180e || c === 0xfeff) return true
  if ((c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) || (c >= 0x2060 && c <= 0x206f)) return true
  if ((c >= 0xfe00 && c <= 0xfe0f) || (c >= 0xfff9 && c <= 0xfffb)) return true
  return (c >= 0xe0000 && c <= 0xe007f) || (c >= 0xe0100 && c <= 0xe01ef)
}

export function hasControl(s: string): boolean {
  for (const ch of s) if (isControlCode(ch.codePointAt(0)!)) return true
  return false
}

/** Replace every control, zero-width and bidi character with a space. */
export function stripControl(s: string): string {
  let out = ''
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    out += isControlCode(c) || (c >= 0xd800 && c <= 0xdfff) ? ' ' : ch // a lone surrogate breaks JSON/UTF-8 consumers
  }
  return out
}

/** s.slice(0, n) that never leaves half of a surrogate pair (review CR-40). */
export function clipText(s: string, n: number): string {
  if (n <= 0) return ''
  if (s.length <= n) return s
  const last = s.charCodeAt(n - 1)
  return s.slice(0, last >= 0xd800 && last <= 0xdbff ? n - 1 : n)
}

// Domain endings treated as links. Not a public-suffix list: only endings that are rarely a file extension
// or a field name (review CR-42; "in", "it", "to", "no", "me", "sh", "cc", "page" are left out on purpose).
const TLDS =
  'com|org|net|io|dev|ai|app|edu|gov|example|local|internal|test|xyz|co|uk|de|fr|ru|cn|info|biz|us|eu|fi|se|nl|tk|top|site|online|cloud|tech|ly|tv|shop|store|link|click|club|live|fun|icu|jp|kr|br|au|ca|ch|es|pl|ua'
// Obfuscated dots: "example[.]com", "example(dot)com".
const OBFUSCATED_DOT = /\[\.\]|\(dot\)|\[dot\]/i

/** Detection patterns (test only; not global). */
export const URL_LIKE: RegExp[] = [
  /\b[a-z][a-z0-9+.-]{1,31}:\/\//i,
  /\bwww\./i,
  new RegExp(`\\b[a-z0-9-]+\\.(?:${TLDS})(?![a-z0-9_])`, 'i'),
  OBFUSCATED_DOT,
  /\]\(/,
  /\bmailto:/i,
]
export const MARKUP = /[<>`]|\$\{|\{\{|<%|%>/

// Replacement of link-carrying words. Works word by word with bounded, unanchored tests; a pattern with a
// leading unbounded `\S*` is quadratic on a long token (review CR-38).
const SCHEME_AT = /[a-z][a-z0-9+.-]{1,31}:\/\//i
const WWW_AT = /(?:^|[^a-z0-9_])www\./i
const DOMAIN_AT = new RegExp(`[a-z0-9-]\\.(?:${TLDS})(?![a-z0-9_])`, 'i')
const isLabelChar = (c: string): boolean => /[a-z0-9.-]/i.test(c)

/** The word without its link, or '' when it is dropped whole. */
function dropLink(w: string): string {
  if (SCHEME_AT.test(w) || WWW_AT.test(w) || /mailto:/i.test(w) || OBFUSCATED_DOT.test(w)) return ''
  const m = DOMAIN_AT.exec(w)
  if (!m) return w
  let a = m.index
  while (a > 0 && isLabelChar(w[a - 1])) a--
  return w.slice(0, a)
}
function removeLinkWords(t: string): string {
  return t.replace(/\S+/g, (w) => (w.length <= 2 ? w : dropLink(w) || ' '))
}
const TEMPLATE_SPAN: RegExp[] = [/\$\{[^}]{0,200}\}/g, /\{\{[^}]{0,200}\}\}/g, /<%[^%]{0,200}%>/g]
const LEFTOVER_MARKUP = /[<>`]|\$\{|\{\{|\}\}|<%|%>/g
// Markdown link -> its label (before link removal, which would otherwise leave a dangling "](").
const MD_LINK = /\[([^\]]{0,80})\]\((?:[^()]|\([^()]{0,100}\)){0,200}\)/g
const REMOVAL_MARKERS = [LINK_REMOVED, INSTRUCTION_REMOVED]

export interface CleanSpecResult {
  text: string
  /** True when instruction-like (model-directed) text was found and dropped. */
  flagged: boolean
}

/** cleanSpecText plus whether model-directed phrases were dropped. */
export function cleanSpecTextFlagged(s: unknown, max = 200): CleanSpecResult {
  try {
    const raw = typeof s === 'string' ? s : s === undefined || s === null ? '' : String(s)
    // Redact secrets and links, drop model-directed phrases, flatten markdown links and tags.
    const r = sanitizeSourceText(stripControl(raw.slice(0, Math.min(MAX_INPUT, Math.max(1, max) * 4))).normalize('NFKC').replace(MD_LINK, '$1'))
    let t = r.text
    for (const m of REMOVAL_MARKERS) t = t.split(m).join(' ')
    t = removeLinkWords(t)
    for (const re of TEMPLATE_SPAN) t = t.replace(re, ' ')
    t = t.replace(LEFTOVER_MARKUP, ' ')
    t = redactSecrets(t).replace(/\s+/g, ' ').trim()
    // Tidy the gaps that removal leaves before punctuation.
    t = t.replace(/\s+([.,;:!?])/g, '$1')
    if (t.length > max) t = `${clipText(t, Math.max(0, max - 3)).trimEnd()}...`
    return { text: t, flagged: r.flagged }
  } catch {
    return { text: '', flagged: false }
  }
}

/** Sanitise spec-derived description text. Returns '' when nothing safe remains (callers fall back to defaults). */
export function cleanSpecText(s: unknown, max = 200): string {
  return cleanSpecTextFlagged(s, max).text
}
