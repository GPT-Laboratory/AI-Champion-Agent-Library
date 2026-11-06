import { describe, it, expect, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { McpClient } from '../client'
import { spawnStdioChannel, StdioSpawnError } from './stdio'

const stub = fileURLToPath(new URL('../testing/stubServer.mjs', import.meta.url))
const spawnStub = (flags: string[] = [], extra: Record<string, unknown> = {}) =>
  spawnStdioChannel({
    command: process.execPath,
    args: [stub, ...flags],
    allowLocalExec: true,
    graceMs: 150,
    ...extra
  })

const clients: McpClient[] = []
const mk = (flags: string[] = [], extra: Record<string, unknown> = {}, timeoutMs = 3000) => {
  const c = McpClient.connect(spawnStub(flags, extra), { timeoutMs })
  clients.push(c)
  return c
}
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()))
  delete process.env.AIC_SENTINEL_SECRET
})

describe('spawnStdioChannel', () => {
  it('refuses without allowLocalExec and spawns nothing', () => {
    let err: unknown
    try {
      spawnStdioChannel({ command: process.execPath, args: ['-e', 'process.exit(0)'] })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(StdioSpawnError)
    expect((err as StdioSpawnError).code).toBe('exec-not-allowed')
  })

  it('scrubs the environment: sentinel not visible, caller vars and fresh HOME are', async () => {
    process.env.AIC_SENTINEL_SECRET = 'do-not-leak'
    const c = mk([], { env: { CALLER_VAR: 'x' } })
    expect((await c.initialize()).ok).toBe(true)
    await c.listTools()
    const o = await c.callTool('echo_env_keys', {})
    expect(o.kind).toBe('result')
    const keys = o.kind === 'result' ? o.text.split(',') : []
    expect(keys).not.toContain('AIC_SENTINEL_SECRET')
    expect(keys).toEqual(expect.arrayContaining(['PATH', 'HOME', 'CALLER_VAR']))
    const allowed = new Set(['PATH', 'LANG', 'HOME', 'CALLER_VAR'])
    // the runtime may add its own internal vars; none of the parent's other vars may appear
    const parentOnly = Object.keys(process.env).filter((k) => !allowed.has(k) && keys.includes(k))
    expect(parentOnly).toEqual([])
  })

  it('captures stderr and surfaces stdout noise as findings', async () => {
    const c = mk(['noise'])
    await c.initialize()
    await new Promise((r) => setTimeout(r, 50))
    expect(c.stderrText()).toContain('stub: ready')
    expect(c.findings.map((f) => f.kind)).toContain('stdout_noise')
    expect(c.findings.map((f) => f.kind)).not.toContain('early_exit')
  })

  it('an early exit yields closed init and early_exit', async () => {
    const c = mk(['exit-early'])
    const r = await c.initialize()
    expect(r).toMatchObject({ ok: false, kind: 'closed' })
    expect(c.findings.map((f) => f.kind)).toContain('early_exit')
  })

  it('close() terminates a hung child quickly and removes the temp HOME', async () => {
    const before = readdirSync(tmpdir()).filter((n) => n.startsWith('aic-mcp-home-')).length
    const c = mk(['hang'], {}, 100)
    expect(await c.initialize()).toMatchObject({ ok: false, kind: 'timeout' })
    const t0 = Date.now()
    await c.close()
    expect(Date.now() - t0).toBeLessThan(3000)
    const after = readdirSync(tmpdir()).filter((n) => n.startsWith('aic-mcp-home-')).length
    expect(after).toBeLessThanOrEqual(before)
  })

  it('escalates to SIGKILL when the child ignores SIGTERM', async () => {
    const c = mk(['stubborn'], {}, 100)
    await c.initialize()
    const t0 = Date.now()
    await c.close()
    expect(Date.now() - t0).toBeLessThan(3000)
  })
})
