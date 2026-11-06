// Line-delimited JSON-RPC framing over a pair of Node streams (MCP stdio framing).
// Core purity: no fs / child_process here; relative imports only.
import type { Readable, Writable } from 'node:stream'

export interface Channel {
  send(msg: unknown): void
  onMessage(cb: (m: unknown) => void): void
  onNoise(cb: (line: string) => void): void
  onClose(cb: (info: { code?: number | null; signal?: string | null }) => void): void
  close(): Promise<void>
  stderrText?(): string
  /** Optional: a line above the size cap was dropped (bytes seen so far). */
  onOversize?(cb: (bytes: number) => void): void
  /** Optional: a transport-level failure; `id` is set when it belongs to a pending request. */
  onTransportError?(cb: (info: { id?: number | string; kind: string; message: string }) => void): void
}

export const DEFAULT_MAX_LINE_BYTES = 1024 * 1024

type CloseInfo = { code?: number | null; signal?: string | null }

/** Build a Channel on a readable (server stdout) and writable (server stdin). */
export function lineChannel(
  input: Readable,
  output: Writable,
  opts: { maxLineBytes?: number; onClose?: () => Promise<void>; closeOnEnd?: boolean } = {}
): Channel & { emitClose(info?: CloseInfo): void } {
  const max = opts.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES
  const msgCbs: ((m: unknown) => void)[] = []
  const noiseCbs: ((l: string) => void)[] = []
  const closeCbs: ((i: CloseInfo) => void)[] = []
  const overCbs: ((b: number) => void)[] = []
  let buf = ''
  let discarding = false
  let closed = false

  const handleLine = (raw: string) => {
    const line = raw.trim()
    if (!line) return
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      for (const cb of noiseCbs) cb(line.slice(0, 200))
      return
    }
    for (const cb of msgCbs) cb(parsed)
  }

  input.setEncoding?.('utf8')
  input.on('data', (chunk: string | Buffer) => {
    let s = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    while (s.length) {
      const nl = s.indexOf('\n')
      if (discarding) {
        if (nl === -1) return
        discarding = false
        s = s.slice(nl + 1)
        continue
      }
      if (nl === -1) {
        buf += s
        if (buf.length > max) {
          const n = buf.length
          buf = ''
          discarding = true
          for (const cb of overCbs) cb(n)
        }
        return
      }
      const line = buf + s.slice(0, nl)
      buf = ''
      s = s.slice(nl + 1)
      if (line.length > max) {
        for (const cb of overCbs) cb(line.length)
      } else handleLine(line)
    }
  })

  const emitClose = (info: CloseInfo = {}) => {
    if (closed) return
    closed = true
    for (const cb of closeCbs) cb(info)
  }
  if (opts.closeOnEnd !== false) {
    input.on('end', () => emitClose())
    input.on('close', () => emitClose())
  }
  output.on('error', () => {})

  return {
    send(msg) {
      if (closed || output.destroyed || output.writableEnded) return
      try {
        output.write(JSON.stringify(msg) + '\n')
      } catch {
        /* a failed write surfaces as close/timeout */
      }
    },
    onMessage: (cb) => void msgCbs.push(cb),
    onNoise: (cb) => void noiseCbs.push(cb),
    onClose: (cb) => void closeCbs.push(cb),
    onOversize: (cb) => void overCbs.push(cb),
    async close() {
      try {
        output.end()
      } catch {
        /* ignore */
      }
      await opts.onClose?.()
    },
    emitClose
  }
}
