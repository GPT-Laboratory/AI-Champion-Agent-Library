// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { submitJob, subscribeProgress, downloadArtifact } from './tryItOut'
import type { JobUpdate } from './tryItOut'
import { installFakeJobApi, type InstalledFakeJobApi } from './testing/fakeJobApi'

let api: InstalledFakeJobApi | undefined

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  api?.uninstall()
  api = undefined
  vi.useRealTimers()
})

describe('submitJob', () => {
  it('POSTs multipart/form-data to /api/tryitout/jobs with agentId, task, file, and resolves to the parsed { jobId, status }', async () => {
    api = installFakeJobApi()
    const file = new File(['x'], 'sample.csv')
    const res = await submitJob('demo-rfi-triage', 'triage this', file)

    expect(res.status).toBe('queued')
    expect(typeof res.jobId).toBe('string')
    expect(res.jobId.length).toBeGreaterThan(0)

    const req = api.requests.find((r) => r.method === 'POST')!
    expect(req.url).toContain('/api/tryitout/jobs')
    expect(req.fields?.agentId).toBe('demo-rfi-triage')
    expect(req.fields?.task).toBe('triage this')
    expect(req.hasFile).toBe(true)
  })

  it('sends no file field at all when file is omitted or null', async () => {
    api = installFakeJobApi()
    await submitJob('a', 't')
    await submitJob('a', 't', null)

    expect(api.requests).toHaveLength(2)
    for (const req of api.requests) {
      expect(req.hasFile).toBe(false)
    }
  })

  it('resolves with a unique jobId across two calls', async () => {
    api = installFakeJobApi()
    const res1 = await submitJob('a', 't')
    const res2 = await submitJob('a', 't')
    expect(res1.jobId).not.toBe(res2.jobId)
  })

  it('rejects with an Error mentioning the status code when the response is not ok', async () => {
    api = installFakeJobApi({ submitStatus: 500 })
    await expect(submitJob('a', 't')).rejects.toThrow(/500/)
  })
})

describe('subscribeProgress', () => {
  it('invokes onUpdate with each polled JobUpdate, staying running while polling, then reaching succeeded', async () => {
    api = installFakeJobApi()
    const { jobId } = await submitJob('a', 'summarize the csv')

    const onUpdate = vi.fn()
    subscribeProgress(jobId, onUpdate)
    await vi.advanceTimersByTimeAsync(0) // flush the immediate first poll

    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenLastCalledWith({ status: 'running', events: [], error: null })

    await vi.advanceTimersByTimeAsync(4000)

    const last = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0] as JobUpdate
    expect(last.status).toBe('succeeded')
    expect(last.error).toBeNull()
    expect(last.events.map((e) => e.summary)).toEqual([
      'using task text as input…',
      'calling model…',
      'writing output…',
      'agent settled (clean exit)',
    ])
  })

  it('every event has a HH:MM:SS ts and type info', async () => {
    api = installFakeJobApi()
    const { jobId } = await submitJob('a', 'summarize the csv')

    const onUpdate = vi.fn()
    subscribeProgress(jobId, onUpdate)
    await vi.advanceTimersByTimeAsync(4000)

    const last = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0] as JobUpdate
    expect(last.events.length).toBeGreaterThan(0)
    for (const e of last.events) {
      expect(e.ts).toMatch(/^\d{2}:\d{2}:\d{2}$/)
      expect(e.type).toBe('info')
    }
  })

  it('delivers events progressively — after the first scheduled poll (1s) status is still running with 1 event', async () => {
    api = installFakeJobApi()
    const { jobId } = await submitJob('a', 'summarize the csv')

    const onUpdate = vi.fn()
    subscribeProgress(jobId, onUpdate)
    await vi.advanceTimersByTimeAsync(1000)

    const last = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0] as JobUpdate
    expect(last.status).toBe('running')
    expect(last.events).toHaveLength(1)
  })

  describe('fail path — exact contract regex /(^|\\W)fail(\\W|$)/i', () => {
    const mustFail = ['fail', 'please fail now', 'FAIL', 'do not fail.', '(fail)']
    const mustSucceed = ['failure', 'failing', 'hardfailover', 'summarize the csv']

    it.each(mustFail)('task "%s" ends in failed with a real error message', async (task) => {
      api = installFakeJobApi()
      const { jobId } = await submitJob('a', task)

      const onUpdate = vi.fn()
      subscribeProgress(jobId, onUpdate)
      await vi.advanceTimersByTimeAsync(4000)

      const last = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0] as JobUpdate
      expect(last.status).toBe('failed')
      expect(last.error).toBe('model returned no output text')
      expect(last.events.map((e) => e.summary)).toEqual([
        'using task text as input…',
        'calling model…',
        'agent failed',
      ])
    })

    it.each(mustSucceed)('task "%s" ends in succeeded', async (task) => {
      api = installFakeJobApi()
      const { jobId } = await submitJob('a', task)

      const onUpdate = vi.fn()
      subscribeProgress(jobId, onUpdate)
      await vi.advanceTimersByTimeAsync(4000)

      const last = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0] as JobUpdate
      expect(last.status).toBe('succeeded')
    })
  })

  it('unsubscribe stops further updates and clears all pending timers', async () => {
    api = installFakeJobApi()
    const { jobId } = await submitJob('a', 'summarize the csv')

    const onUpdate = vi.fn()
    const unsubscribe = subscribeProgress(jobId, onUpdate)
    await vi.advanceTimersByTimeAsync(1000)

    const callCountBefore = onUpdate.mock.calls.length
    unsubscribe()
    expect(vi.getTimerCount()).toBe(0)

    await vi.advanceTimersByTimeAsync(5000)
    expect(onUpdate.mock.calls.length).toBe(callCountBefore)
    expect(
      onUpdate.mock.calls.some(
        (c) => (c[0] as JobUpdate).status === 'succeeded' || (c[0] as JobUpdate).status === 'failed'
      )
    ).toBe(false)
  })

  it('calling unsubscribe while a poll request is in flight causes no onUpdate call when that request resolves', async () => {
    api = installFakeJobApi()
    const { jobId } = await submitJob('a', 'summarize the csv')

    const onUpdate = vi.fn()
    const unsubscribe = subscribeProgress(jobId, onUpdate)
    await vi.advanceTimersByTimeAsync(1000)
    const callsBeforeUnsub = onUpdate.mock.calls.length

    unsubscribe()
    await vi.advanceTimersByTimeAsync(5000)

    expect(onUpdate.mock.calls.length).toBe(callsBeforeUnsub)
  })

  it('a 404 from the status route yields exactly one onUpdate({status:failed,...}) and stops polling', async () => {
    api = installFakeJobApi({ statusPollNotFound: true })

    const onUpdate = vi.fn()
    subscribeProgress('some-job-id', onUpdate)
    await vi.advanceTimersByTimeAsync(0)

    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith({
      status: 'failed',
      events: [],
      error: 'unknown job: some-job-id',
    })

    await vi.advanceTimersByTimeAsync(5000)
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a non-404 non-ok poll response yields a failed update mentioning the status and stops polling', async () => {
    api = installFakeJobApi({ statusPollStatus: 500 })

    const onUpdate = vi.fn()
    subscribeProgress('some-job-id', onUpdate)
    await vi.advanceTimersByTimeAsync(0)

    expect(onUpdate).toHaveBeenCalledTimes(1)
    const call = onUpdate.mock.calls[0][0] as JobUpdate
    expect(call.status).toBe('failed')
    expect(call.error).toMatch(/500/)

    await vi.advanceTimersByTimeAsync(5000)
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })
})

describe('downloadArtifact', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:mock')
    URL.revokeObjectURL = vi.fn()
  })

  it('GETs the artifact, converts to a Blob, triggers a download, and revokes the object URL exactly once', async () => {
    api = installFakeJobApi()
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const { jobId } = await submitJob('demo-rfi-triage', 'summarize the csv')
    await downloadArtifact(jobId)

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob
    expect(blob.type).toBe('text/plain;charset=utf-8')

    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock')
    expect(document.body.querySelector('a')).toBeNull()

    const req = api.requests.find((r) => r.url.endsWith(`/${jobId}/artifact`))
    expect(req).toBeDefined()

    clickSpy.mockRestore()
  })

  it('sets a sanitized download filename matching aic-job-<id>.zip', async () => {
    api = installFakeJobApi()
    let capturedDownload: string | null = null
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        capturedDownload = this.download
      })

    const { jobId } = await submitJob('a', 'summarize the csv')
    await downloadArtifact(jobId)

    expect(capturedDownload).toMatch(/^aic-job-[A-Za-z0-9._-]+\.zip$/)

    clickSpy.mockRestore()
  })

  it('rejects with an Error mentioning the status code on a non-ok response', async () => {
    api = installFakeJobApi({ artifactStatus: 404 })
    await expect(downloadArtifact('nope')).rejects.toThrow(/404/)
  })
})

describe('unknown job handling', () => {
  it('subscribeProgress emits failed for an unknown job (404) and returns a working unsubscribe', async () => {
    api = installFakeJobApi({ statusPollNotFound: true })
    const onUpdate = vi.fn()
    const unsubscribe = subscribeProgress('nope', onUpdate)
    await vi.advanceTimersByTimeAsync(0)

    expect(onUpdate).toHaveBeenCalledWith({ status: 'failed', events: [], error: 'unknown job: nope' })
    expect(() => unsubscribe()).not.toThrow()
  })

  it('downloadArtifact rejects for an unknown jobId (404)', async () => {
    api = installFakeJobApi({ artifactStatus: 404 })
    await expect(downloadArtifact('nope')).rejects.toThrow(/404/)
  })
})
