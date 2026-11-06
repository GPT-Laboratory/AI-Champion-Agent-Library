// Shared by the generate API route and the UI (design doc section 10).
import type { GenerateOptions, Gap } from './types.js'

export interface GenerateRequest {
  adapter?: string
  input: string
  options?: GenerateOptions
}
export interface GenerateErrorResponse {
  ok: false
  /** D-461: same `message` field as every other API error body (first gap's message). */
  message: string
  gaps: Gap[]
}
export const MAX_INPUT_BYTES = 262144
export const MAX_OUTPUT_BYTES = 2_000_000
export const ROUTE_PATH = '/api/mcp-generate'
// Success response is application/zip.
