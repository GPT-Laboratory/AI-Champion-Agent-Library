import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { OracleAgentSpecSchema, fromOracleAgentSpec } from './oracle-agentspec.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname, '../../../data/agents/fixtures')

function loadFixture(filename: string): unknown {
  const raw = readFileSync(join(FIXTURES_DIR, filename), 'utf-8')
  return parseYaml(raw)
}

describe('fromOracleAgentSpec - valid agent', () => {
  const parsed = OracleAgentSpecSchema.safeParse(loadFixture('valid-agent.yaml'))

  it('parses without error', () => {
    expect(parsed.success).toBe(true)
  })

  it('returns slug derived from name', () => {
    if (!parsed.success) throw new Error('Fixture did not parse')
    const record = fromOracleAgentSpec(parsed.data)
    expect(record.slug).toBe('customer-support-triager')
  })

  it('returns title matching name', () => {
    if (!parsed.success) throw new Error('Fixture did not parse')
    const record = fromOracleAgentSpec(parsed.data)
    expect(record.title).toBe('Customer Support Triager')
  })

  it('returns summary matching description', () => {
    if (!parsed.success) throw new Error('Fixture did not parse')
    const record = fromOracleAgentSpec(parsed.data)
    expect(record.summary).toBe(
      'Routes incoming customer support tickets to the appropriate team based on content analysis and urgency classification.'
    )
  })

  it('returns llm.name from llm_config.name', () => {
    if (!parsed.success) throw new Error('Fixture did not parse')
    const record = fromOracleAgentSpec(parsed.data)
    expect(record.llm.name).toBe('gpt-4o')
  })

  it('returns llm.temperature from llm_config.default_generation_parameters.temperature', () => {
    if (!parsed.success) throw new Error('Fixture did not parse')
    const record = fromOracleAgentSpec(parsed.data)
    expect(record.llm.temperature).toBe(0.3)
  })

  it('returns llm.maxTokens from llm_config.default_generation_parameters.max_tokens', () => {
    if (!parsed.success) throw new Error('Fixture did not parse')
    const record = fromOracleAgentSpec(parsed.data)
    expect(record.llm.maxTokens).toBe(1024)
  })

  it('returns llm.topP from llm_config.default_generation_parameters.top_p', () => {
    if (!parsed.success) throw new Error('Fixture did not parse')
    const record = fromOracleAgentSpec(parsed.data)
    expect(record.llm.topP).toBe(0.9)
  })

  it('normalizes metadata input_schema fields', () => {
    if (!parsed.success) throw new Error('Fixture did not parse')
    const record = fromOracleAgentSpec(parsed.data)
    expect(record.inputFields).toHaveLength(2)
    expect(record.inputFields[0]).toMatchObject({
      key: 'ticket_text',
      type: 'textarea',
      required: true,
    })
    expect(record.inputFields[1].options).toHaveLength(2)
  })
})

describe('fromOracleAgentSpec - minimal agent (no optional fields)', () => {
  const parsed = OracleAgentSpecSchema.safeParse(loadFixture('minimal-agent.yaml'))

  it('parses without error', () => {
    expect(parsed.success).toBe(true)
  })

  it('returns null for llm.temperature when not present', () => {
    if (!parsed.success) throw new Error('Fixture did not parse')
    const record = fromOracleAgentSpec(parsed.data)
    expect(record.llm.temperature).toBeNull()
  })

  it('returns null for llm.maxTokens when not present', () => {
    if (!parsed.success) throw new Error('Fixture did not parse')
    const record = fromOracleAgentSpec(parsed.data)
    expect(record.llm.maxTokens).toBeNull()
  })

  it('returns null for llm.topP when not present', () => {
    if (!parsed.success) throw new Error('Fixture did not parse')
    const record = fromOracleAgentSpec(parsed.data)
    expect(record.llm.topP).toBeNull()
  })

  it('returns empty array for toolNames when tools not present', () => {
    if (!parsed.success) throw new Error('Fixture did not parse')
    const record = fromOracleAgentSpec(parsed.data)
    expect(record.toolNames).toEqual([])
  })

  it('returns false for requiresHumanApproval when not present', () => {
    if (!parsed.success) throw new Error('Fixture did not parse')
    const record = fromOracleAgentSpec(parsed.data)
    expect(record.requiresHumanApproval).toBe(false)
  })

  it('returns an empty inputFields array when input_schema is not present', () => {
    if (!parsed.success) throw new Error('Fixture did not parse')
    const record = fromOracleAgentSpec(parsed.data)
    expect(record.inputFields).toEqual([])
  })

  it('returns null for category when metadata not present', () => {
    if (!parsed.success) throw new Error('Fixture did not parse')
    const record = fromOracleAgentSpec(parsed.data)
    expect(record.category).toBeNull()
  })

  it('returns experimental for maturityStatus when metadata not present', () => {
    if (!parsed.success) throw new Error('Fixture did not parse')
    const record = fromOracleAgentSpec(parsed.data)
    expect(record.maturityStatus).toBe('experimental')
  })
})

describe('OracleAgentSpecSchema.safeParse - malformed data', () => {
  it('returns success=false when name is missing', () => {
    const result = OracleAgentSpecSchema.safeParse({
      component_type: 'Agent',
      system_prompt: 'Test',
      llm_config: { name: 'gpt-4o' },
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.message).toBeTruthy()
    }
  })

  it('returns success=false when component_type is not "Agent"', () => {
    const result = OracleAgentSpecSchema.safeParse(loadFixture('malformed-agent.yaml'))
    expect(result.success).toBe(false)
  })

  it('returns success=false when system_prompt is missing', () => {
    const result = OracleAgentSpecSchema.safeParse({
      component_type: 'Agent',
      name: 'Test Agent',
      llm_config: { name: 'gpt-4o' },
    })
    expect(result.success).toBe(false)
  })

  it('returns descriptive error message when name is missing', () => {
    const result = OracleAgentSpecSchema.safeParse({
      component_type: 'Agent',
      system_prompt: 'Test',
      llm_config: { name: 'gpt-4o' },
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const message = result.error.message
      expect(message.length).toBeGreaterThan(0)
    }
  })
})
