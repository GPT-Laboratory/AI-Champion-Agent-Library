// Read-only tool annotations (Phase 21, plan 02). Every registered tool declares readOnlyHint=true,
// destructiveHint=false, idempotentHint=true and an openWorldHint that matches the backend (true for
// http, false for dataset and sql). The generated pytest asserts them. Source strings only; no Python runs.
import { describe, expect, it } from 'vitest'
import { generate, generateFromPlan } from '../generate'
import { acmeDataset, acmeHttp, acmeSql } from '../testing/sample-models'
import { loadFixture, run, SCENARIOS } from '../proposals/testkit'
import type { SourceModel } from '../types'

const file = (files: { path: string; content: string }[], name: string) => files.find((f) => f.path === name)!.content

function annotationsConstant(server: string): string {
  const m = server.match(/^_ANNOTATIONS = (\{[\s\S]*?\n\})$/m)
  expect(m, 'server.py declares one _ANNOTATIONS constant').not.toBeNull()
  return m![1]
}

function checkServer(server: string, openWorld: boolean) {
  const a = annotationsConstant(server)
  expect(a).toContain('"readOnlyHint": True')
  expect(a).toContain('"destructiveHint": False')
  expect(a).toContain('"idempotentHint": True')
  expect(a).toContain(`"openWorldHint": ${openWorld ? 'True' : 'False'}`)
  expect(server.match(/^_ANNOTATIONS = /gm)).toHaveLength(1)
  expect(server).toMatch(/^ {4}mcp\.tool\(_tool, annotations=_ANNOTATIONS(?:, output_schema=_OUTPUT_SCHEMAS\[_tool\.__name__\])?\)$/m)
  expect(server).not.toMatch(/mcp\.tool\(_tool\)/)
  expect(server).not.toMatch(/readOnlyHint"?\s*[:=]\s*False/)
  expect(server).not.toMatch(/destructiveHint"?\s*[:=]\s*True/)
  // Only one registration site, and every registered name is a read tool.
  expect(server.match(/mcp\.tool\(/g)).toHaveLength(1)
}

describe('annotations on every backend', () => {
  for (const [label, model, openWorld] of [
    ['http', acmeHttp, true],
    ['dataset', acmeDataset, false],
    ['sql', acmeSql, false],
  ] as [string, SourceModel, boolean][]) {
    it(`${label}: server.py registers every tool with read-only annotations`, () => {
      checkServer(file(generate(model).files, 'server.py'), openWorld)
    })
    it(`${label}: test_server.py asserts the annotations of every tool`, () => {
      const t = file(generate(model).files, 'test_server.py')
      expect(t).toContain('def test_every_tool_declares_read_only_annotations')
      expect(t).toContain('readOnlyHint')
      expect(t).toContain('destructiveHint')
      expect(t).toContain('idempotentHint')
      expect(t).toContain('openWorldHint')
      expect(t).toContain(`OPEN_WORLD = ${openWorld ? 'True' : 'False'}`)
      expect(t).not.toMatch(/readOnlyHint"?\)?\s*(?:is|==)\s*False/)
    })
  }
})

describe('annotations on proposal-assisted output', () => {
  for (const kind of ['http', 'sql'] as const) {
    for (const [name, ops] of Object.entries(SCENARIOS[kind])) {
      it(`${kind}/${name}: wrapper tools carry the same annotations and the proposal pytest asserts them`, () => {
        const fx = loadFixture(kind === 'http' ? 'acme-openapi.yaml' : 'acme-schema.sql')
        const ev = run(fx, ops)
        expect(ev.ok).toBe(true)
        const files = generateFromPlan(ev.plan!).files
        checkServer(file(files, 'server.py'), kind === 'http')
        const t = file(files, 'test_server.py')
        expect(t).toContain('def test_every_tool_declares_read_only_annotations')
        expect(t).toContain('readOnlyHint')
      })
    }
  }
})
