// Review 23 regression tests for plan.ts (plan.test.ts stays unmodified, see criteria.test.ts).
import { describe, expect, it } from 'vitest'
import { buildPlan } from './plan'
import { acmeHttp } from './testing/sample-models'

describe('projection override with no valid field (CR-41)', () => {
  it('falls back to the default projection and keeps the warning', () => {
    const base = buildPlan(acmeHttp, {})
    const p = buildPlan(acmeHttp, { projectionOverride: { product: ['nope'] } })
    expect(p.tools[0].projection.length).toBeGreaterThan(0)
    expect(p.tools[0].projection).toEqual(base.tools[0].projection)
    expect(p.gaps.map((g) => g.code)).toContain('projection-unknown-field')
  })
})

describe('unusable API key name (CR-08)', () => {
  const withName = (paramName: string) => ({ ...acmeHttp, auth: { ...acmeHttp.auth, paramName } })
  it('reports it and falls back to the default name', () => {
    const p = buildPlan(withName('x-api-key:v2'), {})
    expect(p.gaps.map((g) => g.code)).toContain('auth-name-invalid')
  })
  it('is silent for a valid name', () => {
    expect(buildPlan(withName('X-Api-Key'), {}).gaps.map((g) => g.code)).not.toContain('auth-name-invalid')
  })
})
