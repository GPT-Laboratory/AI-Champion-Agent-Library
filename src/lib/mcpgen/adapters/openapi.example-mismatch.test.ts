// D-463: an example that contradicts its own schema still yields the tool, plus a warn gap that never echoes values.
import { describe, expect, it } from 'vitest'
import { runPipeline } from '../pipeline'

const SECRET = 'hunter2-not-a-real-value-9f8e7d'

function spec(schema: string, example: string, where: 'media' | 'examples' | 'schema' = 'media'): string {
  const ex =
    where === 'media'
      ? `              example: ${example}`
      : where === 'examples'
        ? `              examples:\n                one:\n                  value: ${example}`
        : ''
  const schemaEx = where === 'schema' ? `\n                example: ${example}` : ''
  return `openapi: 3.0.3
info: { title: Ex, version: "1" }
paths:
  /things:
    get:
      operationId: listThings
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
${schema.replace(/^/gm, '                ')}${schemaEx}
${ex}
`
}
const OBJ = 'type: object\nproperties:\n  id: { type: string }\n  count: { type: integer }'
const ARR = 'type: array\nitems:\n  type: object\n  properties:\n    id: { type: string }\n    count: { type: integer }'

function mismatches(input: string) {
  const r = runPipeline(input)
  if (!r.ok) throw new Error(JSON.stringify(r.gaps))
  return { gaps: r.report.gaps.filter((g) => g.code === 'example-schema-mismatch'), tools: r.report.toolsEmitted, r }
}

describe('example-schema-mismatch (D-463)', () => {
  it('property the schema does not define: tool still generated, warn gap with operationId', () => {
    const m = mismatches(spec(OBJ, `{ id: a, extra: ${SECRET} }`))
    expect(m.gaps).toHaveLength(1)
    expect(m.gaps[0]).toMatchObject({ severity: 'warn', path: 'listThings' })
    expect(m.gaps[0].message).toContain('$.extra')
    expect(m.tools.length).toBeGreaterThan(0)
  })

  it('wrong type: reported by property path, value never echoed', () => {
    const m = mismatches(spec(OBJ, `{ id: a, count: ${SECRET} }`))
    expect(m.gaps).toHaveLength(1)
    expect(m.gaps[0].message).toContain('$.count (expected integer, found string)')
    expect(JSON.stringify(m.r)).not.toContain(SECRET)
  })

  it('array items, named examples and schema-level examples are checked', () => {
    expect(mismatches(spec(ARR, '[{ id: a, count: 1 }, { id: b, nope: 1 }]')).gaps).toHaveLength(1)
    expect(mismatches(spec(OBJ, '{ id: 1 }', 'examples')).gaps).toHaveLength(1)
    expect(mismatches(spec(OBJ, '{ zzz: 1 }', 'schema')).gaps).toHaveLength(1)
  })

  it('a conforming example, an absent example, nullable null and open objects produce no gap', () => {
    expect(mismatches(spec(OBJ, '{ id: a, count: 2 }')).gaps).toEqual([])
    expect(mismatches(spec(OBJ, '{ id: a }', 'schema')).gaps).toEqual([])
    expect(mismatches(`${spec(OBJ, '{ id: a }')}`.replace('example: { id: a }', '')).gaps).toEqual([])
    expect(mismatches(spec(`${OBJ}\n  note: { type: string, nullable: true }`, '{ id: a, note: null }')).gaps).toEqual([])
    expect(mismatches(spec(`${OBJ}\nadditionalProperties: true`, '{ id: a, anything: 1 }')).gaps).toEqual([])
  })

  it('output is deterministic', () => {
    const input = spec(OBJ, '{ id: a, extra: 1 }')
    const a = mismatches(input).r
    const b = mismatches(input).r
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})
