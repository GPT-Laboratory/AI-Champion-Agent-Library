import { describe, it, expect, afterEach } from 'vitest'
import { agentKindsEnabled } from './flags.js'

describe('agentKindsEnabled', () => {
  const saved = process.env.AGENT_KINDS
  afterEach(() => {
    if (saved === undefined) delete process.env.AGENT_KINDS
    else process.env.AGENT_KINDS = saved
  })

  it('is false when unset', () => {
    expect(agentKindsEnabled({})).toBe(false)
  })
  it.each(['1', 'true', 'ON', 'Yes'])('true for %s', v => {
    expect(agentKindsEnabled({ AGENT_KINDS: v })).toBe(true)
  })
  it.each(['0', 'off', '', 'false', '2'])('false for %j', v => {
    expect(agentKindsEnabled({ AGENT_KINDS: v })).toBe(false)
  })
  it('reads process.env at call time', () => {
    delete process.env.AGENT_KINDS
    expect(agentKindsEnabled()).toBe(false)
    process.env.AGENT_KINDS = '1'
    expect(agentKindsEnabled()).toBe(true)
    process.env.AGENT_KINDS = 'off'
    expect(agentKindsEnabled()).toBe(false)
  })
})
