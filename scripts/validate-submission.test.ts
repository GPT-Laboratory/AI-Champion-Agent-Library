import { describe, it, expect, afterAll } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateSubmissionPath, formatReport, main } from './validate-submission'

const FIX = 'fixtures/submissions'
const tmps: string[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'valsub-'))
  tmps.push(d)
  return d
}
afterAll(() => {
  for (const d of tmps) rmSync(d, { recursive: true, force: true })
})

const TABLE: Array<[string, string, string, string]> = [
  ['claude-subagent', 'claude-subagent', 'agent', 'partial'],
  ['crewai-jsonc', 'crewai-jsonc', 'system', 'partial'],
  ['crewai-yaml', 'crewai-yaml', 'system', 'partial'],
  ['langgraph', 'langgraph-json', 'system', 'partial'],
  ['manifest-mcp', 'catalog-manifest', 'mcp-server', 'ingestible'],
  ['manifest-system', 'catalog-manifest', 'system', 'ingestible'],
  ['mcp-server-json', 'mcp-server-json', 'mcp-server', 'partial'],
  ['oracle-a2a', 'oracle-agentspec', 'external-agent', 'ingestible'],
  ['oracle-flow', 'oracle-agentspec', 'system', 'ingestible'],
  ['oracle-manager-workers', 'oracle-agentspec', 'system', 'ingestible'],
  ['oracle-single-agent', 'oracle-agentspec', 'agent', 'ingestible'],
  ['oracle-swarm', 'oracle-agentspec', 'system', 'ingestible'],
  ['skill-example', 'agent-skill', 'skill', 'partial'],
]

describe('validateSubmissionPath fixtures', () => {
  it.each(TABLE)('%s', (dir, format, kind, status) => {
    const r = validateSubmissionPath(`${FIX}/${dir}`)
    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toMatchObject({ format, kind, status })
  })

  it('reports the whole fixtures folder per sub-folder', () => {
    const r = validateSubmissionPath(FIX)
    expect(r.items).toHaveLength(13)
    expect(r.summary.ingestible + r.summary.partial + r.summary.missingFromAuthor).toBe(13)
  })

  it('reports a single file as one item', () => {
    const r = validateSubmissionPath(`${FIX}/langgraph/langgraph.json`)
    expect(r.items).toHaveLength(1)
    expect(r.items[0].status).toBe('partial')
  })
})

describe('robustness', () => {
  it('nonexistent path', () => {
    const r = validateSubmissionPath('/nonexistent/path/xyz')
    expect(r.items).toHaveLength(1)
    expect(r.items[0].status).toBe('missing-from-author')
    expect(r.items[0].warnings).toContain('path not found')
  })

  it('empty dir', () => {
    const r = validateSubmissionPath(tmp())
    expect(r.items).toHaveLength(0)
    expect(r.summary).toEqual({ ingestible: 0, partial: 0, missingFromAuthor: 0 })
    expect(r.notes.length).toBeGreaterThan(0)
  })

  it('binary and oversized files are skipped, not thrown', () => {
    const d = tmp()
    const sub = join(d, 'weird')
    mkdirSync(sub)
    writeFileSync(join(sub, 'blob.dat'), Buffer.from([0, 1, 2, 3, 0, 255, 254]))
    writeFileSync(join(sub, 'big.txt'), 'x'.repeat(300 * 1024))
    const r = validateSubmissionPath(d)
    expect(r.items).toHaveLength(1)
    expect(r.items[0].skippedFiles).toEqual(expect.arrayContaining(['blob.dat', 'big.txt']))
  })

  it('invalid yaml and json do not throw', () => {
    const d = tmp()
    writeFileSync(join(d, 'a.yaml'), 'foo: [unclosed\n  - : :\n')
    writeFileSync(join(d, 'b.json'), '{not json')
    const r = validateSubmissionPath(d)
    expect(r.items).toHaveLength(2)
    for (const i of r.items) expect(i.status).toBe('missing-from-author')
  })

  it('yaml alias bomb does not throw', () => {
    const d = tmp()
    let y = 'a0: &a0 [x,x,x,x,x,x,x,x,x,x]\n'
    for (let i = 1; i < 12; i++) y += `a${i}: &a${i} [${Array(10).fill(`*a${i - 1}`).join(',')}]\n`
    writeFileSync(join(d, 'bomb.yaml'), y)
    expect(() => validateSubmissionPath(d)).not.toThrow()
  })

  it('symlink to /etc/passwd is skipped', () => {
    const d = tmp()
    const sub = join(d, 'sub')
    mkdirSync(sub)
    writeFileSync(join(sub, 'catalog.yaml'), 'name: Linked\nkind: agent\n')
    symlinkSync('/etc/passwd', join(sub, 'passwd.yaml'))
    symlinkSync('/etc/passwd', join(d, 'top.yaml'))
    const r = validateSubmissionPath(d)
    const json = JSON.stringify(r)
    expect(json).not.toContain('root:x')
    const sub1 = r.items.find((i) => i.name === 'sub')
    expect(sub1?.skippedFiles).toContain('passwd.yaml')
    expect(r.items.find((i) => i.name === 'top.yaml')?.warnings).toContain('symlinks are not followed')
  })

  it('.env is skipped and never printed; secrets never printed', () => {
    const d = tmp()
    writeFileSync(join(d, '.env'), 'OPENAI_KEY=ENVSECRET_VALUE_123456\n')
    writeFileSync(
      join(d, 'catalog.yaml'),
      'name: Leaky\nkind: agent\napi_key: sk-secret123456789\nextras:\n  api_key: sk-secret123456789\n',
    )
    const r = validateSubmissionPath(d)
    const out = JSON.stringify(r) + formatReport(r)
    expect(out).not.toContain('ENVSECRET_VALUE_123456')
    expect(out).not.toContain('sk-secret123456789')
    expect(r.items[0].skippedFiles).toContain('.env')
  })

  it('secret in an unparseable value cannot leak through warnings', () => {
    const d = tmp()
    writeFileSync(join(d, 'bad.yaml'), 'key: sk-secret123456789 : : [\n')
    const r = validateSubmissionPath(d)
    expect(JSON.stringify(r) + formatReport(r)).not.toContain('sk-secret123456789')
  })
})

describe('report and main', () => {
  it('human report is plain text', () => {
    const text = formatReport(validateSubmissionPath(`${FIX}/langgraph`))
    expect(text).toMatch(/^\[PARTIAL\] langgraph \(langgraph-json, system, langgraph\)/)
    expect(text).toContain('  missing from author:')
    expect(text).toContain('1 submission(s):')
    expect(text).not.toContain('\u001b')
  })

  it('--json equals the result object', () => {
    const out: string[] = []
    const code = main([`${FIX}/oracle-swarm`, '--json'], { out: (s) => out.push(s), err: () => {} })
    expect(code).toBe(0)
    expect(JSON.parse(out.join('\n'))).toEqual(validateSubmissionPath(`${FIX}/oracle-swarm`))
  })

  it('exit codes', () => {
    const io = { out: () => {}, err: () => {} }
    expect(main([], io)).toBe(2)
    expect(main(['--json'], io)).toBe(2)
    expect(main([`${FIX}/oracle-swarm`, '--strict'], io)).toBe(0)
    expect(main([`${FIX}/langgraph`, '--strict'], io)).toBe(1)
    expect(main([`${FIX}/langgraph`], io)).toBe(0)
    expect(main(['/nonexistent/zzz'], io)).toBe(0)
  })

  it('works with AGENT_KINDS unset', () => {
    delete process.env.AGENT_KINDS
    expect(validateSubmissionPath(`${FIX}/oracle-swarm`).items[0].kind).toBe('system')
  })
})

describe('smoke (spawned CLI)', () => {
  it('prints JSON for a fixture', () => {
    const out = execFileSync('npx', ['tsx', 'scripts/validate-submission.ts', `${FIX}/oracle-swarm`, '--json'], {
      timeout: 60_000,
      encoding: 'utf8',
    })
    const j = JSON.parse(out)
    expect(j.items).toHaveLength(1)
    expect(j.items[0].kind).toBe('system')
  })

  it('missing path exits 0 with a missing-from-author item', () => {
    const p = spawnSync('npx', ['tsx', 'scripts/validate-submission.ts', '/nonexistent/zzz', '--json'], {
      timeout: 60_000,
      encoding: 'utf8',
    })
    expect(p.status).toBe(0)
    expect(JSON.parse(p.stdout).items[0].status).toBe('missing-from-author')
  })
})
