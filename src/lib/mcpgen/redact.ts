// Output-side sanitizers (review CR-03, WR-06). Free text from a source document is untrusted: even
// when the input scan passed, text copied into generated files must not carry links with embedded
// credentials, tokens or key assignments. Everything here is linear in the text length and never
// throws. The input scanner (credentials.ts) stays a defence layer; this is what the output relies on.
import { scanForCredentials } from './credentials.js'

export const REMOVED = '[removed]'
export const LINK_REMOVED = '[link removed]'

/** Longest text a sanitizer looks at; callers clip to far less afterwards. */
const MAX_INPUT = 8192

const isSchemeChar = (c: string): boolean => /[A-Za-z0-9+.-]/.test(c)

/** Replace `scheme://rest-of-word` for ANY scheme (not just http and https). */
export function removeLinks(s: string): string {
  let out = ''
  let from = 0
  for (;;) {
    const i = s.indexOf('://', from)
    if (i < 0) break
    let a = i
    while (a > from && i - a < 32 && isSchemeChar(s[a - 1])) a--
    if (a === i) {
      out += s.slice(from, i + 3)
      from = i + 3
      continue
    }
    let e = i + 3
    while (e < s.length && !/\s/.test(s[e])) e++
    out += s.slice(from, a) + LINK_REMOVED
    from = e
  }
  return out + s.slice(from)
}

/** `user:secret@host` without a scheme. */
function hasBareUserinfo(w: string): boolean {
  const at = w.indexOf('@')
  if (at < 2 || at === w.length - 1) return false
  const colon = w.lastIndexOf(':', at)
  return colon > 0 && colon < at - 1
}

/** A long run of base64, base64url or hex characters that mixes letters and digits. */
function replaceLongTokens(w: string): string {
  return w.replace(/[A-Za-z0-9+/_=-]{32,}/g, (run) => (/[0-9]/.test(run) && /[A-Za-z]/.test(run) ? REMOVED : run))
}

/**
 * Remove link and token shaped substrings, then re-scan the result with the full credential scanner;
 * when anything credential-like is still present the whole text is replaced. Fail closed.
 */
export function redactSecrets(input: string): string {
  let s = input.length > MAX_INPUT ? input.slice(0, MAX_INPUT) : input
  s = removeLinks(s)
  s = s.replace(/\S+/g, (w) => {
    if (w === REMOVED || w === LINK_REMOVED) return w
    if (hasBareUserinfo(w) || scanForCredentials(w).length > 0) return REMOVED
    return replaceLongTokens(w)
  })
  return scanForCredentials(s).length > 0 ? REMOVED : s
}

/** Phrases that address the model rather than describe the API (heuristic, WR-06). Bounded patterns. */
const MODEL_DIRECTED: RegExp[] = [
  /\b(?:ignore|disregard|forget|override)\b[^.!?\n]{0,40}\b(?:previous|prior|above|earlier|preceding|all)\b[^.!?\n]{0,40}\b(?:instructions?|prompts?|rules?|messages?)\b/gi,
  /\b(?:system|developer)\s+(?:prompt|message|instructions?)\b/gi,
  /\b(?:from\s+now\s+on|you\s+are\s+now)\b/gi,
  /(?:^|\s)(?:system|assistant)\s*:/gi,
  /<\|[^>]{0,60}>/g,
]

export const INSTRUCTION_REMOVED = '[instruction-like text removed]'

/**
 * Text that will be published as part of a tool description: secrets removed, markup and link
 * syntax flattened, and phrases that address the model replaced. `flagged` is true when any
 * model-directed phrase was removed.
 */
export function sanitizeSourceText(input: string): { text: string; flagged: boolean } {
  let t = redactSecrets(input)
  let flagged = false
  for (const re of MODEL_DIRECTED) {
    t = t.replace(re, () => {
      flagged = true
      return INSTRUCTION_REMOVED
    })
  }
  t = t
    .replace(/\[([^\]]{0,80})\]\((?:[^()]|\([^()]{0,100}\)){0,200}\)/g, '$1') // markdown link -> its label
    .replace(/<\/?[A-Za-z!][^>]{0,80}>/g, ' ') // markup tags
    .replace(/\s+/g, ' ')
    .trim()
  return { text: t, flagged }
}
