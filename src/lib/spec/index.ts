import type { AgentRecord } from './types.js'
import { fromOracleAgentSpec, OracleAgentSpecSchema } from './oracle-agentspec.js'

export type {
  AgentRecord,
  AgentLlm,
  AgentInputField,
  AgentInputFieldType,
  AgentInputOption,
} from './types.js'

type FormatId = 'oracle-agentspec'

/**
 * Detects the agent spec format from a raw parsed object.
 * Oracle AgentSpec is identified by component_type === 'Agent'.
 * Throws an Error with "Unrecognized" in the message for unknown formats.
 */
export function detectFormat(raw: unknown): FormatId {
  if (
    typeof raw === 'object' &&
    raw !== null &&
    (raw as Record<string, unknown>).component_type === 'Agent'
  ) {
    return 'oracle-agentspec'
  }
  throw new Error(
    'Unrecognized agent spec format: no component_type === "Agent" found'
  )
}

/**
 * Normalizes a raw spec object to an AgentRecord using the registered adapter for the format.
 * Throws if validation fails (with Zod error message) or if the format is unknown.
 */
export function normalize(formatId: FormatId, raw: unknown): AgentRecord {
  if (formatId === 'oracle-agentspec') {
    const result = OracleAgentSpecSchema.safeParse(raw)
    if (!result.success) {
      throw new Error(`Oracle AgentSpec validation failed: ${result.error.message}`)
    }
    return fromOracleAgentSpec(result.data)
  }
  // TypeScript exhaustiveness: this line is unreachable if FormatId is a closed union
  throw new Error(`No adapter registered for format: ${String(formatId)}`)
}
