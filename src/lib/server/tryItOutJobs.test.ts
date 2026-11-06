import { describe, it, expect, beforeEach } from 'vitest'
import {
  createJob,
  getJob,
  pushEvent,
  setStatus,
  isValidJobId,
  workDir,
  inputDir,
  outputDir,
  inputFilePath,
  outputFilePath,
  artifactZipPath,
  __resetJobs,
} from './tryItOutJobs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

beforeEach(() => {
  __resetJobs()
})

describe('createJob', () => {
  it('returns a record with a UUID jobId, queued status, empty events, null error', () => {
    const job = createJob('demo-rfi-triage', 'triage this', null)
    expect(job.jobId).toMatch(UUID_RE)
    expect(job.status).toBe('queued')
    expect(job.events).toEqual([])
    expect(job.error).toBeNull()
  })

  it('returns different jobIds across two calls', () => {
    const a = createJob('demo-rfi-triage', 'a', null)
    const b = createJob('demo-rfi-triage', 'b', null)
    expect(a.jobId).not.toBe(b.jobId)
  })
})

describe('getJob', () => {
  it('returns undefined for an unknown id and does not throw', () => {
    expect(() => getJob('00000000-0000-0000-0000-000000000000')).not.toThrow()
    expect(getJob('00000000-0000-0000-0000-000000000000')).toBeUndefined()
  })
})

describe('pushEvent', () => {
  it('appends one info event with a HH:MM:SS ts and no tool field', () => {
    const job = createJob('demo-rfi-triage', 'task', null)
    pushEvent(job.jobId, 'reading input…')
    const updated = getJob(job.jobId)!
    expect(updated.events).toHaveLength(1)
    expect(updated.events[0].type).toBe('info')
    expect(updated.events[0].summary).toBe('reading input…')
    expect(updated.events[0].ts).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    expect(updated.events[0].tool).toBeUndefined()
  })

  it('is a silent no-op on an unknown jobId', () => {
    expect(() => pushEvent('00000000-0000-0000-0000-000000000000', 'x')).not.toThrow()
  })
})

describe('setStatus', () => {
  it('sets status and error together', () => {
    const job = createJob('demo-rfi-triage', 'task', null)
    setStatus(job.jobId, 'failed', 'boom')
    const updated = getJob(job.jobId)!
    expect(updated.status).toBe('failed')
    expect(updated.error).toBe('boom')
  })

  it('resets error to null on a subsequent succeeded call', () => {
    const job = createJob('demo-rfi-triage', 'task', null)
    setStatus(job.jobId, 'failed', 'boom')
    setStatus(job.jobId, 'succeeded')
    const updated = getJob(job.jobId)!
    expect(updated.status).toBe('succeeded')
    expect(updated.error).toBeNull()
  })

  it('is a silent no-op on an unknown jobId', () => {
    expect(() => setStatus('00000000-0000-0000-0000-000000000000', 'failed', 'x')).not.toThrow()
  })
})

describe('isValidJobId', () => {
  it('accepts a randomUUID() output', () => {
    const job = createJob('demo-rfi-triage', 'task', null)
    expect(isValidJobId(job.jobId)).toBe(true)
  })

  it('rejects traversal-shaped and malformed input', () => {
    expect(isValidJobId('../etc')).toBe(false)
    expect(isValidJobId('')).toBe(false)
    expect(isValidJobId('abc')).toBe(false)
    expect(isValidJobId('00000000-0000-0000-0000-000000000000/x')).toBe(false)
  })
})

describe('path helpers', () => {
  it('throw for an invalid jobId', () => {
    expect(() => workDir('../etc')).toThrow()
    expect(() => inputDir('../etc')).toThrow()
    expect(() => outputDir('../etc')).toThrow()
    expect(() => inputFilePath('../etc')).toThrow()
    expect(() => outputFilePath('../etc')).toThrow()
  })

  it('never return a path containing ".."', () => {
    const job = createJob('demo-rfi-triage', 'task', null)
    expect(workDir(job.jobId)).not.toMatch(/\.\./)
    expect(inputDir(job.jobId)).not.toMatch(/\.\./)
    expect(outputDir(job.jobId)).not.toMatch(/\.\./)
    expect(inputFilePath(job.jobId)).not.toMatch(/\.\./)
    expect(outputFilePath(job.jobId)).not.toMatch(/\.\./)
  })

  it('workDir is under .tryitout-work; input/output file paths end correctly', () => {
    const job = createJob('demo-rfi-triage', 'task', null)
    expect(workDir(job.jobId)).toMatch(/\.tryitout-work[\\/]/)
    expect(inputFilePath(job.jobId).replace(/\\/g, '/')).toMatch(/input\/input\.txt$/)
    expect(outputFilePath(job.jobId).replace(/\\/g, '/')).toMatch(/output\/result\.txt$/)
  })

  it('two different jobIds produce non-overlapping workDir paths (A-1 concurrency isolation)', () => {
    const a = createJob('demo-rfi-triage', 'a', null)
    const b = createJob('demo-rfi-triage', 'b', null)
    expect(workDir(a.jobId)).not.toBe(workDir(b.jobId))
  })
})

describe('Phase 8 additions', () => {
  it('pushEvent defaults to info with no tool key; typed events carry tool', () => {
    const job = createJob('a', 't', null)
    pushEvent(job.jobId, 'x')
    pushEvent(job.jobId, 'read a', 'tool_start', 'read')
    const [e1, e2] = getJob(job.jobId)!.events
    expect(e1).toMatchObject({ type: 'info', summary: 'x' })
    expect('tool' in e1).toBe(false)
    expect(e2).toMatchObject({ type: 'tool_start', tool: 'read', summary: 'read a' })
  })

  it('createJob records an optional sessionKey (default null)', () => {
    expect(createJob('a', 't', null).sessionKey).toBeNull()
    expect(createJob('a', 't', null, 'anon:abc').sessionKey).toBe('anon:abc')
  })

  it('artifactZipPath ends in artifact.zip and rejects invalid ids', () => {
    const job = createJob('a', 't', null)
    expect(artifactZipPath(job.jobId).replace(/\\/g, '/')).toMatch(/\/artifact\.zip$/)
    expect(() => artifactZipPath('../x')).toThrow(/invalid jobId/)
  })
})
