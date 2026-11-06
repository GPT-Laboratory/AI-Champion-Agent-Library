import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { getJobUsage } = vi.hoisted(() => ({ getJobUsage: vi.fn() }))
vi.mock('$lib/server/tryitout/llmProxy', () => ({ getJobUsage }))

import { GET } from './+server'

const ID = '123e4567-e89b-12d3-a456-426614174000'
const call = (id: string) => GET({ params: { id } } as never) as Promise<Response> | Response

async function status(id: string): Promise<number> {
  try {
    return (await call(id)).status
  } catch (e) {
    return (e as { status: number }).status
  }
}

describe('GET /api/tryitout/jobs/:id/usage', () => {
  beforeEach(() => getJobUsage.mockReset())
  afterEach(() => {
    delete process.env.TRYITOUT_USAGE_ENDPOINT
  })

  it('is 404 when the flag is off', async () => {
    getJobUsage.mockReturnValue({ jobId: ID, totalTokens: 5, requests: 1, budgetExceeded: false })
    expect(await status(ID)).toBe(404)
  })

  it('is 404 for invalid id and for unknown usage when on', async () => {
    process.env.TRYITOUT_USAGE_ENDPOINT = '1'
    expect(await status('../etc')).toBe(404)
    getJobUsage.mockReturnValue(null)
    expect(await status(ID)).toBe(404)
  })

  it('returns only counts when on', async () => {
    process.env.TRYITOUT_USAGE_ENDPOINT = '1'
    getJobUsage.mockReturnValue({ jobId: ID, totalTokens: 1234, requests: 3, budgetExceeded: false })
    const res = (await call(ID)) as Response
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      model: 'gpt-4.1-mini',
      totalTokens: 1234,
      requests: 3,
      budgetExceeded: false,
    })
  })
})
