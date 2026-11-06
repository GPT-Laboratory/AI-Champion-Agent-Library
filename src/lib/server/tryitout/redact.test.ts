import { describe, expect, it } from 'vitest'
import { publicErrorMessage, publicText, redactSecrets } from './redact'
import { TryItOutRuntimeError } from './runtime'

describe('redactSecrets', () => {
  it('masks sk- keys, masked keys and bearer tokens', () => {
    expect(redactSecrets('key sk-proj-****abcd and sk-abcdef123456')).not.toContain('sk-')
    expect(redactSecrets('Authorization: Bearer abcdefgh12345678')).not.toContain('abcdefgh12345678')
  })
  it('leaves ordinary text alone', () => {
    expect(redactSecrets('disk full')).toBe('disk full')
  })
})

describe('publicErrorMessage', () => {
  it('hides engine detail behind fixed strings', () => {
    const detail = 'not reachable at /run/user/1000/podman.sock; podman build -t pi-runner'
    expect(publicErrorMessage(new TryItOutRuntimeError('engine_unavailable', detail))).toBe('container engine unavailable')
    expect(publicErrorMessage(new TryItOutRuntimeError('container_start_failed', detail))).toBe('container engine error')
    expect(publicErrorMessage(new TryItOutRuntimeError('exec_failed', detail))).toBe('container engine error')
    expect(publicErrorMessage(new TryItOutRuntimeError('output_invalid', 'unsafe output path: ../x'))).toBe(
      'container output was invalid',
    )
  })
  it('keeps the safe fixed messages', () => {
    expect(publicErrorMessage(new TryItOutRuntimeError('session_busy', 'a job is already running in your session'))).toBe(
      'a job is already running in your session',
    )
    expect(publicErrorMessage(new TryItOutRuntimeError('output_invalid', 'output exceeds 3 files'))).toBe('output exceeds 3 files')
  })
  it('redacts and bounds plain errors', () => {
    expect(publicErrorMessage(new Error('Incorrect API key sk-proj-****abcd'))).not.toContain('sk-')
    expect(publicText('x'.repeat(500)).length).toBe(200)
  })
})
