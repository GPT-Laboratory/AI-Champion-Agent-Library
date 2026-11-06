// CR-33: the invariants_hold check must flag the real hazards and nothing in a clean generated server.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { serverInvariantProblems } from './proposalEval'

const dir = fileURLToPath(new URL('../mcpgen/__golden__/', import.meta.url))

describe('serverInvariantProblems (CR-33)', () => {
  const goldens = readdirSync(dir).filter((f) => f.endsWith('.server.py'))
  it('has golden servers to scan', () => expect(goldens.length).toBeGreaterThan(5))
  for (const f of goldens) {
    it(`reports nothing for the clean golden ${f}`, () => {
      expect(serverInvariantProblems(readFileSync(dir + f, 'utf8'))).toEqual([])
    })
  }
  it('does not read len(str(email)) as raw exception text', () => {
    expect(serverInvariantProblems('import json\nx = len(str(email)) + len(str(end)) + len(str(entity))\n')).toEqual([])
  })
  it('still flags the real hazards', () => {
    expect(serverInvariantProblems('import json\nreturn str(e)\n')).toContain('raw exception text')
    expect(serverInvariantProblems('import json\nreturn str(exc)\n')).toContain('raw exception text')
    expect(serverInvariantProblems('import json\nx = eval(y)\n').join()).toContain('dynamic code')
    expect(serverInvariantProblems('import json\nx = compile(y, "a", "exec")\n').join()).toContain('dynamic code')
    expect(serverInvariantProblems('import subprocess\n')).toContain('unexpected import')
  })
})
