// Suite loader: reads every case directory (case.yaml, golden.jsonl, rubric.yaml, fixture/) and validates
// the platform x- blocks. Never throws; never reads outside rootDir; symlinks are skipped.
import { lstat, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { UpstreamSpec } from '../mock/spec'
import { loadCaseDir } from './cases'
import type { CaseDef, GoldenCheck, Rubric } from './cases'

export const FIXTURE_FILE_CAP = 256 * 1024

const Upstream = z.object({ a: UpstreamSpec, b: UpstreamSpec.optional() })
const Env = z.object({
  baseUrl: z.string().min(1),
  apiKey: z.string().min(1).optional(),
  baseUrlB: z.string().min(1).optional(),
  dataPath: z.string().min(1).optional(),
  canaryEnv: z.string().min(1).optional()
})
const Identity = z.object({
  idKeys: z.array(z.string()),
  altKeys: z.array(z.string()).default([]),
  partitionKeys: z.array(z.string()).default([]),
  knownId: z.string(),
  knownAlt: z.string().optional(),
  badId: z.string(),
  partitionValue: z.string(),
  derivedKey: z.string().optional(),
  derivedValue: z.string().optional(),
  expectedDerivedIds: z.array(z.string()).default([]),
  maxPage: z.number().int().positive(),
  projectionMax: z.number().int().positive().optional(),
  ceilingPage: z.number().int().positive().nullable().optional(),
  keyEnv: z.string().optional()
})
const Config = z
  .object({
    healthPath: z.string().optional(),
    grounding: z.object({ traceTable: z.record(z.string(), z.string()), documented: z.array(z.string()) }).optional(),
    large_response: z
      .object({ maxBytes: z.number().positive(), maxItems: z.number().positive(), category: z.string() })
      .optional(),
    i18n: z.object({ invalidCode: z.string(), validCode: z.string(), expectedName: z.string() }).optional(),
    secret: z.object({ canaryEnv: z.string() }).optional(),
    composite: z.object({ componentId: z.string(), expectedKeys: z.array(z.string()) }).optional(),
    profile: z
      .object({
        requiredTools: z.array(z.string()),
        namePattern: z.string(),
        requireDescriptions: z.boolean().default(true)
      })
      .optional()
  })
  .passthrough()

const AppliesTo = z.array(z.enum(['fake', 'generator', 'submitted']))

export interface ParsedX {
  upstream?: z.output<typeof Upstream>
  env?: z.output<typeof Env>
  identity?: z.output<typeof Identity>
  config?: z.output<typeof Config>
  appliesTo?: z.output<typeof AppliesTo>
  requires?: 'real-runtime'
  ceiling?: number | null
  strict?: boolean
}

export interface SuiteCase {
  def: CaseDef
  golden: GoldenCheck[]
  rubric: Rubric | null
  dir: string
  fixtureFiles: { path: string; content: string }[]
  x: ParsedX
}

export function defaultSuiteRoot(): string {
  return fileURLToPath(new URL('../suite', import.meta.url))
}

function issues(prefix: string, key: string, e: z.ZodError): string[] {
  return e.issues.map((i) => `${prefix}: ${key}${i.path.length ? '.' + i.path.join('.') : ''}: ${i.message}`)
}

function parseX(id: string, raw: Record<string, unknown>): { x: ParsedX; errors: string[] } {
  const x: ParsedX = {}
  const errors: string[] = []
  const take = <T>(key: string, schema: z.ZodType<T>, set: (v: T) => void) => {
    if (!(key in raw)) return
    const r = schema.safeParse(raw[key])
    if (r.success) set(r.data)
    else errors.push(...issues(id, key, r.error))
  }
  take('x-upstream', Upstream, (v) => (x.upstream = v))
  take('x-env', Env, (v) => (x.env = v))
  take('x-identity', Identity, (v) => (x.identity = v))
  take('x-config', Config, (v) => (x.config = v))
  take('x-applies-to', AppliesTo, (v) => (x.appliesTo = v))
  take('x-requires', z.literal('real-runtime'), (v) => (x.requires = v))
  take('x-ceiling', z.number().int().positive().nullable(), (v) => (x.ceiling = v))
  take('x-strict', z.boolean(), (v) => (x.strict = v))
  return { x, errors }
}

async function collectFixtures(
  dir: string,
  rel: string,
  out: { path: string; content: string }[],
  errors: string[],
  id: string
): Promise<void> {
  let names: string[]
  try {
    names = (await readdir(dir)).sort()
  } catch {
    return
  }
  for (const name of names) {
    const full = join(dir, name)
    const r = rel ? `${rel}/${name}` : name
    try {
      const st = await lstat(full)
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) await collectFixtures(full, r, out, errors, id)
      else if (st.isFile()) {
        if (st.size > FIXTURE_FILE_CAP) {
          errors.push(`${id}: fixture/${r} exceeds ${FIXTURE_FILE_CAP} bytes`)
          continue
        }
        out.push({ path: r, content: await readFile(full, 'utf8') })
      }
    } catch (e) {
      errors.push(`${id}: fixture/${r}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}

export async function loadSuite(
  rootDir: string = defaultSuiteRoot()
): Promise<{ ok: true; cases: SuiteCase[] } | { ok: false; errors: string[] }> {
  const errors: string[] = []
  const cases: SuiteCase[] = []
  let names: string[] = []
  try {
    const ents = await readdir(rootDir, { withFileTypes: true })
    names = ents.filter((e) => e.isDirectory() && !e.isSymbolicLink()).map((e) => e.name).sort()
  } catch (e) {
    return { ok: false, errors: [`suite: cannot read ${rootDir}: ${e instanceof Error ? e.message : String(e)}`] }
  }
  for (const name of names) {
    const dir = join(rootDir, name)
    const loaded = await loadCaseDir(dir, { requireGolden: true })
    if (!loaded.ok) {
      for (const e of loaded.errors) errors.push(`${name}: ${e.file ?? ''}${e.line ? ':' + e.line : ''}: ${e.message}`)
      continue
    }
    const { def, golden, rubric } = loaded.value
    if (def.id !== name) {
      errors.push(`${name}: case.yaml id ${def.id} does not match directory name`)
      continue
    }
    const px = parseX(def.id, def.x)
    const fixtureFiles: { path: string; content: string }[] = []
    const fx: string[] = []
    await collectFixtures(join(dir, 'fixture'), '', fixtureFiles, fx, def.id)
    if (px.errors.length > 0 || fx.length > 0) {
      errors.push(...px.errors, ...fx)
      continue
    }
    cases.push({ def, golden, rubric: rubric ?? null, dir, fixtureFiles, x: px.x })
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, cases }
}
