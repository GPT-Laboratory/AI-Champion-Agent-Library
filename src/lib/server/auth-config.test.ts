import { describe, expect, it } from 'vitest'
import { parseAuthenticationEnabled } from './auth-config'

describe('parseAuthenticationEnabled', () => {
  it('enables authentication when the setting is missing', () => {
    expect(parseAuthenticationEnabled(undefined)).toBe(true)
  })

  it('disables authentication only when explicitly set to false', () => {
    expect(parseAuthenticationEnabled('false')).toBe(false)
    expect(parseAuthenticationEnabled(' FALSE ')).toBe(false)
    expect(parseAuthenticationEnabled('true')).toBe(true)
    expect(parseAuthenticationEnabled('')).toBe(true)
  })
})
