// SOURCE: Derived from Oracle AgentSpec API reference (oracle.github.io/agent-spec)
// and AIC catalog UI needs. Field names are deliberately NOT Oracle AgentSpec names.

export interface AgentLlm {
  name: string          // e.g. "gpt-4o", "llama-3.1-70b" — from llm_config.name
  temperature: number | null
  maxTokens: number | null
  topP: number | null
}

export type AgentInputFieldType = 'text' | 'textarea' | 'number' | 'select'

export interface AgentInputOption {
  value: string
  label: string
}

export interface AgentInputField {
  key: string
  label: string
  type: AgentInputFieldType
  required: boolean
  description: string | null
  placeholder: string | null
  unit: string | null
  defaultValue: string | number | null
  options: AgentInputOption[]
  min: number | null
  max: number | null
}

export interface AgentRecord {
  // Identity
  slug: string          // URL-safe identifier derived from name; primary key
  title: string         // Human-readable name (from AgentSpec `name`)
  specId: string | null // Original AgentSpec `id` if present

  // Description (what the agent does — used for search embedding)
  summary: string       // From AgentSpec `description`
  systemPrompt: string  // From AgentSpec `system_prompt`

  // LLM configuration
  llm: AgentLlm

  // Capabilities
  toolNames: string[]              // Names of tools the agent uses
  inputFields: AgentInputField[]   // Structured inputs required by the agent
  requiresHumanApproval: boolean   // From `human_in_the_loop`

  // Catalog metadata (consortium conventions in AgentSpec `metadata`)
  category: string | null
  githubUrl: string | null
  linkLabel: string | null         // Text for the githubUrl link; UI falls back to "View on GitHub"
  maturityStatus: 'production' | 'beta' | 'experimental'
  tags: string[]
  customizableFields: string[] | null  // Keys from TAILORABLE_FIELDS; null = all, [] = none
  fixedNote: string | null             // Optional extra text under the fixed fields in the panel
  fixedFields: string[]                // Keys from TAILORABLE_FIELDS shown with their value as not customizable

  // Pipeline metadata
  lastIngestedAt: string  // ISO-8601 timestamp; updated on every ingest run
}

/**
 * Converts a string to a URL-safe slug:
 * lowercase, replace non-alphanumeric with hyphens, collapse multiple hyphens,
 * trim leading/trailing hyphens.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
}
