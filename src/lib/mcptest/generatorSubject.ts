// Phase 14 generator as a scored Subject. Generation happens IN PROCESS (runPipeline: pure, no network).
// The stdio launch descriptor for the generated Python server is returned but NEVER executed here.
// Lives outside core/, so relative imports of ../mcpgen are allowed (no alias imports).
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BINDING_FILE } from '../mcpgen/binding'
import { validPath } from '../mcpgen/bundle'
import { runPipeline } from '../mcpgen/pipeline'
import { prepareInput } from '../mcpgen/registry'
import type { Gap } from '../mcpgen/types'
import type { CaseDef, PrepareResult, Subject } from './core/types'
import { parseBindingFile } from './core/bindingSchema'
import { runGeneratorSideChecks, type PipelineFn } from './generatorChecks'

export interface GeneratorSample {
  id: string
  file: string
  filename: string
  /** Input text supplied by the caller (proposal evaluation): used instead of reading `file`. */
  text?: string
}

export const SAMPLES: GeneratorSample[] = [
  { id: 'openapi', file: 'acme-openapi.yaml', filename: 'acme-openapi.yaml' },
  { id: 'tabular-catalog', file: 'acme-catalog-header.csv', filename: 'acme-catalog-header.csv' },
  { id: 'sql-ddl', file: 'acme-schema.sql', filename: 'acme-schema.sql' }
]

const FIXTURES = fileURLToPath(new URL('../mcpgen/testing/fixtures/', import.meta.url))
const SUITE = fileURLToPath(new URL('./suite/', import.meta.url))

export function resolveSample(id: string): GeneratorSample | null {
  return SAMPLES.find((s) => `generator:${s.id}` === id || s.id === id) ?? null
}

// ONE derivation (E10 D3): src/lib/mcpgen/binding.ts. generate() emits it as mcptest-binding.json; this subject reads
// that emitted file, so the in-process subject and a runner that loads the package file see the same binding.
export { deriveBinding } from '../mcpgen/binding'

/**
 * Env names the generated server reads, by suffix rule: the base URL, the credential (`_API_KEY`, bearer `_TOKEN`,
 * OAuth2 `_ACCESS_TOKEN`, so the canary key reaches every auth scheme, CR-51) and the data location (`_DATA_PATH`,
 * `_DATA_FILE`, `_DB_PATH`).
 */
export function deriveEnvNames(envVars: { name: string }[]): NonNullable<PrepareResult['envNames']> {
  const out: NonNullable<PrepareResult['envNames']> = {}
  for (const { name } of envVars) {
    if (/_BASE_URL_B$/.test(name)) out.baseUrlB ??= name
    else if (/_BASE_URL$/.test(name)) out.baseUrl ??= name
    else if (/_(?:API_KEY|TOKEN)$/.test(name)) out.apiKey ??= name
    else if (/_(?:DATA_PATH|DATA_FILE|DB_PATH)$/.test(name)) out.dataPath ??= name
  }
  return out
}

const cap = (s: string, n = 200) => (s.length > n ? s.slice(0, n) : s)
const gapNotes = (gaps: Gap[]) => gaps.map((g) => cap(`${g.code}: ${g.message}`)).join(' | ')

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

async function readSample(s: GeneratorSample): Promise<string> {
  if (s.text !== undefined) return s.text
  return readFile(join(FIXTURES, s.file), 'utf8')
}

export interface GeneratorSubjectDeps {
  runPipelineFn?: PipelineFn
  /** Samples to build subjects for (default: the three Acme fixtures). */
  samples?: GeneratorSample[]
}

export function generatorSubjects(deps: GeneratorSubjectDeps = {}): Subject[] {
  const run: PipelineFn = deps.runPipelineFn ?? runPipeline
  return (deps.samples ?? SAMPLES).map((sample): Subject => ({
    id: `generator:${sample.id}`,
    kind: 'generator',
    modality: 'spec',
    llm: false,
    networkPolicy: 'no network at generation (in-process, pure); loopback-only mock upstream at run time',
    status: 'installed',
    transports: ['stdio'],
    async prepare(c: CaseDef, workdir: string): Promise<PrepareResult> {
      const transport = c.transport
      if (transport === 'http')
        return { status: 'NA_TRANSPORT', error: 'generator-unsupported: generated servers speak stdio only' }
      if (!c.provides_modalities.includes('spec'))
        return { status: 'NA_MODALITY', error: 'generator-unsupported: case does not provide a spec modality' }
      const applies = strArr(c.x['x-applies-to'])
      if (applies.length > 0 && !applies.includes('generator'))
        return { status: 'NA_MODALITY', error: 'generator-unsupported: case is not applicable to generated servers' }
      if (c.id === 'T4-PARTIAL-SPEC' && sample.id !== 'openapi')
        return { status: 'NA_MODALITY', error: 'case applies to the openapi sample only' }

      let input: string
      let filename = sample.filename
      try {
        input =
          c.id === 'T4-PARTIAL-SPEC'
            ? await readFile(join(SUITE, c.id, 'fixture', 'spec', 'partial-openapi.yaml'), 'utf8')
            : await readSample(sample)
        if (c.id === 'T4-PARTIAL-SPEC') filename = 'partial-openapi.yaml'
      } catch (e) {
        return { status: 'ERROR', error: cap(`sample unreadable: ${e instanceof Error ? e.message : String(e)}`) }
      }

      await prepareInput({ text: input, filename }) // on-demand parsers (OData XML) are loaded before the synchronous pipeline (CR-20)
      const extraChecks = runGeneratorSideChecks(c.id, {
        sample: { id: sample.id, input, filename },
        runPipelineFn: run
      })
      const t0 = Date.now()
      const r = run(input, { filename })
      const generationMs = Date.now() - t0
      if (!r.ok) return { status: 'GEN_FAILED', error: gapNotes(r.gaps), generationMs, extraChecks }

      const pkg = join(workdir, 'pkg')
      try {
        for (const f of r.files) {
          if (!validPath(f.path)) return { status: 'GEN_FAILED', error: 'generated path rejected', generationMs, extraChecks }
          const dest = join(pkg, f.path)
          await mkdir(dirname(dest), { recursive: true })
          await writeFile(dest, f.content, 'utf8')
        }
      } catch (e) {
        return { status: 'ERROR', error: cap(`write failed: ${e instanceof Error ? e.message : String(e)}`), extraChecks }
      }
      const server = r.files.find((f) => /(^|\/)server\.py$/.test(f.path)) ?? r.files.find((f) => f.path.endsWith('.py'))
      return {
        status: 'PASS',
        launch: { kind: 'stdio', command: 'python3', args: [server ? server.path : 'server.py'], cwd: pkg },
        generationMs,
        binding: parseBindingFile(r.files.find((f) => f.path === BINDING_FILE)?.content ?? '') ?? {},
        envNames: deriveEnvNames(r.report.envVars),
        notes: gapNotes(r.report.gaps),
        extraChecks
      }
    }
  }))
}
