import { describe, expect, it } from 'vitest'
import { agentKindsEnabled, mcpGeneratorEnabled } from './flags'

describe('mcpGeneratorEnabled', () => {
  it('is off by default', () => {
    expect(mcpGeneratorEnabled({})).toBe(false)
  })
  it.each(['1', 'true', 'ON', ' yes '])('is on for %j', (v) => {
    expect(mcpGeneratorEnabled({ MCP_GENERATOR: v })).toBe(true)
  })
  it.each(['0', 'off', '', 'no'])('is off for %j', (v) => {
    expect(mcpGeneratorEnabled({ MCP_GENERATOR: v })).toBe(false)
  })
  it('does not change agentKindsEnabled', () => {
    expect(agentKindsEnabled({ MCP_GENERATOR: '1' })).toBe(false)
    expect(agentKindsEnabled({ AGENT_KINDS: 'true' })).toBe(true)
  })
})
