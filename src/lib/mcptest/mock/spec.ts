// Upstream spec schema and the shapes shared with core/types.ts (declared locally; mock/ imports nothing from $lib).
import { z } from 'zod'
import { DATASETS } from './contract'

export const UpstreamSpec = z.object({
  datasets: z.array(z.enum(DATASETS)),
  auth: z.object({ header: z.literal('X-Api-Key'), mode: z.enum(['401', '403']) }).optional(),
  maxPageSize: z.number().int().positive().default(50),
  /** page*per_page above this returns 500 'all shards failed'. null disables. Default 200. */
  ceiling: z.number().int().positive().nullable().default(200),
  /** Docs mode: route patterns that exist; anything else is 404 and logged undocumented. */
  documentedRoutes: z.array(z.string()).optional(),
  rejectUnknownParams: z.boolean().default(true),
  seed: z.number().int().default(1),
  size: z.number().int().positive().optional(),
})
export type UpstreamSpec = z.output<typeof UpstreamSpec>
export type UpstreamSpecInput = z.input<typeof UpstreamSpec>

// structurally identical to core/types.ts
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

// structurally identical to core/types.ts
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

// structurally identical to core/types.ts
export interface MockView {
  url: string
  log(): LogEntry[]
  hits(routePrefix?: string): number
  inject(f: FaultSpec): void
  clearFaults(): void
  reset(): void
}

export interface MockOptions {
  /** Expected X-Api-Key value; supplied by the runner, never read from the environment. */
  apiKey?: string
  now?: () => number
  /** Backend label recorded in each LogEntry (composite case: 'A' / 'B'). */
  label?: string
}

export interface MockHandle extends MockView {
  port: number
  close(): Promise<void>
  setSeed(n: number): void
}
