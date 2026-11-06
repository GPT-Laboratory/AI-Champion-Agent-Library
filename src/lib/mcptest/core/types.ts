// Shared contracts for the MCP test platform (Phase 15).
// Core purity: no $lib, svelte or @sveltejs imports; relative imports only so it runs under tsx in a container.
import type { CaseDef } from './cases'

export type { CaseDef, GoldenCheck, Expect, Rubric } from './cases'

/** Per-cell run state. The first 8 mirror the source runner; NA_TRANSPORT and PENDING_HUMAN are additive. */
export type CellState =
  | 'PASS'
  | 'FAIL'
  | 'NA_MODALITY'
  | 'SKIPPED_FIXTURE'
  | 'UNAVAILABLE'
  | 'INSTALL_FAILED'
  | 'GEN_FAILED'
  | 'ERROR'
  | 'NA_TRANSPORT'
  | 'PENDING_HUMAN'
/** Per-check status. ERROR means unbound or ambiguous binding (scorer problem, not a server failure). */
export type CheckStatus = 'PASS' | 'FAIL' | 'NA' | 'ERROR'
/** Scoring dimensions D1-D6. */
export type Dimension = 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6'
/** The 10 generic harness behaviour checks. */
export type BehaviourKind =
  | 'lookup_by_id'
  | 'lookup_by_alt_key'
  | 'partition_filter'
  | 'derived_filter'
  | 'projection'
  | 'pagesize_clamp'
  | 'pagination_ceiling'
  | 'bad_input'
  | 'empty_vs_error'
  | 'auth_fail'
/** Case-specific special check kinds. */
export type SpecialKind =
  | 'grounding'
  | 'profile'
  | 'composite'
  | 'large_response'
  | 'fault_retry'
  | 'fault_timeout'
  | 'fault_malformed'
  | 'secret_canary'
  | 'i18n_codes'
  | 'rerun_variance'
  | 'generator_side'

/** Outcome of one tools/call: tool-level result, JSON-RPC error, or transport failure. Kept distinct. */
export type ToolOutcome =
  | { kind: 'result'; isError: boolean; text: string; structured?: unknown; content: unknown[] }
  | { kind: 'rpc_error'; code: number; message: string }
  | { kind: 'transport_error'; message: string; timedOut?: boolean }

/** A tool as listed by tools/list. */
export interface ToolInfo {
  name: string
  description?: string
  inputSchema?: unknown
  annotations?: Record<string, unknown>
}

/** Transport-agnostic handle the validators use to talk to a subject. */
export interface ToolCaller {
  tools: ToolInfo[]
  call(name: string, args: Record<string, unknown>, opts?: { timeoutMs?: number }): Promise<ToolOutcome>
}

/** A fault the mock upstream can be told to inject. */
export interface FaultSpec {
  route?: string
  fault: 'status' | 'latency' | 'timeout' | 'malformed' | 'reset' | 'huge'
  status?: number
  times?: number
  headers?: Record<string, string>
  envelope?: boolean
  mode?: 'truncated_json' | 'html' | 'empty' | 'wrong_content_type' | 'slow_drip'
  ms?: number
  bytes?: number
}

/** One mock request log line. Header names only, never values. */
export interface LogEntry {
  n: number
  tMs: number
  method: string
  rawPath: string
  query: Record<string, string[]>
  headerNames: string[]
  route: string
  fault?: string
  undocumented?: boolean
  backend?: string
}

/** What validators may see and do on the mock upstream. */
export interface MockView {
  url: string
  log(): LogEntry[]
  hits(routePrefix?: string): number
  inject(f: FaultSpec): void
  clearFaults(): void
  reset(): void
}

/** Tier 4 risk flag ids. */
export type FlagId =
  | 'LEAK'
  | 'SECRET_ECHO'
  | 'WRITE_TOOL'
  | 'CONFIDENT_WRONG'
  | 'NO_RETRY'
  | 'SILENT_GUESS'
  | 'UNVALIDATED_CODE'
  | 'STDOUT_NOISE'
/** A raised risk flag; blockers force the BLOCKED verdict regardless of score. */
export interface FlagHit {
  id: FlagId
  severity: 'blocker' | 'warning'
  detail: string
}

/** Result of one scored check. */
export interface CheckResult {
  id: string
  kind: BehaviourKind | SpecialKind | 'tool_exists' | 'call' | 'auth'
  dimension: Dimension
  status: CheckStatus
  boundBy: 'explicit' | 'hint' | 'none'
  reason: string
  flags?: FlagHit[]
}

/** How a runtime starts the subject. A launch is a descriptor, never a live process. */
export type Launch =
  | { kind: 'stdio'; command: string; args: string[]; cwd: string }
  | {
      kind: 'inproc'
      serve: (
        r: NodeJS.ReadableStream,
        w: NodeJS.WritableStream,
        env: Record<string, string>
      ) => Promise<void>
    }
  | { kind: 'http'; url: string; healthPath?: string }

/** Result of Subject.prepare. Never thrown; failures are states. */
export interface PrepareResult {
  launch?: Launch
  status: CellState
  error?: string
  generationMs?: number
  notes?: string
  artefacts?: Record<string, string>
  /** Explicit tool binding by check id or kind; wins over the suite's regex hints. argMap renames suite argument names. */
  binding?: Record<string, { tool: string; args?: Record<string, unknown>; argMap?: Record<string, string> }>
  /** Names under which the subject reads the mock URL and key; default ACME_* from the case x-env. */
  envNames?: { baseUrl?: string; apiKey?: string; baseUrlB?: string; dataPath?: string }
  /** Generator-side checks, appended by the runner. */
  extraChecks?: CheckResult[]
}

/** A server under test (fake variant, generator output, or submitted). */
export interface Subject {
  id: string
  kind: 'fake' | 'generator' | 'submitted'
  modality: 'spec' | 'docs' | 'dump' | 'repo' | 'any'
  llm: boolean
  networkPolicy: string
  status: 'installed' | 'install_failed' | 'unavailable'
  transports: ('stdio' | 'http')[]
  prepare(c: CaseDef, workdir: string): Promise<PrepareResult>
}
