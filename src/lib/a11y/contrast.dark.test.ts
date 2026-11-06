import { describe, expect, it } from 'vitest'
import { PAIRS, TOKENS } from './contrast'
import { DARK_OKLCH, DARK_PAIRS, DARK_SWAP, DARK_TOKENS, darkContrast } from './contrastDark'

describe('UI-02 dark palette meets WCAG AA', () => {
  it('covers every light pair (plus extras)', () => {
    expect(DARK_PAIRS.length).toBeGreaterThan(PAIRS.length)
    for (const p of DARK_PAIRS) {
      expect(DARK_TOKENS[p.fg], p.name).toBeDefined()
      expect(DARK_TOKENS[p.bg], p.name).toBeDefined()
    }
  })

  it.each(DARK_PAIRS)('$name meets $minRatio:1', (p) => {
    expect(darkContrast(p)).toBeGreaterThanOrEqual(p.minRatio)
  })

  it('pairs are evaluated with dark values, not the light ones', () => {
    expect(DARK_TOKENS.white).not.toBe(TOKENS.white)
    expect(DARK_TOKENS['gray-900']).toBe(TOKENS['gray-50'])
    expect(DARK_TOKENS['indigo-600']).not.toBe(TOKENS['indigo-600'])
  })

  it('swap sources all resolve to an oklch value', () => {
    for (const k of Object.keys(DARK_SWAP)) expect(DARK_OKLCH[k], k).toMatch(/^oklch\(/)
  })

  it('prints measured dark ratios for the audit', () => {
    console.log('\n' + DARK_PAIRS.map((p) => `${darkContrast(p).toFixed(2)}:1 (need ${p.minRatio}) ${p.name}`).join('\n'))
  })
})
