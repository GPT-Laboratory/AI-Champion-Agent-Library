import { describe, it, expect } from 'vitest'
import { TryItOutRuntimeError, isTryItOutRuntimeError } from './runtime'

describe('isTryItOutRuntimeError', () => {
  it('accepts the real class', () => {
    expect(isTryItOutRuntimeError(new TryItOutRuntimeError('busy', 'x'))).toBe(true)
  })

  it('accepts an error from another copy of the module (Vite dev reload keeps the old class)', () => {
    class OldCopy extends Error {
      code = 'engine_unavailable'
      constructor() {
        super('engine down')
        this.name = 'TryItOutRuntimeError'
      }
    }
    const err = new OldCopy()
    expect(err instanceof TryItOutRuntimeError).toBe(false)
    expect(isTryItOutRuntimeError(err)).toBe(true)
  })

  it('rejects ordinary errors and non-errors', () => {
    expect(isTryItOutRuntimeError(new Error('boom'))).toBe(false)
    expect(isTryItOutRuntimeError({ name: 'TryItOutRuntimeError', code: 'busy' })).toBe(false)
    expect(isTryItOutRuntimeError(undefined)).toBe(false)
  })
})
