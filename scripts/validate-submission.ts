// Author-facing submission validator (Phase 13). Read-only: no DB, no network, nothing from
// the submission is executed or imported. It is a validator, so it always uses the format
// registry and works regardless of the AGENT_KINDS flag (agentKindsEnabled is never called).
// It never throws: every problem becomes a reported warning.
import { lstatSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { parseSubmission, detectFormats } from '../src/lib/spec/registry.js'
import { readSubmissionDir } from '../src/lib/spec/scan.js'
import type { ParseOutcome, SubmissionFile, SubmissionStatus } from '../src/lib/spec/kinds.js'
import { sanitizeMessage } from '../src/lib/spec/security.js'
import { isMainModule } from './is-main.js'

export interface ReportItem {
  name: string
  status: SubmissionStatus
  format: string
  kind: string | null
  framework: string | null
  topology: string | null
  memberCount: number
  missingFromAuthor: string[]
  unknownFields: string[]
  warnings: string[]
  skippedFiles: string[]
}

export interface ValidationResult {
  path: string
  items: ReportItem[]
  summary: { ingestible: number; partial: number; missingFromAuthor: number }
  notes: string[]
}

/** Exit code for an unexpected internal error (1 is a --strict failure, 2 is usage). */
export const INTERNAL_ERROR_EXIT = 3
const MAX_ITEMS = 200
const MAX_STR = 300
const MAX_LIST = 50
const DATA_EXT = /\.(ya?ml|json|jsonc|md)$/i

/** Strip secret-looking tokens, control characters and excess length from any printed string. */
function clean(s: unknown): string {
  // The short (8+) sk- rule is a stricter extra on top of the shared list that sanitizeMessage applies (G2).
  const t = (typeof s === 'string' ? s : String(s)).replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
  return sanitizeMessage(t, MAX_STR)
}
const cleanList = (l: unknown): string[] =>
  (Array.isArray(l) ? l : []).slice(0, MAX_LIST).map(clean)

function toItem(name: string, outcome: ParseOutcome, skipped: string[]): ReportItem {
  return {
    name: clean(name),
    status: outcome.status,
    format: clean(outcome.format),
    kind: outcome.kindInfo?.kind ?? null,
    framework: outcome.kindInfo?.framework ? clean(outcome.kindInfo.framework) : null,
    topology: outcome.kindInfo?.topology ? clean(outcome.kindInfo.topology) : null,
    memberCount: outcome.kindInfo?.members.length ?? 0,
    missingFromAuthor: cleanList(outcome.missingFromAuthor),
    unknownFields: cleanList(outcome.unknownFields),
    warnings: cleanList(outcome.warnings),
    skippedFiles: cleanList(skipped),
  }
}

function failItem(name: string, warning: string): ReportItem {
  return {
    name: clean(name),
    status: 'missing-from-author',
    format: 'unknown',
    kind: null,
    framework: null,
    topology: null,
    memberCount: 0,
    missingFromAuthor: ['recognizable agent definition'],
    unknownFields: [],
    warnings: [clean(warning)],
    skippedFiles: [],
  }
}

function itemFor(name: string, target: string): ReportItem {
  try {
    const { files, skipped } = readSubmissionDir(target)
    // The folder (or file stem) names the submission when its files carry no usable name (CR-02).
    const hint = DATA_EXT.test(name) ? name.replace(/\.[^.]+$/, '') : name
    const outcome = parseSubmission(files, { now: new Date().toISOString(), hint })
    return toItem(name, outcome, skipped)
  } catch (e) {
    return failItem(name, `could not be validated: ${e instanceof Error ? e.message : 'error'}`)
  }
}

function detects(files: SubmissionFile[]): boolean {
  try {
    return detectFormats(files).length > 0
  } catch {
    return false
  }
}

function tally(items: ReportItem[]): ValidationResult['summary'] {
  const s = { ingestible: 0, partial: 0, missingFromAuthor: 0 }
  for (const i of items) {
    if (i.status === 'ingestible') s.ingestible++
    else if (i.status === 'partial') s.partial++
    else s.missingFromAuthor++
  }
  return s
}

export function validateSubmissionPath(path: string): ValidationResult {
  const notes: string[] = []
  let items: ReportItem[] = []
  try {
    let st
    try {
      st = lstatSync(path)
    } catch {
      return {
        path,
        items: [failItem(basename(path) || path, 'path not found')],
        summary: { ingestible: 0, partial: 0, missingFromAuthor: 1 },
        notes,
      }
    }
    if (st.isSymbolicLink()) {
      items = [failItem(basename(path), 'symlinks are not followed')]
    } else if (st.isFile()) {
      items = [itemFor(basename(path), path)]
    } else if (st.isDirectory()) {
      // 1. Does the folder itself (its direct files) contain a submission?
      const whole = readSubmissionDir(path)
      const direct = whole.files.filter((f) => !f.path.includes('/'))
      if (direct.length > 0 && detects(direct)) {
        items = [itemFor(basename(path) || path, path)]
      } else {
        // 2. Depth-1 children: sub-folders and top-level data files.
        let names: string[] = []
        try {
          names = readdirSync(path).sort()
        } catch {
          notes.push('folder could not be read')
        }
        for (const n of names) {
          if (items.length >= MAX_ITEMS) {
            notes.push(`more than ${MAX_ITEMS} entries; the rest were not checked`)
            break
          }
          if (n.startsWith('.') || n === 'node_modules') continue
          const child = join(path, n)
          let cst
          try {
            cst = lstatSync(child)
          } catch {
            continue
          }
          if (cst.isSymbolicLink()) {
            items.push(failItem(n, 'symlinks are not followed'))
          } else if (cst.isDirectory() || (cst.isFile() && DATA_EXT.test(n))) {
            items.push(itemFor(n, child))
          }
        }
        // 3. Nested layout (e.g. config/agents.yaml): the whole folder is one submission.
        if (
          items.every((i) => i.format === 'unknown') &&
          whole.files.length > 0 &&
          detects(whole.files)
        ) {
          items = [itemFor(basename(path) || path, path)]
        }
      }
      if (items.length === 0) notes.push('no submissions found in this folder')
    } else {
      items = [failItem(basename(path), 'not a regular file or folder')]
    }
  } catch (e) {
    items = [
      failItem(basename(path) || path, `unexpected error: ${e instanceof Error ? e.message : 'error'}`),
    ]
  }
  return { path, items, summary: tally(items), notes }
}

export function formatReport(result: ValidationResult): string {
  const lines: string[] = []
  for (const it of result.items) {
    const tag = it.status === 'missing-from-author' ? 'MISSING-FROM-AUTHOR' : it.status.toUpperCase()
    const bits = [it.format, it.kind ?? 'no kind']
    if (it.framework) bits.push(it.framework)
    lines.push(`[${tag}] ${it.name} (${bits.join(', ')})`)
    if (it.topology || it.memberCount) {
      lines.push(`  topology: ${it.topology ?? 'n/a'}, members: ${it.memberCount}`)
    }
    if (it.missingFromAuthor.length) {
      lines.push('  missing from author:')
      for (const m of it.missingFromAuthor) lines.push(`    - ${m}`)
    }
    if (it.unknownFields.length) {
      lines.push('  unknown fields:')
      for (const u of it.unknownFields) lines.push(`    - ${u}`)
    }
    if (it.warnings.length) {
      lines.push('  warnings:')
      for (const w of it.warnings) lines.push(`    - ${w}`)
    }
    if (it.skippedFiles.length) {
      lines.push('  skipped files:')
      for (const s of it.skippedFiles) lines.push(`    - ${s}`)
    }
  }
  for (const n of result.notes) lines.push(`note: ${n}`)
  const s = result.summary
  lines.push(
    `${result.items.length} submission(s): ${s.ingestible} ingestible, ${s.partial} partial, ${s.missingFromAuthor} missing-from-author`,
  )
  return lines.join('\n')
}

export function main(
  argv: string[],
  io: { out: (s: string) => void; err: (s: string) => void } = {
    out: console.log,
    err: console.error,
  },
): number {
  try {
    const json = argv.includes('--json')
    const strict = argv.includes('--strict')
    const path = argv.find((a) => !a.startsWith('--'))
    if (!path) {
      io.err('Usage: npm run validate-submission -- <file-or-folder> [--json] [--strict]')
      return 2
    }
    const result = validateSubmissionPath(path)
    io.out(json ? JSON.stringify(result, null, 2) : formatReport(result))
    if (strict && result.items.some((i) => i.status !== 'ingestible')) return 1
    return 0
  } catch (e) {
    try {
      io.err(`validate-submission: ${e instanceof Error ? clean(e.message) : 'error'}`)
    } catch {
      /* the exit code below is what matters */
    }
    // WR-08: an internal failure must fail a CI gate (also with --strict), never report success.
    return INTERNAL_ERROR_EXIT
  }
}

const isMain = isMainModule(import.meta.url, process.argv[1])
if (isMain) {
  process.exitCode = main(process.argv.slice(2))
}
