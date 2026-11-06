// Contracts of the local MCP proxy (Phase 36, D-635). Local only; removed from the release branch by Phase 38.
export interface McpToolResult {
  content: Array<{ type: string; text?: string }>
  structuredContent?: unknown
  isError?: boolean
}
export interface McpUpstream {
  callTool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<McpToolResult>
  close(): Promise<void>
}
export interface LocalMcpDeps {
  upstream: McpUpstream | null
  callBudget: number
  timeoutMs: number
}
export const LOCAL_MCP_ALLOWED_TOOLS = [
  'lookup_by_lvi_number',
  'get_product_by_link',
  'get_product_by_gtin',
  'search_products',
  'filter_by_etim_class',
] as const
export type LocalMcpTool = (typeof LOCAL_MCP_ALLOWED_TOOLS)[number]
export const MAX_ARGS_BYTES = 4096
export const MAX_RESPONSE_BYTES = 24 * 1024
export const DEFAULT_CALL_BUDGET = 12
export const DEFAULT_TIMEOUT_MS = 20_000
