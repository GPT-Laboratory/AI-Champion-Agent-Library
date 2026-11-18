// src/lib/server/tryitout/postRunCheck.ts
// Server-only module — SvelteKit enforces that src/lib/server/ cannot be imported client-side.
//
// Optional per-agent check that runs after a successful Try It Out job, on the container path and the direct-model
// fallback alike (docs/tryitout-post-run-check.md). A check is deterministic own code (no model call): it reads the
// job's input and output files and returns a report. The report is added to the artifact as one extra file, and its
// summary (plus the first findings) goes to the progress feed. A check never changes or removes the agent's own files
// and never fails the job: a check that throws only costs the report.

import { checkEbomResult, hasResultTable } from '$lib/ebom/ebomCheck'
import { MAX_ARTIFACT_BYTES, MAX_ARTIFACT_FILES } from './artifact'
import { pushEvent } from '../tryItOutJobs'
import { logDetail } from './redact'

export interface PostRunInput {
  /** The task text of the job. */
  task: string
  /** The uploaded file as text, or null when the job had no upload. */
  upload: string | null
  /** The agent's output files (relative path -> bytes), as they go into the artifact. */
  files: Readonly<Record<string, Uint8Array>>
}

export interface PostRunReport {
  /** File name of the report in the artifact (top level). */
  file: string
  /** Report text (Markdown). */
  text: string
  /** One line for the progress feed. */
  summary: string
  /** Individual findings; the first MAX_FEED_FINDINGS go to the feed, all of them are in the file. */
  findings: string[]
}

export type PostRunCheck = (input: PostRunInput) => PostRunReport

/** Findings shown in the progress feed; the rest are only in the report file. */
export const MAX_FEED_FINDINGS = 5

const decoder = new TextDecoder('utf-8')
const text = (b: Uint8Array): string => decoder.decode(b)

// ------------------------------------------------------------------ ifc-ebom-compiler: the ebom-join check

export const EBOM_CHECK_FILE = 'ebom-join-check.md'

/** The output file that holds the class rows: result.md (SKILL.md) first, then any .md or .txt with the table. */
export function findEbomResult(files: Readonly<Record<string, Uint8Array>>): string | null {
  const names = Object.keys(files).sort()
  const candidates = ['result.md', ...names.filter((n) => n !== 'result.md' && /\.(md|txt)$/i.test(n))]
  for (const n of candidates) {
    const b = files[n]
    if (b && hasResultTable(text(b))) return n
  }
  return null
}

export const ebomJoinCheck: PostRunCheck = ({ task, upload, files }) => {
  const source = upload !== null ? 'the uploaded file' : 'the task text (no file was uploaded)'
  const head = (what: string) =>
    [
      '# ebom-join check',
      '',
      'Written by the app after the run, not by the agent. The deterministic ebom-join helper',
      '(src/lib/ebom/ebomJoin.ts, the same code as scripts/ebom-join.ts) worked out every class row from the',
      `input and compared it with the agent's result. No model call. Input: ${source}. ${what}`,
      '',
    ].join('\n')

  const resultFile = findEbomResult(files)
  if (resultFile === null) {
    return {
      file: EBOM_CHECK_FILE,
      text: `${head('Result checked: none.')}\nThe output has no \`## E-BOM class rows\` table, so nothing was checked.\n`,
      summary: 'helper check: no E-BOM class rows table in the output, nothing checked',
      findings: [],
    }
  }
  const r = checkEbomResult(upload ?? task, text(files[resultFile]))
  const body = `${head(`Result checked: ${resultFile}.`)}\n${r.out}\n`
  if (r.code === 2) {
    return {
      file: EBOM_CHECK_FILE,
      text: body,
      summary: `helper check: could not read the input or result (${r.out.replace(/^error: /, '').slice(0, 200)})`,
      findings: [],
    }
  }
  if (r.code === 0) {
    return { file: EBOM_CHECK_FILE, text: body, summary: 'helper check: the class rows match the ebom-join helper on every cell', findings: [] }
  }
  const parts = [
    r.problems.length ? `${r.problems.length} contract problem${r.problems.length === 1 ? '' : 's'}` : '',
    r.diffs.length ? `${r.diffs.length} mismatch${r.diffs.length === 1 ? '' : 'es'} with the ebom-join helper` : '',
  ].filter(Boolean)
  return {
    file: EBOM_CHECK_FILE,
    text: body,
    summary: `helper check: ${parts.join(', ')} (details in ${EBOM_CHECK_FILE})`,
    findings: [...r.problems, ...r.diffs],
  }
}

// ------------------------------------------------------------------ registry and runner

/** slug -> check. A Map, so a slug such as "constructor" never reaches an Object prototype member. */
export const POST_RUN_CHECKS: ReadonlyMap<string, PostRunCheck> = new Map([['ifc-ebom-compiler', ebomJoinCheck]])

export interface PostRunResult {
  /** File to add to the artifact, or null (no check, the check threw, or the file could not be added). */
  file: { name: string; bytes: Uint8Array } | null
  /** Progress feed lines, in order. */
  events: string[]
}

/** Runs the slug's check, if any. Pure apart from logging; never throws. */
export function runPostRunCheck(
  slug: string,
  input: PostRunInput,
  checks: ReadonlyMap<string, PostRunCheck> = POST_RUN_CHECKS,
): PostRunResult {
  const check = checks.get(slug)
  if (!check) return { file: null, events: [] }
  let report: PostRunReport
  try {
    report = check(input)
  } catch (err) {
    logDetail(`post-run check for ${slug} failed:`, err)
    return { file: null, events: ['helper check failed to run; the result is unchecked'] }
  }
  const events = [report.summary]
  for (const f of report.findings.slice(0, MAX_FEED_FINDINGS)) events.push(`  ${f}`)
  if (report.findings.length > MAX_FEED_FINDINGS) {
    events.push(`  … and ${report.findings.length - MAX_FEED_FINDINGS} more in ${report.file}`)
  }

  const bytes = new TextEncoder().encode(report.text)
  const names = Object.keys(input.files)
  const total = names.reduce((n, k) => n + input.files[k].byteLength, 0)
  let skip: string | null = null
  if (Object.hasOwn(input.files, report.file)) skip = `the output already has a file named ${report.file}`
  else if (names.length + 1 > MAX_ARTIFACT_FILES) skip = `the output already has ${names.length} files`
  else if (total + bytes.byteLength > MAX_ARTIFACT_BYTES) skip = 'the output is at the artifact size limit'
  if (skip) {
    events.push(`helper check report not added to the download: ${skip}`)
    return { file: null, events }
  }
  return { file: { name: report.file, bytes }, events }
}

/** runPostRunCheck plus the feed lines for the job. Never throws. */
export function applyPostRunCheck(jobId: string, slug: string, input: PostRunInput): PostRunResult['file'] {
  try {
    const r = runPostRunCheck(slug, input)
    for (const e of r.events) pushEvent(jobId, e)
    return r.file
  } catch (err) {
    logDetail(`post-run check for job ${jobId} failed:`, err)
    return null
  }
}
