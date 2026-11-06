// Phase 9 chaos: malformed, oversized and adversarial Pi JSONL. Pure functions plus the fake runtime.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MAX_JSONL_LINE_CHARS,
  MAX_SUMMARY_CHARS,
  MAX_TRACKED_TOOL_CALLS,
  createCompletionTracker,
  createJsonlParser,
  createPiEventMapper,
  summarizeToolCall,
} from './piEvents'
import { PI_SUCCESS_STREAM } from './piFixtures'

vi.mock('../tryItOutPrompts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tryItOutPrompts')>()
  return {
    ...actual,
    loadPiSkill: vi.fn(async (slug: string) => ({
      basePrompt: 'BASE',
      skillMarkdown: `---\nname: ${slug}\ndescription: d\n---\nBODY`,
    })),
  }
})

function collect(feed: (p: ReturnType<typeof createJsonlParser>) => void) {
  const got: unknown[] = []
  const parser = createJsonlParser((r) => got.push(r))
  feed(parser)
  return { got, parser }
}

describe('chaos: parser framing', () => {
  const lines = ['{"a":1}', '{"b":[1,2,3]}', '{"c":"é€𝄞"}']
  const text = lines.join('\n') + '\n'

  it('one byte at a time yields the same records as one chunk', () => {
    const whole = collect((p) => {
      p.push(Buffer.from(text))
      p.end()
    }).got
    const bytes = collect((p) => {
      for (const b of Buffer.from(text)) p.push(Buffer.from([b]))
      p.end()
    }).got
    expect(bytes).toEqual(whole)
    expect(whole).toHaveLength(3)
  })

  it('handles CRLF, empty lines and a final line without LF (flushed by end)', () => {
    const { got } = collect((p) => {
      p.push(Buffer.from('{"a":1}\r\n\r\n\n{"b":2}\r\n{"c":3}'))
      p.end()
    })
    expect(got).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }])
  })

  it('a lone CR does not split a record and does not throw', () => {
    const { got } = collect((p) => {
      p.push(Buffer.from('{"a":\r1}\n{"b":2}\n'))
      p.end()
    })
    expect(got).toContainEqual({ b: 2 })
  })

  it('invalid, truncated, NUL and invalid-UTF-8 lines are skipped; neighbours survive', () => {
    const { got } = collect((p) => {
      p.push(Buffer.from('{"ok":1}\n{"trunc":\n\u0000\u0000\n'))
      p.push(Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0xfe, 0xc3, 0x28, 0x22, 0x7d, 0x0a])) // bad UTF-8 in a string
      p.push(Buffer.from('{"ok":2}\n'))
      p.end()
    })
    expect(got).toContainEqual({ ok: 1 })
    expect(got).toContainEqual({ ok: 2 })
  })

  it('JSON primitives and arrays reach the consumer, and the mapper/tracker ignore them', () => {
    const { got } = collect((p) => {
      p.push(Buffer.from('null\n1\n"x"\ntrue\n[1,2]\n{"type":"agent_settled"}\n'))
      p.end()
    })
    const mapper = createPiEventMapper()
    const tracker = createCompletionTracker()
    for (const r of got) {
      expect(() => tracker.observe(r)).not.toThrow()
      const m = mapper.map(r)
      if (!(typeof r === 'object' && r !== null && !Array.isArray(r))) expect(m).toBeNull()
    }
    expect(tracker.sawAgentSettled()).toBe(true)
  })

  it('a throwing consumer does not break the stream', () => {
    let n = 0
    const parser = createJsonlParser(() => {
      n++
      throw new Error('boom')
    })
    expect(() => {
      parser.push(Buffer.from('{"a":1}\n{"b":2}\n'))
      parser.end()
    }).not.toThrow()
    expect(n).toBe(2)
  })
})

describe('chaos: parser limits', () => {
  it('a 5 MB line without LF in 64 KB chunks never buffers more than the cap and is reported once', () => {
    const got: unknown[] = []
    const parser = createJsonlParser((r) => got.push(r))
    const chunk = Buffer.alloc(64 * 1024, 0x61)
    let maxBuffered = 0
    for (let i = 0; i < 80; i++) {
      parser.push(chunk)
      maxBuffered = Math.max(maxBuffered, parser.bufferedChars())
    }
    expect(maxBuffered).toBeLessThanOrEqual(MAX_JSONL_LINE_CHARS)
    expect(parser.dropped()).toBe(1)
    parser.push(Buffer.from('\n{"after":1}\n'))
    parser.end()
    expect(got).toEqual([{ after: 1 }])
    expect(parser.dropped()).toBe(1)
  })

  it('100k tiny lines complete quickly and every record arrives', () => {
    let n = 0
    const parser = createJsonlParser(() => void n++)
    const block = Buffer.from('{"type":"x"}\n'.repeat(1000))
    const t0 = Date.now()
    for (let i = 0; i < 100; i++) parser.push(block)
    parser.end()
    expect(n).toBe(100_000)
    expect(Date.now() - t0).toBeLessThan(5000)
  })

  it('deeply nested JSON does not crash the process', () => {
    const depth = 10_000
    const line = '['.repeat(depth) + ']'.repeat(depth) + '\n'
    const { got } = collect((p) => {
      p.push(Buffer.from(line + '{"after":1}\n'))
      p.end()
    })
    expect(got).toContainEqual({ after: 1 })
    const deep = '{"a":'.repeat(200_000) + '1' + '}'.repeat(200_000)
    expect(() => {
      const p = createJsonlParser(() => {})
      p.push(Buffer.from(deep.slice(0, MAX_JSONL_LINE_CHARS - 10) + '\n'))
      p.end()
    }).not.toThrow()
  })
})

describe('chaos: mapper', () => {
  it('huge, odd or missing tool args stay within the summary cap and never throw', () => {
    const huge = 'x'.repeat(10 * 1024 * 1024)
    const odd: unknown[] = [undefined, null, 5, 'str', [1, [2, [3]]], { path: { nested: 1 } }, { command: huge }, { pattern: huge, path: huge }, { path: huge }]
    for (const tool of ['read', 'write', 'edit', 'ls', 'grep', 'find', 'bash', 'unknown-tool', '', 'x'.repeat(500)]) {
      for (const args of odd) {
        const s = summarizeToolCall(tool, args)
        expect(s.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS)
      }
    }
  })

  it('never copies write content or raw stderr/upstream text into events', () => {
    const mapper = createPiEventMapper()
    const e = mapper.map({
      type: 'tool_execution_start',
      toolCallId: 'c',
      toolName: 'write',
      args: { path: 'out/a.txt', content: 'TOP_SECRET_BODY' },
    })
    expect(JSON.stringify(e)).not.toContain('TOP_SECRET_BODY')
    const r = mapper.map({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, errorMessage: 'sk-proj-LEAKLEAKLEAK 401' })
    expect(JSON.stringify(r)).not.toContain('LEAK')
  })

  it('unknown event types and missing fields map to null or a safe default', () => {
    const mapper = createPiEventMapper()
    for (const r of [{}, { type: 5 }, { type: 'nope' }, { type: 'tool_execution_end' }, { type: 'tool_execution_start' }, { type: 'tool_execution_end', isError: true, result: 5 }]) {
      expect(() => mapper.map(r)).not.toThrow()
    }
  })

  it('tool calls that never end do not grow mapper memory without bound, and long ids are ignored', () => {
    const mapper = createPiEventMapper()
    for (let i = 0; i < 50_000; i++) {
      mapper.map({ type: 'tool_execution_start', toolCallId: 'id' + i, toolName: 'read', args: { path: 'a' } })
    }
    // The oldest ids were forgotten (only the newest MAX_TRACKED_TOOL_CALLS stay remembered).
    const forgotten = mapper.map({ type: 'tool_execution_end', toolCallId: 'id0', toolName: 'read', isError: false })
    const kept = mapper.map({ type: 'tool_execution_end', toolCallId: 'id49999', toolName: 'read', isError: false })
    expect(forgotten?.summary).toBe('read done')
    expect(kept?.summary).toBe('read a done')
    expect(MAX_TRACKED_TOOL_CALLS).toBeLessThanOrEqual(1000)
    const big = 'i'.repeat(5000)
    mapper.map({ type: 'tool_execution_start', toolCallId: big, toolName: 'read', args: { path: 'z' } })
    expect(mapper.map({ type: 'tool_execution_end', toolCallId: big, toolName: 'read', isError: false })?.summary).toBe('read done')
  })
})

describe('chaos: completion tracker verdicts', () => {
  const input = { exitCode: 0, timedOut: false, timeoutMs: 1000, stderrTail: '' }
  const msg = (stopReason: string, errorMessage?: string) => ({
    type: 'message_end',
    message: { role: 'assistant', content: [{ type: 'text', text: 't' }], stopReason, ...(errorMessage ? { errorMessage } : {}) },
  })

  it('a stream that ends without any terminal event fails', () => {
    const t = createCompletionTracker()
    t.observe({ type: 'session' })
    expect(t.verdict(input)).toEqual({ ok: false, error: 'pi exited before the agent settled' })
  })

  it('duplicate settled events are idempotent', () => {
    const t = createCompletionTracker()
    for (const r of [msg('stop'), { type: 'agent_settled' }, { type: 'agent_settled' }]) t.observe(r)
    expect(t.verdict(input)).toEqual({ ok: true })
  })

  it('error followed by a successful message is a success; success followed by error is a failure', () => {
    const a = createCompletionTracker()
    for (const r of [msg('error', 'bad'), msg('stop'), { type: 'agent_settled' }]) a.observe(r)
    expect(a.verdict(input)).toEqual({ ok: true })
    const b = createCompletionTracker()
    for (const r of [msg('stop'), msg('error', 'late failure'), { type: 'agent_settled' }]) b.observe(r)
    expect(b.verdict(input)).toEqual({ ok: false, error: 'late failure' })
  })

  it('is deterministic for the same record sequence', () => {
    const run = () => {
      const t = createCompletionTracker()
      const parser = createJsonlParser((r) => t.observe(r))
      parser.push(Buffer.from(PI_SUCCESS_STREAM))
      parser.end()
      return t.verdict(input)
    }
    expect(run()).toEqual(run())
    expect(run()).toEqual({ ok: true })
  })
})

describe('chaos: job event count is capped (piRunner path)', () => {
  let tmpDir: string
  let jobsMod: typeof import('../tryItOutJobs')
  let piRunner: typeof import('./piRunner')
  let svcMod: typeof import('./service')
  let fakeMod: typeof import('./runtimeFake')
  let cfgMod: typeof import('./runnerConfig')
  let proxy: typeof import('./llmProxy')

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'tryitout-chaos-jsonl-'))
    process.env.TRYITOUT_WORK_DIR = tmpDir
    jobsMod = await import('../tryItOutJobs')
    piRunner = await import('./piRunner')
    svcMod = await import('./service')
    fakeMod = await import('./runtimeFake')
    cfgMod = await import('./runnerConfig')
    proxy = await import('./llmProxy')
  })
  afterAll(async () => {
    delete process.env.TRYITOUT_WORK_DIR
    await rm(tmpDir, { recursive: true, force: true })
  })
  beforeEach(() => {
    jobsMod.__resetJobs()
    proxy.__resetProxy()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    svcMod.__setTryItOutServiceForTests(null)
  })

  it('a Pi process emitting 60k events leaves at most MAX_JOB_EVENTS + a few events on the job', async () => {
    const runtime = fakeMod.createFakeRuntime()
    const svc = svcMod.createTryItOutService({ runtime, config: cfgMod.parseRunnerConfig({}), instanceId: 't' })
    svcMod.__setTryItOutServiceForTests(svc)
    runtime.scriptExec((ctx) => {
      if (ctx.cmd[0] !== 'timeout') return 0
      let id = 0
      for (let block = 0; block < 60; block++) {
        let s = ''
        for (let i = 0; i < 1000; i++) {
          s += JSON.stringify({ type: 'tool_execution_start', toolCallId: 'c' + id++, toolName: 'read', args: { path: 'a' } }) + '\n'
        }
        ctx.stdout(s)
      }
      return 0
    })
    const job = jobsMod.createJob('demo-rfi-triage', 'task', null, 'anon:s1')
    jobsMod.setStatus(job.jobId, 'running')
    await piRunner.runJobInContainer(job.jobId)
    const j = jobsMod.getJob(job.jobId)!
    expect(j.events.length).toBeLessThanOrEqual(piRunner.MAX_JOB_EVENTS + 10)
    expect(j.events.some((e) => e.summary === 'further progress events omitted')).toBe(true)
    expect(j.status).toBe('failed') // never settled: still reported, not hung
  })
})
