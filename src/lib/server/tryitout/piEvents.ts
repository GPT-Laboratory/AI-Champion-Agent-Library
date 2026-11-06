// src/lib/server/tryitout/piEvents.ts
// Server-only. Pure helpers for `pi --mode json` output:
//   - createJsonlParser: LF-only JSONL framing (never node:line-reader; Unicode
//     line separators are legal inside JSON strings)
//   - createPiEventMapper: Pi events -> the frozen JobEvent feed (no ts; the
//     job store stamps it)
//   - createCompletionTracker: D-16 success rule (exit 0 + settled + no model
//     error), never keyed off the intermediate end-of-run event
// Every function is total: malformed input never throws.

import { StringDecoder } from 'node:string_decoder'
import type { JobEvent } from '../../tryItOut'
import { publicText } from './redact'

export const MAX_SUMMARY_CHARS = 120

export type MappedJobEvent = { type: JobEvent['type']; tool?: string; summary: string }
export type CompletionVerdict = { ok: true } | { ok: false; error: string }

type Rec = Record<string, unknown>

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

/** IN-05: longest JSONL line kept in memory; longer lines are dropped up to the next newline. */
export const MAX_JSONL_LINE_CHARS = 1024 * 1024

export function createJsonlParser(onRecord: (r: unknown) => void): {
  push(chunk: Buffer): void
  end(): void
  /** Number of over-long lines dropped so far. */
  dropped(): number
  /** Characters currently buffered (always <= MAX_JSONL_LINE_CHARS). */
  bufferedChars(): number
} {
  const dec = new StringDecoder('utf8')
  let buf = ''
  let discarding = false
  let droppedLines = 0
  const emit = (line: string) => {
    if (!line.trim()) return
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      return // ignore garbage lines
    }
    try {
      onRecord(parsed)
    } catch {
      // A throwing consumer must not break the exec stream handler that feeds this parser.
    }
  }
  return {
    push(chunk: Buffer) {
      let s = dec.write(chunk)
      while (s.length > 0) {
        const nl = s.indexOf('\n')
        if (nl < 0) {
          if (!discarding) {
            buf += s
            if (buf.length > MAX_JSONL_LINE_CHARS) {
              buf = ''
              discarding = true
              droppedLines++
            }
          }
          return
        }
        const head = s.slice(0, nl)
        s = s.slice(nl + 1)
        if (discarding) {
          discarding = false
          continue
        }
        const line = buf + head
        buf = ''
        if (line.length > MAX_JSONL_LINE_CHARS) {
          droppedLines++
          continue
        }
        emit(line.replace(/\r$/, ''))
      }
    },
    end() {
      const tail = dec.end()
      if (discarding) {
        discarding = false
        buf = ''
        return
      }
      const rest = (buf + tail).replace(/\r$/, '')
      buf = ''
      if (rest.length > MAX_JSONL_LINE_CHARS) {
        droppedLines++
        return
      }
      emit(rest)
    },
    dropped: () => droppedLines,
    bufferedChars: () => buf.length,
  }
}

function clean(s: string): string {
  const collapsed = s.replace(/\s+/g, ' ').trim()
  return collapsed.length > MAX_SUMMARY_CHARS ? `${collapsed.slice(0, MAX_SUMMARY_CHARS - 1)}…` : collapsed
}

// Never reads args.content / oldText / newText (T8-02-1).
export function summarizeToolCall(toolName: string, args: unknown): string {
  const a = isRec(args) ? args : {}
  const path = str(a.path)
  let s: string
  switch (toolName) {
    case 'read':
    case 'write':
    case 'edit':
    case 'ls':
      s = path ? `${toolName} ${path}` : toolName
      break
    case 'grep':
      s = `grep ${str(a.pattern) ?? ''} in ${path ?? '.'}`
      break
    case 'find':
      s = `find ${str(a.pattern) ?? ''}`
      break
    case 'bash':
      s = `bash ${str(a.command) ?? ''}`
      break
    default:
      s = toolName
  }
  return clean(s)
}

function resultText(result: unknown): string {
  if (typeof result === 'string') return result
  if (isRec(result) && Array.isArray(result.content)) {
    return result.content
      .map((p) => (isRec(p) && typeof p.text === 'string' ? p.text : ''))
      .join('')
  }
  return ''
}

/** Open tool calls remembered for their end event; older ones are forgotten (09-03: bounded memory). */
export const MAX_TRACKED_TOOL_CALLS = 1000
const MAX_TOOL_CALL_ID_CHARS = 200

export function createPiEventMapper(): { map(record: unknown): MappedJobEvent | null } {
  const summaries = new Map<string, string>()
  const toolCallId = (v: unknown): string | undefined => {
    const id = str(v)
    return id && id.length <= MAX_TOOL_CALL_ID_CHARS ? id : undefined
  }
  return {
    map(record) {
      if (!isRec(record)) return null
      switch (record.type) {
        case 'session':
          return { type: 'info', summary: 'pi session started' }
        case 'tool_execution_start': {
          const tool = str(record.toolName) ?? 'tool'
          const summary = summarizeToolCall(tool, record.args)
          const id = toolCallId(record.toolCallId)
          if (id) {
            if (summaries.size >= MAX_TRACKED_TOOL_CALLS && !summaries.has(id)) {
              const oldest = summaries.keys().next().value
              if (oldest !== undefined) summaries.delete(oldest)
            }
            summaries.set(id, summary)
          }
          return { type: 'tool_start', tool, summary }
        }
        case 'tool_execution_end': {
          const tool = str(record.toolName) ?? 'tool'
          const id = toolCallId(record.toolCallId)
          const start = (id && summaries.get(id)) || summarizeToolCall(tool, undefined)
          if (id) summaries.delete(id)
          if (record.isError === true) {
            const first = resultText(record.result).split('\n')[0] ?? ''
            return { type: 'tool_end', tool, summary: clean(`${tool} failed: ${first}`) }
          }
          return { type: 'tool_end', tool, summary: clean(`${start} done`) }
        }
        case 'auto_retry_start': {
          const n = typeof record.attempt === 'number' ? record.attempt : '?'
          const m = typeof record.maxAttempts === 'number' ? record.maxAttempts : '?'
          return {
            type: 'info',
            // The upstream error text stays out of the visitor-readable feed (WR-06).
            summary: clean(`retrying model call (attempt ${n}/${m})`),
          }
        }
        case 'agent_settled':
          return { type: 'info', summary: 'agent settled' }
        default:
          return null
      }
    },
  }
}

function assistantText(message: Rec): string | null {
  const c = message.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    const parts = c.filter((p) => isRec(p) && p.type === 'text' && typeof p.text === 'string').map((p) => (p as Rec).text as string)
    return parts.length ? parts.join('') : null
  }
  return null
}

export function createCompletionTracker(): {
  observe(record: unknown): void
  verdict(input: { exitCode: number | null; timedOut: boolean; timeoutMs: number; stderrTail: string }): CompletionVerdict
  lastAssistantText(): string | null
  sawAgentSettled(): boolean
} {
  let settled = false
  let lastStop: string | undefined
  let lastErr: string | undefined
  let retryFailed: string | undefined
  let text: string | null = null
  return {
    observe(record) {
      if (!isRec(record)) return
      if (record.type === 'agent_settled') settled = true
      if (record.type === 'message_end' && isRec(record.message) && record.message.role === 'assistant') {
        lastStop = str(record.message.stopReason)
        const em = str(record.message.errorMessage)
        lastErr = em === undefined ? undefined : publicText(em)
        text = assistantText(record.message)
      }
      if (record.type === 'auto_retry_end' && record.success === false) {
        retryFailed = publicText(str(record.finalError) ?? 'model call failed after retries')
      }
    },
    verdict({ exitCode, timedOut, timeoutMs, stderrTail }) {
      if (timedOut) return { ok: false, error: `timeout after ${Math.round(timeoutMs / 1000)}s` }
      if (exitCode === null) return { ok: false, error: 'pi exit status unknown' }
      const modelFailed = lastStop === 'error' || lastStop === 'aborted'
      if (modelFailed && lastErr) return { ok: false, error: lastErr }
      if (retryFailed) return { ok: false, error: retryFailed }
      if (exitCode !== 0) {
        // Container stderr is never shown to the visitor (WR-06); the runner logs it server-side.
        void stderrTail
        return { ok: false, error: `pi exited with code ${exitCode}` }
      }
      if (!settled) return { ok: false, error: 'pi exited before the agent settled' }
      if (modelFailed) return { ok: false, error: `model call ended with stopReason ${lastStop}` }
      return { ok: true }
    },
    lastAssistantText: () => text,
    sawAgentSettled: () => settled,
  }
}
