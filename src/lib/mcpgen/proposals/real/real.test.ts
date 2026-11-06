// Regression test for the first real proposal (Phase 22, written by an agent session from a context pack).
// It must stay accepted in strict mode against the current baseline fingerprint and apply deterministically.
// If it fails with "fingerprint-mismatch", the baseline changed: regenerate the context pack and rewrite
// the proposal (proposals are re-written, not migrated).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { generateFromPlan } from '../../generate.js'
import { evaluateProposals } from '../index.js'
import { loadFixture } from '../testkit.js'

const text = readFileSync(fileURLToPath(new URL('./acme-openapi.proposals.json', import.meta.url)), 'utf8')
const fx = loadFixture('acme-openapi.yaml')
const evaluate = (t: string) => evaluateProposals({ model: fx.model, options: fx.options, text: t })

describe('first real proposal (acme-openapi)', () => {
  it('is accepted in strict mode with zero rejected ops', () => {
    const ev = evaluate(text)
    const msg = ev.fatal.some((i) => i.code === 'fingerprint-mismatch')
      ? 'The baseline fingerprint changed: regenerate the context pack and rewrite src/lib/mcpgen/proposals/real/acme-openapi.proposals.json.'
      : JSON.stringify([...ev.fatal, ...ev.rejected])
    expect(ev.fatal, msg).toEqual([])
    expect(ev.rejected, msg).toEqual([])
    expect(ev.ok, msg).toBe(true)
    expect(ev.mode).toBe('strict')
    expect(ev.applied.map((o) => o.op).sort()).toEqual(
      ['composite_tool', 'describe_arg', 'describe_arg', 'describe_tool', 'describe_tool', 'hide_tool', 'rename_tool', 'rename_tool', 'set_arg_default'].sort(),
    )
  })

  it('generates identical output when applied twice and when ops are reversed', () => {
    const gen = (t: string) => {
      const ev = evaluate(t)
      expect(ev.ok).toBe(true)
      return generateFromPlan(ev.plan!)
    }
    const parsed = JSON.parse(text) as { ops: unknown[] }
    const reversed = JSON.stringify({ ...parsed, ops: [...parsed.ops].reverse() })
    const a = gen(text)
    // Same file twice: byte-identical package including provenance.
    expect(JSON.stringify(gen(text))).toBe(JSON.stringify(a))
    // Reversed op order: the file hash in the provenance legitimately differs; the served surface must not.
    const b = gen(reversed)
    for (const path of ['server.py', 'mcptest-binding.json', 'requirements.txt']) {
      expect(b.files.find((f) => f.path === path)?.content, path).toBe(a.files.find((f) => f.path === path)?.content)
    }
  })

  it('has no URL or credential-shaped text (no text-* gate codes)', () => {
    const ev = evaluate(text)
    const textCodes = [...ev.fatal, ...ev.rejected].map((i) => i.code).filter((c) => c.startsWith('text-') || c.startsWith('value-') || c === 'secret-arg')
    expect(textCodes).toEqual([])
    expect(text).not.toMatch(/https?:\/\/|www\./i)
  })
})
