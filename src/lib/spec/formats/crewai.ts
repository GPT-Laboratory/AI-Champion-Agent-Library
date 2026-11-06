// CrewAI adapter (Phase 13, flag AGENT_KINDS; rank 4 in D-030).
//
// DOCUMENTED ASSUMPTIONS (no web access when written; facts from 12-RESEARCH.md only):
//  - Config only. CrewAI Flows (Python-defined) are not supported and their shape is unverified.
//  - Two config styles are recognised:
//      JSONC: `crew.jsonc|crew.json` plus optional `agents/*.json[c]` (one agent per file).
//      YAML:  `config/agents.yaml` + `config/tasks.yaml` (top-level keys are agent / task ids).
//  - Agent fields: role, goal, backstory, llm, tools. Task fields: name, description,
//    expected_output, agent, context. `process` is sequential (default) or hierarchical.
//  - Hierarchical is detected when `process: hierarchical`, or `manager_llm` / `manager_agent` is
//    present. A `manager_agent` string that names a member makes that member the manager.
//  - The YAML style has no crew-level process key (it lives in Python), so it is assumed
//    sequential and a warning says so.
//  - Tool refs `custom:<name>` and `{"python": "module.attr"}` are recorded as TEXT in
//    extras.unloadedToolRefs and never imported or executed. Other string tool names go to
//    toolNames as text.
//  - CrewAI has no catalog metadata (category, tags, summary, github_url): the record is
//    'partial' and the author adds catalog.yaml.
//  - JSONC comments and trailing commas are removed by a small tolerant character state machine
//    (no dependency). Malformed input yields an outcome, never an exception.
import { parse as parseYaml } from 'yaml'
import type { AgentRecord } from '../types.js'
import { slugify } from '../types.js'
import type {
  AgentMember,
  FormatAdapter,
  KindInfo,
  ParseOutcome,
  SubmissionFile,
} from '../kinds.js'
import { clampExtras, MEMBERS_MAX } from '../kinds.js'
import { unrecognizedOutcome } from '../outcome.js'
import { capText, setOwn } from '../security.js'
import { byShallowest, dirOf, ignoredWarning } from '../paths.js'

type Obj = Record<string, unknown>

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}
function cap(s: string, n: number): string {
  return capText(s, n).text
}

/** Remove // and block comments and trailing commas, respecting string literals. */
export function stripJsonc(text: string): string {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]!
    if (c === '"') {
      let j = i + 1
      while (j < n && text[j] !== '"') {
        if (text[j] === '\\') j++
        j++
      }
      out += text.slice(i, Math.min(j + 1, n))
      i = j + 1
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? n : end + 2
      out += ' '
    } else if (c === ',') {
      let j = i + 1
      for (;;) {
        while (j < n && /\s/.test(text[j]!)) j++
        if (text[j] === '/' && text[j + 1] === '/') {
          while (j < n && text[j] !== '\n') j++
        } else if (text[j] === '/' && text[j + 1] === '*') {
          const end = text.indexOf('*/', j + 2)
          j = end === -1 ? n : end + 2
        } else break
      }
      if (text[j] === '}' || text[j] === ']') {
        i++ // drop the trailing comma
      } else {
        out += c
        i++
      }
    } else {
      out += c
      i++
    }
  }
  return out
}

function parseJsonc(text: string): unknown {
  try {
    return JSON.parse(stripJsonc(text))
  } catch {
    return undefined
  }
}

const base = (p: string): string => p.split('/').pop() ?? p
const crewFile = (f: SubmissionFile): boolean => /^crew\.jsonc?$/.test(base(f.path))
const agentFile = (f: SubmissionFile): boolean => /(^|\/)agents\/[^/]+\.jsonc?$/.test(f.path)
const yamlAgents = (f: SubmissionFile): boolean => /(^|\/)config\/agents\.ya?ml$/.test(f.path)
const yamlTasks = (f: SubmissionFile): boolean => /(^|\/)config\/tasks\.ya?ml$/.test(f.path)

/**
 * WR-03: crew.json is a very common file name. It only counts as a CrewAI crew when its content
 * looks like one (agents or tasks), when agent files sit next to it, or when it does not parse at
 * all (so the author hears about the syntax error instead of the file being silently skipped).
 */
function crewStrength(f: SubmissionFile, files: SubmissionFile[]): 'strong' | 'weak' | 'none' {
  const doc = parseJsonc(f.text)
  if (doc === undefined) return 'weak'
  if (!isObj(doc)) return 'none'
  const listy = (v: unknown): boolean => Array.isArray(v) || isObj(v)
  if (listy(doc.agents) || listy(doc.tasks)) return 'strong'
  const dir = dirOf(f.path)
  const prefix = dir ? `${dir}/agents/` : 'agents/'
  return files.some((o) => agentFile(o) && o.path.startsWith(prefix)) ? 'strong' : 'none'
}

/** The crew file to use (shallowest wins, WR-02), how strongly it looks like a crew, and the rest. */
function pickCrew(files: SubmissionFile[]): { file: SubmissionFile; strength: 'strong' | 'weak'; ignored: string[] } | null {
  const ranked = byShallowest(files.filter(crewFile), (f) => f.path)
    .map((f) => ({ f, strength: crewStrength(f, files) }))
    .filter((x) => x.strength !== 'none')
  const first = ranked.find((x) => x.strength === 'strong') ?? ranked[0]
  if (!first) return null
  return {
    file: first.f,
    strength: first.strength as 'strong' | 'weak',
    ignored: files.filter((o) => crewFile(o) && o !== first.f).map((o) => o.path),
  }
}

function pickYaml(files: SubmissionFile[]): { agents: SubmissionFile; tasks: SubmissionFile | undefined; ignored: string[] } | null {
  const agents = byShallowest(files.filter(yamlAgents), (f) => f.path)
  const first = agents[0]
  if (!first) return null
  const tasks = byShallowest(files.filter(yamlTasks), (f) => f.path)
  const sibling = tasks.find((t) => dirOf(t.path) === dirOf(first.path)) ?? tasks[0]
  const used = new Set([first, sibling])
  return {
    agents: first,
    tasks: sibling,
    ignored: [...agents, ...tasks].filter((f) => !used.has(f)).map((f) => f.path),
  }
}

interface RawAgent {
  id: string
  role: string | null
  goal: string | null
  llm: string | null
  tools: unknown[]
}

function collectTools(
  tools: unknown,
  toolNames: Set<string>,
  unloaded: Set<string>,
): void {
  if (!Array.isArray(tools)) return
  for (const t of tools) {
    if (typeof t === 'string') {
      if (t.startsWith('custom:')) unloaded.add(cap(t, 200))
      else toolNames.add(cap(t, 100))
    } else if (isObj(t)) {
      const py = str(t.python)
      if (py) unloaded.add(cap(`python:${py}`, 200))
      else unloaded.add(cap(JSON.stringify(t), 200))
    }
  }
}

function toRaw(id: string, o: Obj): RawAgent {
  return {
    id,
    role: str(o.role),
    goal: str(o.goal),
    llm: typeof o.llm === 'string' ? o.llm : isObj(o.llm) ? str(o.llm.model) ?? str(o.llm.name) : null,
    tools: Array.isArray(o.tools) ? o.tools : [],
  }
}

const CREW_KNOWN = new Set([
  'name', 'description', 'process', 'agents', 'tasks', 'manager_llm', 'manager_agent',
  'category', 'tags', 'summary', 'github_url', 'verbose', 'memory', 'planning', 'cache',
])

function failed(format: string, missing: string[], warnings: string[] = []): ParseOutcome {
  return {
    status: 'missing-from-author', format, record: null, kindInfo: null,
    missingFromAuthor: missing, unknownFields: [], warnings,
  }
}

function matchAgent(agents: RawAgent[], ref: string): RawAgent | undefined {
  const r = slugify(ref)
  return agents.find((a) => a.id === ref || slugify(a.id) === r || (a.role !== null && slugify(a.role) === r))
}

interface Parsed {
  title: string
  summary: string
  agents: RawAgent[]
  hierarchical: boolean
  managerRef: string | null
  managerInline: RawAgent | null
  tasks: Array<{ name: string; agent: string | null; context: string[]; description: string | null }>
  extrasUnknown: Obj
  unknownFields: string[]
  warnings: string[]
  sourceFormat: string
  meta: { category: string | null; tags: string[]; github: string | null; summary: string | null }
  models: Set<string>
}

function parseTasks(
  v: unknown,
): Array<{ name: string; agent: string | null; context: string[]; description: string | null }> {
  const out: Array<{ name: string; agent: string | null; context: string[]; description: string | null }> = []
  const push = (id: string, o: Obj): void => {
    out.push({
      name: str(o.name) ?? id,
      agent: str(o.agent),
      context: Array.isArray(o.context) ? o.context.filter((c): c is string => typeof c === 'string') : [],
      description: str(o.description) ? cap(o.description as string, 300) : null,
    })
  }
  if (Array.isArray(v)) v.forEach((t, i) => isObj(t) && push(`task-${i + 1}`, t))
  else if (isObj(v)) for (const [k, t] of Object.entries(v)) if (isObj(t)) push(k, t)
  return out
}

function parseJsoncStyle(files: SubmissionFile[], cf: SubmissionFile, hint: string): Parsed | ParseOutcome {
  const crew = parseJsonc(cf.text)
  if (!isObj(crew)) return failed('crewai-jsonc', ['valid crew.jsonc'])
  const warnings: string[] = []
  const fileAgents: RawAgent[] = []
  for (const f of files.filter(agentFile)) {
    const o = parseJsonc(f.text)
    if (!isObj(o)) {
      warnings.push(`${f.path}: not valid JSON(C), skipped`)
      continue
    }
    fileAgents.push(toRaw(base(f.path).replace(/\.jsonc?$/, ''), o))
  }
  let agents: RawAgent[] = []
  if (Array.isArray(crew.agents) && crew.agents.length > 0) {
    for (const a of crew.agents) {
      if (typeof a === 'string') {
        agents.push(matchAgent(fileAgents, a) ?? { id: a, role: null, goal: null, llm: null, tools: [] })
      } else if (isObj(a)) {
        agents.push(toRaw(str(a.name) ?? str(a.role) ?? `agent-${agents.length + 1}`, a))
      }
    }
    for (const fa of fileAgents) if (!agents.includes(fa)) agents.push(fa)
  } else {
    agents = fileAgents
  }
  const mgr = crew.manager_agent
  let managerInline: RawAgent | null = null
  let managerRef: string | null = null
  if (typeof mgr === 'string') managerRef = mgr
  else if (isObj(mgr)) managerInline = toRaw(str(mgr.name) ?? str(mgr.role) ?? 'manager', mgr)
  const hierarchical =
    crew.process === 'hierarchical' || crew.manager_llm !== undefined || crew.manager_agent !== undefined
  const unknown: Obj = {}
  for (const [k, v] of Object.entries(crew)) if (!CREW_KNOWN.has(k)) setOwn(unknown, k, v)
  const models = new Set<string>()
  if (typeof crew.manager_llm === 'string') models.add(crew.manager_llm)
  return {
    title: str(crew.name) ? cap(str(crew.name) as string, 120) : hint || 'CrewAI crew',
    summary: str(crew.description) ?? '',
    agents, hierarchical, managerRef, managerInline,
    tasks: parseTasks(crew.tasks),
    extrasUnknown: unknown,
    unknownFields: Object.keys(unknown),
    warnings,
    sourceFormat: 'crewai-jsonc',
    meta: {
      category: str(crew.category),
      tags: Array.isArray(crew.tags) ? crew.tags.filter((t): t is string => typeof t === 'string') : [],
      github: str(crew.github_url),
      summary: str(crew.summary),
    },
    models,
  }
}

function parseYamlStyle(af: SubmissionFile, tf: SubmissionFile | undefined, hint: string): Parsed | ParseOutcome {
  let adoc: unknown
  let tdoc: unknown
  try {
    adoc = parseYaml(af.text)
    tdoc = tf ? parseYaml(tf.text) : undefined
  } catch (e) {
    return failed('crewai-yaml', ['valid config/agents.yaml and config/tasks.yaml'], [
      `YAML could not be parsed: ${cap(e instanceof Error ? e.message : 'error', 200)}`,
    ])
  }
  if (!isObj(adoc)) return failed('crewai-yaml', ['valid config/agents.yaml'])
  const agents: RawAgent[] = []
  for (const [id, o] of Object.entries(adoc)) if (isObj(o)) agents.push(toRaw(id, o))
  const parts = af.path.split('/')
  const folder = parts.length >= 3 ? parts[parts.length - 3]! : ''
  return {
    title: folder !== '' && folder !== '.' ? folder : hint || 'CrewAI crew',
    summary: '',
    agents, hierarchical: false, managerRef: null, managerInline: null,
    tasks: parseTasks(tdoc),
    extrasUnknown: {}, unknownFields: [],
    warnings: ['process is defined in Python for the YAML style; assumed sequential'],
    sourceFormat: 'crewai-yaml',
    meta: { category: null, tags: [], github: null, summary: null },
    models: new Set<string>(),
  }
}

export const crewaiAdapter: FormatAdapter = {
  id: 'crewai',
  detect(files) {
    const crew = pickCrew(files)
    if (crew) return { format: 'crewai-jsonc', confidence: crew.strength === 'strong' ? 0.85 : 0.4 }
    if (pickYaml(files) && files.some(yamlTasks)) return { format: 'crewai-yaml', confidence: 0.8 }
    return null
  },
  parse(files, ctx): ParseOutcome {
    try {
      const crew = pickCrew(files)
      const yaml = crew ? null : pickYaml(files)
      if (!crew && !yaml) return unrecognizedOutcome()
      const hint = typeof ctx.hint === 'string' ? cap(ctx.hint.trim(), 120) : ''
      const p = crew ? parseJsoncStyle(files, crew.file, hint) : parseYamlStyle(yaml!.agents, yaml!.tasks, hint)
      if ('status' in p) return p
      const ignoredNote = crew
        ? ignoredWarning('crew.json', crew.file.path, crew.ignored)
        : ignoredWarning('config/agents.yaml', yaml!.agents.path, yaml!.ignored)
      if (ignoredNote) p.warnings.push(ignoredNote)

      const toolNames = new Set<string>()
      const unloaded = new Set<string>()
      for (const a of p.agents) {
        collectTools(a.tools, toolNames, unloaded)
        if (a.llm) p.models.add(a.llm)
      }
      if (p.managerInline) collectTools(p.managerInline.tools, toolNames, unloaded)
      if (unloaded.size > 0) p.warnings.push(`${unloaded.size} custom/python tool reference(s) recorded as text, not loaded`)

      const warnings = p.warnings
      let managerAgent: RawAgent | null = p.managerInline
      let managerMatched = false
      if (p.hierarchical && p.managerRef) {
        const m = matchAgent(p.agents, p.managerRef)
        if (m) {
          managerAgent = m
          managerMatched = true
        } else {
          warnings.push(`manager_agent "${cap(p.managerRef, 100)}" does not match a listed agent`)
        }
      }
      const toMember = (a: RawAgent, role: AgentMember['role']): AgentMember => ({
        ref: a.id,
        name: a.role ?? a.id,
        role,
        description: a.goal ? cap(a.goal, 300) : null,
        slug: null,
      })
      const memberRole: AgentMember['role'] = p.hierarchical ? 'worker' : 'step'
      let members: AgentMember[] = []
      if (managerAgent) members.push(toMember(managerAgent, 'manager'))
      for (const a of p.agents) {
        if (managerMatched && a === managerAgent) continue
        members.push(toMember(a, memberRole))
      }
      if (members.length > MEMBERS_MAX) {
        warnings.push(`members truncated to ${MEMBERS_MAX}`)
        members = members.slice(0, MEMBERS_MAX)
      }

      const missing: string[] = []
      const summary = p.summary || p.meta.summary || ''
      if (!summary) missing.push('summary')
      if (!p.meta.category) missing.push('category')
      if (p.meta.tags.length === 0) missing.push('tags')
      if (!p.meta.github) missing.push('github_url')
      if (p.sourceFormat === 'crewai-yaml') missing.unshift('name')
      if (members.length === 0) missing.push('agents')

      // An empty slug (non-ASCII title) is resolved by the registry from the folder hint or a hash.
      const slug = slugify(p.title)
      const record: AgentRecord = {
        slug,
        title: p.title,
        specId: null,
        summary: cap(summary, 2000),
        systemPrompt: '',
        llm: { name: 'n/a', temperature: null, maxTokens: null, topP: null },
        toolNames: [...toolNames].slice(0, 100),
        inputFields: [],
        requiresHumanApproval: false,
        category: p.meta.category,
        githubUrl: p.meta.github && /^https?:\/\//i.test(p.meta.github) ? p.meta.github : null,
        linkLabel: null,
        maturityStatus: 'experimental',
        tags: p.meta.tags.slice(0, 20),
        customizableFields: [],
        fixedNote: null,
        fixedFields: [],
        lastIngestedAt: ctx.now,
      }
      const extras: Obj = {
        models: [...p.models],
        tasks: p.tasks.map((t) => ({ name: t.name, agent: t.agent, context: t.context, description: t.description })),
        unloadedToolRefs: [...unloaded],
      }
      if (Object.keys(p.extrasUnknown).length > 0) extras.unknown = p.extrasUnknown
      const kindInfo: KindInfo = {
        kind: 'system',
        framework: 'crewai',
        topology: p.hierarchical ? 'manager-workers' : 'pipeline',
        members,
        sourceFormat: p.sourceFormat,
        extras: clampExtras(extras),
      }
      return {
        status: missing.length === 0 ? 'ingestible' : 'partial',
        format: p.sourceFormat,
        record, kindInfo,
        missingFromAuthor: missing,
        unknownFields: p.unknownFields,
        warnings,
      }
    } catch (e) {
      return unrecognizedOutcome([`crewai: ${e instanceof Error ? e.message : 'error'}`])
    }
  },
}
