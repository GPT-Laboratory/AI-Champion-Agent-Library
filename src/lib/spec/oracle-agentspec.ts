import { z } from 'zod'
import type { AgentRecord } from './types.js'
import { slugify } from './types.js'

const OracleInputOptionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
})

const OracleInputFieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1),
  type: z.enum(['text', 'textarea', 'number', 'select']),
  required: z.boolean().optional(),
  description: z.string().optional(),
  placeholder: z.string().optional(),
  unit: z.string().optional(),
  default: z.union([z.string(), z.number()]).optional(),
  options: z.array(OracleInputOptionSchema).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
}).superRefine((field, ctx) => {
  if (field.type === 'select' && (!field.options || field.options.length === 0)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Select fields require at least one option',
      path: ['options'],
    })
  }
})

// Zod 4 schema mirrors Oracle AgentSpec structure exactly.
// Oracle AgentSpec field names exist ONLY in this file — never in types.ts or index.ts.
export const OracleAgentSpecSchema = z.object({
  component_type: z.literal('Agent'),
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  metadata: z.object({
    input_schema: z.array(OracleInputFieldSchema).optional(),
  }).catchall(z.unknown()).optional(),
  system_prompt: z.string().min(1),
  llm_config: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    default_generation_parameters: z.object({
      max_tokens: z.number().int().positive().optional(),
      temperature: z.number().min(0).max(2).optional(),
      top_p: z.number().min(0).max(1).optional(),
    }).optional(),
  }),
  tools: z.array(z.object({ name: z.string() }).passthrough()).optional(),
  toolboxes: z.array(z.unknown()).optional(),
  inputs: z.array(z.unknown()).optional(),
  outputs: z.array(z.unknown()).optional(),
  human_in_the_loop: z.boolean().optional(),
  min_agentspec_version: z.string().optional(),
  max_agentspec_version: z.string().optional(),
})

export type OracleAgentSpec = z.infer<typeof OracleAgentSpecSchema>

/**
 * Extract a string value from the free-form metadata field by key.
 * Returns null if the key is absent or the value is not a string.
 */
function extractMeta(metadata: Record<string, unknown> | undefined, key: string): string | null {
  if (!metadata) return null
  const value = metadata[key]
  return typeof value === 'string' ? value : null
}

/**
 * Extract a string array from the free-form metadata field by key.
 * Returns an empty array if the key is absent or not an array of strings.
 */
function extractMetaArray(metadata: Record<string, unknown> | undefined, key: string): string[] {
  if (!metadata) return []
  const value = metadata[key]
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

/**
 * Like extractMetaArray, but distinguishes an absent key (null) from an empty list.
 */
function extractOptionalMetaArray(metadata: Record<string, unknown> | undefined, key: string): string[] | null {
  if (!metadata || !Array.isArray(metadata[key])) return null
  return extractMetaArray(metadata, key)
}

/**
 * Cast a raw maturity string to the AgentRecord maturityStatus union.
 * Falls back to 'experimental' for any unrecognized value.
 */
function toMaturityStatus(raw: string | null): 'production' | 'beta' | 'experimental' {
  if (raw === 'production' || raw === 'beta' || raw === 'experimental') return raw
  return 'experimental'
}

/**
 * Adapter: transforms a validated OracleAgentSpec into an AgentRecord.
 * This is the ONLY place where Oracle AgentSpec field names appear on the right-hand side.
 */
export function fromOracleAgentSpec(raw: OracleAgentSpec): AgentRecord {
  return {
    slug: slugify(raw.name),
    title: raw.name,
    specId: raw.id ?? null,
    summary: raw.description ?? '',
    systemPrompt: raw.system_prompt,
    llm: {
      name: raw.llm_config.name,
      temperature: raw.llm_config.default_generation_parameters?.temperature ?? null,
      maxTokens: raw.llm_config.default_generation_parameters?.max_tokens ?? null,
      topP: raw.llm_config.default_generation_parameters?.top_p ?? null,
    },
    toolNames: (raw.tools ?? []).map(t => t.name),
    inputFields: (raw.metadata?.input_schema ?? []).map(field => ({
      key: field.key,
      label: field.label,
      type: field.type,
      required: field.required ?? false,
      description: field.description ?? null,
      placeholder: field.placeholder ?? null,
      unit: field.unit ?? null,
      defaultValue: field.default ?? null,
      options: field.options ?? [],
      min: field.min ?? null,
      max: field.max ?? null,
    })),
    requiresHumanApproval: raw.human_in_the_loop ?? false,
    category: extractMeta(raw.metadata, 'category'),
    githubUrl: extractMeta(raw.metadata, 'github_url'),
    linkLabel: extractMeta(raw.metadata, 'link_label'),
    maturityStatus: toMaturityStatus(extractMeta(raw.metadata, 'maturity')),
    tags: extractMetaArray(raw.metadata, 'tags'),
    customizableFields: extractOptionalMetaArray(raw.metadata, 'customizable'),
    fixedFields: extractMetaArray(raw.metadata, 'fixed'),
    fixedNote: extractMeta(raw.metadata, 'fixed_note'),
    lastIngestedAt: new Date().toISOString(),
  }
}
