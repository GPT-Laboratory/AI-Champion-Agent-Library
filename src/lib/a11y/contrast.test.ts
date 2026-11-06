import { describe, expect, it } from 'vitest'
import { PAIRS, TOKENS, contrastRatio, oklchToHex, relativeLuminance } from './contrast'

describe('contrastRatio', () => {
  it('matches reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.5)
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 5)
  })
  it('is symmetric and luminance is bounded', () => {
    expect(contrastRatio('#336699', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#336699'), 10)
    expect(relativeLuminance('#000000')).toBe(0)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5)
  })
  it('rejects bad hex', () => {
    expect(() => contrastRatio('nope', '#fff')).toThrow()
  })
})

describe('oklchToHex', () => {
  it('converts known Tailwind values', () => {
    expect(oklchToHex('oklch(100% 0 0)')).toBe('#ffffff')
    expect(oklchToHex('oklch(0% 0 0)')).toBe('#000000')
    // Tailwind indigo-600 is approximately #4f39f6
    expect(oklchToHex('oklch(51.1% 0.262 276.966)')).toBe('#4f39f6')
  })
})

describe('UI colour pairs', () => {
  const ratio = (p: (typeof PAIRS)[number]) => contrastRatio(TOKENS[p.fg], TOKENS[p.bg])

  it('references only known tokens', () => {
    for (const p of PAIRS) {
      expect(TOKENS[p.fg], p.name).toBeDefined()
      expect(TOKENS[p.bg], p.name).toBeDefined()
    }
  })

  it.each(PAIRS.filter((p) => !p.knownFailing))('$name meets $minRatio:1', (p) => {
    expect(ratio(p)).toBeGreaterThanOrEqual(p.minRatio)
  })

  // Known failures stay visible: they must really fail. When 10-02 fixes a token it
  // removes the knownFailing flag, and this test forces that cleanup.
  it.each(PAIRS.filter((p) => p.knownFailing))('KNOWN FAILING $name stays below $minRatio:1', (p) => {
    expect(ratio(p)).toBeLessThan(p.minRatio)
  })

  it('prints measured ratios for the audit', () => {
    const rows = PAIRS.map(
      (p) => `${ratio(p).toFixed(2)}:1 (need ${p.minRatio}) ${p.name}${p.knownFailing ? ' [known failing]' : ''}`,
    )
    console.log('\n' + rows.join('\n'))
  })
})
