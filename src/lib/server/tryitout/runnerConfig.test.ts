import { describe, it, expect } from 'vitest'
import { parseRunnerConfig } from './runnerConfig'

describe('parseRunnerConfig', () => {
  it('returns documented defaults for an empty env', () => {
    expect(parseRunnerConfig({})).toEqual({
      enabled: true,
      image: 'localhost/pi-runner:latest',
      socketPath: '/run/podman/podman.sock',
      network: 'aic-pi-internal',
      allowOpenEgress: false,
      proxyUrl: 'http://aic-agent-library:3000/api/llm/v1',
      maxContainers: 5,
      idleTtlMs: 300000,
      minIdleMs: 60000,
      warmWaitMs: 90000,
      jobTimeoutMs: 300000,
      memoryMb: 1024,
      cpus: 0.5,
      pids: 200,
      workTmpfsMb: 256,
      tmpTmpfsMb: 64,
      agentTmpfsMb: 16,
      fsMode: 'tmpfs',
      tools: ['read', 'write', 'edit', 'grep', 'find', 'ls'],
      fallbackEnabled: true,
      jobTokenBudget: 100000,
      jobRequestBudget: 40,
      maxOutputBytes: 20971520,
      maxOutputFiles: 200,
      anonSessionsPerClient: 5,
    })
  })

  it('parses the per-client anonymous session cap, 0 meaning unlimited', () => {
    expect(parseRunnerConfig({ PI_RUNNER_ANON_SESSIONS_PER_CLIENT: '2' }).anonSessionsPerClient).toBe(2)
    expect(parseRunnerConfig({ PI_RUNNER_ANON_SESSIONS_PER_CLIENT: '0' }).anonSessionsPerClient).toBe(0)
    expect(() => parseRunnerConfig({ PI_RUNNER_ANON_SESSIONS_PER_CLIENT: '-1' })).toThrow()
  })

  it('derives the socket path from XDG_RUNTIME_DIR and lets PI_RUNNER_SOCKET win', () => {
    expect(parseRunnerConfig({ XDG_RUNTIME_DIR: '/run/user/1000' }).socketPath).toBe(
      '/run/user/1000/podman/podman.sock',
    )
    expect(
      parseRunnerConfig({ XDG_RUNTIME_DIR: '/run/user/1000', PI_RUNNER_SOCKET: '/x/y.sock' }).socketPath,
    ).toBe('/x/y.sock')
  })

  it('rejects invalid numbers naming the variable', () => {
    expect(() => parseRunnerConfig({ PI_RUNNER_MAX_CONTAINERS: 'abc' })).toThrow(/PI_RUNNER_MAX_CONTAINERS/)
    expect(() => parseRunnerConfig({ PI_RUNNER_MAX_CONTAINERS: '0' })).toThrow(/PI_RUNNER_MAX_CONTAINERS/)
    expect(() => parseRunnerConfig({ PI_RUNNER_MAX_CONTAINERS: '51' })).toThrow(/PI_RUNNER_MAX_CONTAINERS/)
  })

  it('rejects unknown tools and bad fs mode', () => {
    expect(() => parseRunnerConfig({ PI_RUNNER_TOOLS: 'read,rm' })).toThrow(/PI_RUNNER_TOOLS/)
    expect(() => parseRunnerConfig({ PI_RUNNER_FS_MODE: 'other' })).toThrow(/PI_RUNNER_FS_MODE/)
    expect(parseRunnerConfig({ PI_RUNNER_TOOLS: ' read , bash ' }).tools).toEqual(['read', 'bash'])
    expect(parseRunnerConfig({ PI_RUNNER_FS_MODE: 'layer' }).fsMode).toBe('layer')
  })

  it('only the literal false disables fallback and runner', () => {
    expect(parseRunnerConfig({ PI_FALLBACK_ENABLED: 'false' }).fallbackEnabled).toBe(false)
    expect(parseRunnerConfig({ PI_FALLBACK_ENABLED: 'FALSE' }).fallbackEnabled).toBe(false)
    expect(parseRunnerConfig({ PI_FALLBACK_ENABLED: '0' }).fallbackEnabled).toBe(true)
    expect(parseRunnerConfig({ PI_RUNNER_ENABLED: 'false' }).enabled).toBe(false)
  })

  it('only the literal true enables open egress', () => {
    expect(parseRunnerConfig({ PI_RUNNER_ALLOW_OPEN_EGRESS: 'true' }).allowOpenEgress).toBe(true)
    expect(parseRunnerConfig({ PI_RUNNER_ALLOW_OPEN_EGRESS: '1' }).allowOpenEgress).toBe(false)
  })
})
