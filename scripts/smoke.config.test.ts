import { describe, expect, it } from 'vitest'
import { CONFIGS, PROBES } from './smoke.js'

// The smoke runner itself is not run in `npm run check` (it builds); this pins its matrix shape (D-420).
describe('smoke matrix', () => {
  it('covers all-off, each of six flags alone, and all-on', () => {
    expect(CONFIGS).toHaveLength(8)
    expect(CONFIGS[0].on).toEqual([])
    expect(CONFIGS[7].on).toHaveLength(6)
  })
  it('expects flagged routes to 404 when off and not when on', () => {
    for (const label of ['compare', 'mcp-test page', 'api mcp-generate', 'api mcp-test runs']) {
      const p = PROBES.find((x) => x.label === label)!
      expect(p.status(new Set())).toBe(404)
      expect(p.status(new Set(['AGENT_COMPARE', 'MCP_TESTER', 'MCP_GENERATOR']))).not.toBe(404)
    }
  })
})
