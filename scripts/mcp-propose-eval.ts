// Stage 2 evaluation of a proposal file (D-593): baseline package versus proposal-assisted package through the
// Phase 15 runner, with a before/after table and an exit code. Not part of `npm run check`. Author tool: it reads
// exactly the input file and the proposal file, never env files, makes no network call and no model call, and never
// executes generated Python (real-server cells stay PENDING_HUMAN). With --write-packages it writes both packages
// so a human can run them with `npm run mcp-test -- --subject cmd:... --allow-local-exec`.
//
// Exit codes: 0 no regression, 1 regression of the Tier 1 gate, the headline score or the blocker flags
// (threshold: --max-score-drop, default 0 percentage points), 2 usage error or the proposal was rejected, 64 usage.
import { lstat, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { MAX_INPUT_BYTES } from '../src/lib/mcpgen/api-contract.js'
import { validPath } from '../src/lib/mcpgen/bundle.js'
import { isEnvFileName } from '../src/lib/mcpgen/credentials.js'
import { formatGaps } from '../src/lib/mcpgen/diagnostics.js'
import { runPipeline } from '../src/lib/mcpgen/pipeline.js'
import { prepareInput } from '../src/lib/mcpgen/registry.js'
import { MAX_PROPOSAL_BYTES } from '../src/lib/mcpgen/proposals/schema.js'
import { isMainModule } from './is-main.js'
import { DEFAULT_MAX_SCORE_DROP, evaluateProposalEffect, renderComparison } from '../src/lib/mcptest/proposalEval.js'

export interface EvalIo {
  readFile: (p: string) => Promise<string>
  fileSize: (p: string) => Promise<number>
  writeFile: (p: string, c: string) => Promise<void>
  mkdir: (p: string) => Promise<void>
  /** Kind of the entry itself (a symbolic link is reported, not followed); null when it does not exist. */
  lstatKind?: (p: string) => Promise<'file' | 'dir' | 'symlink' | 'other' | null>
  log: (s: string) => void
  error: (s: string) => void
}

export const defaultIo: EvalIo = {
  readFile: (p) => readFile(p, 'utf8'),
  fileSize: async (p) => (await stat(p)).size,
  writeFile: (p, c) => writeFile(p, c, 'utf8'),
  mkdir: async (p) => {
    await mkdir(p, { recursive: true })
  },
  lstatKind: async (p) => {
    try {
      const st = await lstat(p)
      return st.isSymbolicLink() ? 'symlink' : st.isDirectory() ? 'dir' : st.isFile() ? 'file' : 'other'
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return null
      throw e
    }
  },
  log: (s) => console.log(s),
  error: (s) => console.error(s),
}

const USAGE =
  'Usage: npm run mcp-propose-eval -- <input-file> --proposals <file> [--adapter <id|auto>] [--proposals-lenient] [--reruns 1-3] [--max-score-drop N] [--format text|markdown] [--write-packages <dir>]'

interface Parsed {
  input: string
  proposals: string
  adapter: string
  lenient: boolean
  reruns: number
  maxDrop: number
  format: 'text' | 'markdown'
  writePackages?: string
}

function parse(argv: string[]): Parsed | null {
  const p: Partial<Parsed> & { adapter: string; lenient: boolean; reruns: number; maxDrop: number; format: 'text' | 'markdown' } = { adapter: 'auto', lenient: false, reruns: 1, maxDrop: DEFAULT_MAX_SCORE_DROP, format: 'text' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--proposals-lenient') p.lenient = true
    else if (['--proposals', '--adapter', '--reruns', '--max-score-drop', '--format', '--write-packages'].includes(a)) {
      const v = argv[++i]
      if (v === undefined || v.startsWith('--')) return null
      if (a === '--proposals') p.proposals = v
      else if (a === '--adapter') p.adapter = v
      else if (a === '--reruns') {
        if (!/^[1-3]$/.test(v)) return null
        p.reruns = Number(v)
      } else if (a === '--max-score-drop') {
        if (!/^\d{1,3}(\.\d)?$/.test(v)) return null
        p.maxDrop = Number(v)
      } else if (a === '--format') {
        if (v !== 'text' && v !== 'markdown') return null
        p.format = v
      } else p.writePackages = v
    } else if (a.startsWith('--')) return null
    else if (p.input === undefined) p.input = a
    else return null
  }
  return p.input && p.proposals ? (p as Parsed) : null
}

const refusesEnv = isEnvFileName
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').slice(0, 300)

export async function main(argv: string[], io: EvalIo = defaultIo): Promise<number> {
  const args = parse(argv)
  if (!args) {
    io.error(USAGE)
    return 64
  }
  try {
    if (refusesEnv(args.input) || refusesEnv(args.proposals)) {
      io.error('mcp-propose-eval: refusing to read environment files.')
      return 2
    }
    if ((await io.fileSize(args.input)) > MAX_INPUT_BYTES || (await io.fileSize(args.proposals)) > MAX_PROPOSAL_BYTES) {
      io.error('mcp-propose-eval: an input file exceeds its size limit.')
      return 2
    }
    const input = await io.readFile(args.input)
    const proposalsText = await io.readFile(args.proposals)
    const adapterId = args.adapter === 'auto' ? undefined : args.adapter
    const r = await evaluateProposalEffect({ input, filename: basename(args.input), adapterId, proposalsText, lenient: args.lenient }, { reruns: args.reruns, maxScoreDrop: args.maxDrop })
    if (r.kind !== 'compared') {
      io.error(r.kind === 'baseline-failed' ? 'mcp-propose-eval: the baseline could not be generated.' : 'mcp-propose-eval: the proposal file was rejected (nothing was scored).')
      io.error(formatGaps(r.gaps.map((g) => ({ ...g, severity: 'error' as const }))))
      return 2
    }
    io.log(renderComparison(r.comparison, args.format))
    if (args.writePackages) {
      const dir = resolve(args.writePackages)
      await prepareInput({ text: input, filename: basename(args.input) }, { adapterId })
      for (const [label, proposals] of [['baseline', undefined], ['proposed', { text: proposalsText, lenient: args.lenient }]] as const) {
        const out = runPipeline(input, { filename: basename(args.input), adapterId, ...(proposals ? { proposals } : {}) })
        if (!out.ok) continue
        for (const f of out.files) {
          if (!validPath(f.path)) continue
          const target = join(dir, label, f.path)
          // T-23-06: a directory or file that is a symbolic link would redirect the write.
          if (io.lstatKind) {
            const parts = [label, ...f.path.split('/')]
            for (let i = 1; i <= parts.length; i++) {
              if ((await io.lstatKind(join(dir, ...parts.slice(0, i)))) === 'symlink') throw new Error('refusing to write through a symbolic link')
            }
          }
          await io.mkdir(dirname(target))
          await io.writeFile(target, f.content)
        }
      }
      io.log(`Wrote both packages under ${clean(dir)} (baseline/ and proposed/). Nothing was executed.`)
    }
    return r.comparison.regressions.length === 0 ? 0 : 1
  } catch (e) {
    io.error(`mcp-propose-eval: ${e instanceof Error ? clean(e.message) : 'error'}`)
    return 2
  }
}

export { isMainModule }

if (isMainModule(import.meta.url, process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2))
}
