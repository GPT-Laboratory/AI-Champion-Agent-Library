// CR-47: the production app image has no src/ unless the Containerfile copies it, and the bundled server cannot find
// the repo root from import.meta.url. CR-58: the runner image installs every bare specifier of the driver closure.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { resolveDriverRoot } from './containerRun'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const tmp = mkdtempSync(join(tmpdir(), 'driver-root-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

function withDriver(name: string): string {
  const root = join(tmp, name)
  mkdirSync(join(root, 'src/lib/mcptest'), { recursive: true })
  writeFileSync(join(root, 'src/lib/mcptest/driver.ts'), '// stub\n')
  return root
}

describe('resolveDriverRoot (CR-47)', () => {
  it('uses the first candidate that holds the driver entry', () => {
    const empty = join(tmp, 'empty')
    mkdirSync(empty, { recursive: true })
    const cwd = withDriver('cwd')
    expect(resolveDriverRoot([empty, cwd])).toBe(cwd)
    expect(resolveDriverRoot([undefined, '', cwd])).toBe(cwd)
  })
  it('an explicit root wins over later candidates and the last candidate is the fallback', () => {
    const a = withDriver('a')
    const b = withDriver('b')
    expect(resolveDriverRoot([a, b])).toBe(a)
    const none = join(tmp, 'none')
    expect(resolveDriverRoot([none])).toBe(none)
  })
})

describe('Containerfile runtime stage ships the driver sources (CR-47)', () => {
  const runtime = read('../../../../Containerfile').split(/^FROM .* AS runtime$/m)[1] ?? ''
  it('copies the three source trees the driver tree is read from', () => {
    for (const p of ['src/lib/mcptest', 'src/lib/mcpgen', 'src/lib/spec/security.ts']) {
      expect(runtime, p).toContain(`COPY --from=builder /app/${p} ./${p}`)
    }
  })
  it('copies them before the chown and the USER switch', () => {
    expect(runtime.indexOf('COPY --from=builder /app/src/lib/mcpgen')).toBeLessThan(runtime.indexOf('chown -R node:node /app'))
  })
})

describe('Containerfile.mcp-test-runner installs sax (CR-58)', () => {
  it('pins sax at the package.json version', () => {
    const pkg = JSON.parse(read('../../../../package.json')) as { dependencies: Record<string, string> }
    expect(read('../../../../Containerfile.mcp-test-runner')).toContain(`sax@${pkg.dependencies.sax.replace(/^[\^~]/, '')}`)
  })
})
