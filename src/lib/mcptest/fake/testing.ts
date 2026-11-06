// Test helpers for the fake runtime: a fake served over PassThrough pairs against a fresh mock.
import { PassThrough } from 'node:stream'
import { McpClient } from '../core/client'
import { lineChannel } from '../core/jsonrpc'
import { ENV_VARS } from '../mock/contract'
import type { MockHandle, UpstreamSpecInput } from '../mock/spec'
import { withMock } from '../mock/testing'
import { serveStdio } from './fakeServer'

export const CANARY = 'canary-not-a-real-key'
export const ALL_DATASETS = ['catalog', 'bulk', 'codes', 'docs', 'components', 'products'] as const
export const FAKE_SPEC: UpstreamSpecInput = {
  datasets: [...ALL_DATASETS],
  auth: { header: 'X-Api-Key', mode: '401' }
}
const noSleep = async () => {}

/** Local 6-line copy of the 3-of-4 envelope rule; core/leak.ts owns the canonical one. */
export const envelopeLeak = (t: string) =>
  ['timestamp', 'status', 'error', 'path'].filter((w) => t.toLowerCase().includes(w)).length >= 3

export async function withFake<T>(
  variant: string,
  fn: (c: McpClient, mock: MockHandle, stderr: string[]) => Promise<T>,
  opts: { key?: string; mockKey?: string; spec?: UpstreamSpecInput } = {}
): Promise<T> {
  return withMock(
    opts.spec ?? FAKE_SPEC,
    async (mock) => {
      const toServer = new PassThrough()
      const fromServer = new PassThrough()
      const stderr: string[] = []
      const served = serveStdio(toServer, fromServer, {
        variant,
        env: { [ENV_VARS.baseUrl]: mock.url, [ENV_VARS.baseUrlB]: mock.url, [ENV_VARS.apiKey]: opts.key ?? CANARY },
        sleep: noSleep,
        stderr: { write: (s: string) => stderr.push(s) }
      })
      const client = McpClient.connect(lineChannel(fromServer, toServer), { timeoutMs: 8000 })
      try {
        const init = await client.initialize()
        if (!init.ok) throw new Error(`initialize failed: ${init.reason}`)
        await client.listTools()
        return await fn(client, mock, stderr)
      } finally {
        await client.close()
        await served
      }
    },
    { apiKey: opts.mockKey ?? CANARY }
  )
}
