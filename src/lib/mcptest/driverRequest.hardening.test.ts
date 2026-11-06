// Review fix WR-10: the driver request is the trust boundary, so it rejects interpreter options and
// loader/interpreter environment variable names.
import { describe, expect, it } from 'vitest'
import { DriverRequestSchema } from './driverRequest'
import { isReservedEnvName } from './core/envNames'
import { spawnStdioChannel, StdioSpawnError } from './core/transports/stdio'
import { runCli, type CliIo } from '../../../scripts/mcp-test'

const staged = { kind: 'staged', command: 'python3', args: ['server.py'], cwd: '/work/pkg/acme', id: 'generator:openapi' }
const ok = (subject: unknown) => DriverRequestSchema.safeParse({ v: 1, subject }).success

describe('interpreter options are rejected', () => {
  it('rejects -c, -m, -e, -p, --eval and any argument starting with a dash', () => {
    for (const a of ['-c', '-m', '-e', '-p', '--eval', '--print', '-', '-W']) {
      expect(ok({ ...staged, args: [a, 'server.py'] }), a).toBe(false)
      expect(ok({ ...staged, args: ['server.py', a] }), `server.py ${a}`).toBe(false)
    }
    expect(ok({ ...staged, command: 'node', args: ['--eval', 'process.exit()'] })).toBe(false)
  })
  it('the first argument must be a script', () => {
    expect(ok({ ...staged, args: ['import os'] })).toBe(false)
    expect(ok({ ...staged, args: [] })).toBe(false)
    expect(ok({ ...staged, args: ['acme/server.py'] })).toBe(true)
    expect(ok({ ...staged, command: 'node', args: ['server.js'] })).toBe(true)
    expect(ok({ ...staged, command: 'node', args: ['server.mjs', 'x'] })).toBe(true)
  })
})

describe('reserved environment names are rejected', () => {
  const names = ['PATH', 'HOME', 'LANG', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'NODE_OPTIONS', 'PYTHONPATH', 'PYTHONSTARTUP', 'LC_ALL', 'BASH_ENV', 'TMPDIR']
  it('isReservedEnvName covers the loader and interpreter variables', () => {
    for (const n of names) expect(isReservedEnvName(n), n).toBe(true)
    for (const n of ['ACME_BASE_URL', 'ACME_API_KEY', 'ACME_DATA_PATH', 'SERVICE_URL']) expect(isReservedEnvName(n), n).toBe(false)
  })
  it('the schema rejects them in every envNames slot', () => {
    for (const n of names) {
      for (const slot of ['baseUrl', 'apiKey', 'baseUrlB']) expect(ok({ ...staged, envNames: { [slot]: n } }), `${slot}=${n}`).toBe(false)
    }
    expect(ok({ ...staged, envNames: { baseUrl: 'ACME_BASE_URL', apiKey: 'ACME_API_KEY' } })).toBe(true)
  })
  it('the stdio transport refuses a caller env that names one, without spawning', () => {
    expect(() => spawnStdioChannel({ command: process.execPath, args: ['-e', ''], env: { LD_PRELOAD: '/x' }, allowLocalExec: true })).toThrowError(StdioSpawnError)
    expect(() => spawnStdioChannel({ command: process.execPath, args: ['-e', ''], env: { PATH: '/x' }, allowLocalExec: true })).toThrowError(/reserved/)
  })
  it('the CLI refuses them for --env-base-url and --env-api-key', async () => {
    const errors: string[] = []
    const io: CliIo = {
      writeFile: async () => {},
      mkdir: async () => {},
      isDirectory: async () => false,
      log: () => {},
      error: (s) => errors.push(s),
      now: () => new Date()
    }
    for (const flag of ['--env-base-url', '--env-api-key']) {
      errors.length = 0
      expect(await runCli(['--subject', 'cmd:python3 /x/server.py', flag, 'LD_PRELOAD'], io)).toBe(2)
      expect(errors.join('\n')).toMatch(/reserved/)
    }
  })
})
