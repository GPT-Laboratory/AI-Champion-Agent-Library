// ProposalSet: the DATA-ONLY file an external author (a person or an agent session) writes to
// improve the deterministic baseline server (research 14-NONDETERMINISTIC-GENERATORS section 5.2,
// extended by D-580 with structural ops). There is no field that holds code; every string is a
// name, free text for descriptions, a checked constant, or a selector in the restricted grammar.
//
// `buildProposalSchema(strict)`: strict=true adds the name patterns (the JSON Schema an agent sees);
// strict=false checks shape only, so a bad name reaches gate 3 and gets its own stable code.
import { z } from 'zod'

export const PROPOSAL_VERSION = 1
export const MAX_PROPOSAL_BYTES = 262_144
export const MAX_OPS = 64
export const MAX_NEW_TOOLS = 20

/** Documented limits (gate 3 and 4 enforce them with stable codes). */
export const LIMITS = {
  toolDescription: 400,
  argDescription: 160,
  reason: 500,
  constString: 256,
  opId: 40,
  mergeDispatch: 8,
  mergeFanout: 4,
  splitTools: 8,
  compositeSteps: 4,
  compositeFanout: 10,
  compositeTotalCalls: 20,
  compositeArgs: 8,
  compositeOutputKeys: 12,
  projectionFields: 12,
  pagingMaxPages: 10,
} as const

export const NAME_RE = {
  op: /^[a-z][a-z0-9_-]{0,39}$/,
  tool: /^[a-z][a-z0-9_]{2,47}$/,
  arg: /^[a-z][a-z0-9_]{0,31}$/,
  value: /^[a-z][a-z0-9_]{0,31}$/,
  step: /^[a-z][a-z0-9_]{0,15}$/,
}

export const OP_TYPES = [
  'rename_tool',
  'rename_arg',
  'describe_tool',
  'describe_arg',
  'hide_tool',
  'set_arg_default',
  'pin_arg',
  'set_projection',
  'set_paging_default',
  'merge_tools',
  'split_tool',
  'composite_tool',
  'derived_filter',
] as const
export type OpType = (typeof OP_TYPES)[number]

export function buildProposalSchema(strict: boolean) {
  const pat = (re: RegExp, max: number, min = 1) => {
    const s = z.string().min(min).max(max)
    return strict ? s.regex(re) : s
  }
  const toolRef = z.string().min(1).max(64)
  const argRef = z.string().min(1).max(64)
  const text = (max: number) => z.string().min(1).max(max)
  const constant = z.union([z.string().max(LIMITS.constString), z.number(), z.boolean()])
  const selector = z.string().min(1).max(120)
  const valueSpec = z.union([z.strictObject({ const: constant }), z.strictObject({ from: selector })])
  const base = {
    id: pat(NAME_RE.op, LIMITS.opId),
    reason: z.string().min(1).max(LIMITS.reason),
  }
  const op = <T extends string, S extends z.ZodRawShape>(name: T, shape: S) => z.strictObject({ op: z.literal(name), ...base, ...shape })

  const compositeArg = z.strictObject({
    name: pat(NAME_RE.arg, 32),
    type: z.enum(['string', 'integer', 'number', 'boolean']),
    required: z.boolean().optional(),
    description: text(LIMITS.argDescription).optional(),
    enum: z.array(pat(NAME_RE.value, 32)).max(16).optional(),
    default: constant.optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  })
  const step = z.strictObject({
    id: pat(NAME_RE.step, 16),
    tool: toolRef,
    args: z.record(z.string().max(64), valueSpec),
    select: z.array(z.string().min(1).max(64)).max(LIMITS.projectionFields).optional(),
    forEach: z.strictObject({ from: selector, max: z.number().int().min(1).max(LIMITS.compositeFanout) }).optional(),
  })

  const ops = z.discriminatedUnion('op', [
    op('rename_tool', { tool: toolRef, name: pat(NAME_RE.tool, 48, 3) }),
    op('rename_arg', { tool: toolRef, arg: argRef, name: pat(NAME_RE.arg, 32), keepAlias: z.boolean().optional() }),
    op('describe_tool', { tool: toolRef, text: text(LIMITS.toolDescription) }),
    op('describe_arg', { tool: toolRef, arg: argRef, text: text(LIMITS.argDescription) }),
    op('hide_tool', { tool: toolRef }),
    op('set_arg_default', { tool: toolRef, arg: argRef, value: constant }),
    op('pin_arg', { tool: toolRef, arg: argRef, value: constant }),
    op('set_projection', { entity: z.string().min(1).max(64), fields: z.array(z.string().min(1).max(64)).min(1).max(LIMITS.projectionFields) }),
    op('set_paging_default', { tool: toolRef, arg: z.enum(['page_size', 'limit', 'max_pages']), value: z.number().int() }),
    op('merge_tools', {
      name: pat(NAME_RE.tool, 48, 3),
      description: text(LIMITS.toolDescription),
      mode: z.enum(['dispatch', 'fanout']),
      dispatchArg: pat(NAME_RE.arg, 32).optional(),
      sources: z.array(z.strictObject({ tool: toolRef, value: pat(NAME_RE.value, 32) })).min(2).max(LIMITS.mergeDispatch),
    }),
    op('split_tool', {
      tool: toolRef,
      keepOriginal: z.boolean().optional(),
      tools: z
        .array(z.strictObject({ name: pat(NAME_RE.tool, 48, 3), description: text(LIMITS.toolDescription), fixed: z.record(z.string().max(64), constant) }))
        .min(1)
        .max(LIMITS.splitTools),
    }),
    op('composite_tool', {
      name: pat(NAME_RE.tool, 48, 3),
      description: text(LIMITS.toolDescription),
      args: z.array(compositeArg).max(LIMITS.compositeArgs),
      steps: z.array(step).min(1).max(LIMITS.compositeSteps),
      output: z.record(z.string().max(64), selector).optional(),
    }),
    op('derived_filter', { entity: z.string().min(1).max(64), source: z.string().min(1).max(64), description: text(LIMITS.toolDescription) }),
  ])

  return z.strictObject({
    version: z.literal(PROPOSAL_VERSION),
    baseline: z.strictObject({ fingerprint: z.string().regex(/^[0-9a-f]{64}$/) }),
    producer: z.strictObject({ kind: z.enum(['human', 'external-agent', 'tool']), note: z.string().max(200).optional() }).optional(),
    ops: z.array(ops).max(MAX_OPS),
  })
}

export const ProposalSetSchema = buildProposalSchema(true)
export const ProposalSetShapeSchema = buildProposalSchema(false)
export type ProposalSet = z.infer<typeof ProposalSetSchema>
export type ProposalOp = ProposalSet['ops'][number]

/** The JSON Schema document written by `--emit-proposal-schema` and placed in every context pack. */
export function proposalJsonSchema(): Record<string, unknown> {
  const s = z.toJSONSchema(ProposalSetSchema, { target: 'draft-2020-12' }) as Record<string, unknown>
  return {
    ...s,
    title: 'ProposalSet',
    description:
      'Data-only proposal file for the deterministic MCP generator. Version 1. No field holds code. See docs/mcp-generator-proposals.md.',
  }
}
