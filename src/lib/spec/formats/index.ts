// Adapter wiring list, ordered by Phase 12 ranking (D-030). The registry orders by detect
// confidence; ties are resolved by this order.
import type { FormatAdapter } from '../kinds.js'
import { oracleSystemsAdapter } from './oracle-systems.js'
import { manifestAdapter } from './manifest.js'
import { skillAdapter } from './skill.js'
import { crewaiAdapter } from './crewai.js'
import { mcpServerJsonAdapter } from './mcp-server-json.js'
import { langgraphAdapter } from './langgraph.js'

export const ADAPTERS: FormatAdapter[] = [
  oracleSystemsAdapter,
  manifestAdapter,
  skillAdapter,
  crewaiAdapter,
  mcpServerJsonAdapter,
  langgraphAdapter,
]
