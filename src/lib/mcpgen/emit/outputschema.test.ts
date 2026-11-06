// Output schemas and structured results (Phase 21, plan 03).
//
// FastMCP behaviour, probed in throwaway venvs (fastmcp 3.4.8 with mcp 1.30.0, fastmcp 4.1.0 with mcp 2.3.0):
// - A tool annotated '-> dict' already advertises the generic schema {"type": "object", "additionalProperties": true}
//   and returns structured_content equal to the dict, on both versions. It is not precise, so it is not enough.
// - mcp.tool(fn, annotations=..., output_schema=<JSON schema dict>) advertises exactly that schema on both versions,
//   returns structured_content equal to the dict, and validates the result: a non-conforming result raises
//   ToolError (3.4.8) or RuntimeError (4.1.0) instead of being returned. Error dicts with ok False validate.
// - Version differences that matter: 4.1.0 renames Tool.outputSchema to Tool.output_schema (the old name still
//   works with a deprecation warning) and the annotation fields to snake_case. The generated tests read both names.
// - Chosen approach (identical on both, no version-conditional server code): explicit output_schema= with a JSON
//   schema literal per tool shape (list, item, describe), derived from the tool kind only.
// Source strings only; no Python runs here (plan 21-05 runs the generated pytest on both versions).
import { describe, expect, it } from 'vitest'
import { generate, generateFromPlan } from '../generate'
import { acmeDataset, acmeHttp, acmeSql } from '../testing/sample-models'
import { loadFixture, run, SCENARIOS } from '../proposals/testkit'
import type { SourceModel } from '../types'

const file = (files: { path: string; content: string }[], name: string) => files.find((f) => f.path === name)!.content

function checkServer(server: string) {
  expect(server).toContain('    mcp.tool(_tool, annotations=_ANNOTATIONS, output_schema=_OUTPUT_SCHEMAS[_tool.__name__])')
  expect(server.match(/mcp\.tool\(/g)).toHaveLength(1)
  expect(server.match(/^_OUTPUT_SCHEMAS = \{$/gm)).toHaveLength(1)
  const table = server.match(/^_OUTPUT_SCHEMAS = \{\n([\s\S]*?)\n\}$/m)![1]
  const mapped = [...table.matchAll(/^ {4}"([a-z0-9_]+)": _OUT_(LIST|ITEM|DESCRIBE),$/gm)]
  const registered = server.match(/for _tool in \(\n([\s\S]*?)\n\):/)![1].split('\n').map((l) => l.trim().replace(/,$/, ''))
  expect(mapped.map((m) => m[1]).sort()).toEqual([...registered].sort())
  for (const kind of new Set(mapped.map((m) => m[2]))) expect(server).toMatch(new RegExp(`^_OUT_${kind} = \\{`, 'm'))
  // Every schema is an object with a required boolean ok; the error dict (ok, kind, message, hint) fits.
  for (const m of server.matchAll(/^_OUT_(LIST|ITEM|DESCRIBE) = (\{[\s\S]*?\n\})$/gm)) {
    expect(m[2]).toContain('"type": "object"')
    expect(m[2]).toContain('"required": ["ok"]')
    for (const key of ['ok', 'kind', 'message', 'hint']) expect(m[2]).toContain(`"${key}":`)
  }
}

describe('output schemas on every backend', () => {
  for (const [label, model] of [
    ['http', acmeHttp],
    ['dataset', acmeDataset],
    ['sql', acmeSql],
  ] as [string, SourceModel][]) {
    it(`${label}: server.py registers every tool with an output schema`, () => {
      checkServer(file(generate(model).files, 'server.py'))
    })
    it(`${label}: test_server.py asserts schemas and structured content`, () => {
      const t = file(generate(model).files, 'test_server.py')
      expect(t).toContain('def test_every_tool_declares_an_object_output_schema')
      expect(t).toContain('def test_structured_content_matches_the_dict_result_and_schema')
      expect(t).toContain('structured_content')
      expect(t).toContain('"output_schema"')
      expect(t).toContain('"outputSchema"')
    })
  }

  it('shapes: list tools carry results and count, get tools a result object, describe the entities', () => {
    const s = file(generate(acmeHttp).files, 'server.py')
    expect(s).toMatch(/_OUT_LIST = [\s\S]*"results":[\s\S]*"count":/)
    expect(s).toMatch(/_OUT_ITEM = [\s\S]*"result":/)
    const d = file(generate(acmeDataset).files, 'server.py')
    expect(d).toMatch(/_OUT_DESCRIBE = [\s\S]*"entities":/)
    expect(d).toMatch(/"describe_[a-z0-9_]+": _OUT_DESCRIBE,/)
  })

  it('does not change the result dict shape of the tools', () => {
    const s = file(generate(acmeHttp).files, 'server.py')
    expect(s).toContain('return {"ok": True, "result": _project(item, sel)}')
    expect(s).toContain('-> dict:')
  })
})

describe('output schemas on proposal-assisted output', () => {
  for (const kind of ['http', 'sql'] as const) {
    for (const [name, ops] of Object.entries(SCENARIOS[kind])) {
      it(`${kind}/${name}: wrapper tools are mapped to a schema and the pytest checks it`, () => {
        const fx = loadFixture(kind === 'http' ? 'acme-openapi.yaml' : 'acme-schema.sql')
        const ev = run(fx, ops)
        expect(ev.ok).toBe(true)
        const files = generateFromPlan(ev.plan!).files
        checkServer(file(files, 'server.py'))
        expect(file(files, 'test_server.py')).toContain('def test_every_tool_declares_an_object_output_schema')
      })
    }
  }
})
