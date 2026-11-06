// D-340 regression: the sk- key pattern must not fire inside ordinary words (task-force, risk-based).
import { describe, expect, it } from 'vitest'
import { publicErrorMessage, redactSecrets } from './redact'

describe('redactSecrets does not mangle words ending in "sk"', () => {
  it.each(['task-force', 'risk-based', 'desk-top', 'ask-me-anything'])('keeps %s', (w) => {
    expect(redactSecrets(`failed: ${w} error`)).toBe(`failed: ${w} error`)
    expect(publicErrorMessage(new Error(`bad ${w}`))).toBe(`bad ${w}`)
  })

  it('still redacts real keys at word starts and after punctuation', () => {
    expect(redactSecrets('sk-proj-ABCDEF1234')).toBe('[redacted]')
    expect(redactSecrets('key=sk-proj-ABCDEF1234,')).toBe('key=[redacted],')
    expect(redactSecrets('("sk-live-ABCDEF")')).toBe('("[redacted]")')
    expect(redactSecrets('sk-proj-****abcd')).toBe('[redacted]')
  })
})
