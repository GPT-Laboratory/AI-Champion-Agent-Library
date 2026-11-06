import { describe, expect, it } from 'vitest'
import { agentCompareEnabled, agentKindsEnabled, mcpGeneratorEnabled } from './flags'

describe('agentCompareEnabled', () => {
  it('is off by default', () => {
    expect(agentCompareEnabled({})).toBe(false)
    expect(agentCompareEnabled({ AGENT_COMPARE: undefined })).toBe(false)
  })
  it.each(['1', 'true', 'TRUE', ' on ', 'yes'])('is on for %j', (v) => {
    expect(agentCompareEnabled({ AGENT_COMPARE: v })).toBe(true)
  })
  it.each(['0', 'false', 'off', 'no', ''])('is off for %j', (v) => {
    expect(agentCompareEnabled({ AGENT_COMPARE: v })).toBe(false)
  })
  it('reads process.env at call time', () => {
    const prev = process.env.AGENT_COMPARE
    try {
      process.env.AGENT_COMPARE = '1'
      expect(agentCompareEnabled()).toBe(true)
      process.env.AGENT_COMPARE = '0'
      expect(agentCompareEnabled()).toBe(false)
    } finally {
      if (prev === undefined) delete process.env.AGENT_COMPARE
      else process.env.AGENT_COMPARE = prev
    }
  })
  it('is independent of the other flags', () => {
    expect(agentCompareEnabled({ AGENT_KINDS: '1', MCP_GENERATOR: '1' })).toBe(false)
    expect(agentKindsEnabled({ AGENT_COMPARE: '1' })).toBe(false)
    expect(mcpGeneratorEnabled({ AGENT_COMPARE: '1' })).toBe(false)
  })
})
