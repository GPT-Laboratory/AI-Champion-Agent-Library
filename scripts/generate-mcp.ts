// Author-facing MCP generator CLI (Phase 14). Like validate-submission it is an author tool and
// works regardless of the MCP_GENERATOR flag (mcpGeneratorEnabled is never called). It reads
// exactly one file (the given input path), never env files, never the network, and writes only
// under --out. The generated Python is never executed.
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { lstat, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { MAX_INPUT_BYTES } from '../src/lib/mcpgen/api-contract.js'
import { validPath } from '../src/lib/mcpgen/bundle.js'
import { isEnvFileName } from '../src/lib/mcpgen/credentials.js'
import { formatGaps } from '../src/lib/mcpgen/diagnostics.js'
import { runPipelineAsync } from '../src/lib/mcpgen/pipeline.js'
import { buildContextPack } from '../src/lib/mcpgen/proposals/contextPack.js'
import { evaluateProposals } from '../src/lib/mcpgen/proposals/index.js'
import { MAX_PROPOSAL_BYTES, proposalJsonSchema } from '../src/lib/mcpgen/proposals/schema.js'
import { renderReview } from '../src/lib/mcpgen/proposals/review.js'
import { stableJson } from '../src/lib/mcpgen/generate.js'
import { parseInput, prepareInput } from '../src/lib/mcpgen/registry.js'
import type { GenerateOptions } from '../src/lib/mcpgen/types.js'
import { isMainModule } from './is-main.js'
import { collectPackFiles } from './mcp-pack-io.js'

export interface CliIo {
  readFile: (path: string) => Promise<string>
  /** Size in bytes of the input file (checked before reading). */
  fileSize: (path: string) => Promise<number>
  /** Entries of a directory; resolves [] when it does not exist. */
  readdir: (path: string) => Promise<string[]>
  writeFile: (path: string, content: string) => Promise<void>
  mkdir: (path: string) => Promise<void>
  log: (s: string) => void
  error: (s: string) => void
  /** Kind of the entry itself (a symbolic link is reported, not followed). Used by --context-pack only. */
  lstatKind?: (path: string) => Promise<'file' | 'dir' | 'symlink' | 'other' | null>
}

const USAGE =
  'Usage: npm run generate-mcp -- --adapter <openapi|tabular-catalog|sql-ddl|prisma|odata|auto> <input-file> --out <dir> [--force] [--server-name N] [--max-page-size N] [--result-ceiling N]\n' +
  '       proposals: add --proposals <file> [--proposals-lenient]; review only: <input-file> --proposals <file> --validate-only\n' +
  '       context pack: <input-file> --context-pack <dir> [--docs <path>]... [--samples <path>]... [--force]\n' +
  '       schema: --emit-proposal-schema <file>'

const MAX_STR = 300
/** C0 and C1 control characters (the C1 range includes the 8-bit CSI) are never printed (review IN-06). */
export function clean(s: unknown): string {
  const t = (typeof s === 'string' ? s : String(s)).replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
  return t.length > MAX_STR ? `${t.slice(0, MAX_STR)}...` : t
}

export const defaultIo: CliIo = {
  readFile: (p) => readFile(p, 'utf8'),
  fileSize: async (p) => {
    const st = await stat(p)
    // A FIFO or device reports size 0 and a read would never end (CR-55b).
    if (!st.isFile()) throw new Error('the input is not a regular file')
    return st.size
  },
  readdir: async (p) => {
    try {
      return await readdir(p)
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return []
      throw e
    }
  },
  writeFile: async (p, c) => {
    // --force writes into an existing directory: never through a symlink an earlier run or a stranger left there (CR-55c).
    try {
      if ((await lstat(p)).isSymbolicLink()) throw new Error('refusing to write through a symbolic link')
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') throw e
    }
    await writeFile(p, c, 'utf8')
  },
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

interface Parsed {
  adapter: string
  input?: string
  out?: string
  force: boolean
  options: GenerateOptions
  proposals?: string
  lenient: boolean
  validateOnly: boolean
  contextPack?: string
  docs: string[]
  samples: string[]
  emitSchema?: string
}

function posInt(v: string | undefined): number | undefined {
  if (v === undefined || !/^\d{1,7}$/.test(v)) return undefined
  const n = Number(v)
  return n >= 1 ? n : undefined
}

const VALUE_FLAGS = ['--adapter', '--out', '--server-name', '--max-page-size', '--result-ceiling', '--proposals', '--context-pack', '--docs', '--samples', '--emit-proposal-schema']

function parseArgs(argv: string[]): Parsed | null {
  const p: Parsed = { adapter: 'auto', force: false, options: {}, lenient: false, validateOnly: false, docs: [], samples: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--force') p.force = true
    else if (a === '--proposals-lenient') p.lenient = true
    else if (a === '--validate-only') p.validateOnly = true
    else if (VALUE_FLAGS.includes(a)) {
      const v = argv[++i]
      if (v === undefined || v.startsWith('--')) return null
      if (a === '--adapter') p.adapter = v
      else if (a === '--out') p.out = v
      else if (a === '--server-name') p.options.serverName = v.slice(0, 80)
      else if (a === '--proposals') p.proposals = v
      else if (a === '--context-pack') p.contextPack = v
      else if (a === '--docs') p.docs.push(v)
      else if (a === '--samples') p.samples.push(v)
      else if (a === '--emit-proposal-schema') p.emitSchema = v
      else {
        const n = posInt(v)
        if (n === undefined) return null
        p.options.limits = { ...p.options.limits, [a === '--max-page-size' ? 'maxPageSize' : 'resultCeiling']: n }
      }
    } else if (a.startsWith('--')) return null
    else if (p.input === undefined) p.input = a
    else return null
  }
  // Mode rules: each mode accepts only the flags that belong to it.
  if (p.emitSchema) return p.input === undefined && !p.out && !p.proposals && !p.contextPack && !p.validateOnly ? p : null
  if (p.lenient && !p.proposals) return null
  if ((p.docs.length > 0 || p.samples.length > 0) && !p.contextPack) return null
  if (p.contextPack) return p.input && !p.out && !p.proposals && !p.validateOnly && !p.lenient ? p : null
  if (p.validateOnly) return p.input && p.proposals && !p.out ? p : null
  return p.input && p.out ? p : null
}

const refusesEnv = isEnvFileName

/** Write files under dir, refusing a non-empty directory unless --force. Returns false after printing the reason. */
async function writeFiles(io: CliIo, dir: string, files: { path: string; content: string }[], force: boolean, tool: string): Promise<boolean> {
  if (!force && (await io.readdir(dir)).length > 0) {
    io.error(`${tool}: output directory is not empty (use --force to write into it).`)
    return false
  }
  if (!files.every((f) => validPath(f.path))) {
    io.error(`${tool}: generated file path rejected.`)
    return false
  }
  await io.mkdir(dir)
  // --force writes into an existing directory: a subdirectory that is a symbolic link would redirect the writes
  // (T-23-06). The check is per directory component below `dir`, before anything is written.
  if (io.lstatKind) {
    const seen = new Set<string>()
    for (const f of files) {
      const parts = f.path.split('/').slice(0, -1)
      for (let i = 1; i <= parts.length; i++) {
        const sub = join(dir, ...parts.slice(0, i))
        if (seen.has(sub)) continue
        seen.add(sub)
        if ((await io.lstatKind(sub)) === 'symlink') {
          io.error(`${tool}: refusing to write through a symbolic link.`)
          return false
        }
      }
    }
  }
  for (const f of files) {
    const target = join(dir, f.path)
    const parent = target.slice(0, Math.max(0, target.length - basename(target).length - 1))
    if (parent && parent !== dir) await io.mkdir(parent)
    await io.writeFile(target, f.content)
  }
  return true
}

async function readProposals(io: CliIo, path: string): Promise<string | null> {
  if (refusesEnv(path)) {
    io.error('generate-mcp: refusing to read environment files.')
    return null
  }
  if ((await io.fileSize(path)) > MAX_PROPOSAL_BYTES) {
    io.error(`generate-mcp: the proposal file exceeds the ${MAX_PROPOSAL_BYTES} byte limit.`)
    return null
  }
  return io.readFile(path)
}

async function runContextPack(args: Parsed, text: string, io: CliIo): Promise<number> {
  const pio = {
    readFile: io.readFile,
    fileSize: io.fileSize,
    readdir: io.readdir,
    lstatKind: io.lstatKind ?? (async () => 'file' as const),
  }
  const docs = await collectPackFiles(pio, args.docs, 'docs')
  if (!docs.ok) {
    io.error(`generate-mcp: ${clean(docs.error)}`)
    return 2
  }
  const samples = await collectPackFiles(pio, args.samples, 'samples')
  if (!samples.ok) {
    io.error(`generate-mcp: ${clean(samples.error)}`)
    return 2
  }
  const pack = buildContextPack({
    source: { name: basename(args.input!), text },
    adapterId: args.adapter,
    options: args.options,
    docs: docs.files,
    samples: samples.files,
  })
  if (!pack.ok) {
    io.error(formatGaps(pack.gaps))
    return 2
  }
  if (!(await writeFiles(io, args.contextPack!, pack.files, args.force, 'generate-mcp'))) return 2
  io.log(`Wrote a context pack of ${pack.files.length} files to ${clean(args.contextPack)}.`)
  for (const n of [...docs.notes, ...samples.notes, ...pack.notes]) io.log(`  note: ${clean(n)}`)
  for (const s of pack.skippedExamples) io.log(`  example skipped: ${clean(s.op)}: ${clean(s.reason)}`)
  io.log('Give the pack to an external agent session; it writes proposals.json. Human review of the result is required before publishing.')
  return 0
}

async function runValidateOnly(args: Parsed, text: string, io: CliIo): Promise<number> {
  const proposals = await readProposals(io, args.proposals!)
  if (proposals === null) return 2
  const parsed = parseInput({ text, filename: basename(args.input!) }, { adapterId: args.adapter === 'auto' ? undefined : args.adapter, options: args.options })
  if (!parsed.ok) {
    io.error(formatGaps(parsed.gaps))
    return 2
  }
  const ev = evaluateProposals({ model: parsed.model, options: args.options, text: proposals, lenient: args.lenient })
  io.log(renderReview(ev))
  return ev.ok ? 0 : 2
}

/** Returns 0 ok, 2 rejected or failed, 64 usage error. Never throws. */
export async function main(argv: string[], io: CliIo = defaultIo): Promise<number> {
  const args = parseArgs(argv)
  if (!args || (!args.emitSchema && !args.input)) {
    io.error(USAGE)
    return 64
  }
  try {
    if (args.emitSchema) {
      if (refusesEnv(args.emitSchema)) {
        io.error('generate-mcp: refusing to write an environment file name.')
        return 2
      }
      const dir = dirname(args.emitSchema)
      if (dir && dir !== '.') await io.mkdir(dir)
      await io.writeFile(args.emitSchema, stableJson(proposalJsonSchema()))
      io.log(`Wrote the ProposalSet JSON Schema to ${clean(args.emitSchema)}.`)
      return 0
    }
    if (!args.input) return 64
    if (refusesEnv(args.input)) {
      io.error('generate-mcp: refusing to read environment files.')
      return 2
    }
    if ((await io.fileSize(args.input)) > MAX_INPUT_BYTES) {
      io.error(`generate-mcp: input exceeds the ${MAX_INPUT_BYTES} byte limit.`)
      return 2
    }
    const text = await io.readFile(args.input)
    // EDMX needs the async XML loader; these two modes call the sync parser directly.
    if (args.contextPack || args.validateOnly) await prepareInput({ text, filename: basename(args.input) }, { adapterId: args.adapter === 'auto' ? undefined : args.adapter })
    if (args.contextPack) return await runContextPack(args, text, io)
    if (args.validateOnly) return await runValidateOnly(args, text, io)
    let proposals: { text: string; lenient: boolean } | undefined
    if (args.proposals) {
      const t = await readProposals(io, args.proposals)
      if (t === null) return 2
      proposals = { text: t, lenient: args.lenient }
    }
    const result = await runPipelineAsync(text, {
      adapterId: args.adapter,
      options: args.options,
      filename: basename(args.input),
      ...(proposals ? { proposals } : {}),
    })
    if (!result.ok) {
      io.error(formatGaps(result.gaps))
      return 2
    }
    if (!(await writeFiles(io, args.out!, result.files, args.force, 'generate-mcp'))) return 2
    const r = result.report
    io.log(`Generated ${result.files.length} files in ${clean(args.out)} (adapter: ${clean(result.adapterId)}).`)
    io.log(`Tools: ${r.toolsEmitted.map(clean).join(', ') || '(none)'}`)
    if (r.toolsDropped.length > 0) {
      io.log('Dropped:')
      for (const d of r.toolsDropped) io.log(`  - ${clean(d.id)}: ${clean(d.reason)}`)
    }
    if (r.gaps.length > 0) io.log(formatGaps(r.gaps))
    if (r.assumptions.length > 0) {
      io.log('Assumptions:')
      for (const a of r.assumptions) io.log(`  - ${clean(a)}`)
    }
    if (r.envVars.length > 0) {
      io.log('Environment variables:')
      for (const v of r.envVars) io.log(`  ${clean(v.name)}  ${clean(v.purpose)}`)
    }
    if (result.proposals) {
      const pr = result.proposals
      io.log(`Proposals: sha256 ${pr.sha256}; applied ${pr.applied.length} op(s), rejected ${pr.rejected.length} (${pr.mode}).`)
      for (const x of pr.rejected) io.log(`  rejected ${clean(x.id)}: gate ${x.gate} ${clean(x.code)}`)
      io.log('Human review of the diff against the baseline is required before this package is published. Run with --validate-only for the review summary.')
    }
    return 0
  } catch (e) {
    io.error(`generate-mcp: ${e instanceof Error ? clean(e.message) : 'error'}`)
    return 2
  }
}

export { isMainModule }

if (isMainModule(import.meta.url, process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2))
}
