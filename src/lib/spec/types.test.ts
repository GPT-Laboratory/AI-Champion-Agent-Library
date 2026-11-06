import { describe, it, expect } from 'vitest'
import { OracleAgentSpecSchema } from './oracle-agentspec.js'
import { detectFormat, normalize } from './index.js'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname, '../../../data/agents/fixtures')

function loadFixture(filename: string): unknown {
  const raw = readFileSync(join(FIXTURES_DIR, filename), 'utf-8')
  return parseYaml(raw)
}

describe('Field name isolation (PIPE-02)', () => {
  it('no AgentRecord key appears in OracleAgentSpecSchema top-level keys', () => {
    const specKeys = new Set(Object.keys(OracleAgentSpecSchema.shape))

    // Manually maintained array of AgentRecord field names
    const agentRecordKeys = [
      'slug',
      'title',
      'specId',
      'summary',
      'systemPrompt',
      'llm',
      'toolNames',
      'inputFields',
      'requiresHumanApproval',
      'category',
      'githubUrl',
      'maturityStatus',
      'tags',
      'lastIngestedAt',
    ]

    const intersection = agentRecordKeys.filter(key => specKeys.has(key))
    expect(intersection).toEqual([])
  })
})

describe('detectFormat', () => {
  it('returns "oracle-agentspec" when component_type is "Agent"', () => {
    const result = detectFormat({ component_type: 'Agent', name: 'Test' })
    expect(result).toBe('oracle-agentspec')
  })

  it('throws Error with "Unrecognized" when component_type is missing', () => {
    expect(() => detectFormat({})).toThrow(/Unrecognized/)
  })

  it('throws Error when component_type is not "Agent"', () => {
    expect(() => detectFormat({ component_type: 'NotAnAgent' })).toThrow()
  })
})

describe('normalize', () => {
  it('returns valid AgentRecord for oracle-agentspec format', () => {
    const validRaw = loadFixture('valid-agent.yaml')
    const record = normalize('oracle-agentspec', validRaw)
    expect(record.slug).toBe('customer-support-triager')
    expect(record.title).toBe('Customer Support Triager')
    expect(typeof record.lastIngestedAt).toBe('string')
  })

  it('throws with Zod error message for invalid oracle-agentspec data', () => {
    const invalidRaw = { component_type: 'Agent', name: 'Missing system prompt' }
    expect(() => normalize('oracle-agentspec', invalidRaw)).toThrow()
  })
})
