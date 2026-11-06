// catalog.yaml manifest adapter (Phase 13, flag AGENT_KINDS; rank 2 in D-030).
//
// `catalog.yaml` is OUR OWN convention, author-asserted. It is the universal fallback for
// code-only frameworks (LangGraph, CrewAI code, ...) whose topology lives in code we never
// execute or import. Because it is asserted, it may drift from the code: validate-submission
// cannot verify it for code-only frameworks.
//
// DOCUMENTED ASSUMPTIONS
//  - File basename is `catalog.yaml` or `catalog.yml`; content is parsed as data only (yaml).
//  - Schema: name (required); kind (default 'agent', invalid -> warning + 'agent'); summary or
//    description; category; tags[]; maturity (production|beta|experimental); repo_url (http/https
//    only, else dropped with a warning; never fetched); link_label; framework; topology;
//    members[{name, role, description, ref, slug}]; tools[] (strings or {name}); model (string).
//  - kind 'mcp-server': transport / package / command / args / env are summarised under
//    extras.mcp. Only env variable NAMES are kept; values are never stored. Secret-looking
//    values anywhere in extras are redacted.
//  - Every unknown top-level key is preserved in extras. Malformed input never throws.
//  - Non-agent kinds get placeholder systemPrompt '' and llm 'n/a' (D-037).
//  - Confidence 0.9: wins over lower-ranked formats in the same folder; ties with other 0.9
//    detectors resolve by ADAPTERS order (oracle-systems first).
import { parse as parseYaml } from 'yaml'
import type { AgentRecord } from '../types.js'
import { slugify } from '../types.js'
import type {
  AgentKind,
  AgentMember,
  FormatAdapter,
  KindInfo,
  MemberRole,
  ParseOutcome,
  SubmissionFile,
} from '../kinds.js'
import { AGENT_KIND_VALUES, clampExtras, MEMBERS_MAX } from '../kinds.js'
import { unrecognizedOutcome } from '../outcome.js'
import { capText, redactSecrets, scanSecrets, setOwn } from '../security.js'
import { byShallowest, ignoredWarning } from '../paths.js'

type Obj = Record<string, unknown>
const FORMAT = 'catalog-manifest'
const ROLES: readonly string[] = ['manager', 'worker', 'peer', 'step', 'participant']
const MATURITY: readonly string[] = ['production', 'beta', 'experimental']
const KNOWN = [
  'name', 'kind', 'summary', 'description', 'category', 'tags', 'maturity', 'repo_url',
  'link_label', 'framework', 'topology', 'members', 'tools', 'model',
]
const MCP_KEYS = ['transport', 'package', 'command', 'args']
const CATALOG_RE = /(^|\/)catalog\.ya?ml$/i

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
}
function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const item of v) {
    const s = str(item) ?? (isObj(item) ? str(item.name) : null)
    if (s) out.push(s)
  }
  return out
}

function load(files: SubmissionFile[]): { doc: Obj; path: string; ignored: string[] } | null {
  const catalogs = byShallowest(
    (Array.isArray(files) ? files : []).filter(
      (f) => f && typeof f.path === 'string' && typeof f.text === 'string' && CATALOG_RE.test(f.path),
    ),
    (f) => f.path,
  )
  for (const file of catalogs) {
    try {
      const doc: unknown = parseYaml(file.text, { maxAliasCount: 100 })
      if (isObj(doc) && str(doc.name)) {
        return { doc, path: file.path, ignored: catalogs.filter((f) => f !== file).map((f) => f.path) }
      }
    } catch {
      /* not parseable: not detected */
    }
  }
  return null
}

function hasCatalogObject(files: SubmissionFile[]): boolean {
  for (const file of Array.isArray(files) ? files : []) {
    if (!file || typeof file.path !== 'string' || typeof file.text !== 'string') continue
    if (!CATALOG_RE.test(file.path)) continue
    try {
      if (isObj(parseYaml(file.text, { maxAliasCount: 100 }))) return true
    } catch {
      /* not parseable */
    }
  }
  return false
}

/** Why a catalog file is unusable: the (clamped) YAML error, e.g. the alias limit, or the missing name. */
function catalogProblem(text: string): string {
  try {
    const doc: unknown = parseYaml(text, { maxAliasCount: 100 })
    return isObj(doc) ? 'catalog.yaml has no usable name' : 'catalog.yaml is not a mapping'
  } catch (e) {
    return `catalog.yaml could not be parsed: ${capText(e instanceof Error ? e.message : 'error', 200).text}`
  }
}

function safeHttpUrl(v: unknown): string | null {
  const s = str(v)
  if (!s) return null
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:' ? s : null
  } catch {
    return null
  }
}

function envNames(env: unknown): string[] {
  if (Array.isArray(env)) {
    return env
      .map((e) => (typeof e === 'string' ? (e.split('=')[0] ?? '') : isObj(e) ? str(e.name) : null))
      .filter((n): n is string => !!n)
  }
  return isObj(env) ? Object.keys(env) : []
}

function parseMembers(v: unknown, warnings: string[]): AgentMember[] {
  if (v === undefined) return []
  if (!Array.isArray(v)) {
    warnings.push('members is not a list; ignored')
    return []
  }
  if (v.length > MEMBERS_MAX) warnings.push(`members capped at ${MEMBERS_MAX} (found ${v.length})`)
  const out: AgentMember[] = []
  for (const m of v.slice(0, MEMBERS_MAX)) {
    const o = isObj(m) ? m : typeof m === 'string' ? { name: m } : null
    const name = o ? str(o.name) : null
    if (!o || !name) {
      warnings.push('member without a name skipped')
      continue
    }
    let role = str(o.role) ?? 'participant'
    if (!ROLES.includes(role)) {
      warnings.push(`member ${name}: unknown role "${role}", using participant`)
      role = 'participant'
    }
    out.push({
      ref: str(o.ref) ?? slugify(name),
      name,
      role: role as MemberRole,
      description: str(o.description),
      slug: str(o.slug),
    })
  }
  return out
}

function parseDoc(doc: Obj, now: string): ParseOutcome {
  const warnings: string[] = []
  const unknownFields = Object.keys(doc).filter((k) => !KNOWN.includes(k))
  const name = str(doc.name)
  if (!name) {
    return {
      status: 'missing-from-author', format: FORMAT, record: null, kindInfo: null,
      missingFromAuthor: ['name'], unknownFields, warnings,
    }
  }

  let kind: AgentKind = 'agent'
  if (doc.kind !== undefined) {
    const k = str(doc.kind)
    if (k && (AGENT_KIND_VALUES as readonly string[]).includes(k)) kind = k as AgentKind
    else warnings.push(`invalid kind "${String(doc.kind)}", using agent`)
  }

  const githubUrl = safeHttpUrl(doc.repo_url)
  if (doc.repo_url !== undefined && !githubUrl) warnings.push('repo_url is not an http(s) URL; dropped')

  const maturityRaw = str(doc.maturity)
  let maturity: AgentRecord['maturityStatus'] = 'experimental'
  if (maturityRaw && MATURITY.includes(maturityRaw)) maturity = maturityRaw as AgentRecord['maturityStatus']
  else if (maturityRaw) warnings.push(`unknown maturity "${maturityRaw}", using experimental`)

  const summary = str(doc.summary) ?? str(doc.description)
  const category = str(doc.category)
  const members = parseMembers(doc.members, warnings)

  const extras: Obj = {}
  for (const k of unknownFields) setOwn(extras, k, doc[k])
  if (kind === 'mcp-server') {
    const mcp: Obj = {}
    const src = isObj(doc.mcp) ? { ...doc.mcp } : {}
    for (const k of MCP_KEYS) {
      const v = doc[k] ?? src[k]
      if (v !== undefined) setOwn(mcp, k, v)
    }
    const names = envNames(doc.env ?? src.env)
    if (names.length > 0) mcp.envVarNames = names
    for (const k of [...MCP_KEYS, 'env', 'mcp']) delete extras[k]
    if (Object.keys(mcp).length > 0) extras.mcp = mcp
  }
  const found = scanSecrets(extras)
  if (found.length > 0) warnings.push(`secret-like values redacted (${found.length}): ${found.slice(0, 5).join(', ')}`)
  const safeExtras = clampExtras(redactSecrets(extras))

  const record: AgentRecord = {
    slug: slugify(name),
    title: name,
    specId: null,
    summary: summary ?? '',
    systemPrompt: '',
    llm: { name: str(doc.model) ?? 'n/a', temperature: null, maxTokens: null, topP: null },
    toolNames: strList(doc.tools),
    inputFields: [],
    requiresHumanApproval: false,
    category,
    githubUrl,
    linkLabel: str(doc.link_label),
    maturityStatus: maturity,
    tags: strList(doc.tags),
    customizableFields: null,
    fixedNote: null,
    fixedFields: [],
    lastIngestedAt: now,
  }
  const kindInfo: KindInfo = {
    kind, framework: str(doc.framework), topology: str(doc.topology), members,
    sourceFormat: 'catalog-manifest@1', extras: safeExtras,
  }
  const missing: string[] = []
  if (!summary) missing.push('summary')
  if (!category) missing.push('category')
  return {
    status: missing.length > 0 ? 'partial' : 'ingestible',
    format: FORMAT, record, kindInfo, missingFromAuthor: missing, unknownFields, warnings,
  }
}

export const manifestAdapter: FormatAdapter = {
  id: 'catalog-manifest',
  detect(files) {
    try {
      if (load(files)) return { format: FORMAT, confidence: 0.9 }
      // WR-01: a catalog.yaml that parses but has no name is still a catalog manifest. It is
      // detected at low confidence so that parse() can report the missing name (a failure for
      // the author) instead of the folder being skipped as "not a submission". An unparseable
      // file stays undetected (pinned by manifest.test.ts; IN-03 is only covered at parse level).
      return hasCatalogObject(files) ? { format: FORMAT, confidence: 0.3 } : null
    } catch {
      return null
    }
  },
  parse(files, ctx) {
    try {
      const hit = load(files)
      if (hit) {
        const outcome = parseDoc(hit.doc, ctx.now)
        const note = ignoredWarning('catalog.yaml', hit.path, hit.ignored)
        return note ? { ...outcome, warnings: [...outcome.warnings, note] } : outcome
      }
      for (const f of Array.isArray(files) ? files : []) {
        if (f && typeof f.path === 'string' && CATALOG_RE.test(f.path)) {
          return {
            status: 'missing-from-author', format: FORMAT, record: null, kindInfo: null,
            missingFromAuthor: ['name'], unknownFields: [], warnings: [catalogProblem(f.text)],
          }
        }
      }
      return unrecognizedOutcome()
    } catch (e) {
      return unrecognizedOutcome([`catalog.yaml could not be read: ${e instanceof Error ? e.message : 'error'}`])
    }
  },
}

export type { SubmissionFile }
