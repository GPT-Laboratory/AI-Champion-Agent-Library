// Source-compatible loaders for case.yaml, golden.jsonl and rubric.yaml (Phase 15).
// Unknown keys are ignored (mirrors the source runner); x- prefixed keys are captured under `x`.
// Loaders never throw. Core purity: no $lib imports.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseDocument } from 'yaml'
import { z } from 'zod'

export const MAX_INPUT_BYTES = 1024 * 1024

export const CASE_ID_RE = /^[A-Z0-9][A-Z0-9-]{2,40}$/

export interface LoadError {
  line: number
  message: string
  file?: string
}
export type LoadResult<T> = { ok: true; value: T } | { ok: false; errors: LoadError[] }

const Dim = z.enum(['D1', 'D2', 'D3', 'D4', 'D5', 'D6'])

export const CaseSchema = z.object({
  id: z.string().regex(CASE_ID_RE, 'id must match /^[A-Z0-9][A-Z0-9-]{2,40}$/'),
  tier: z.number().int().min(1).max(4),
  title: z.string().optional(),
  source: z.unknown().optional(),
  auth: z.unknown().optional(),
  transport: z.unknown().optional(),
  provides_modalities: z.array(z.string()).default([]),
  pass_thresholds: z.record(z.string(), z.unknown()).optional(),
  scoring_notes: z.unknown().optional(),
  /** Platform extension keys, captured from x- prefixed top-level keys (prefix kept). */
  x: z.record(z.string(), z.unknown()).default({})
})
export type CaseDef = z.infer<typeof CaseSchema>

export const ExpectSchema = z.object({
  field_value: z.record(z.string(), z.unknown()).optional(),
  field_present: z.union([z.string(), z.array(z.string())]).optional(),
  fields_present: z.array(z.string()).optional(),
  no_error: z.boolean().optional(),
  clean_not_found: z.boolean().optional(),
  empty_with_message: z.boolean().optional(),
  max_items: z.number().optional(),
  max_fields: z.number().optional(),
  no_leak: z.boolean().optional(),
  status_category: z.union([z.string(), z.number()]).optional()
})
export type Expect = z.infer<typeof ExpectSchema>

const InjectSchema = z.object({
  route: z.string().optional(),
  fault: z.enum(['status', 'latency', 'timeout', 'malformed', 'reset', 'huge']),
  status: z.number().optional(),
  times: z.number().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  envelope: z.boolean().optional(),
  mode: z.enum(['truncated_json', 'html', 'empty', 'wrong_content_type', 'slow_drip']).optional(),
  ms: z.number().optional(),
  bytes: z.number().optional()
})

export const GoldenCheckSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['tool_exists', 'call', 'auth']),
  description: z.string().optional(),
  tool_hint: z.string().optional(),
  tool: z.string().optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  expect: ExpectSchema.optional(),
  dimension: Dim.optional(),
  /** Additive: fault(s) injected before the call. */
  inject: z.union([InjectSchema, z.array(InjectSchema)]).optional(),
  /** Additive: repeat the call N times. */
  repeat: z.number().int().min(1).max(100).optional(),
  /** Additive: link to one of the 10 behaviour checks. */
  check_kind: z.string().optional()
})
export type GoldenCheck = z.infer<typeof GoldenCheckSchema>

const CriteriaBlock = z.object({
  title: z.string().optional(),
  scale: z.unknown().optional(),
  criteria: z.array(z.unknown()).default([])
})

export const RubricSchema = z.object({
  D3: CriteriaBlock.optional(),
  D5: CriteriaBlock.optional(),
  checklist_per_subject: z.unknown().optional()
})
export type Rubric = z.infer<typeof RubricSchema>

function fail(line: number, message: string): { ok: false; errors: LoadError[] } {
  return { ok: false, errors: [{ line, message }] }
}

function tooBig(text: string): boolean {
  return Buffer.byteLength(text, 'utf8') > MAX_INPUT_BYTES
}

function zodErrors(err: z.ZodError, line: number): LoadError[] {
  return err.issues.map((i) => ({
    line,
    message: `${i.path.length ? i.path.join('.') + ': ' : ''}${i.message}`
  }))
}

function parseYaml(text: string): LoadResult<Record<string, unknown>> {
  if (typeof text !== 'string') return fail(1, 'input is not text')
  if (tooBig(text)) return fail(1, 'input exceeds 1 MiB')
  try {
    const doc = parseDocument(text)
    if (doc.errors.length > 0) {
      const e = doc.errors[0]
      return fail(e.linePos?.[0]?.line ?? 1, `yaml: ${e.message.split('\n')[0]}`)
    }
    const v = doc.toJS({ maxAliasCount: 50 })
    if (v === null || v === undefined) return { ok: true, value: {} }
    if (typeof v !== 'object' || Array.isArray(v)) return fail(1, 'top level must be a mapping')
    return { ok: true, value: v as Record<string, unknown> }
  } catch (e) {
    return fail(1, `yaml: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`)
  }
}

/** Parse a source-style case.yaml. Unknown keys ignored; x- keys captured under `x`. */
export function parseCaseYaml(text: string): LoadResult<CaseDef> {
  const y = parseYaml(text)
  if (!y.ok) return y
  const rest: Record<string, unknown> = {}
  const x: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(y.value)) {
    if (k.startsWith('x-')) x[k] = v
    else rest[k] = v
  }
  const r = CaseSchema.safeParse({ ...rest, x })
  if (!r.success) return { ok: false, errors: zodErrors(r.error, 1) }
  return { ok: true, value: r.data }
}

/** Parse golden.jsonl: blank and # lines skipped; check ids must be unique. */
export function parseGoldenJsonl(text: string): LoadResult<GoldenCheck[]> {
  if (typeof text !== 'string') return fail(1, 'input is not text')
  if (tooBig(text)) return fail(1, 'input exceeds 1 MiB')
  const out: GoldenCheck[] = []
  const errors: LoadError[] = []
  const seen = new Map<string, number>()
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1
    const raw = lines[i].trim()
    if (raw === '' || raw.startsWith('#')) continue
    let obj: unknown
    try {
      obj = JSON.parse(raw)
    } catch (e) {
      errors.push({ line: lineNo, message: `invalid JSON: ${e instanceof Error ? e.message : String(e)}` })
      continue
    }
    const r = GoldenCheckSchema.safeParse(obj)
    if (!r.success) {
      errors.push(...zodErrors(r.error, lineNo))
      continue
    }
    const prev = seen.get(r.data.id)
    if (prev !== undefined) {
      errors.push({ line: lineNo, message: `duplicate check id ${r.data.id} (first on line ${prev})` })
      continue
    }
    seen.set(r.data.id, lineNo)
    out.push(r.data)
  }
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value: out }
}

function normaliseBlock(v: unknown): unknown {
  if (Array.isArray(v)) return { criteria: v }
  return v
}

/** Parse rubric.yaml (D3 and D5 criteria; checklist_per_arm accepted and renamed to checklist_per_subject). */
export function parseRubricYaml(text: string): LoadResult<Rubric> {
  const y = parseYaml(text)
  if (!y.ok) return y
  const src = y.value
  const r = RubricSchema.safeParse({
    D3: normaliseBlock(src.D3),
    D5: normaliseBlock(src.D5),
    checklist_per_subject: src.checklist_per_subject ?? src.checklist_per_arm
  })
  if (!r.success) return { ok: false, errors: zodErrors(r.error, 1) }
  return { ok: true, value: r.data }
}

export interface LoadedCase {
  def: CaseDef
  golden: GoldenCheck[]
  rubric?: Rubric
}

async function readOptional(path: string): Promise<{ text?: string; error?: string }> {
  try {
    return { text: await readFile(path, 'utf8') }
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return {}
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Load case.yaml (required), golden.jsonl and rubric.yaml (optional) from one case directory.
 * With requireGolden (the suite loader), a missing or empty golden.jsonl is an error: a case without
 * its checks would be scored on nothing (CR-01, CR-02).
 */
export async function loadCaseDir(dir: string, opts: { requireGolden?: boolean } = {}): Promise<LoadResult<LoadedCase>> {
  const errors: LoadError[] = []
  const tag = (file: string, errs: LoadError[]) => errors.push(...errs.map((e) => ({ ...e, file })))

  const c = await readOptional(join(dir, 'case.yaml'))
  if (c.error) return { ok: false, errors: [{ line: 0, file: 'case.yaml', message: c.error }] }
  if (c.text === undefined) return { ok: false, errors: [{ line: 0, file: 'case.yaml', message: 'case.yaml not found' }] }
  const def = parseCaseYaml(c.text)
  if (!def.ok) tag('case.yaml', def.errors)

  let golden: GoldenCheck[] = []
  const g = await readOptional(join(dir, 'golden.jsonl'))
  if (g.error) errors.push({ line: 0, file: 'golden.jsonl', message: g.error })
  else if (g.text !== undefined) {
    const p = parseGoldenJsonl(g.text)
    if (p.ok) golden = p.value
    else tag('golden.jsonl', p.errors)
    if (p.ok && opts.requireGolden && golden.length === 0) {
      errors.push({ line: 0, file: 'golden.jsonl', message: 'golden.jsonl declares no checks' })
    }
  } else if (opts.requireGolden) errors.push({ line: 0, file: 'golden.jsonl', message: 'golden.jsonl not found' })

  let rubric: Rubric | undefined
  const r = await readOptional(join(dir, 'rubric.yaml'))
  if (r.error) errors.push({ line: 0, file: 'rubric.yaml', message: r.error })
  else if (r.text !== undefined) {
    const p = parseRubricYaml(r.text)
    if (p.ok) rubric = p.value
    else tag('rubric.yaml', p.errors)
  }

  if (errors.length > 0 || !def.ok) return { ok: false, errors }
  return { ok: true, value: { def: def.value, golden, rubric } }
}
