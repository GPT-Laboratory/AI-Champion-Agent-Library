// The ONLY subprocess test in fake/: proves genuine stdio with a real child process.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { McpClient } from '../core/client'
import { spawnStdioChannel } from '../core/transports/stdio'
import { ENV_VARS, TOOL_NAMES } from '../mock/contract'
import { KNOWN_ITEM_ID } from '../mock/datasets'
import { withMock } from '../mock/testing'
import { CANARY, FAKE_SPEC } from './testing'

const MAIN = fileURLToPath(new URL('./fakeMain.ts', import.meta.url))

describe('fakeMain as a real subprocess', () => {
  it('speaks MCP over genuine stdio and exits after close', { timeout: 20000 }, async () => {
    // Fail clearly (no network fallback) when tsx cannot be resolved locally.
    expect(() => createRequire(import.meta.url).resolve('tsx')).not.toThrow()
    await withMock(
      FAKE_SPEC,
      async (mock) => {
        const ch = spawnStdioChannel({
          command: process.execPath,
          args: ['--import', 'tsx', MAIN, '--variant', 'good'],
          cwd: process.cwd(),
          env: { [ENV_VARS.baseUrl]: mock.url, [ENV_VARS.apiKey]: CANARY },
          allowLocalExec: true // test only
        })
        const exited = new Promise<{ code?: number | null }>((r) => ch.onClose(r))
        const client = McpClient.connect(ch, { timeoutMs: 15000 })
        try {
          const init = await client.initialize()
          expect(init.ok).toBe(true)
          const tools = await client.listTools()
          expect(tools.map((t) => t.name)).toContain(TOOL_NAMES.lookupItem)
          const o = await client.callTool(TOOL_NAMES.lookupItem, { id: KNOWN_ITEM_ID })
          expect(o.kind).toBe('result')
          if (o.kind === 'result') expect((o.structured as { item: { id: string } }).item.id).toBe(KNOWN_ITEM_ID)
          expect(client.findings).toEqual([])
        } finally {
          await client.close()
        }
        expect((await exited).code).toBe(0)
        expect(mock.hits('/items')).toBe(1)
      },
      { apiKey: CANARY }
    )
  })
})
