// Catalog entry validator (Phase 24). Checks an Oracle AgentSpec YAML against the real parser
// schema, then the consortium template fields (docs/agent-entry-template.md). Read-only: no DB,
// no network, nothing from the file is executed. Entries that carry none of the consortium keys
// (the pre-existing agents) are reported as skipped, not as errors.
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { OracleAgentSpecSchema } from '../src/lib/spec/oracle-agentspec.js'
import { scanSecrets } from '../src/lib/spec/security.js'
import { isMainModule } from './is-main.js'

export interface EntryResult {
  path: string
  status: 'ok' | 'skipped' | 'error'
  errors: string[]
}

const STAGES = ['design', 'sourcing', 'manufacturing', 'site-handover']
const CONSORTIUM_KEYS = [
  'stage',
  'agent_no',
  'purpose',
  'inputs',
  'outputs',
  'data_sources',
  'assumptions',
  'gaps',
  'draft_for_review',
  'sample_data',
]
const MAX_ERRORS = 50

const isStringList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string' && x.trim().length > 0)

function checkConsortium(meta: Record<string, unknown>): string[] {
  const errs: string[] = []
  if (typeof meta.stage !== 'string' || !STAGES.includes(meta.stage))
    errs.push(`metadata.stage must be one of ${STAGES.join(', ')}`)
  if (meta.agent_no !== undefined && !(Number.isInteger(meta.agent_no) && (meta.agent_no as number) >= 1 && (meta.agent_no as number) <= 20))
    errs.push('metadata.agent_no must be an integer from 1 to 20')
  if (typeof meta.purpose !== 'string' || meta.purpose.trim() === '') errs.push('metadata.purpose must be a non-empty string')
  for (const k of ['inputs', 'outputs']) {
    if (!isStringList(meta[k]) || (meta[k] as string[]).length === 0) errs.push(`metadata.${k} must be a non-empty list of strings`)
  }
  for (const k of ['data_sources', 'assumptions', 'gaps']) {
    if (!isStringList(meta[k])) errs.push(`metadata.${k} must be a list of strings (key present, may be empty)`)
  }
  if (meta.draft_for_review !== true) errs.push('metadata.draft_for_review must be true')
  const sd = meta.sample_data as Record<string, unknown> | undefined
  if (
    !sd ||
    typeof sd !== 'object' ||
    !['public', 'synthetic'].includes(sd.kind as string) ||
    typeof sd.label !== 'string' ||
    sd.label.trim() === ''
  )
    errs.push('metadata.sample_data must be {kind: public|synthetic, label: non-empty string}')
  return errs
}

export function validateEntryFile(path: string): EntryResult {
  const fail = (errors: string[]): EntryResult => ({ path, status: 'error', errors: errors.slice(0, MAX_ERRORS) })
  try {
    const text = readFileSync(path, 'utf8')
    let doc: unknown
    try {
      doc = parse(text, { maxAliasCount: 100 })
    } catch (e) {
      return fail([`YAML parse error: ${e instanceof Error ? e.message.split('\n')[0] : 'unknown'}`])
    }
    const parsed = OracleAgentSpecSchema.safeParse(doc)
    if (!parsed.success)
      return fail(parsed.error.issues.map((i) => `schema: ${i.path.join('.') || '(root)'}: ${i.message}`))
    const errors: string[] = []
    const secrets = scanSecrets(doc)
    if (secrets.length > 0) errors.push(`secret-like value at ${secrets.slice(0, 5).join(', ')}`)
    const meta = (parsed.data.metadata ?? {}) as Record<string, unknown>
    const isConsortium = CONSORTIUM_KEYS.some((k) => meta[k] !== undefined)
    if (!isConsortium && errors.length === 0) return { path, status: 'skipped', errors: [] }
    if (isConsortium) errors.push(...checkConsortium(meta))
    return errors.length ? fail(errors) : { path, status: 'ok', errors: [] }
  } catch (e) {
    return fail([`cannot read: ${e instanceof Error ? e.message.split('\n')[0] : 'unknown'}`])
  }
}

/** Top-level *.yaml / *.yml files of a directory (subdirectories are ignored). */
export function validateEntriesDir(dir: string): EntryResult[] {
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/i.test(f))
    .sort()
    .map((f) => join(dir, f))
    .filter((p) => lstatSync(p).isFile())
    .map(validateEntryFile)
}

export function main(
  argv: string[],
  io: { out: (s: string) => void; err: (s: string) => void } = { out: console.log, err: console.error },
): number {
  // CR-56: an unknown flag is a usage error, not silently ignored.
  const unknown = argv.find((a) => a.startsWith('--'))
  if (unknown !== undefined) {
    io.err(`validate-entries: unknown option ${unknown.slice(0, 40).replace(/[^\x20-\x7e]/g, '?')}`)
    return 2
  }
  const paths = argv.filter((a) => !a.startsWith('--'))
  if (paths.length === 0) paths.push('data/agents')
  const results: EntryResult[] = []
  for (const p of paths) {
    if (!existsSync(p)) {
      io.err(`validate-entries: path not found: ${p}`)
      return 2
    }
    results.push(...(lstatSync(p).isDirectory() ? validateEntriesDir(p) : [validateEntryFile(p)]))
  }
  // A mistyped directory that holds no YAML files must not pass as "0 entries" (CR-56).
  if (results.length === 0) {
    io.err('validate-entries: no entry files found')
    return 2
  }
  for (const r of results) {
    io.out(`[${r.status.toUpperCase()}] ${r.path}`)
    for (const e of r.errors) io.out(`  - ${e}`)
  }
  const bad = results.filter((r) => r.status === 'error').length
  io.out(`${results.length} entr${results.length === 1 ? 'y' : 'ies'}: ${bad} error(s)`)
  return bad > 0 ? 1 : 0
}

const isMain = isMainModule(import.meta.url, process.argv[1])
if (isMain) {
  process.exitCode = main(process.argv.slice(2))
}
