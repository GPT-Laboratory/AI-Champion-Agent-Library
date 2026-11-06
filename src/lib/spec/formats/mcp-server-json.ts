// MCP registry `server.json` adapter (Phase 13, flag AGENT_KINDS; rank 5 in D-030).
//
// DOCUMENTED ASSUMPTIONS (no web access when written; facts from 12-RESEARCH.md only):
//  - The MCP registry is in preview and the server.json schema is a DRAFT: keys may be renamed.
//    Both snake_case and camelCase spellings are tolerated for the keys read here, and every
//    unrecognised top-level key is preserved under extras.unknown.
//  - Read keys: reverse-DNS `name`, `description`, `version`, `repository.url`, `packages[]`
//    (identifier/name, registry_type/registryType, version, transport, environment variables),
//    `remotes[]` (type, url), top-level environment variables.
//  - server.json carries no tool list and no catalog category: toolNames is empty and both are
//    reported as missing from the author (a catalog.yaml can supply them).
//  - Remote URLs and the repository URL are kept as TEXT only and never fetched.
//  - Environment variables: ONLY their names are stored. Any `value` / `default` is dropped, so a
//    secret placed in a declaration can never reach the record.
//  - Nothing from the file is executed, imported or fetched. Malformed JSON yields an outcome.
import type { AgentRecord } from '../types.js'
import { slugify } from '../types.js'
import type { FormatAdapter, KindInfo, ParseOutcome, SubmissionFile } from '../kinds.js'
import { clampExtras } from '../kinds.js'
import { unrecognizedOutcome } from '../outcome.js'
import { capText, setOwn } from '../security.js'
import { byShallowest, ignoredWarning } from '../paths.js'

type Obj = Record<string, unknown>

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}
function cap(s: string, n = 300): string {
  return capText(s, n).text
}
function pick(o: Obj, ...keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined) return o[k]
  return undefined
}

const KNOWN = new Set([
  '$schema', 'name', 'description', 'version', 'repository', 'packages', 'remotes',
  'environment_variables', 'environmentVariables', 'title', 'website_url', 'websiteUrl',
  'status', '_meta', 'icons',
])

function parseJson(text: string): Obj | undefined {
  try {
    const v: unknown = JSON.parse(text)
    return isObj(v) ? v : undefined
  } catch {
    return undefined
  }
}

const isServerJson = (f: SubmissionFile): boolean => (f.path.split('/').pop() ?? '') === 'server.json'

function looksLikeMcp(o: Obj): boolean {
  const schema = typeof o.$schema === 'string' && o.$schema.toLowerCase().includes('modelcontextprotocol')
  // WR-01: a nameless server.json that declares the MCP registry $schema is still an MCP server
  // definition; parse() reports the missing name instead of the file being skipped.
  if (schema) return true
  if (typeof o.name !== 'string') return false
  return Array.isArray(o.packages) || Array.isArray(o.remotes)
}

function envNames(v: unknown, into: Set<string>): void {
  if (!Array.isArray(v)) return
  for (const e of v) {
    const n = isObj(e) ? str(e.name) : typeof e === 'string' ? e : null
    if (n) into.add(cap(n, 100))
  }
}

function transportOf(o: Obj): string | null {
  const t = o.transport
  if (typeof t === 'string') return cap(t, 50)
  if (isObj(t)) return str(t.type) ? cap(t.type as string, 50) : null
  return str(o.type) ? cap(o.type as string, 50) : null
}

function prettify(name: string): string {
  const last = name.split('/').pop() ?? name
  const words = last.split(/[-_.\s]+/).filter(Boolean)
  const t = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  return t || name
}

export const mcpServerJsonAdapter: FormatAdapter = {
  id: 'mcp-server-json',
  detect(files) {
    for (const f of byShallowest(files.filter(isServerJson), (x) => x.path)) {
      const o = parseJson(f.text)
      if (o && looksLikeMcp(o)) return { format: 'mcp-server-json', confidence: 0.85 }
    }
    return null
  },
  parse(files, ctx): ParseOutcome {
    try {
      const all = byShallowest(files.filter(isServerJson), (x) => x.path)
      const f = all.find((x) => { const j = parseJson(x.text); return j !== undefined && looksLikeMcp(j) }) ?? all[0]
      if (!f) return unrecognizedOutcome()
      const ignored = all.filter((x) => x !== f).map((x) => x.path)
      const o = parseJson(f.text)
      if (!o) {
        return {
          status: 'missing-from-author', format: 'mcp-server-json', record: null, kindInfo: null,
          missingFromAuthor: ['valid server.json'], unknownFields: [], warnings: [],
        }
      }
      const name = str(o.name)
      if (!name) {
        return {
          status: 'missing-from-author', format: 'mcp-server-json', record: null, kindInfo: null,
          missingFromAuthor: ['name'], unknownFields: [], warnings: [],
        }
      }
      const warnings: string[] = []
      const ignoredNote = ignoredWarning('server.json', f.path, ignored)
      if (ignoredNote) warnings.push(ignoredNote)
      const transports = new Set<string>()
      const packageIdentifiers: string[] = []
      const remoteUrls: string[] = []
      const env = new Set<string>()
      if (Array.isArray(o.packages)) {
        for (const p of o.packages) {
          if (!isObj(p)) continue
          const id = str(pick(p, 'identifier', 'name', 'package'))
          if (id) packageIdentifiers.push(cap(id, 200))
          const t = transportOf(p)
          if (t) transports.add(t)
          envNames(pick(p, 'environment_variables', 'environmentVariables'), env)
        }
      }
      if (Array.isArray(o.remotes)) {
        for (const r of o.remotes) {
          if (!isObj(r)) continue
          const u = str(r.url)
          if (u) remoteUrls.push(cap(u, 500))
          const t = transportOf(r)
          if (t) transports.add(t)
          envNames(pick(r, 'environment_variables', 'environmentVariables'), env)
        }
      }
      envNames(pick(o, 'environment_variables', 'environmentVariables'), env)

      const unknown: Obj = {}
      for (const [k, v] of Object.entries(o)) if (!KNOWN.has(k)) setOwn(unknown, k, v)

      const repoUrl = isObj(o.repository) ? str(o.repository.url) : null
      const githubUrl = repoUrl && /^https?:\/\//i.test(repoUrl) ? cap(repoUrl, 500) : null
      const version = str(o.version)
      const title = str(o.title) ? cap(o.title as string, 120) : prettify(name)

      const record: AgentRecord = {
        // An empty slug (non-ASCII name) is resolved by the registry from the folder hint or a hash.
        slug: slugify(name),
        title,
        specId: cap(name, 200),
        summary: cap(str(o.description) ?? '', 2000),
        systemPrompt: '',
        llm: { name: 'n/a', temperature: null, maxTokens: null, topP: null },
        toolNames: [],
        inputFields: [],
        requiresHumanApproval: false,
        category: null,
        githubUrl,
        linkLabel: null,
        maturityStatus: 'experimental',
        tags: [],
        customizableFields: [],
        fixedNote: null,
        fixedFields: [],
        lastIngestedAt: ctx.now,
      }
      const missing = ['tool list', 'category']
      if (!record.summary) missing.unshift('summary')
      const extras: Obj = {
        mcp: {
          name: cap(name, 200),
          version: version ? cap(version, 50) : null,
          transports: [...transports],
          packageIdentifiers: packageIdentifiers.slice(0, 20),
          remoteUrls: remoteUrls.slice(0, 20),
          envVarNames: [...env].slice(0, 50),
        },
      }
      if (Object.keys(unknown).length > 0) extras.unknown = unknown
      const kindInfo: KindInfo = {
        kind: 'mcp-server',
        framework: 'mcp',
        topology: null,
        members: [],
        sourceFormat: 'mcp-server-json',
        extras: clampExtras(extras),
      }
      return {
        status: 'partial',
        format: 'mcp-server-json',
        record, kindInfo,
        missingFromAuthor: missing,
        unknownFields: Object.keys(unknown),
        warnings,
      }
    } catch (e) {
      return unrecognizedOutcome([`mcp-server-json: ${e instanceof Error ? e.message : 'error'}`])
    }
  },
}
