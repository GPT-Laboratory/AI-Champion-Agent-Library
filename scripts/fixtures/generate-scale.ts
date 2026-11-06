import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import { slugify } from '../../src/lib/spec/types.js'

/**
 * Deterministic generator of synthetic Oracle AgentSpec YAMLs for scale tests.
 * No Date.now / Math.random: output depends only on (count, seed).
 */

export interface Tool { name: string; description: string }
export interface Topic {
  id: string
  title: string
  category: string
  keywords: string[]
  tools: Tool[]
  /** Description templates; `{kw}` is replaced with topic keywords. Each contains >=1 keyword. */
  phrases: string[]
}

export const TOPICS: Topic[] = [
  {
    id: 'hvac', title: 'HVAC', category: 'mechanical',
    keywords: ['hvac', 'ventilation', 'heating', 'cooling', 'ductwork', 'airflow', 'thermal-load'],
    tools: [
      { name: 'extract_zone_geometry', description: 'Reads zone geometry and envelope data from a model' },
      { name: 'run_load_calculation', description: 'Runs a heating and cooling load calculation for a zone set' },
      { name: 'size_ductwork', description: 'Sizes ductwork for a target airflow and pressure drop' },
      { name: 'check_ventilation_rate', description: 'Checks ventilation rates against occupancy' },
      { name: 'write_load_report', description: 'Writes a load calculation report' },
    ],
    phrases: [
      'Calculates {kw} loads and sizes {kw} equipment for building zones.',
      'Reviews {kw} design assumptions and flags {kw} capacity shortfalls.',
      'Checks {kw} layouts against design conditions and reports {kw} issues.',
    ],
  },
  {
    id: 'electrical', title: 'Electrical', category: 'electrical',
    keywords: ['electrical', 'switchboard', 'circuit', 'cable-sizing', 'lighting', 'short-circuit', 'load-schedule'],
    tools: [
      { name: 'read_single_line_diagram', description: 'Parses a single line diagram into circuits' },
      { name: 'calculate_cable_size', description: 'Calculates cable size from current and voltage drop' },
      { name: 'check_short_circuit', description: 'Checks short-circuit ratings along a feeder' },
      { name: 'build_load_schedule', description: 'Builds a panel load schedule' },
      { name: 'flag_protection_gap', description: 'Flags missing or mismatched protection devices' },
    ],
    phrases: [
      'Builds {kw} documentation and verifies {kw} sizing for distribution boards.',
      'Reviews {kw} designs and checks {kw} calculations before issue.',
      'Compares {kw} schedules against drawings and reports {kw} mismatches.',
    ],
  },
  {
    id: 'plumbing', title: 'Plumbing', category: 'plumbing',
    keywords: ['plumbing', 'drainage', 'pipe-sizing', 'water-supply', 'sanitary', 'backflow', 'pump'],
    tools: [
      { name: 'trace_pipe_network', description: 'Traces a pipe network through a model' },
      { name: 'size_pipes', description: 'Sizes supply and drainage pipes from fixture units' },
      { name: 'check_backflow_protection', description: 'Checks backflow prevention at connections' },
      { name: 'estimate_pump_head', description: 'Estimates required pump head' },
      { name: 'list_fixtures', description: 'Lists sanitary fixtures per level' },
    ],
    phrases: [
      'Sizes {kw} systems and validates {kw} routes for each floor.',
      'Audits {kw} layouts for {kw} conflicts and missing protection.',
      'Summarises {kw} quantities and checks {kw} capacity.',
    ],
  },
  {
    id: 'fire-safety', title: 'Fire Safety', category: 'compliance',
    keywords: ['fire-safety', 'sprinkler', 'egress', 'fire-rating', 'smoke-control', 'evacuation', 'compartment'],
    tools: [
      { name: 'map_fire_compartments', description: 'Maps fire compartments and their ratings' },
      { name: 'check_egress_distance', description: 'Checks egress travel distances' },
      { name: 'verify_fire_rating', description: 'Verifies fire ratings of assemblies' },
      { name: 'review_sprinkler_coverage', description: 'Reviews sprinkler coverage per compartment' },
      { name: 'draft_fire_report', description: 'Drafts a fire safety review report' },
    ],
    phrases: [
      'Reviews {kw} plans and checks {kw} requirements for each compartment.',
      'Verifies {kw} provisions and reports {kw} deviations from code.',
      'Checks {kw} strategy documents against the model for {kw} gaps.',
    ],
  },
  {
    id: 'rfi-triage', title: 'RFI Triage', category: 'project-management',
    keywords: ['rfi', 'triage', 'clarification', 'response-time', 'routing', 'discipline', 'question-log'],
    tools: [
      { name: 'read_rfi', description: 'Reads an incoming RFI and its attachments' },
      { name: 'classify_discipline', description: 'Classifies an RFI by discipline' },
      { name: 'route_to_owner', description: 'Routes an RFI to the responsible reviewer' },
      { name: 'find_similar_rfis', description: 'Finds earlier similar RFIs in the question log' },
      { name: 'draft_response', description: 'Drafts a response for reviewer approval' },
    ],
    phrases: [
      'Performs {kw} on incoming requests and handles {kw} for each discipline.',
      'Improves {kw} by sorting every {kw} item and suggesting an owner.',
      'Tracks {kw} backlog and highlights overdue {kw} items.',
    ],
  },
  {
    id: 'scheduling', title: 'Scheduling', category: 'project-management',
    keywords: ['scheduling', 'critical-path', 'milestone', 'lookahead', 'sequencing', 'delay', 'baseline'],
    tools: [
      { name: 'load_schedule', description: 'Loads a project schedule' },
      { name: 'compute_critical_path', description: 'Computes the critical path' },
      { name: 'compare_to_baseline', description: 'Compares the schedule to the baseline' },
      { name: 'build_lookahead', description: 'Builds a three-week lookahead' },
      { name: 'flag_delay_risk', description: 'Flags activities at risk of delay' },
    ],
    phrases: [
      'Analyses {kw} data and reports {kw} risks to the project team.',
      'Builds a {kw} view and checks {kw} against the baseline.',
      'Monitors {kw} progress and warns of {kw} slippage.',
    ],
  },
  {
    id: 'compliance-audit', title: 'Compliance Audit', category: 'compliance',
    keywords: ['compliance', 'audit', 'regulation', 'checklist', 'evidence', 'non-conformance', 'standard'],
    tools: [
      { name: 'load_checklist', description: 'Loads a compliance checklist' },
      { name: 'collect_evidence', description: 'Collects evidence documents for a requirement' },
      { name: 'evaluate_requirement', description: 'Evaluates a requirement against evidence' },
      { name: 'log_non_conformance', description: 'Logs a non-conformance record' },
      { name: 'write_audit_report', description: 'Writes an audit report' },
    ],
    phrases: [
      'Runs a {kw} review against each {kw} and records findings.',
      'Collects {kw} material and prepares {kw} summaries for reviewers.',
      'Maps every {kw} item to a {kw} reference and flags gaps.',
    ],
  },
  {
    id: 'cost-estimating', title: 'Cost Estimating', category: 'cost-management',
    keywords: ['cost', 'estimate', 'quantity-takeoff', 'unit-price', 'budget', 'contingency', 'variance'],
    tools: [
      { name: 'extract_quantities', description: 'Extracts quantities from a model' },
      { name: 'lookup_unit_price', description: 'Looks up unit prices from a price book' },
      { name: 'build_estimate', description: 'Builds a cost estimate' },
      { name: 'compare_budget', description: 'Compares an estimate to the budget' },
      { name: 'explain_variance', description: 'Explains cost variance between revisions' },
    ],
    phrases: [
      'Produces a {kw} from {kw} data and highlights {kw} drivers.',
      'Compares each {kw} to the {kw} and explains changes.',
      'Prepares {kw} summaries and reviews {kw} assumptions.',
    ],
  },
  {
    id: 'bim-coordination', title: 'BIM Coordination', category: 'design',
    keywords: ['bim', 'clash', 'coordination', 'ifc', 'model-check', 'federated-model', 'issue-tracking'],
    tools: [
      { name: 'load_federated_model', description: 'Loads a federated model from several disciplines' },
      { name: 'detect_clashes', description: 'Detects clashes between model elements' },
      { name: 'group_clashes', description: 'Groups related clashes into issues' },
      { name: 'validate_ifc', description: 'Validates an IFC file against rules' },
      { name: 'create_issue', description: 'Creates a coordination issue' },
    ],
    phrases: [
      'Detects {kw} problems in the {kw} and groups them into issues.',
      'Runs {kw} checks on each {kw} and summarises results.',
      'Prepares {kw} meeting material and tracks {kw} resolution.',
    ],
  },
  {
    id: 'document-control', title: 'Document Control', category: 'project-management',
    keywords: ['document', 'revision', 'transmittal', 'naming', 'register', 'approval', 'archive'],
    tools: [
      { name: 'scan_incoming_documents', description: 'Scans incoming documents' },
      { name: 'check_naming_convention', description: 'Checks file naming conventions' },
      { name: 'update_register', description: 'Updates the document register' },
      { name: 'issue_transmittal', description: 'Issues a transmittal with revisions' },
      { name: 'archive_superseded', description: 'Archives superseded revisions' },
    ],
    phrases: [
      'Checks every {kw} against the {kw} rules and updates the register.',
      'Manages {kw} flow and keeps each {kw} traceable.',
      'Reviews {kw} metadata and reports {kw} inconsistencies.',
    ],
  },
]

const LLMS = ['claude-sonnet-4-6', 'gpt-4o', 'gpt-4.1-mini', 'gpt-5.6']
const VARIANTS = [
  'Assistant', 'Reviewer', 'Checker', 'Planner', 'Analyst', 'Coordinator',
  'Advisor', 'Auditor', 'Navigator', 'Inspector', 'Summariser', 'Monitor',
]

export interface GeneratedAgent { slug: string; filename: string; yaml: string }

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Rng = () => number
const int = (r: Rng, min: number, max: number) => min + Math.floor(r() * (max - min + 1))
const pick = <T>(r: Rng, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)]
function shuffle<T>(r: Rng, arr: readonly T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
const pickN = <T>(r: Rng, arr: readonly T[], n: number): T[] => shuffle(r, arr).slice(0, n)

function maturity(r: Rng): 'production' | 'beta' | 'experimental' {
  const x = r()
  return x < 0.25 ? 'production' : x < 0.65 ? 'beta' : 'experimental'
}

function inputSchema(r: Rng, topic: Topic) {
  const kws = shuffle(r, topic.keywords)
  const n = int(r, 1, 4)
  const fields: Record<string, unknown>[] = []
  for (let i = 0; i < n; i++) {
    const kind = i === 0 ? 'text' : pick(r, ['text', 'textarea', 'number', 'select'] as const)
    const base = kws[i % kws.length].replace(/[^a-z0-9]+/g, '_')
    const key = `${base}_${i + 1}`
    const field: Record<string, unknown> = {
      key,
      label: `${base.replace(/_/g, ' ')} ${i + 1}`,
      type: kind,
      required: r() < 0.6,
    }
    if (kind === 'select') {
      field.options = pickN(r, ['basic', 'standard', 'detailed', 'strict'], int(r, 2, 3)).map(v => ({
        value: v,
        label: v[0].toUpperCase() + v.slice(1),
      }))
    }
    fields.push(field)
  }
  return fields
}

export function generateAgents(count = 150, seed = 20260101): GeneratedAgent[] {
  const rng = mulberry32(seed)
  const order = shuffle(rng, TOPICS.map((_, i) => i))
  const out: GeneratedAgent[] = []

  for (let i = 0; i < count; i++) {
    const topic = TOPICS[order[i % TOPICS.length]]
    const num = String(i + 1).padStart(3, '0')
    const variant = pick(rng, VARIANTS)
    const name = `Synthetic ${topic.title} ${variant} ${num}`
    const slug = slugify(name)

    const kwPair = () => pickN(rng, topic.keywords, 2)
    const [k1, k2] = kwPair()
    const sentence = pick(rng, topic.phrases).replace('{kw}', k1).replace('{kw}', k2)
    // Template may contain >2 placeholders; any remainder falls back to k1.
    const desc = `${sentence.replace(/\{kw\}/g, k1)} Synthetic test agent - not a real catalog entry.`

    const tools = pickN(rng, topic.tools, int(rng, 2, 5))
    const [p1, p2] = kwPair()
    const systemPrompt =
      `You are a ${topic.title.toLowerCase()} agent. Focus on ${p1} and ${p2}. ` +
      `Use the available tools (${tools.map(t => t.name).join(', ')}) and report results clearly. ` +
      `This is a synthetic test agent.`

    const spec = {
      component_type: 'Agent',
      id: `synthetic-${num}`,
      name,
      description: desc,
      metadata: {
        category: topic.category,
        github_url: `https://example.invalid/synthetic/${slug}`,
        maturity: maturity(rng),
        tags: ['synthetic', topic.id, ...pickN(rng, topic.keywords, int(rng, 2, 3))],
        input_schema: inputSchema(rng, topic),
      },
      system_prompt: systemPrompt,
      llm_config: {
        name: pick(rng, LLMS),
        default_generation_parameters: {
          max_tokens: pick(rng, [1024, 2048, 4096, 8192]),
          temperature: Math.round(rng() * 10) / 10,
          top_p: pick(rng, [0.8, 0.9, 0.95, 1]),
        },
      },
      tools,
      human_in_the_loop: rng() < 0.5,
    }

    out.push({ slug, filename: `${slug}.yaml`, yaml: stringifyYaml(spec) })
  }
  return out
}

const PROTECTED_DIR = resolve('data/agents')

export function writeScaleFixtures(dir: string, count = 150, seed = 20260101): number {
  const target = resolve(dir)
  const rel = relative(PROTECTED_DIR, target)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    throw new Error(`Refusing to write scale fixtures into protected directory: ${PROTECTED_DIR}`)
  }
  const agents = generateAgents(count, seed)
  mkdirSync(target, { recursive: true })
  for (const a of agents) writeFileSync(join(target, a.filename), a.yaml, 'utf-8')
  return agents.length
}

const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  const count = Number(process.env.SCALE_COUNT ?? 150)
  const seed = Number(process.env.SCALE_SEED ?? 20260101)
  const outDir = process.env.SCALE_OUT_DIR ?? './data/fixtures-scale'
  const n = writeScaleFixtures(outDir, count, seed)
  console.log(`Wrote ${n} synthetic agents to ${outDir} (seed ${seed})`)
}
