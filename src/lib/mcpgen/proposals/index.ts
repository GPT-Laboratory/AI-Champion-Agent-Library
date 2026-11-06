// The proposal layer's library API. Pure: the proposal text comes in as a string, nothing is read or
// written here, no network, no model, no clock. Same model + same options + same proposal text gives
// byte-identical output (D-159 invariant, research section 5.1).
//
// Gates, in order (all deterministic, each issue has a stable code and an op id):
//   1 schema   2 grounding   3 safety   4 structure   5 fingerprint
// Policy: strict (default) rejects the whole file when any op fails; lenient applies the ops that pass
// every gate and reports the rest. A file-level failure (not JSON, wrong envelope, wrong baseline) is
// fatal in both modes: nothing can be applied to a baseline the file was not written for.
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { cmp, gap } from '../diagnostics.js'
import { stableJson } from '../generate.js'
import { buildPlan } from '../plan.js'
import type { DerivedTool, Gap, GenerateOptions, ServerPlan, SourceModel } from '../types.js'
import { applyOps } from './apply.js'
import { show } from './hygiene.js'
import { checkOps, makeCtx, type Issue } from './gates.js'
import type { ProposalProvenance } from './model.js'
import { MAX_OPS, MAX_PROPOSAL_BYTES, PROPOSAL_VERSION, ProposalSetShapeSchema, type ProposalOp } from './schema.js'

export const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

/** Hash of the deterministic SourceModel and plan a proposal is written for. */
export function fingerprintOf(plan: ServerPlan): string {
  return sha256(stableJson({ format: PROPOSAL_VERSION, model: plan.model, tools: plan.tools, derived: plan.derived }))
}

/** Hash of every emitted tool name and description (descriptions.lock style). */
export function descriptionsHash(plan: ServerPlan): string {
  return sha256(stableJson(plan.tools.map((t) => ({ name: t.name, description: t.description }))))
}

export interface EvaluateInput {
  model: SourceModel
  options?: GenerateOptions
  extraDerived?: DerivedTool[]
  text: string
  lenient?: boolean
}

export interface Evaluation {
  /** True when a plan was produced (strict: every op passed; lenient: the file was usable). */
  ok: boolean
  baseline: ServerPlan
  fingerprint: string
  fileSha256: string
  /** File-level problems (gates 1 and 5), fatal in both modes. */
  fatal: Issue[]
  /** Rejected ops: strict mode lists them as the reason for failure; lenient mode lists what it skipped. */
  rejected: Issue[]
  applied: ProposalOp[]
  plan?: ServerPlan
  mode: 'strict' | 'lenient'
}

const Envelope = z.strictObject({
  version: z.literal(PROPOSAL_VERSION),
  baseline: z.strictObject({ fingerprint: z.string().regex(/^[0-9a-f]{64}$/) }),
  producer: ProposalSetShapeSchema.shape.producer,
  ops: z.array(z.unknown()).max(MAX_OPS),
})
const OpSchema = ProposalSetShapeSchema.shape.ops.element

const issue = (gate: Issue['gate'], code: string, opId: string, message: string): Issue => ({ gate, code, opId, message })

/** Zod issue -> a message built from the path and the issue code only (never the received value). */
function zodIssues(err: z.ZodError, opId: (path: PropertyKey[]) => string, gate: 1 = 1): Issue[] {
  const seen = new Set<string>()
  const out: Issue[] = []
  for (const i of err.issues) {
    const path = i.path.map((p) => (typeof p === 'number' ? `[${p}]` : show(String(p)).replace(/[^A-Za-z0-9_]/g, '?').slice(0, 24))).join('.')
    const key = `${path}|${i.code}`
    if (seen.has(key) || out.length >= 12) continue
    seen.add(key)
    out.push(issue(gate, 'schema-invalid', opId(i.path), `The proposal does not match the schema at ${path || '(root)'} (${i.code}).`))
  }
  return out
}

function derivedOf(op: Extract<ProposalOp, { op: 'derived_filter' }>): DerivedTool {
  return { id: `${op.entity}.${op.source}`, kind: 'inMemoryFilter', entity: op.entity, source: op.source, description: op.description, origin: 'proposed' }
}

export function evaluateProposals(input: EvaluateInput): Evaluation {
  const mode = input.lenient ? 'lenient' : 'strict'
  const options = input.options ?? {}
  const baseline = buildPlan(input.model, options, input.extraDerived ?? [])
  const fingerprint = fingerprintOf(baseline)
  const fileSha256 = sha256(input.text)
  const result = (partial: Partial<Evaluation>): Evaluation => ({ ok: false, baseline, fingerprint, fileSha256, fatal: [], rejected: [], applied: [], mode, ...partial })

  // ---- gate 1: size, JSON, envelope ----
  if (Buffer.byteLength(input.text, 'utf8') > MAX_PROPOSAL_BYTES) return result({ fatal: [issue(1, 'file-too-large', '-', `The proposal file is larger than ${MAX_PROPOSAL_BYTES} bytes.`)] })
  let raw: unknown
  try {
    raw = JSON.parse(input.text.charCodeAt(0) === 0xfeff ? input.text.slice(1) : input.text) // a UTF-8 BOM is not part of the JSON (CR-37)
  } catch {
    return result({ fatal: [issue(1, 'bad-json', '-', 'The proposal file is not valid JSON.')] })
  }
  const env = Envelope.safeParse(raw)
  if (!env.success) return result({ fatal: zodIssues(env.error, () => '-') })

  // ---- gate 5 (file level): the baseline the file was written for ----
  if (env.data.baseline.fingerprint !== fingerprint) {
    return result({ fatal: [issue(5, 'fingerprint-mismatch', '-', 'The proposal was written for a different baseline (the source, options or generator changed). Regenerate the context pack and rewrite the proposal.')] })
  }

  // ---- gate 1 per op ----
  const rejected: Issue[] = []
  let ops: ProposalOp[] = []
  env.data.ops.forEach((rawOp, i) => {
    const id = rawOp && typeof rawOp === 'object' && typeof (rawOp as { id?: unknown }).id === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test((rawOp as { id: string }).id) ? (rawOp as { id: string }).id : `ops[${i}]`
    const r = OpSchema.safeParse(rawOp)
    if (!r.success) rejected.push(...zodIssues(r.error, () => id))
    else ops.push(r.data as ProposalOp)
  })

  // ---- gates 2 to 4, iterated in lenient mode until the surviving ops are stable ----
  let expanded = baseline
  for (let round = 0; round <= ops.length + 1; round++) {
    const derivedOps = ops.filter((o): o is Extract<ProposalOp, { op: 'derived_filter' }> => o.op === 'derived_filter')
    expanded = derivedOps.length > 0 ? buildPlan(input.model, options, [...(input.extraDerived ?? []), ...derivedOps.map(derivedOf)]) : baseline
    const issues = checkOps(ops, makeCtx(expanded))
    for (const d of derivedOps) {
      const built = expanded.derived.some((x) => x.id === `${d.entity}.${d.source}` && x.origin === 'proposed')
      if (!built && !issues.some((x) => x.opId === d.id)) issues.push(issue(2, 'derived-not-built', d.id, 'The derived filter could not be built (it duplicates a detected one, or no list operation can fetch candidates).'))
    }
    if (issues.length === 0) break
    if (!input.lenient) return result({ rejected: [...rejected, ...issues], fatal: [] })
    const fileLevel = issues.filter((x) => x.opId === '-')
    if (fileLevel.length > 0) return result({ fatal: fileLevel })
    const bad = new Set(issues.map((x) => x.opId))
    rejected.push(...issues)
    ops = ops.filter((o) => !bad.has(o.id))
  }
  if (!input.lenient && rejected.length > 0) return result({ rejected })

  const plan = applyOps(expanded, ops)
  const provenance: ProposalProvenance = {
    sha256: fileSha256,
    fingerprint,
    mode,
    applied: ops.map((o) => ({ id: o.id, op: o.op })).sort((a, b) => cmp(a.id, b.id)),
    rejected: firstPerOp(rejected)
      .map((x) => ({ id: x.opId, gate: x.gate, code: x.code, message: x.message }))
      .sort((a, b) => cmp(a.id, b.id) || cmp(a.code, b.code)),
    descriptionsSha256: descriptionsHash(plan),
  }
  if (plan.tools.length === 0) return result({ fatal: [issue(4, 'last-tool', '-', 'The proposal would leave the server without any tool.')] })
  return result({ ok: true, applied: ops, rejected, plan: { ...plan, proposals: provenance } })
}

function firstPerOp(issues: Issue[]): Issue[] {
  const seen = new Set<string>()
  const out: Issue[] = []
  for (const i of issues) {
    if (seen.has(i.opId)) continue
    seen.add(i.opId)
    out.push(i)
  }
  return out
}

/** Gaps for a failed evaluation (strict rejection or a fatal file problem). Messages carry no proposal values. */
export function issuesToGaps(ev: Evaluation): Gap[] {
  const all = [...ev.fatal, ...ev.rejected]
  return all.slice(0, 50).map((i) => gap(`proposal-${i.code}`, i.opId === '-' ? i.message : `Op ${i.opId}: ${i.message}`, { severity: 'error', path: i.opId }))
}
