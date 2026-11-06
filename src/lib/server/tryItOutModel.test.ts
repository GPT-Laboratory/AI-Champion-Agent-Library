import { describe, it, expect } from 'vitest'
import { MODEL, TEMPERATURE, modelParams } from './tryItOutModel'

describe('tryItOutModel', () => {
  it('MODEL is a non-empty string', () => {
    expect(typeof MODEL).toBe('string')
    expect(MODEL.length).toBeGreaterThan(0)
  })

  it('TEMPERATURE is either null or a number in [0, 0.5]', () => {
    expect(TEMPERATURE === null || typeof TEMPERATURE === 'number').toBe(true)
    if (typeof TEMPERATURE === 'number') {
      expect(TEMPERATURE).toBeGreaterThanOrEqual(0)
      expect(TEMPERATURE).toBeLessThanOrEqual(0.5)
    }
  })

  describe('modelParams', () => {
    it('omits the temperature key entirely when TEMPERATURE is null', () => {
      if (TEMPERATURE === null) {
        expect('temperature' in modelParams()).toBe(false)
      }
    })

    it('includes temperature when TEMPERATURE is a number', () => {
      if (typeof TEMPERATURE === 'number') {
        const params = modelParams()
        expect('temperature' in params).toBe(true)
        expect(params.temperature).toBe(TEMPERATURE)
      }
    })
  })
})
