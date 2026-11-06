// Registry of agents that get a staged Pi extension (D-636). Null when the flag is off or the slug is not registered,
// so every caller is inert by default. Local only; removed from the release branch by Phase 38.
import { localMcpAgentsEnabled } from '../../localMcpFlag'
import { LVI_AGENT_SLUG } from '../../localMcp/slugs'
import { AGENT_DIR } from '../tryitout/runtime'
import type { RunnerConfig } from '../tryitout/runnerConfig'
import { renderLviExtension } from './extensionTemplate'
import { DEFAULT_CALL_BUDGET, LOCAL_MCP_ALLOWED_TOOLS } from './types'

export interface LocalMcpAgent {
  extensionPath: string
  /** Path relative to AGENT_DIR. */
  extensionFile: string
  tools: readonly string[]
  render(cfg: Pick<RunnerConfig, 'proxyUrl'>): string
}

const LLM_SUFFIX = '/api/llm/v1'
const MCP_SUFFIX = '/api/local-mcp/v1'

export function localMcpBaseUrl(proxyUrl: string): string {
  const trimmed = proxyUrl.replace(/\/+$/, '')
  if (!trimmed.endsWith(LLM_SUFFIX)) throw new Error('local MCP: PI_LLM_PROXY_URL must end with /api/llm/v1')
  return trimmed.slice(0, -LLM_SUFFIX.length) + MCP_SUFFIX
}

function callBudget(env: NodeJS.ProcessEnv = process.env): number {
  const v = env.LOCAL_MCP_JOB_CALL_BUDGET
  const n = Number(v)
  return v !== undefined && Number.isInteger(n) && n >= 1 && n <= 50 ? n : DEFAULT_CALL_BUDGET
}

export function localMcpAgent(slug: string): LocalMcpAgent | null {
  if (!localMcpAgentsEnabled() || slug !== LVI_AGENT_SLUG) return null
  return {
    extensionPath: `${AGENT_DIR}/extensions/lvi-info.ts`,
    extensionFile: 'extensions/lvi-info.ts',
    tools: LOCAL_MCP_ALLOWED_TOOLS,
    render: (cfg) => renderLviExtension({ baseUrl: localMcpBaseUrl(cfg.proxyUrl), callBudget: callBudget() }),
  }
}
