// GET /api/tryitout/jobs/:id/check: the tool check of a succeeded job, for the badge (docs/tryitout-post-run-check.md).
import { beforeEach, describe, expect, it } from 'vitest'
import { GET } from './+server'
import { __resetJobs, createJob, setCheck, setStatus } from '$lib/server/tryItOutJobs'

type Ev = Parameters<typeof GET>[0]
const call = async (id: string) => {
  try {
    const res = (await GET({ params: { id } } as unknown as Ev)) as Response
    return { status: res.status, body: await res.json() }
  } catch (e) {
    const err = e as { status: number; body: { message: string } }
    return { status: err.status, body: err.body }
  }
}

beforeEach(() => __resetJobs())

describe('GET /api/tryitout/jobs/:id/check', () => {
  it('a malformed or unknown id is 404', async () => {
    expect((await call('../etc')).status).toBe(404)
    expect((await call('00000000-0000-4000-8000-000000000000')).status).toBe(404)
  })

  it('a job that has not succeeded is 409', async () => {
    const job = createJob('ifc-ebom-compiler', 't', null)
    expect((await call(job.jobId)).status).toBe(409)
  })

  it('a succeeded job without a check gives check: null', async () => {
    const job = createJob('demo-rfi-triage', 't', null)
    setStatus(job.jobId, 'succeeded')
    expect(await call(job.jobId)).toEqual({ status: 200, body: { check: null } })
  })

  it('a succeeded job gives exactly the three check fields', async () => {
    const job = createJob('ifc-ebom-compiler', 't', null)
    setCheck(job.jobId, { status: 'match', summary: 'all good', file: 'ebom-join-check.md', extra: 'x' } as never)
    setStatus(job.jobId, 'succeeded')
    expect(await call(job.jobId)).toEqual({ status: 200, body: { check: { status: 'match', summary: 'all good', file: 'ebom-join-check.md' } } })
  })
})
