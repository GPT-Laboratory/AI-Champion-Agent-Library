import { describe, expect, it } from 'vitest'
import { agentKindsEnabled, mcpGeneratorEnabled, mcpTesterEnabled } from './flags'

describe('mcpTesterEnabled', () => {
  it('is off by default', () => {
    expect(mcpTesterEnabled({})).toBe(false)
    expect(mcpTesterEnabled({ MCP_TESTER: undefined })).toBe(false)
  })
  it.each(['1', 'true', 'TRUE', ' on ', 'yes'])('is on for %j', (v) => {
    expect(mcpTesterEnabled({ MCP_TESTER: v })).toBe(true)
  })
  it.each(['0', 'false', 'off', 'no', ''])('is off for %j', (v) => {
    expect(mcpTesterEnabled({ MCP_TESTER: v })).toBe(false)
  })
  it('reads process.env at call time', () => {
    const prev = process.env.MCP_TESTER
    try {
      process.env.MCP_TESTER = '1'
      expect(mcpTesterEnabled()).toBe(true)
      process.env.MCP_TESTER = '0'
      expect(mcpTesterEnabled()).toBe(false)
    } finally {
      if (prev === undefined) delete process.env.MCP_TESTER
      else process.env.MCP_TESTER = prev
    }
  })
  it('is independent of the other flags', () => {
    expect(mcpTesterEnabled({ MCP_GENERATOR: '1', AGENT_KINDS: '1' })).toBe(false)
    expect(mcpGeneratorEnabled({ MCP_TESTER: '1' })).toBe(false)
    expect(agentKindsEnabled({ MCP_TESTER: '1' })).toBe(false)
  })
})
