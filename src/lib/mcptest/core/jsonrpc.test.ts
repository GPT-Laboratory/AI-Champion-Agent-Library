import { describe, it, expect } from 'vitest'
import { PassThrough } from 'node:stream'
import { lineChannel } from './jsonrpc'

function setup(maxLineBytes?: number) {
  const fromServer = new PassThrough()
  const toServer = new PassThrough()
  const ch = lineChannel(fromServer, toServer, { maxLineBytes })
  const msgs: unknown[] = []
  const noise: string[] = []
  const over: number[] = []
  ch.onMessage((m) => msgs.push(m))
  ch.onNoise((l) => noise.push(l))
  ch.onOversize?.((n) => over.push(n))
  return { fromServer, toServer, ch, msgs, noise, over }
}
const tick = () => new Promise((r) => setTimeout(r, 10))

describe('lineChannel', () => {
  it('reassembles partial chunks and splits multi-message chunks', async () => {
    const { fromServer, msgs } = setup()
    fromServer.write('{"a":')
    fromServer.write('1}\n{"b":2}\n{"c"')
    fromServer.write(':3}\n')
    await tick()
    expect(msgs).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }])
  })

  it('routes non-JSON lines to noise, truncated to 200 chars', async () => {
    const { fromServer, msgs, noise } = setup()
    fromServer.write('hello world\n' + 'x'.repeat(500) + '\n{"ok":true}\n')
    await tick()
    expect(msgs).toEqual([{ ok: true }])
    expect(noise[0]).toBe('hello world')
    expect(noise[1]).toHaveLength(200)
  })

  it('drops oversize lines without buffering them unbounded', async () => {
    const { fromServer, msgs, over } = setup(100)
    fromServer.write('x'.repeat(150)) // no newline yet: dropped as oversize
    fromServer.write('y'.repeat(150) + '\n{"ok":1}\n')
    await tick()
    expect(over.length).toBe(1)
    expect(msgs).toEqual([{ ok: 1 }])
  })

  it('reports an oversize line that arrives complete in one chunk', async () => {
    const { fromServer, msgs, over } = setup(100)
    fromServer.write(JSON.stringify({ big: 'z'.repeat(300) }) + '\n{"ok":1}\n')
    await tick()
    expect(over.length).toBe(1)
    expect(msgs).toEqual([{ ok: 1 }])
  })

  it('send writes JSON plus newline', async () => {
    const { toServer, ch } = setup()
    const chunks: string[] = []
    toServer.on('data', (c) => chunks.push(String(c)))
    ch.send({ hi: 1 })
    await tick()
    expect(chunks.join('')).toBe('{"hi":1}\n')
  })

  it('fires onClose when the input ends', async () => {
    const { fromServer, ch } = setup()
    let closed = false
    ch.onClose(() => (closed = true))
    fromServer.end()
    await tick()
    expect(closed).toBe(true)
  })
})
