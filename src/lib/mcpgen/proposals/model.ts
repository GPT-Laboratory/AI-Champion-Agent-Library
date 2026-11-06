// Plan-level shapes the proposal layer attaches to a ServerPlan (docs/mcp-generator-proposals.md).
// Plain data only: every value here is a checked constant, a name, or a parsed selector path.
// Nothing in this file is, or becomes, code.

/** A scalar constant: never null, never an object, never a secret (gate 3). */
export type Const = string | number | boolean

export type ArgType = 'string' | 'integer' | 'number' | 'boolean' | 'array'

/** An argument of an emitted tool as the Python signature has it. */
export interface SigArg {
  name: string
  type: ArgType
  required: boolean
  /** The default the signature carries (undefined: None for optional arguments). */
  default?: Const
  enum?: string[]
  min?: number
  max?: number
  description?: string
}

/** Edits of one argument, keyed by its baseline name. */
export interface ArgEdit {
  name?: string
  /** Keep the baseline name as an extra optional argument (documented alias). */
  keepAlias?: boolean
  description?: string
  default?: Const
  pin?: Const
}

/** A parsed selector: root first (`input`, `item` or a step id), then keys and list indexes. */
export type SelectorPath = (string | number)[]

export type ValueSpec = { const: Const } | { from: SelectorPath }

export interface CompositeStep {
  id: string
  /** Baseline tool name of a grounded read-only tool. */
  tool: string
  args: Record<string, ValueSpec>
  /** Fields requested from the callee (grounded entity fields, at most 12). */
  select?: string[]
  /** Bounded fan-out over a list: the step runs once per item (`item.*` selectors), at most `max` times. */
  forEach?: { from: SelectorPath; max: number }
}

export type WrapperSpec =
  | { kind: 'merge'; mode: 'dispatch' | 'fanout'; dispatchArg: string; sources: { value: string; tool: string }[]; params: SigArg[] }
  | { kind: 'split'; base: string; fixed: Record<string, Const>; params: SigArg[] }
  | { kind: 'composite'; steps: CompositeStep[]; output?: Record<string, SelectorPath>; params: SigArg[]; totalCalls: number }

export interface ProposedBehavior {
  /** Name the tool had in the deterministic baseline (absent for tools a proposal created). */
  baseName?: string
  args?: Record<string, ArgEdit>
  wrapper?: WrapperSpec
  /** Ids of the proposal ops that touched this tool (provenance, never emitted into code). */
  ops: string[]
}

export interface ProposalProvenance {
  /** sha256 of the proposal file text as read. */
  sha256: string
  fingerprint: string
  mode: 'strict' | 'lenient'
  applied: { id: string; op: string }[]
  rejected: { id: string; gate: number; code: string; message: string }[]
  /** sha256 of every emitted tool name and description (descriptions.lock style). */
  descriptionsSha256: string
}
