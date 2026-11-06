import { describe, expect, it } from 'vitest'
import { formatGaps, gap, summarizeGaps } from './diagnostics'

describe('diagnostics', () => {
  it('builds gaps with clipped, control-free messages', () => {
    const g = gap('c', 'a\u0000b\n' + 'x'.repeat(400), { severity: 'error', path: 'p\tq' })
    expect(g.message.length).toBeLessThanOrEqual(303)
    expect(g.message).not.toMatch(/[\u0000-\u001f]/)
    expect(g.path).toBe('p q')
    expect(gap('c', 'm').severity).toBe('warn')
  })
  it('formats deterministically: severity, then code, then path', () => {
    const gaps = [
      gap('b', 'm', { severity: 'info' }),
      gap('z', 'm', { severity: 'error', path: 'b' }),
      gap('z', 'm', { severity: 'error', path: 'a' }),
      gap('a', 'm', { severity: 'warn' }),
    ]
    const out = formatGaps(gaps).split('\n')
    expect(out[0]).toContain('z (a)')
    expect(out[1]).toContain('z (b)')
    expect(out[2]).toContain('[warn] a')
    expect(out[3]).toContain('[info] b')
    expect(formatGaps(gaps.slice().reverse())).toBe(formatGaps(gaps))
  })
  it('summarizes counts', () => {
    expect(
      summarizeGaps([gap('a', 'm', { severity: 'error' }), gap('b', 'm'), gap('c', 'm', { severity: 'info' })]),
    ).toEqual({ errors: 1, warnings: 1, infos: 1 })
  })
})
