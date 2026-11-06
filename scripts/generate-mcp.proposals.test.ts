// CLI tests for the proposal modes of generate-mcp: --proposals, --proposals-lenient, --validate-only,
// --context-pack with --docs and --samples, --emit-proposal-schema. Real temp directories outside the repo.
import { afterAll, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main, defaultIo, type CliIo } from './generate-mcp.js'
import { doc, fixtureText, loadFixture, op, SCENARIOS } from '../src/lib/mcpgen/proposals/testkit.js'

const root = mkdtempSync(join(tmpdir(), 'gen-prop-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const secret = ['sk', 'abcdefghijklmnop1234567890'].join('-')

function capture() {
  const logs: string[] = []
  const errs: string[] = []
  const io: CliIo = { ...defaultIo, log: (s) => logs.push(s), error: (s) => errs.push(s) }
  return { io, logs, errs, out: () => logs.join('\n'), err: () => errs.join('\n') }
}

const http = loadFixture('acme-openapi.yaml')
const input = join(root, 'acme-openapi.yaml')
writeFileSync(input, fixtureText('acme-openapi.yaml'))
const write = (name: string, text: string) => {
  const p = join(root, name)
  writeFileSync(p, text)
  return p
}

describe('--proposals', () => {
  it('writes the package, prints provenance and the human review reminder, and is deterministic', async () => {
    const p = write('p1.json', doc(http, SCENARIOS.http.split))
    const a = capture()
    expect(await main([input, '--out', join(root, 'o1'), '--proposals', p], a.io)).toBe(0)
    expect(a.out()).toContain('Proposals: sha256')
    expect(a.out()).toContain('Human review')
    const b = capture()
    expect(await main([input, '--out', join(root, 'o2'), '--proposals', p], b.io)).toBe(0)
    for (const f of readdirSync(join(root, 'o1'))) expect(readFileSync(join(root, 'o1', f), 'utf8')).toBe(readFileSync(join(root, 'o2', f), 'utf8'))
    const report = JSON.parse(readFileSync(join(root, 'o1', 'report.json'), 'utf8'))
    expect(report.proposals.applied).toHaveLength(1)
    expect(readFileSync(join(root, 'o1', 'README.generated.md'), 'utf8')).toContain(report.proposals.sha256)
  })
  it('strict rejects the whole file (exit 2, nothing written); lenient applies the valid ops and lists the rest', async () => {
    const p = write('p2.json', doc(http, [op('hide_tool', 'good', { tool: 'filter_part_by_features' }), op('rename_tool', 'bad', { tool: 'ghost', name: 'find_ghost' })]))
    const s = capture()
    expect(await main([input, '--out', join(root, 'o3'), '--proposals', p], s.io)).toBe(2)
    expect(s.err()).toContain('proposal-unknown-tool')
    expect(existsSync(join(root, 'o3'))).toBe(false)
    const l = capture()
    expect(await main([input, '--out', join(root, 'o4'), '--proposals', p, '--proposals-lenient'], l.io)).toBe(0)
    expect(l.out()).toContain('rejected bad')
  })
  it('a proposal with a secret is rejected without echoing it', async () => {
    const p = write('p3.json', doc(http, [op('describe_tool', 'd', { tool: 'search_part', text: `Use ${secret} here` })]))
    const c = capture()
    expect(await main([input, '--out', join(root, 'o5'), '--proposals', p], c.io)).toBe(2)
    expect(c.err() + c.out()).not.toContain(secret)
  })
  it('refuses env files and oversize proposal files', async () => {
    const env = write('.env.proposals', '{}')
    expect(await main([input, '--out', join(root, 'o6'), '--proposals', env], capture().io)).toBe(2)
    const big = write('big.json', ' '.repeat(300000))
    expect(await main([input, '--out', join(root, 'o7'), '--proposals', big], capture().io)).toBe(2)
  })
})

describe('--validate-only', () => {
  it('prints the review summary with before and after and writes nothing', async () => {
    const p = write('v1.json', doc(http, SCENARIOS.http['rename-describe']))
    const c = capture()
    expect(await main([input, '--proposals', p, '--validate-only'], c.io)).toBe(0)
    const t = c.out()
    expect(t).toContain('result: ACCEPTED')
    expect(t).toContain('search_part')
    expect(t).toContain('find_parts')
    expect(t).toContain('before:')
    expect(t).toContain('after:')
    expect(t).toContain('alias kept')
    expect(t).toContain('Human review is required')
  })
  it('exits 2 and names the failing op and gate for a bad proposal', async () => {
    const p = write('v2.json', doc(http, [op('rename_tool', 'oops', { tool: 'search_part', name: 'delete_parts' })]))
    const c = capture()
    expect(await main([input, '--proposals', p, '--validate-only'], c.io)).toBe(2)
    expect(c.out()).toContain('oops')
    expect(c.out()).toContain('gate 3')
    expect(c.out()).toContain('REJECTED')
  })
  it('a wrong fingerprint is fatal', async () => {
    const p = write('v3.json', JSON.stringify({ version: 1, baseline: { fingerprint: 'b'.repeat(64) }, ops: [] }))
    const c = capture()
    expect(await main([input, '--proposals', p, '--validate-only', '--proposals-lenient'], c.io)).toBe(2)
    expect(c.out()).toContain('fingerprint-mismatch')
  })
  it('usage errors: validate-only needs --proposals, lenient needs --proposals, docs need --context-pack', async () => {
    expect(await main([input, '--validate-only'], capture().io)).toBe(64)
    expect(await main([input, '--out', 'x', '--proposals-lenient'], capture().io)).toBe(64)
    expect(await main([input, '--out', 'x', '--docs', root], capture().io)).toBe(64)
    expect(await main([input, '--context-pack', 'x', '--out', 'y'], capture().io)).toBe(64)
  })
})

describe('--emit-proposal-schema', () => {
  it('writes the JSON Schema', async () => {
    const out = join(root, 'schema', 'proposal.schema.json')
    const c = capture()
    expect(await main(['--emit-proposal-schema', out], c.io)).toBe(0)
    const j = JSON.parse(readFileSync(out, 'utf8'))
    expect(j.title).toBe('ProposalSet')
    expect(JSON.stringify(j)).toContain('composite_tool')
  })
})

describe('--context-pack', () => {
  it('writes the pack with docs and samples, banners, manifest', async () => {
    const docs = join(root, 'docs-in')
    mkdirSync(docs)
    writeFileSync(join(docs, 'glossary.md'), 'A part is an item.')
    writeFileSync(join(docs, 'skip.bin'), 'binary')
    const sample = write('rows.csv', 'partId,name\nP-1,Gizmo\n')
    const out = join(root, 'pack')
    const c = capture()
    expect(await main([input, '--context-pack', out, '--docs', docs, '--samples', sample], c.io)).toBe(0)
    for (const f of ['README-FOR-AGENT.md', 'MANIFEST.json', 'FINGERPRINT', 'docs/glossary.md', 'samples/rows.csv', 'source/acme-openapi.yaml', 'baseline/tool-inventory.json']) expect(existsSync(join(out, f)), f).toBe(true)
    expect(readFileSync(join(out, 'docs/glossary.md'), 'utf8')).toContain('UNTRUSTED CONTENT')
    expect(existsSync(join(out, 'docs/skip.bin'))).toBe(false)
    const again = capture()
    expect(await main([input, '--context-pack', out], again.io)).toBe(2)
    expect(again.err()).toContain('not empty')
  })
  it('a credential in a doc refuses the whole pack and is never echoed', async () => {
    const docs = join(root, 'docs-bad')
    mkdirSync(docs)
    writeFileSync(join(docs, 'notes.md'), `api_key = ${secret}`)
    const out = join(root, 'pack-bad')
    const c = capture()
    expect(await main([input, '--context-pack', out, '--docs', docs], c.io)).toBe(2)
    expect(c.err()).toContain('pack-credential-in-docs')
    expect(c.err() + c.out()).not.toContain(secret)
    expect(existsSync(out)).toBe(false)
  })
  it('skips symbolic links, refuses .env names, and stays inside the given paths', async () => {
    const docs = join(root, 'docs-links')
    mkdirSync(docs)
    writeFileSync(join(root, 'outside.md'), 'outside the docs directory')
    symlinkSync(join(root, 'outside.md'), join(docs, 'link.md'))
    writeFileSync(join(docs, 'ok.md'), 'fine')
    writeFileSync(join(docs, '.env'), 'A=1')
    const out = join(root, 'pack-links')
    const c = capture()
    expect(await main([input, '--context-pack', out, '--docs', docs], c.io)).toBe(0)
    expect(existsSync(join(out, 'docs/ok.md'))).toBe(true)
    expect(existsSync(join(out, 'docs/link.md'))).toBe(false)
    expect(readdirSync(join(out, 'docs'))).toEqual(['ok.md'])
    expect(c.out()).toContain('symbolic links')
    const explicit = capture()
    expect(await main([input, '--context-pack', join(root, 'pack-env'), '--docs', join(docs, '.env')], explicit.io)).toBe(2)
    expect(existsSync(join(root, 'pack-env'))).toBe(false)
    const missing = capture()
    expect(await main([input, '--context-pack', join(root, 'pack-missing'), '--samples', join(root, 'nope.csv')], missing.io)).toBe(2)
  })
})
