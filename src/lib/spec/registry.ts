// Format registry (Phase 13): detect then parse, never throws. Pure over SubmissionFile[]
// (no fs). Only reachable from flag-gated code.
//
// Every outcome passes through `finalize`, the single place that enforces the submission-wide
// invariants no adapter may skip: secrets never reach extras, members or free-text record fields
// (CR-01, WR-10), the slug is non-empty and bounded (CR-02), titles and member strings are
// bounded (WR-07), and a record URL is http(s) or dropped (CR-03).
import type { DetectResult, FormatAdapter, ParseContext, ParseOutcome, SubmissionFile } from './kinds.js'
import { clampExtras, clampMembers, TITLE_MAX_BYTES } from './kinds.js'
import { ADAPTERS } from './formats/index.js'
import { unrecognizedOutcome } from './outcome.js'
import { capText, redactSecrets, redactText, sanitizeMessage, scanSecrets, scanTruncated } from './security.js'
import { finalizeSlug } from './slug.js'
import { safeHttpUrl } from '../safeUrl.js'

export { unrecognizedOutcome }

export function listAdapters(): FormatAdapter[] {
  return ADAPTERS.slice()
}

/** All adapters that detect, best first (confidence desc, then adapter order). */
export function detectFormats(
  files: SubmissionFile[],
): Array<{ adapter: FormatAdapter } & DetectResult> {
  const hits: Array<{ adapter: FormatAdapter; order: number } & DetectResult> = []
  ADAPTERS.forEach((adapter, order) => {
    try {
      const r = adapter.detect(files)
      if (r) hits.push({ adapter, order, format: r.format, confidence: r.confidence })
    } catch {
      /* a failing detector is a non-detect */
    }
  })
  hits.sort((a, b) => b.confidence - a.confidence || a.order - b.order)
  return hits.map(({ adapter, format, confidence }) => ({ adapter, format, confidence }))
}

const dedupe = (list: string[]): string[] => [...new Set(list)]

function finalize(outcome: ParseOutcome, ctx: ParseContext): ParseOutcome {
  const warnings = [...outcome.warnings]
  let record = outcome.record
  let kindInfo = outcome.kindInfo

  if (kindInfo) {
    const found = [...scanSecrets(kindInfo.extras), ...scanSecrets(kindInfo.members)]
    const truncated = [...scanTruncated(kindInfo.extras), ...scanTruncated(kindInfo.members)]
    // Redaction always runs (idempotent), so no adapter can forget it.
    kindInfo = {
      ...kindInfo,
      members: clampMembers(redactSecrets(kindInfo.members)),
      extras: clampExtras(redactSecrets(kindInfo.extras)),
    }
    if (found.length > 0) {
      warnings.push(`secret-like values redacted (${found.length}): ${found.slice(0, 5).join(', ')}`)
    }
    if (truncated.length > 0) {
      warnings.push(
        `nesting too deep to inspect for secrets; truncated (${truncated.length}): ${truncated.slice(0, 3).join(', ')}`,
      )
    }
  }

  if (record) {
    const r = { ...record }
    const redactedFields: string[] = []
    for (const field of ['systemPrompt', 'summary', 'title'] as const) {
      const clean = redactText(r[field])
      if (clean !== r[field]) {
        r[field] = clean
        redactedFields.push(field)
      }
    }
    if (redactedFields.length > 0) {
      warnings.push(`secret-like values redacted in record text: ${redactedFields.join(', ')}`)
    }
    r.title = capText(r.title, TITLE_MAX_BYTES).text
    if (r.githubUrl !== null && safeHttpUrl(r.githubUrl) === null) {
      r.githubUrl = null
      warnings.push('github_url is not an http(s) URL; dropped')
    }
    const fin = finalizeSlug(r.slug, r.title, ctx.hint)
    if (fin.derived) warnings.push('slug derived from the folder name or a hash: the name has no ASCII letters or digits')
    r.slug = fin.slug
    record = r
  }

  return { ...outcome, record, kindInfo, warnings: dedupe(warnings.map((w) => sanitizeMessage(w, 500))) }
}

export function parseSubmission(files: SubmissionFile[], ctx: ParseContext): ParseOutcome {
  try {
    const list = Array.isArray(files) ? files : []
    const best = detectFormats(list)[0]
    if (!best) return unrecognizedOutcome()
    let outcome: ParseOutcome
    try {
      outcome = best.adapter.parse(list, ctx)
    } catch (e) {
      return unrecognizedOutcome([
        sanitizeMessage(`adapter ${best.adapter.id} failed: ${e instanceof Error ? e.message : 'error'}`, 500),
      ])
    }
    return finalize(outcome, ctx)
  } catch (e) {
    return unrecognizedOutcome([`registry error: ${e instanceof Error ? e.message : 'error'}`])
  }
}
