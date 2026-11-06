// Core support for OData-shaped operations (D-562, D-563) with a hand-built model, so the planner and the
// emitter are tested without any adapter. The generated Python is never run; py_compile is the only check.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generate } from '../generate'
import type { SourceModel } from '../types'

const probe = spawnSync('python3', ['-I', '--version'], { encoding: 'utf8' })
const hasPython = probe.status === 0

export const odataModel: SourceModel = {
  name: 'Acme Parts Service',
  backend: { kind: 'http', baseUrlEnv: 'ACME_PARTS_BASE_URL' },
  auth: { scheme: 'bearer', envVar: 'ACME_PARTS_ACCESS_TOKEN', oauth2: true },
  entities: [
    {
      id: 'Part',
      label: 'Part',
      identifierFields: ['PartID', 'Region'],
      nested: [],
      fields: [
        { name: 'PartID', type: 'string', identifier: true, odata: { kind: 'guid', filterable: true } },
        { name: 'Region', type: 'integer', identifier: true, odata: { kind: 'number', filterable: true } },
        { name: 'Name', type: 'string', nameLike: true, odata: { kind: 'string', filterable: true } },
        { name: 'Color', type: 'string', enum: ['Red', 'Green'], odata: { kind: 'enum', filterable: true, enumType: 'Acme.Parts.Color' } },
        { name: 'Created', type: 'string', odata: { kind: 'date', filterable: true } },
        { name: 'Active', type: 'boolean', odata: { kind: 'boolean', filterable: true } },
        { name: 'Dims', type: 'object' },
      ],
    },
  ],
  operations: [
    {
      id: 'list_Parts',
      kind: 'list',
      method: 'GET',
      protocol: 'odata',
      path: '/Parts',
      entity: 'Part',
      pageParam: 'skip',
      pageSizeParam: 'top',
      params: [
        { name: 'top', wireName: '$top', in: 'query', type: 'integer', required: false, min: 1 },
        { name: 'skip', wireName: '$skip', in: 'query', type: 'integer', required: false, min: 0 },
      ],
    },
    {
      id: 'get_Part',
      kind: 'get',
      method: 'GET',
      protocol: 'odata',
      path: '/Parts',
      entity: 'Part',
      params: [
        { name: 'part_id', wireName: 'PartID', in: 'path', type: 'string', required: true },
        { name: 'region', wireName: 'Region', in: 'path', type: 'integer', required: true },
      ],
    },
  ],
  limits: { maxPageSize: 50, resultCeiling: 1000, maxResponseItems: 200 },
  gaps: [],
  writeOperationsDropped: [],
}

const file = (r: ReturnType<typeof generate>, name: string) => r.files.find((f) => f.path === name)!.content

describe('odata operations in the core', () => {
  const r = generate(odataModel, {})
  const server = file(r, 'server.py')

  it('plans a list tool and a composite-key lookup tool', () => {
    expect(r.report.toolsEmitted).toEqual(['list_parts', 'lookup_part_by_part_id_and_region'])
    expect(r.report.envVars.map((e) => e.name).sort()).toEqual(['ACME_PARTS_ACCESS_TOKEN', 'ACME_PARTS_BASE_URL'])
  })
  it('writes system query options from fixed text and never $expand', () => {
    expect(server).toContain('"$top": page_size')
    expect(server).toContain('"$skip": (page - 1) * page_size')
    expect(server).toContain('"$select"')
    expect(server).not.toContain('$expand')
    expect(server).toContain('page_size = _clamp(page_size, 1, 50)')
    expect(server).toContain('if page * page_size > 1000:')
  })
  it('compiles filters and keys through the validating helpers only', () => {
    expect(server).toContain('condition = _odata_filter("Part", field, match, value)')
    expect(server).toContain('_odata_path("Part", [part_id, region])')
    expect(server).toContain('"key": [')
    expect(server).toMatch(/"enumType": "Acme\.Parts\.Color"/)
    expect(server).toContain('urllib.parse.quote(str(name), safe="$")')
    expect(server).not.toContain('params=query')
  })
  it('keeps REST servers unchanged: no OData runtime unless an operation asks for it', async () => {
    const { acmeHttp } = await import('../testing/sample-models')
    const rest = file(generate(acmeHttp, {}), 'server.py')
    expect(rest).not.toContain('_odata')
    expect(rest).toContain('params=query')
  })
  it('is deterministic', () => {
    expect(file(generate(odataModel, {}), 'server.py')).toBe(server)
    expect(file(generate(odataModel, {}), 'test_server.py')).toBe(file(r, 'test_server.py'))
  })
  it('omits an OData tool whose path is not a single safe segment', () => {
    const bad: SourceModel = { ...odataModel, operations: odataModel.operations.map((o) => ({ ...o, path: '/Parts/../x' })) }
    const out = generate(bad, {})
    expect(out.report.gaps.some((g) => g.code === 'tool-omitted')).toBe(true)
    expect(out.files.length).toBe(0)
  })
  it.skipIf(!hasPython)('py_compile of server.py and test_server.py', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcpgen-odata-'))
    try {
      for (const name of ['server.py', 'test_server.py']) {
        const f = join(dir, name)
        writeFileSync(f, file(r, name))
        const res = spawnSync('python3', ['-I', '-m', 'py_compile', f], { encoding: 'utf8' })
        expect(res.status, `${name}: ${res.stderr}`).toBe(0)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
