// Oracle AgentSpec multi-agent adapter (Phase 13, flag AGENT_KINDS; rank 1 in D-030).
//
// This is the "discriminated union behind the flag": a tolerant hand-written reader that
// dispatches on `type` OR `component_type` (Swarm, ManagerWorkers, Flow, A2AAgent, Agent).
// The strict `z.literal('Agent')` schema in oracle-agentspec.ts is untouched; a single Agent
// delegates to the public normalize(detectFormat(raw), raw) so that path is identical.
//
// DOCUMENTED ASSUMPTIONS (no web access when this was written, facts from 12-RESEARCH.md only):
//  - Swarm: `first_agent`, `agents`, `relationships`, `handoff` (never|optional|always).
//    The `relationships` tuple shape is UNVERIFIED: it is kept opaque in extras.relationships and
//    never used to derive order. Member order comes from first_agent then `agents` only.
//  - ManagerWorkers: `group_manager`, `workers`.
//  - Flow: `start_node`, `nodes` (AgentNode / LLMNode / FlowNode ...), `control_flow_connections`
//    (`from_node` -> `to_node`). Members are the AgentNode nodes in control-flow order.
//  - A2AAgent: `agent_url`, `connection_config`; the URL is kept as TEXT only, never fetched.
//  - References are `{"$component_ref": "<id>"}`. The YAML shape of the reference registry is
//    unconfirmed, so a ref resolves to a component with a matching `id` defined anywhere in the
//    same file (inline, or under a `$referenced_components` map/list). If nothing matches, the ref
//    string is kept as member `ref` and `name` and a warning is added.
//  - Author content is only ever parsed as data. Nothing is executed, imported or fetched.
import { parse as parseYaml } from 'yaml'
import type { AgentRecord } from '../types.js'
import { slugify } from '../types.js'
import { detectFormat, normalize } from '../index.js'
import type {
  AgentKind,
  AgentMember,
  FormatAdapter,
  KindInfo,
  MemberRole,
  ParseOutcome,
  SubmissionFile,
} from '../kinds.js'
import { clampExtras, MEMBERS_MAX } from '../kinds.js'
import { unrecognizedOutcome } from '../outcome.js'
import { redactSecrets, scanSecrets, setOwn } from '../security.js'
import { safeHttpUrl } from '../../safeUrl.js'
import { byShallowest, ignoredWarning } from '../paths.js'

type Obj = Record<string, unknown>
type SystemType = 'Swarm' | 'ManagerWorkers' | 'Flow' | 'A2AAgent'
const SYSTEM_TYPES: readonly string[] = ['Swarm', 'ManagerWorkers', 'Flow', 'A2AAgent']

const COMMON_KNOWN = [
  'type', 'component_type', 'id', 'name', 'description', 'metadata',
  'min_agentspec_version', 'max_agentspec_version', '$referenced_components',
]
const KNOWN_BY_TYPE: Record<SystemType | 'Agent', string[]> = {
  Swarm: ['first_agent', 'agents', 'relationships', 'handoff'],
  ManagerWorkers: ['group_manager', 'workers'],
  Flow: ['start_node', 'nodes', 'control_flow_connections'],
  A2AAgent: ['agent_url', 'connection_config'],
  Agent: [
    'system_prompt', 'llm_config', 'tools', 'toolboxes', 'inputs', 'outputs', 'human_in_the_loop',
  ],
}
const OMIT_FROM_MEMBER_FIELDS = new Set(['id', 'name', 'description', 'component_type', 'type', 'system_prompt', 'metadata'])

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}
function typeOf(o: Obj): string | null {
  return str(o.component_type) ?? str(o.type)
}

interface Candidate {
  file: SubmissionFile
  doc: Obj
  type: SystemType | 'Agent'
}

function parseDoc(text: string): unknown {
  try {
    return parseYaml(text, { maxAliasCount: 100 })
  } catch {
    return undefined
  }
}

function candidates(files: SubmissionFile[]): Candidate[] {
  const out: Candidate[] = []
  for (const file of Array.isArray(files) ? files : []) {
    if (!file || typeof file.text !== 'string') continue
    if (!/\.(ya?ml|json)$/i.test(file.path)) continue
    const doc = parseDoc(file.text)
    if (!isObj(doc)) continue
    const t = typeOf(doc)
    if (t && (SYSTEM_TYPES.includes(t) || t === 'Agent')) {
      out.push({ file, doc, type: t as Candidate['type'] })
    }
  }
  // systems first, then single agents; within each, the shallowest path wins (WR-02)
  const shallow = byShallowest(out, (c) => c.file.path)
  return [...shallow.filter((c) => c.type !== 'Agent'), ...shallow.filter((c) => c.type === 'Agent')]
}

// ---- reference resolution ---------------------------------------------------------------

interface Ctx {
  byId: Map<string, Obj>
  warnings: string[]
}

function buildIndex(root: Obj, warnings: string[]): Map<string, Obj> {
  const byId = new Map<string, Obj>()
  const register = (id: string, o: Obj): void => {
    const prev = byId.get(id)
    if (prev && prev !== o) warnings.push(`duplicate component id: ${id}`)
    else byId.set(id, o)
  }
  const seen = new Set<object>()
  const walk = (v: unknown, depth: number): void => {
    if (depth > 12 || typeof v !== 'object' || v === null || seen.has(v)) return
    seen.add(v)
    if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1)
      return
    }
    const o = v as Obj
    if (o !== root && str(o.id) && typeOf(o)) register(o.id as string, o)
    for (const [k, item] of Object.entries(o)) {
      if (k === '$referenced_components' && isObj(item)) {
        for (const [key, comp] of Object.entries(item)) {
          if (isObj(comp)) {
            if (!str(comp.id)) register(key, comp)
          }
        }
      }
      walk(item, depth + 1)
    }
  }
  walk(root, 0)
  const refd = root.$referenced_components
  if (Array.isArray(refd)) for (const c of refd) if (isObj(c) && str(c.id)) register(c.id as string, c)
  return byId
}

interface Resolved {
  ref: string
  comp: Obj | null
}

function resolve(item: unknown, ctx: Ctx): Resolved | null {
  if (typeof item === 'string' && item) {
    const comp = ctx.byId.get(item) ?? null
    if (!comp) ctx.warnings.push(`unresolved reference: ${item}`)
    return { ref: item, comp }
  }
  if (!isObj(item)) return null
  const refStr = str(item.$component_ref)
  if (refStr) {
    const comp = ctx.byId.get(refStr) ?? null
    if (!comp) ctx.warnings.push(`unresolved $component_ref: ${refStr}`)
    return { ref: refStr, comp }
  }
  const ref = str(item.id) ?? str(item.name)
  if (!ref) return null
  return { ref, comp: item }
}

function toMember(r: Resolved, role: MemberRole, ctx: Ctx): AgentMember {
  let comp = r.comp
  // AgentNode wraps an agent: prefer the wrapped agent's name/description.
  if (comp && typeOf(comp) === 'AgentNode' && comp.agent !== undefined) {
    const inner = resolve(comp.agent, ctx)
    if (inner?.comp) comp = { ...inner.comp, id: r.ref }
  }
  return {
    ref: r.ref,
    name: (comp && str(comp.name)) ?? r.ref,
    role,
    description: (comp && str(comp.description)) ?? null,
    slug: null,
  }
}

function memberFields(r: Resolved): Obj | null {
  if (!r.comp) return null
  const o: Obj = {}
  for (const [k, v] of Object.entries(r.comp)) if (!OMIT_FROM_MEMBER_FIELDS.has(k)) setOwn(o, k, v)
  return Object.keys(o).length > 0 ? o : null
}

function listOf(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

// ---- system readers ----------------------------------------------------------------------

interface SystemRead {
  kind: AgentKind
  topology: string | null
  members: Array<{ r: Resolved; role: MemberRole }>
  extras: Obj
}

function readSwarm(doc: Obj, ctx: Ctx): SystemRead {
  const members: SystemRead['members'] = []
  const used = new Set<string>()
  const add = (item: unknown, role: MemberRole): void => {
    const r = resolve(item, ctx)
    if (r && !used.has(r.ref)) {
      used.add(r.ref)
      members.push({ r, role })
    }
  }
  if (doc.first_agent !== undefined) add(doc.first_agent, 'peer')
  for (const a of listOf(doc.agents)) add(a, 'peer')
  const extras: Obj = {}
  if (doc.relationships !== undefined) extras.relationships = doc.relationships
  if (doc.handoff !== undefined) extras.handoff = doc.handoff
  return { kind: 'system', topology: 'swarm', members, extras }
}

function readManagerWorkers(doc: Obj, ctx: Ctx): SystemRead {
  const members: SystemRead['members'] = []
  const used = new Set<string>()
  const add = (item: unknown, role: MemberRole): void => {
    const r = resolve(item, ctx)
    if (r && !used.has(r.ref)) {
      used.add(r.ref)
      members.push({ r, role })
    }
  }
  if (doc.group_manager !== undefined) add(doc.group_manager, 'manager')
  for (const w of listOf(doc.workers)) add(w, 'worker')
  return { kind: 'system', topology: 'manager-workers', members, extras: {} }
}

function nodeKey(v: unknown): string | null {
  if (typeof v === 'string') return v || null
  if (!isObj(v)) return null
  return str(v.$component_ref) ?? str(v.id) ?? str(v.name)
}

function readFlow(doc: Obj, ctx: Ctx): SystemRead {
  const nodes: Resolved[] = []
  for (const n of listOf(doc.nodes)) {
    const r = resolve(n, ctx)
    if (r) nodes.push(r)
  }
  const edges = new Map<string, string[]>()
  for (const c of listOf(doc.control_flow_connections)) {
    if (!isObj(c)) continue
    const from = nodeKey(c.from_node)
    const to = nodeKey(c.to_node)
    if (from && to) edges.set(from, [...(edges.get(from) ?? []), to])
  }
  // BFS from start_node over control-flow edges, then remaining nodes in listed order.
  const order: string[] = []
  const seen = new Set<string>()
  const start = nodeKey(doc.start_node)
  const queue = start ? [start] : []
  while (queue.length > 0 && order.length < 1000) {
    const k = queue.shift() as string
    if (seen.has(k)) continue
    seen.add(k)
    order.push(k)
    queue.push(...(edges.get(k) ?? []))
  }
  const byKey = new Map(nodes.map((n) => [n.ref, n]))
  const ordered: Resolved[] = []
  for (const k of order) {
    const n = byKey.get(k)
    if (n) ordered.push(n)
  }
  for (const n of nodes) if (!seen.has(n.ref)) ordered.push(n)

  // Map, not a plain object: author-controlled node types like `constructor` must not read inherited members.
  const nodeTypes = new Map<string, number>()
  const members: SystemRead['members'] = []
  for (const n of ordered) {
    const t = (n.comp && typeOf(n.comp)) ?? 'unknown'
    nodeTypes.set(t, (nodeTypes.get(t) ?? 0) + 1)
    if (t === 'AgentNode') members.push({ r: n, role: 'step' })
  }
  const extras: Obj = { nodeTypes: Object.fromEntries([...nodeTypes].filter(([k]) => k !== '__proto__')) }
  if (start) extras.startNode = start
  if (doc.control_flow_connections !== undefined) extras.controlFlow = doc.control_flow_connections
  return { kind: 'system', topology: 'pipeline', members, extras }
}

function readA2A(doc: Obj): SystemRead {
  const extras: Obj = {}
  if (doc.agent_url !== undefined) extras.agentUrl = typeof doc.agent_url === 'string' ? doc.agent_url : String(doc.agent_url)
  if (doc.connection_config !== undefined) extras.connectionConfig = doc.connection_config
  return { kind: 'external-agent', topology: null, members: [], extras }
}

// ---- adapter -----------------------------------------------------------------------------

function metaStr(meta: Obj | null, key: string): string | null {
  return meta ? str(meta[key]) : null
}

function placeholderRecord(doc: Obj, now: string, warnings: string[]): AgentRecord | null {
  const name = str(doc.name)
  if (!name) return null
  const meta = isObj(doc.metadata) ? doc.metadata : null
  const rawUrl = metaStr(meta, 'github_url')
  const githubUrl = safeHttpUrl(rawUrl)
  if (rawUrl && !githubUrl) warnings.push('github_url is not an http(s) URL; dropped')
  const maturity = metaStr(meta, 'maturity')
  return {
    slug: slugify(name),
    title: name,
    specId: str(doc.id),
    summary: str(doc.description) ?? '',
    systemPrompt: '',
    llm: { name: 'n/a', temperature: null, maxTokens: null, topP: null },
    toolNames: [],
    inputFields: [],
    requiresHumanApproval: false,
    category: metaStr(meta, 'category'),
    githubUrl,
    linkLabel: metaStr(meta, 'link_label'),
    maturityStatus: maturity === 'production' || maturity === 'beta' || maturity === 'experimental' ? maturity : 'experimental',
    tags: meta && Array.isArray(meta.tags) ? meta.tags.filter((t): t is string => typeof t === 'string') : [],
    customizableFields: null,
    fixedNote: null,
    fixedFields: [],
    lastIngestedAt: now,
  }
}

function missingMeta(doc: Obj): string[] {
  const meta = isObj(doc.metadata) ? doc.metadata : null
  const missing: string[] = []
  if (!str(doc.description)) missing.push('summary')
  if (!metaStr(meta, 'category')) missing.push('category')
  if (!(meta && Array.isArray(meta.tags) && meta.tags.length > 0)) missing.push('tags')
  if (!metaStr(meta, 'github_url')) missing.push('github_url')
  if (!metaStr(meta, 'maturity')) missing.push('maturity')
  return missing
}

function parseCandidate(c: Candidate, ctxIn: { now: string }): ParseOutcome {
  const { doc, type } = c
  const warnings: string[] = []
  const format = 'oracle-agentspec'
  const sourceFormat = `oracle-agentspec@${str(doc.min_agentspec_version) ?? 'unknown'}`
  const known = new Set([...COMMON_KNOWN, ...KNOWN_BY_TYPE[type]])
  const unknownFields = Object.keys(doc).filter((k) => !known.has(k))

  if (type === 'Agent') {
    let record: AgentRecord
    try {
      const raw = doc.component_type === 'Agent' ? doc : { ...doc, component_type: 'Agent' }
      record = { ...normalize(detectFormat(raw), raw), lastIngestedAt: ctxIn.now }
    } catch (e) {
      return unrecognizedOutcome([`Agent did not validate: ${e instanceof Error ? e.message : 'error'}`])
    }
    const kindInfo: KindInfo = {
      kind: 'agent', framework: 'oracle-agentspec', topology: null, members: [], sourceFormat, extras: {},
    }
    const missing = missingMeta(doc)
    return {
      status: missing.length > 0 ? 'partial' : 'ingestible',
      format, record, kindInfo, missingFromAuthor: missing, unknownFields, warnings,
    }
  }

  const ctx: Ctx = { byId: buildIndex(doc, warnings), warnings }
  const read =
    type === 'Swarm' ? readSwarm(doc, ctx)
    : type === 'ManagerWorkers' ? readManagerWorkers(doc, ctx)
    : type === 'Flow' ? readFlow(doc, ctx)
    : readA2A(doc)

  let picked = read.members
  if (picked.length > MEMBERS_MAX) {
    warnings.push(`members capped at ${MEMBERS_MAX} (found ${picked.length})`)
    picked = picked.slice(0, MEMBERS_MAX)
  }
  const members = picked.map((m) => toMember(m.r, m.role, ctx))

  const extras: Obj = { ...read.extras }
  for (const k of unknownFields) setOwn(extras, k, doc[k])
  if (isObj(doc.metadata)) {
    const rest: Obj = {}
    const consumed = new Set(['category', 'tags', 'github_url', 'maturity', 'link_label'])
    for (const [k, v] of Object.entries(doc.metadata)) if (!consumed.has(k)) setOwn(rest, k, v)
    if (Object.keys(rest).length > 0) extras.metadata = rest
  }
  const fields: Obj = {}
  for (const m of picked) {
    const f = memberFields(m.r)
    if (f) setOwn(fields, m.r.ref, f)
  }
  if (Object.keys(fields).length > 0) extras.memberFields = fields
  if (type === 'Swarm' && !str(doc.first_agent) && !isObj(doc.first_agent)) {
    warnings.push('Swarm has no first_agent')
  }

  let safe = redactSecrets(extras)
  const found = scanSecrets(extras)
  if (found.length > 0) warnings.push(`secret-like values redacted (${found.length}): ${found.slice(0, 5).join(', ')}`)
  if (Buffer.byteLength(JSON.stringify(safe), 'utf8') > 16384 && safe.memberFields !== undefined) {
    delete safe.memberFields
    warnings.push('extras too large: per-member fields dropped')
  }
  safe = clampExtras(safe)

  const record = placeholderRecord(doc, ctxIn.now, warnings)
  if (!record) {
    return {
      status: 'missing-from-author', format, record: null, kindInfo: null,
      missingFromAuthor: ['name'], unknownFields, warnings,
    }
  }
  const kindInfo: KindInfo = {
    kind: read.kind, framework: 'oracle-agentspec', topology: read.topology, members, sourceFormat, extras: safe,
  }
  const missing = missingMeta(doc)
  return {
    status: missing.length > 0 ? 'partial' : 'ingestible',
    format, record, kindInfo, missingFromAuthor: missing, unknownFields, warnings,
  }
}

export const oracleSystemsAdapter: FormatAdapter = {
  id: 'oracle-agentspec',
  detect(files) {
    const best = candidates(files)[0]
    if (!best) return null
    return { format: 'oracle-agentspec', confidence: best.type === 'Agent' ? 0.8 : 0.9 }
  },
  parse(files, ctx) {
    const all = candidates(files)
    const best = all[0]
    if (!best) return unrecognizedOutcome()
    const outcome = parseCandidate(best, ctx)
    // WR-02: one submission yields one record; say so when other definitions were left out.
    const note = ignoredWarning('Oracle AgentSpec', best.file.path, all.slice(1).map((c) => c.file.path))
    return note ? { ...outcome, warnings: [...outcome.warnings, note] } : outcome
  },
}

export type { SubmissionFile }
