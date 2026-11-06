// SKILL.md and Claude subagent adapter (Phase 13, flag AGENT_KINDS; rank 3 in D-030).
// One adapter (id 'skill') covers both, because formats/index.ts lists only `skillAdapter`.
// ParseOutcome.format distinguishes 'agent-skill' from 'claude-subagent'.
//
// DOCUMENTED ASSUMPTIONS (no web access; facts from 12-RESEARCH.md only)
//  - Agent Skills (agentskills.io): a directory with SKILL.md; YAML frontmatter between leading
//    `---` fences; name <= 64 chars, lowercase letters/digits/hyphens (no leading, trailing or
//    doubled hyphen) and equal to the directory name; description <= 1024; compatibility <= 500;
//    optional license, metadata map, space-separated allowed-tools. A skill is NEVER an agent:
//    kind 'skill', framework 'agent-skills', placeholder systemPrompt '' and llm 'n/a' (D-037).
//    Limit violations are warnings (plus missingFromAuthor 'valid skill name'), never errors.
//  - Claude subagent (Claude Code docs as summarised in 12-RESEARCH.md): a .md file whose
//    frontmatter has `name` and `description`; body is the system prompt; `tools` is a comma
//    string or list; `model` may be an alias (inherit, sonnet, opus, haiku). Aliases are NOT real
//    model ids and must never reach Try It Out (handoff traps), so llm.name is 'n/a' and the alias
//    is kept in extras.modelAlias. Other frontmatter keys (permissionMode, maxTurns, skills,
//    mcpServers, hooks, ...) are preserved in extras.
//  - The skill listing of scripts/, references/, assets/ is file PATHS only. Referenced files are
//    never read, imported or executed. Secret-looking values in extras are redacted.
//  - Plain markdown without frontmatter name + description (README.md ...) is not detected.
import { parse as parseYaml } from 'yaml'
import type { AgentRecord } from '../types.js'
import { slugify } from '../types.js'
import type { FormatAdapter, KindInfo, ParseOutcome, SubmissionFile } from '../kinds.js'
import { clampExtras } from '../kinds.js'
import { unrecognizedOutcome } from '../outcome.js'
import { capText, redactSecrets, scanSecrets, setOwn } from '../security.js'
import { byShallowest, ignoredWarning } from '../paths.js'

type Obj = Record<string, unknown>

const SKILL_FORMAT = 'agent-skill'
const SUBAGENT_FORMAT = 'claude-subagent'
const MODEL_ALIASES: readonly string[] = ['inherit', 'sonnet', 'opus', 'haiku']
const NAME_MAX = 64
const DESC_MAX = 1024
const COMPAT_MAX = 500
const BODY_EXCERPT_BYTES = 2048
const PROMPT_MAX_BYTES = 65536
const LISTING_MAX = 100
const FRONTMATTER_MISSING = 'frontmatter with name and description'

const SKILL_KNOWN = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']
const SUBAGENT_KNOWN = ['name', 'description', 'tools', 'model']

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
}
function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1)
}
function dirname(p: string): string {
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : p.slice(0, i)
}

interface Parsed {
  fm: Obj | null // null: no frontmatter or invalid
  body: string
}

function splitFrontmatter(text: string): Parsed {
  const t = text.replace(/^﻿/, '')
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(t)
  if (!m) return { fm: null, body: t }
  try {
    const fm: unknown = parseYaml(m[1] ?? '', { maxAliasCount: 100 })
    return isObj(fm) ? { fm, body: m[2] ?? '' } : { fm: null, body: t }
  } catch {
    return { fm: null, body: t }
  }
}

function hasFrontmatterFence(text: string): boolean {
  return /^﻿?---[ \t]*\r?\n/.test(text)
}

function isFile(f: unknown): f is SubmissionFile {
  return !!f && typeof (f as SubmissionFile).path === 'string' && typeof (f as SubmissionFile).text === 'string'
}

type Hit =
  | { type: 'skill'; file: SubmissionFile; files: SubmissionFile[]; ignored: string[] }
  | { type: 'subagent'; file: SubmissionFile; parsed: Parsed; ignored: string[] }

/** Subagents live under an `agents/` folder (usually `.claude/agents/`) or declare tools or model (WR-03). */
const SUBAGENT_DIR = /(^|\/)agents\/[^/]+\.md$/i

function find(files: SubmissionFile[]): Hit | null {
  const list = (Array.isArray(files) ? files : []).filter(isFile)
  // WR-02: the shallowest match wins, so the submission's own SKILL.md beats one in a subfolder.
  const skills = byShallowest(
    list.filter((f) => basename(f.path) === 'SKILL.md' && hasFrontmatterFence(f.text)),
    (f) => f.path,
  )
  if (skills[0]) {
    return { type: 'skill', file: skills[0], files: list, ignored: skills.slice(1).map((f) => f.path) }
  }
  const subagents: Array<{ file: SubmissionFile; parsed: Parsed }> = []
  for (const f of list) {
    if (!/\.md$/i.test(f.path) || basename(f.path) === 'SKILL.md') continue
    const parsed = splitFrontmatter(f.text)
    if (!parsed.fm || !str(parsed.fm.name) || !str(parsed.fm.description)) continue
    // WR-03: a blog post or CHANGELOG with name+description frontmatter is not an agent.
    if (!SUBAGENT_DIR.test(f.path) && parsed.fm.tools === undefined && parsed.fm.model === undefined) continue
    subagents.push({ file: f, parsed })
  }
  const ordered = byShallowest(subagents, (x) => x.file.path)
  const first = ordered[0]
  if (!first) return null
  return { type: 'subagent', file: first.file, parsed: first.parsed, ignored: ordered.slice(1).map((x) => x.file.path) }
}

function toolList(v: unknown, sep: RegExp): string[] {
  const items = Array.isArray(v) ? v : typeof v === 'string' ? v.split(sep) : []
  return items.filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter(Boolean)
}

function baseRecord(slug: string, title: string, summary: string, now: string): AgentRecord {
  return {
    slug, title, specId: null, summary,
    systemPrompt: '',
    llm: { name: 'n/a', temperature: null, maxTokens: null, topP: null },
    toolNames: [], inputFields: [], requiresHumanApproval: false,
    category: null, githubUrl: null, linkLabel: null,
    maturityStatus: 'experimental', tags: [],
    customizableFields: null, fixedNote: null, fixedFields: [],
    lastIngestedAt: now,
  }
}

function finishExtras(extras: Obj, warnings: string[]): Obj {
  const found = scanSecrets(extras)
  if (found.length > 0) warnings.push(`secret-like values redacted (${found.length}): ${found.slice(0, 5).join(', ')}`)
  return clampExtras(redactSecrets(extras))
}

function metaCategoryTags(fm: Obj): { category: string | null; tags: string[] } {
  const meta = isObj(fm.metadata) ? fm.metadata : {}
  const tags = Array.isArray(meta.tags)
    ? meta.tags.filter((t): t is string => typeof t === 'string')
    : typeof meta.tags === 'string' ? meta.tags.split(',').map((t) => t.trim()).filter(Boolean) : []
  return { category: str(meta.category), tags }
}

function parseSkill(hit: Extract<Hit, { type: 'skill' }>, now: string): ParseOutcome {
  const warnings: string[] = []
  const { fm, body } = splitFrontmatter(hit.file.text)
  if (!fm) {
    return {
      status: 'missing-from-author', format: SKILL_FORMAT, record: null, kindInfo: null,
      missingFromAuthor: [FRONTMATTER_MISSING], unknownFields: [], warnings: ['SKILL.md frontmatter is missing or invalid'],
    }
  }
  const unknownFields = Object.keys(fm).filter((k) => !SKILL_KNOWN.includes(k))
  const name = str(fm.name)
  const description = str(fm.description)
  const missing: string[] = []
  if (!name) missing.push('name')
  if (!description) missing.push('description')
  if (!name || !description) {
    return {
      status: 'missing-from-author', format: SKILL_FORMAT, record: null, kindInfo: null,
      missingFromAuthor: missing, unknownFields, warnings,
    }
  }

  const dir = dirname(hit.file.path)
  const dirName = dir ? basename(dir) : null
  let nameOk = true
  if (name.length > NAME_MAX) {
    warnings.push(`skill name is ${name.length} chars (max ${NAME_MAX})`)
    nameOk = false
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    warnings.push('skill name must be lowercase letters, digits and single hyphens')
    nameOk = false
  }
  if (dirName && dirName !== name) {
    warnings.push(`skill name "${name}" does not match directory "${dirName}"`)
    nameOk = false
  }
  if (!nameOk) missing.push('valid skill name')
  if (description.length > DESC_MAX) warnings.push(`description is ${description.length} chars (max ${DESC_MAX})`)
  const compat = str(fm.compatibility)
  if (compat && compat.length > COMPAT_MAX) warnings.push(`compatibility is ${compat.length} chars (max ${COMPAT_MAX})`)

  const prefix = dir ? `${dir}/` : ''
  const listing: Record<string, string[]> = {}
  for (const sub of ['scripts', 'references', 'assets']) {
    const paths = hit.files
      .map((f) => f.path)
      .filter((p) => p.startsWith(`${prefix}${sub}/`))
      .slice(0, LISTING_MAX)
    if (paths.length > 0) listing[sub] = paths
  }

  const extras: Obj = {}
  for (const k of unknownFields) setOwn(extras, k, fm[k])
  if (fm.license !== undefined) extras.license = fm.license
  if (compat) extras.compatibility = compat
  if (isObj(fm.metadata)) extras.metadata = fm.metadata
  if (Object.keys(listing).length > 0) extras.files = listing
  const excerpt = capText(body.trim(), BODY_EXCERPT_BYTES)
  if (excerpt.text) extras.bodyExcerpt = excerpt.text

  const { category, tags } = metaCategoryTags(fm)
  const record = baseRecord(slugify(name), name, description, now)
  record.toolNames = toolList(fm['allowed-tools'], /[\s,]+/)
  record.category = category
  record.tags = tags
  if (!category) missing.push('category')

  const kindInfo: KindInfo = {
    kind: 'skill', framework: 'agent-skills', topology: null, members: [],
    sourceFormat: 'agent-skills@1', extras: finishExtras(extras, warnings),
  }
  return {
    status: missing.length > 0 ? 'partial' : 'ingestible',
    format: SKILL_FORMAT, record, kindInfo, missingFromAuthor: missing, unknownFields, warnings,
  }
}

function parseSubagent(hit: Extract<Hit, { type: 'subagent' }>, now: string): ParseOutcome {
  const warnings: string[] = []
  const fm = hit.parsed.fm as Obj
  const unknownFields = Object.keys(fm).filter((k) => !SUBAGENT_KNOWN.includes(k))
  const name = str(fm.name) as string
  const description = str(fm.description) as string

  const record = baseRecord(slugify(name), name, description, now)
  const prompt = capText(hit.parsed.body.trim(), PROMPT_MAX_BYTES)
  if (prompt.truncated) warnings.push(`system prompt truncated to ${PROMPT_MAX_BYTES} bytes`)
  record.systemPrompt = prompt.text
  record.toolNames = toolList(fm.tools, /\s*,\s*/)

  const extras: Obj = {}
  for (const k of unknownFields) setOwn(extras, k, fm[k])
  const model = str(fm.model)
  if (model) {
    if (MODEL_ALIASES.includes(model.toLowerCase())) extras.modelAlias = model
    else record.llm.name = model
  } else if (fm.model !== undefined) {
    warnings.push('model is not a string; ignored')
  }

  const missing: string[] = []
  if (!model) missing.push('model')
  missing.push('category')
  const kindInfo: KindInfo = {
    kind: 'agent', framework: 'claude-subagent', topology: null, members: [],
    sourceFormat: 'claude-subagent@1', extras: finishExtras(extras, warnings),
  }
  return {
    status: 'partial',
    format: SUBAGENT_FORMAT, record, kindInfo, missingFromAuthor: missing, unknownFields, warnings,
  }
}

export const skillAdapter: FormatAdapter = {
  id: 'skill',
  detect(files) {
    try {
      const hit = find(files)
      if (!hit) return null
      return hit.type === 'skill'
        ? { format: SKILL_FORMAT, confidence: 0.8 }
        : { format: SUBAGENT_FORMAT, confidence: 0.6 }
    } catch {
      return null
    }
  },
  parse(files, ctx) {
    try {
      const hit = find(files)
      if (!hit) return unrecognizedOutcome()
      const outcome = hit.type === 'skill' ? parseSkill(hit, ctx.now) : parseSubagent(hit, ctx.now)
      const note = ignoredWarning(hit.type === 'skill' ? 'SKILL.md' : 'subagent', hit.file.path, hit.ignored)
      return note ? { ...outcome, warnings: [...outcome.warnings, note] } : outcome
    } catch (e) {
      return unrecognizedOutcome([`could not read submission: ${e instanceof Error ? e.message : 'error'}`])
    }
  },
}

export type { SubmissionFile }
