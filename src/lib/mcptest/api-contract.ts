// Client-safe contract of the MCP test run API (flag MCP_TESTER). Pure TypeScript, no server imports.
export const ROUTE_PATH = '/api/mcp-test/runs'
export const MAX_BODY_BYTES = 4096
export const MAX_CASES = 12
export const MAX_RERUNS = 3

export interface StartRunRequest {
  /** fake:<known variant> or generator:<known sample>. Uploaded code and cmd: subjects are not accepted. */
  subject: string
  cases?: string[]
  reruns?: number
}

export type RunStatus = 'queued' | 'running' | 'done' | 'failed'

export interface StartRunResponse {
  id: string
  status: 'queued'
}

export interface RunStatusResponse {
  status: RunStatus
  progress: { done: number; total: number; current: string | null }
  events: { t: string; text: string }[]
  error: string | null
}

export interface ApiError {
  ok: false
  /** D-461: every API error body carries `message` (same field as the auth 401 and /health 503). */
  message: string
}
