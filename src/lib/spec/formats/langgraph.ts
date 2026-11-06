// langgraph.json DETECTOR (Phase 13, flag AGENT_KINDS; rank 6 in D-030).
//
// DOCUMENTED ASSUMPTIONS (no web access when written; facts from 12-RESEARCH.md only):
//  - langgraph.json is a deployment config: `graphs` (id -> "./path/file.py:variable"),
//    `dependencies`, `env` (a path string OR an object), optional `python_version`,
//    `dockerfile_lines`. It carries NO name, summary, members or topology; those live in Python.
//  - So this adapter is a detector with low confidence (0.5): it records graph ids and
//    dependencies and reports the rest as missing, asking for a catalog.yaml. A catalog.yaml in
//    the same folder wins in the registry (manifest confidence is higher).
//  - Entrypoints are kept as TEXT and never resolved, imported or executed.
//  - `env`: only a string path is stored. Object values (which may be secrets) are never stored,
//    not even the keys.
//  - Malformed JSON yields an outcome, never an exception.
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
function cap(s: string, n = 300): string {
  return capText(s, n).text
}
function parseJson(text: string): Obj | undefined {
  try {
    const v: unknown = JSON.parse(text)
    return isObj(v) ? v : undefined
  } catch {
    return undefined
  }
}

const isLg = (f: SubmissionFile): boolean => (f.path.split('/').pop() ?? '') === 'langgraph.json'

const KNOWN = new Set([
  'graphs', 'dependencies', 'env', 'python_version', 'node_version', 'dockerfile_lines',
  'store', 'auth', 'http', '$schema', 'pip_installer', 'image_distro',
])

export const langgraphAdapter: FormatAdapter = {
  id: 'langgraph',
  detect(files) {
    for (const f of byShallowest(files.filter(isLg), (x) => x.path)) {
      const o = parseJson(f.text)
      if (o && isObj(o.graphs)) return { format: 'langgraph-json', confidence: 0.5 }
    }
    return null
  },
  parse(files, ctx): ParseOutcome {
    try {
      const all = byShallowest(files.filter(isLg), (x) => x.path)
      const f = all.find((x) => isObj(parseJson(x.text)?.graphs)) ?? all[0]
      if (!f) return unrecognizedOutcome()
      const ignored = all.filter((x) => x !== f).map((x) => x.path)
      const o = parseJson(f.text)
      if (!o || !isObj(o.graphs)) {
        return {
          status: 'missing-from-author', format: 'langgraph-json', record: null, kindInfo: null,
          missingFromAuthor: ['valid langgraph.json with graphs'], unknownFields: [], warnings: [],
        }
      }
      const graphIds = Object.keys(o.graphs).slice(0, 50).map((k) => cap(k, 100))
      const graphEntrypoints: Record<string, string> = {}
      for (const [k, v] of Object.entries(o.graphs).slice(0, 50)) {
        if (typeof v === 'string') setOwn(graphEntrypoints, cap(k, 100), cap(v, 300))
      }
      const dependencies = Array.isArray(o.dependencies)
        ? o.dependencies.filter((d): d is string => typeof d === 'string').slice(0, 100).map((d) => cap(d, 200))
        : []
      const unknown: Obj = {}
      for (const k of Object.keys(o)) if (!KNOWN.has(k)) setOwn(unknown, k, o[k])
      const parts = f.path.split('/')
      const folder = parts.length >= 2 ? parts[parts.length - 2]! : ''
      // CR-02: root-level files have no folder in their path, so fall back to the submission hint
      // before the fixed name; otherwise every root-level langgraph.json would share one slug.
      const hint = typeof ctx.hint === 'string' ? ctx.hint.trim() : ''
      const title = folder && folder !== '.' ? cap(folder, 120) : hint ? cap(hint, 120) : 'LangGraph application'
      const record: AgentRecord = {
        slug: slugify(title),
        title,
        specId: null,
        summary: '',
        systemPrompt: '',
        llm: { name: 'n/a', temperature: null, maxTokens: null, topP: null },
        toolNames: [],
        inputFields: [],
        requiresHumanApproval: false,
        category: null,
        githubUrl: null,
        linkLabel: null,
        maturityStatus: 'experimental',
        tags: [],
        customizableFields: [],
        fixedNote: null,
        fixedFields: [],
        lastIngestedAt: ctx.now,
      }
      const extras: Obj = {
        graphIds,
        graphEntrypoints,
        dependencies,
        pythonVersion: typeof o.python_version === 'string' ? cap(o.python_version, 20) : null,
        envFile: typeof o.env === 'string' ? cap(o.env, 200) : null,
      }
      if (Object.keys(unknown).length > 0) extras.unknown = unknown
      const kindInfo: KindInfo = {
        kind: 'system',
        framework: 'langgraph',
        topology: null,
        members: [],
        sourceFormat: 'langgraph-json',
        extras: clampExtras(extras),
      }
      return {
        status: 'partial',
        format: 'langgraph-json',
        record, kindInfo,
        missingFromAuthor: ['name', 'summary', 'members', 'topology', 'category (add catalog.yaml)'],
        unknownFields: Object.keys(unknown),
        warnings: [
          'langgraph.json holds no topology; add a catalog.yaml describing the system',
          ...[ignoredWarning('langgraph.json', f.path, ignored)].filter((w): w is string => w !== null),
        ],
      }
    } catch (e) {
      return unrecognizedOutcome([`langgraph: ${e instanceof Error ? e.message : 'error'}`])
    }
  },
}
