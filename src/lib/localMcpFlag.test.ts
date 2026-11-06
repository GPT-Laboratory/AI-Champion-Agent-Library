import { describe, it, expect, afterEach } from 'vitest'
import { localMcpAgentsEnabled } from './flags.js'

describe('localMcpAgentsEnabled', () => {
  const saved = process.env.LOCAL_MCP_AGENTS
  afterEach(() => {
    if (saved === undefined) delete process.env.LOCAL_MCP_AGENTS
    else process.env.LOCAL_MCP_AGENTS = saved
  })

  it('is false when unset', () => {
    expect(localMcpAgentsEnabled({})).toBe(false)
  })
  it.each(['1', 'true', 'ON', 'Yes', ' on '])('true for %j', v => {
    expect(localMcpAgentsEnabled({ LOCAL_MCP_AGENTS: v })).toBe(true)
  })
  it.each(['0', 'off', '', 'false', '2'])('false for %j', v => {
    expect(localMcpAgentsEnabled({ LOCAL_MCP_AGENTS: v })).toBe(false)
  })
  it('reads process.env at call time', () => {
    delete process.env.LOCAL_MCP_AGENTS
    expect(localMcpAgentsEnabled()).toBe(false)
    process.env.LOCAL_MCP_AGENTS = '1'
    expect(localMcpAgentsEnabled()).toBe(true)
    process.env.LOCAL_MCP_AGENTS = 'off'
    expect(localMcpAgentsEnabled()).toBe(false)
  })
})
