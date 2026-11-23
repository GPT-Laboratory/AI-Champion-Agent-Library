// src/lib/server/tryitout/postRunCheck.ts
// Server-only module — SvelteKit enforces that src/lib/server/ cannot be imported client-side.
//
// Optional per-agent check that runs after a successful Try It Out job, on the container path and the direct-model
// fallback alike (docs/tryitout-post-run-check.md). A check is deterministic own code (no model call): it reads the
// job's input and output files and returns a report. The report (and, for some agents, a spreadsheet) is added to
// the artifact as extra files, its summary (plus the first findings) goes to the progress feed, and its status is
// kept on the job for the "Checked by tool" badge (GET /api/tryitout/jobs/:id/check). A check never changes or
// removes the agent's own files and never fails the job: a check that throws only costs the report.

import { RESULT_COLS } from '$lib/ebom/ebomJoin'
import { checkEbomResult, hasResultTable } from '$lib/ebom/ebomCheck'
import { runCli as warrantyCli } from '$lib/warranty/resultCheck'
import { runCli as leadTimeCli } from '$lib/procurement/resultCheck'
import { runCli as deliveryCli } from '$lib/delivery/resultCheck'
import { runCli as bmsCli } from '$lib/bms/resultCheck'
import { runCli as carbonCli } from '$lib/carbon/resultCheck'
import { runCli as qtoCli } from '$lib/qto/resultCheck'
import { checkRuleResult, dryRunSummary, runCli as ruleCli } from '$lib/rules/ruleCheck'
import { parseDocument } from '$lib/resultMarkdown'
import { cellValue, xlsxBytes, type Sheet } from '$lib/xlsx'
import type { CheckStatus, JobCheck } from '$lib/tryItOutCheck'
import { MAX_ARTIFACT_BYTES, MAX_ARTIFACT_FILES } from './artifact'
import { pushEvent, setCheck } from '../tryItOutJobs'
import { logDetail } from './redact'

export interface PostRunInput {
  /** The task text of the job. */
  task: string
  /** The uploaded file as text, or null when the job had no upload. */
  upload: string | null
  /** The agent's output files (relative path -> bytes), as they go into the artifact. */
  files: Readonly<Record<string, Uint8Array>>
}

export interface OutFile {
  name: string
  bytes: Uint8Array
}

export interface PostRunReport {
  /** File name of the report in the artifact (top level). */
  file: string
  /** Report text (Markdown). */
  text: string
  /** One line for the progress feed. */
  summary: string
  /** match: every checked cell agrees; differences: problems or mismatches; not-checked: nothing could be checked. */
  status: CheckStatus
  /** Individual findings; the first MAX_FEED_FINDINGS go to the feed, all of them are in the file. */
  findings: string[]
  /** Further files for the artifact, after the report (e.g. ebom.xlsx). */
  attachments?: OutFile[]
}

export type PostRunCheck = (input: PostRunInput) => PostRunReport

/** Findings shown in the progress feed; the rest are only in the report file. */
export const MAX_FEED_FINDINGS = 5

const decoder = new TextDecoder('utf-8')
const text = (b: Uint8Array): string => decoder.decode(b)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The output file that holds the agent's table: result.md (SKILL.md) first, then any .md or .txt that has it. */
export function findResultFile(files: Readonly<Record<string, Uint8Array>>, has: (t: string) => boolean): string | null {
  const names = Object.keys(files).sort()
  const candidates = ['result.md', ...names.filter((n) => n !== 'result.md' && /\.(md|txt)$/i.test(n))]
  for (const n of candidates) {
    const b = files[n]
    if (b && has(text(b))) return n
  }
  return null
}

function reportHead(helper: string, source: string, what: string): string {
  return [
    `# ${helper} check`,
    '',
    `Written by the app after the run, not by the agent. The deterministic ${helper} helper worked out the`,
    `expected values from the input and compared them with the agent's result. No model call. Input: ${source}. ${what}`,
    '',
  ].join('\n')
}

const sourceOf = (upload: string | null) => (upload !== null ? 'the uploaded file' : 'the task text (no file was uploaded)')

// ------------------------------------------------------------------ ifc-ebom-compiler: the ebom-join check

export const EBOM_CHECK_FILE = 'ebom-join-check.md'
export const EBOM_XLSX_FILE = 'ebom.xlsx'

/** The output file that holds the class rows. */
export const findEbomResult = (files: Readonly<Record<string, Uint8Array>>): string | null => findResultFile(files, hasResultTable)

/** ebom.xlsx: E-BOM lines (from the helper's join of the agent's billed rows), class rows, review items, the check. */
export function ebomWorkbook(
  check: ReturnType<typeof checkEbomResult>,
  resultText: string,
  summary: string,
  stickM = '3',
): Uint8Array | null {
  if (!check.lines || !check.rows) return null
  const titles = check.blockTitles ?? {}
  const differs = new Set(check.diffs.map((d) => d.split(':')[0]))
  const sheets: Sheet[] = [
    {
      name: 'E-BOM',
      rows: [
        ['Block', 'Block title', 'Designation', 'Unit', 'Measured', 'Billed', 'Elements', 'Rounded up to whole sticks'],
        ...check.lines.map((l) => [
          l.block,
          titles[l.block] ?? '',
          l.designation,
          l.unit,
          cellValue(l.measured),
          cellValue(l.billed),
          l.elements,
          l.stick_rounded ? `yes (${stickM} m)` : 'no',
        ]),
      ],
    },
    {
      name: 'Class rows',
      rows: [
        [...RESULT_COLS, 'tool check'],
        ...check.rows.map((r) => [...RESULT_COLS.map((c) => cellValue(r[c] ?? '')), differs.has(r.token) ? 'differs' : 'agrees']),
      ],
    },
  ]
  const review = parseDocument(resultText).find((b) => b.kind === 'table' && /review items/i.test(b.title ?? ''))
  if (review && review.kind === 'table') sheets.push({ name: 'Review items', rows: [review.header, ...review.rows.map((r) => r.map(cellValue))] })
  sheets.push({
    name: 'Check',
    rows: [
      ['Item', 'Value'],
      ['Checked by', 'ebom-join helper (deterministic, no model call)'],
      ['Result', summary],
      ['Stick length (m)', cellValue(stickM)],
      ...[...check.problems, ...check.diffs].map((f) => ['Finding', f]),
      ['Note', 'Draft for estimator review. E-BOM lines are joined by the tool from the agent\'s billed rows.'],
    ],
  })
  return xlsxBytes(sheets)
}

export const ebomJoinCheck: PostRunCheck = ({ task, upload, files }) => {
  const head = (what: string) => reportHead('ebom-join', sourceOf(upload), what)
  const resultFile = findEbomResult(files)
  if (resultFile === null) {
    return {
      file: EBOM_CHECK_FILE,
      text: `${head('Result checked: none.')}\nThe output has no \`## E-BOM class rows\` table, so nothing was checked.\n`,
      summary: 'helper check: no E-BOM class rows table in the output, nothing checked',
      status: 'not-checked',
      findings: [],
    }
  }
  const resultText = text(files[resultFile])
  const r = checkEbomResult(upload ?? task, resultText)
  const body = `${head(`Result checked: ${resultFile}.`)}\n${r.out}\n`
  if (r.code === 2) {
    return {
      file: EBOM_CHECK_FILE,
      text: body,
      summary: `helper check: could not read the input or result (${r.out.replace(/^error: /, '').slice(0, 200)})`,
      status: 'not-checked',
      findings: [],
    }
  }
  let summary: string
  if (r.code === 0) summary = 'helper check: the class rows match the ebom-join helper on every cell'
  else {
    const parts = [
      r.problems.length ? plural(r.problems.length, 'contract problem') : '',
      r.diffs.length ? `${plural(r.diffs.length, 'mismatch', 'mismatches')} with the ebom-join helper` : '',
    ].filter(Boolean)
    summary = `helper check: ${parts.join(', ')} (details in ${EBOM_CHECK_FILE})`
  }
  const xlsx = ebomWorkbook(r, resultText, summary.replace(/^helper check: /, ''))
  return {
    file: EBOM_CHECK_FILE,
    text: body,
    summary,
    status: r.code === 0 ? 'match' : 'differences',
    findings: [...r.problems, ...r.diffs],
    attachments: xlsx ? [{ name: EBOM_XLSX_FILE, bytes: xlsx }] : [],
  }
}

// ------------------------------------------------------------------ the six agents with a table helper

/** A helper's runCli: input = the upload (or, without one, the task text); task = the task text. */
type HelperCli = (input: string, result?: string, task?: string) => { code: number; out: string }

export interface HelperCheckSpec {
  /** Helper name, as the CLI in scripts/ (e.g. warranty-status); the report is `<helper>-check.md`. */
  helper: string
  /** The result section the helper compares (e.g. "Warranty register check"). */
  section: string
  runCli: HelperCli
  /** Summary when everything matches (default: "the <section> table matches the <helper> helper on every cell"). */
  matchSummary?: (input: string, result: string, task: string) => string
}

const MISMATCH_HEAD = /^MISMATCHES \(\d+\)$/

/** A post-run check from a helper CLI's runCli (code 0 match, 1 mismatches listed after MISMATCHES (n), 2 bad input). */
export function helperCheck(spec: HelperCheckSpec): PostRunCheck {
  const file = `${spec.helper}-check.md`
  const heading = new RegExp(`^##\\s*${spec.section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i')
  const has = (t: string) => t.split(/\r?\n/).some((l) => heading.test(l.trim()))
  return ({ task, upload, files }) => {
    const head = (what: string) => reportHead(spec.helper, sourceOf(upload), what)
    const resultFile = findResultFile(files, has)
    if (resultFile === null) {
      return {
        file,
        text: `${head('Result checked: none.')}\nThe output has no \`## ${spec.section}\` table, so nothing was checked.\n`,
        summary: `helper check: no ${spec.section} table in the output, nothing checked`,
        status: 'not-checked',
        findings: [],
      }
    }
    const input = upload ?? task
    const resultText = text(files[resultFile])
    const r = spec.runCli(input, resultText, task)
    const fenced = '```text\n' + r.out.replace(/```/g, "'''") + '\n```'
    if (r.code === 2) {
      return {
        file,
        text: `${head(`Result checked: ${resultFile}.`)}\n${fenced}\n`,
        summary: `helper check: could not read the input or result (${r.out.replace(/^error: /, '').slice(0, 200)})`,
        status: 'not-checked',
        findings: [],
      }
    }
    const lines = r.out.split('\n')
    const at = lines.findIndex((l) => MISMATCH_HEAD.test(l.trim()))
    const diffs = r.code === 1 && at >= 0 ? lines.slice(at + 1).filter((l) => l.trim() !== '') : []
    const summary =
      r.code === 0
        ? `helper check: ${spec.matchSummary ? spec.matchSummary(input, resultText, task) : `the ${spec.section} table matches the ${spec.helper} helper on every cell`}`
        : `helper check: ${plural(diffs.length, 'mismatch', 'mismatches')} with the ${spec.helper} helper (details in ${file})`
    const listed = diffs.length ? `## Mismatches\n${diffs.map((d) => `- ${d}`).join('\n')}\n\n` : ''
    return {
      file,
      text: `${head(`Result checked: ${resultFile}.`)}\n${summary.replace(/^helper check: /, 'Result: ')}\n\n${listed}## Helper output\n${fenced}\n`,
      summary,
      status: r.code === 0 ? 'match' : 'differences',
      findings: diffs,
    }
  }
}

export const HELPER_CHECKS: ReadonlyArray<[string, HelperCheckSpec]> = [
  ['warranty-register-check', { helper: 'warranty-status', section: 'Warranty register check', runCli: warrantyCli }],
  ['procurement-lead-time-check', { helper: 'procurement-lead-time', section: 'Lead time check', runCli: leadTimeCli }],
  ['material-delivery-check', { helper: 'delivery-check', section: 'Delivery check', runCli: deliveryCli }],
  ['bms-digital-twin', { helper: 'bms-point-status', section: 'Point mapping', runCli: bmsCli }],
  ['carbon-epd-enrichment', { helper: 'carbon-lifecycle', section: 'Per-product rows', runCli: (i, r) => carbonCli(i, r) }],
  ['qto-normalization', { helper: 'qto-group-totals', section: 'Normalised rows', runCli: qtoCli }],
  [
    'scope-rule-drafter',
    {
      helper: 'rule-check',
      section: 'Sentence mapping',
      runCli: ruleCli,
      matchSummary: (input, result, task) => dryRunSummary(checkRuleResult(input, result, task).dryRun),
    },
  ],
]

// ------------------------------------------------------------------ registry and runner

/** slug -> check. A Map, so a slug such as "constructor" never reaches an Object prototype member. */
export const POST_RUN_CHECKS: ReadonlyMap<string, PostRunCheck> = new Map<string, PostRunCheck>([
  ['ifc-ebom-compiler', ebomJoinCheck],
  ...HELPER_CHECKS.map(([slug, spec]): [string, PostRunCheck] => [slug, helperCheck(spec)]),
])

export interface PostRunResult {
  /** Files to add to the artifact (the report first), possibly none. */
  files: OutFile[]
  /** Progress feed lines, in order. */
  events: string[]
  /** The check status for the job, or null when the agent has no check. */
  check: JobCheck | null
}

/** Runs the slug's check, if any. Pure apart from logging; never throws. */
export function runPostRunCheck(
  slug: string,
  input: PostRunInput,
  checks: ReadonlyMap<string, PostRunCheck> = POST_RUN_CHECKS,
): PostRunResult {
  const check = checks.get(slug)
  if (!check) return { files: [], events: [], check: null }
  let report: PostRunReport
  try {
    report = check(input)
  } catch (err) {
    logDetail(`post-run check for ${slug} failed:`, err)
    return {
      files: [],
      events: ['helper check failed to run; the result is unchecked'],
      check: { status: 'not-checked', summary: 'the check failed to run; the result is unchecked', file: null },
    }
  }
  const events = [report.summary]
  for (const f of report.findings.slice(0, MAX_FEED_FINDINGS)) events.push(`  ${f}`)
  if (report.findings.length > MAX_FEED_FINDINGS) {
    events.push(`  … and ${report.findings.length - MAX_FEED_FINDINGS} more in ${report.file}`)
  }

  const wanted: OutFile[] = [{ name: report.file, bytes: new TextEncoder().encode(report.text) }, ...(report.attachments ?? [])]
  const names = Object.keys(input.files)
  let count = names.length
  let total = names.reduce((n, k) => n + input.files[k].byteLength, 0)
  const files: OutFile[] = []
  for (const f of wanted) {
    let skip: string | null = null
    if (Object.hasOwn(input.files, f.name)) skip = `the output already has a file named ${f.name}`
    else if (count + 1 > MAX_ARTIFACT_FILES) skip = `the output already has ${count} files`
    else if (total + f.bytes.byteLength > MAX_ARTIFACT_BYTES) skip = 'the output is at the artifact size limit'
    if (skip) {
      events.push(`helper check ${f === wanted[0] ? 'report' : `file ${f.name}`} not added to the download: ${skip}`)
      continue
    }
    files.push(f)
    count += 1
    total += f.bytes.byteLength
  }
  const reportAdded = files.some((f) => f.name === report.file)
  return {
    files,
    events,
    check: { status: report.status, summary: report.summary.replace(/^helper check: /, ''), file: reportAdded ? report.file : null },
  }
}

/** runPostRunCheck plus the feed lines and the check status for the job. Never throws. */
export function applyPostRunCheck(jobId: string, slug: string, input: PostRunInput): OutFile[] {
  try {
    const r = runPostRunCheck(slug, input)
    for (const e of r.events) pushEvent(jobId, e)
    if (r.check) setCheck(jobId, r.check)
    return r.files
  } catch (err) {
    logDetail(`post-run check for job ${jobId} failed:`, err)
    return []
  }
}
