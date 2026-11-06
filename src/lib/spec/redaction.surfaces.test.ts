// G2 (D-440): one shared token list; every redaction surface masks ghp_/xox/AKIA/PEM-shaped
// tokens, and the word-boundary rule for "task-force" (D-340) still holds everywhere.
import { describe, it, expect } from 'vitest'
import { redactText, sanitizeMessage, INLINE_TOKEN_PATTERNS } from './security'
import { redactSecrets, publicText, publicErrorMessage } from '../server/tryitout/redact'
import { redact, redactName } from '../mcptest/core/redact'

// [token, the part that must not survive]
const SAMPLES: Record<string, [string, string]> = {
  ghp: ['ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2', 'A1b2C3d4E5f6G7h8I9j0K1l2'],
  xox: ['xoxb-' + '1234567890-abcdefghij', '1234567890-abcdefghij'],
  akia: ['AKIA' + 'ABCDEFGHIJKLMNOP', 'ABCDEFGHIJKLMNOP'],
  pem: ['-----BEGIN RSA PRIVATE KEY-----\nMIIEabc\n-----END RSA PRIVATE KEY-----', 'MIIEabc'],
}

const surfaces: Record<string, (s: string) => string> = {
  redactText,
  sanitizeMessage: (s) => sanitizeMessage(s, 1000),
  redactSecrets,
  publicText: (s) => publicText(s),
  publicErrorMessage: (s) => publicErrorMessage(new Error(s)),
  'mcptest redact': (s) => redact(s, [], 1000),
  'mcptest redactName': (s) => redactName(s, [], 1000),
}

describe('shared inline token patterns', () => {
  it('are exported', () => {
    expect(INLINE_TOKEN_PATTERNS.length).toBeGreaterThanOrEqual(6)
  })
  for (const [surface, fn] of Object.entries(surfaces)) {
    describe(surface, () => {
      for (const [kind, [token, secret]] of Object.entries(SAMPLES)) {
        it(`masks a ${kind}-shaped token`, () => {
          const out = fn(`failed with ${token} in the body`)
          expect(out).not.toContain(secret)
          expect(out).toContain('[redacted]')
        })
      }
      it('leaves task-force alone (D-340)', () => {
        expect(fn('the task-force is ready')).toBe('the task-force is ready')
      })
    })
  }
})
