// Text hygiene for proposal text (gate 3). Descriptions are published to the model that will use the
// server, so they get the same suspicion as source text plus rules for text an author wrote on purpose:
// no links, no markup, no credential-shaped strings, no instructions addressed to the model, no claim
// of write capability, no limit numbers that differ from the server's real limits.
// Pure, linear, never throws, never returns the offending text (only stable codes).
import { scanForCredentials } from '../credentials.js'
import { hasControl, MARKUP, URL_LIKE } from '../hygiene.js'
import { redactSecrets, sanitizeSourceText } from '../redact.js'

export type TextKind = 'description' | 'constant' | 'reason'

const INJECTION: RegExp[] = [
  /\b(?:ignore|disregard|forget|bypass|override)\b/i,
  /\b(?:always|never|must|should)\s+(?:call|use|invoke|run|execute|prefer|choose)\b/i,
  /\b(?:instead\s+of|rather\s+than)\s+(?:calling|using)\b/i,
  /\bdo\s+not\s+(?:tell|inform|mention|reveal|show|warn)\b/i,
  /\byou\s+(?:are|must|will|should|shall)\b/i,
  /\b(?:before|after)\s+(?:calling|using)\s+(?:any|every|all|other)\b/i,
  /\b(?:exfiltrat|send\s+(?:it|this|them|the\s+\w+)\s+to\b)/i,
  /(?:^|\s)(?:system|assistant|user|developer)\s*:/i,
  /\b(?:jailbreak|prompt\s+injection|new\s+instructions?)\b/i,
]
const CREDENTIAL_WORD = /\b(?:password|passwd|passphrase|secret|api[_ -]?key|bearer|credential|private[_ -]?key|access[_ -]?token)s?\b/i
// All verb forms (creates, creating, created ...); CR-30.
const WRITE_CLAIM = /\b(?:(?:creat|updat|delet|overwrit|remov|truncat|mutat)(?:e|es|ed|ing)|insert(?:s|ed|ing)?|modif(?:y|ies|ied|ying)|writ(?:e|es|ing|ten)|wrote|overwrote|drop(?:s|ped|ping)?)\b/gi
// A past participle that only locates a timestamp ("updated since a date") is not a claim.
const PARTICIPLE_TIME = /^(?:updated|created|modified)$/i
const TIME_WORD_AFTER = /^\s+(?:since|after|before|on|at|in|between|during|from)\b/i
// A write verb is not a claim when the same clause negates it ("Does not delete or modify any data"): the
// negation must be directly before the verb with only write verbs, "or"/"nor" and filler words between, so
// "Does not delete, but updates rows" and "Does not delete and updates rows" are still claims.
const WRITE_VERB_WORD = '(?:creat\\w*|updat\\w*|delet\\w*|modif\\w*|insert\\w*|overwrit\\w*|writ\\w*|remov\\w*|drop\\w*|truncat\\w*|mutat\\w*|chang\\w*|alter\\w*|edit\\w*)'
const NEGATED_BEFORE = new RegExp(`(?:\\b(not|never|cannot|without|neither|nor)|n't)\\s+(?:(?:${WRITE_VERB_WORD}|or|nor|ever)\\s+)*$`, 'i')
// "update" as a noun naming returned data ("the last update time", "update date"), not as an action.
const UPDATE_NOUN_BEFORE = /\b(?:last|latest|recent|since\s+the)\s+$/i
const UPDATE_NOUN_AFTER = /^\s+(?:date|time|timestamp|count|history|log)\b/i
const LIMIT_CLAIM = /\b(?:max(?:imum)?|at\s+most|up\s+to|limit(?:ed)?(?:\s+(?:of|to))?|clamp(?:ed)?(?:\s+(?:to|at))?)\s*(?:of\s+)?(\d[\d,]*)/gi

function hasWriteClaim(text: string): boolean {
  for (const m of text.matchAll(WRITE_CLAIM)) {
    const at = m.index ?? 0
    const before = text.slice(Math.max(0, at - 80), at)
    const neg = NEGATED_BEFORE.exec(before)
    // After an auxiliary negation ("does not", "cannot") the following verbs are base forms, so a third-person
    // form ("does not delete or updates rows") is a new claim; "never"/"without" may take -s forms.
    const thirdPerson = /[^s]s$/i.test(m[0])
    const aux = neg !== null && (neg[1] === undefined || /^(?:not|cannot|neither|nor)$/i.test(neg[1]))
    if (neg !== null && !(aux && thirdPerson)) continue
    const after = text.slice(at + m[0].length, at + m[0].length + 20)
    if (/^update$/i.test(m[0]) && (UPDATE_NOUN_BEFORE.test(before) || UPDATE_NOUN_AFTER.test(after))) continue
    if (PARTICIPLE_TIME.test(m[0]) && TIME_WORD_AFTER.test(after)) continue
    return true
  }
  return false
}

export interface TextOptions {
  kind: TextKind
  /** Numbers a limit claim may name (the server's real limits). */
  allowedNumbers?: Set<number>
}

/** Stable codes for everything wrong with the text; [] means clean. */
export function textCodes(raw: string, opts: TextOptions): string[] {
  const out: string[] = []
  if (typeof raw !== 'string' || raw.trim() === '') return ['text-empty']
  // Checks other than the control scan run on the NFKC form, so full-width spellings are matched (CR-39).
  const text = raw.normalize('NFKC')
  if (hasControl(raw)) out.push('text-control-chars')
  if (scanForCredentials(text).length > 0 || redactSecrets(text) !== text) out.push('text-credential')
  if (URL_LIKE.some((re) => re.test(text))) out.push('text-url')
  if (MARKUP.test(text)) out.push('text-markup')
  if (opts.kind === 'reason') return [...new Set(out)]
  if (opts.kind === 'description') {
    if (sanitizeSourceText(text).flagged || INJECTION.some((re) => re.test(text))) out.push('text-injection')
    if (CREDENTIAL_WORD.test(text)) out.push('text-credential-word')
    if (hasWriteClaim(text)) out.push('text-write-claim')
    if (opts.allowedNumbers) {
      for (const m of text.matchAll(LIMIT_CLAIM)) {
        const n = Number(m[1].replace(/,/g, ''))
        if (!opts.allowedNumbers.has(n)) {
          out.push('text-limit-claim')
          break
        }
      }
    }
  }
  return [...new Set(out)]
}

/** A short, safe rendering of a user-supplied identifier for a message (never a secret-looking value). */
export function show(s: unknown): string {
  if (typeof s !== 'string') return '(not text)'
  if (s.length > 48 || scanForCredentials(s).length > 0 || redactSecrets(s) !== s) return '[value]'
  return s.replace(/[^A-Za-z0-9_.\-[\]]/g, '?')
}
