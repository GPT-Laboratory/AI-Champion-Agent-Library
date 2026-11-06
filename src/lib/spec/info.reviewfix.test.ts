// Phase 13 review fixes IN-03 (parse failures explained) and IN-04 (secret filename filter).
import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isSecretFileName, readSubmissionDir } from './scan.js'
import { manifestAdapter } from './formats/manifest.js'
import { parseSubmission } from './registry.js'

const NOW = '2026-01-01T00:00:00.000Z'
const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('IN-04 secret file names', () => {
  it.each(['.env', '.ENV', '.env.local', '.npmrc', '.NPMRC', 'id_rsa', 'id_rsa.pub', 'id_ed25519', 'server.PEM', 'tls.key', 'credentials.json', 'Credentials.JSON', 'store.p12'])(
    'flags %s',
    (name) => expect(isSecretFileName(name)).toBe(true),
  )
  it.each(['catalog.yaml', 'SKILL.md', 'crew.json', 'environment.yaml', 'keys.md', 'monkey.md', 'README.md'])(
    'does not flag %s',
    (name) => expect(isSecretFileName(name)).toBe(false),
  )
  it('readSubmissionDir never reads them into memory', () => {
    const d = mkdtempSync(join(tmpdir(), 'scan-secret-'))
    dirs.push(d)
    mkdirSync(join(d, 'sub'))
    for (const n of ['.ENV', '.npmrc', 'id_rsa', 'cert.pem', 'credentials.json', 'sub/Credentials.json']) {
      writeFileSync(join(d, n), 'TOP-SECRET')
    }
    writeFileSync(join(d, 'catalog.yaml'), 'name: A\n')
    const { files, skipped } = readSubmissionDir(d)
    expect(files.map((f) => f.path)).toEqual(['catalog.yaml'])
    expect(JSON.stringify(files)).not.toContain('TOP-SECRET')
    expect(skipped.sort()).toEqual(['.ENV', '.npmrc', 'cert.pem', 'credentials.json', 'id_rsa', 'sub/Credentials.json'].sort())
  })
})

describe('IN-03 parse failures say why', () => {
  it('an unparseable catalog.yaml is explained at adapter level', () => {
    const broken = manifestAdapter.parse([{ path: 'catalog.yaml', text: 'name: [unterminated' }], { now: NOW })
    expect(broken.warnings.join('\n')).toContain('catalog.yaml could not be parsed')
  })

  it('a nameless catalog.yaml keeps the plain missing-name reason', () => {
    const out = parseSubmission([{ path: 'catalog.yaml', text: 'summary: s\n' }], { now: NOW })
    expect(out.warnings).toContain('catalog.yaml has no usable name')
  })

  it('crewai YAML that does not parse reports the parser message', () => {
    const out = parseSubmission(
      [
        { path: 'config/agents.yaml', text: 'a: [unclosed' },
        { path: 'config/tasks.yaml', text: 'x: 1' },
      ],
      { now: NOW },
    )
    expect(out.format).toBe('crewai-yaml')
    expect(out.warnings.join('\n')).toContain('YAML could not be parsed')
  })
})
