// E9 defect D2: the staged driver tree lacked src/lib/spec/security.ts. These tests resolve every relative import of
// the staged set against the staged paths, and guard that new files under src/lib/mcptest stay inside it.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { importClosure, resolveRelative, scanRelativeImports } from './driverClosure'
import { readDriverTree } from './containerRun'

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

describe('scanRelativeImports', () => {
  it('finds static, export-from, side-effect and literal dynamic imports; ignores packages and comments', () => {
    const src = `
      import a from './a'
      import type { B } from '../b'
      import { c,
        d } from "./c"
      export { e } from './e'
      export * from './f'
      import './g'
      const h = await import('./h')
      import yaml from 'yaml'
      import fs from 'node:fs'
      // import x from './commented'
      /* import y from './block' */
      const nonLiteral = await import(name)
    `
    expect(scanRelativeImports(src)).toEqual(['../b', './a', './c', './e', './f', './g', './h'])
  })
})

describe('driver tree closure (D2)', () => {
  const staged = readDriverTree()
  const paths = new Set(staged.map((f) => f.path))

  it('stages src/lib/spec/security.ts, which core/redact.ts imports', () => {
    expect(paths.has('src/lib/spec/security.ts')).toBe(true)
  })

  it('every relative import of every staged .ts file resolves inside the staged set', () => {
    const bad: string[] = []
    // Checked: the driver's closure and everything under src/lib/mcptest. Other staged mcpgen files the driver never
    // reaches (limits.ts imports server code) are dead weight, not a runtime failure.
    const reached = new Set(importClosure(ROOT, ['src/lib/mcptest/driver.ts']).files)
    for (const f of staged) {
      if (!f.path.endsWith('.ts')) continue
      if (!reached.has(f.path) && !f.path.startsWith('src/lib/mcptest/')) continue
      for (const spec of scanRelativeImports(String(f.content))) {
        const r = resolveRelative(ROOT, f.path, spec)
        if (!r || !paths.has(r)) bad.push(`${f.path} -> ${spec}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('no non-test source under src/lib/mcptest imports something outside the staged set', () => {
    const bad: string[] = []
    const walk = (rel: string) => {
      // Tests and testing dirs are not staged, so they may import anything.
      const abs = join(ROOT, rel)
      for (const name of readdirNames(abs)) {
        const r = `${rel}/${name}`
        if (isDir(join(ROOT, r))) {
          if (name === '__golden__' || name === 'testing' || name === 'node_modules') continue
          walk(r)
        } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
          // Files the driver never reaches (UI model, page data, ...) are not staged; they are only a problem when staged.
          if (!paths.has(r)) continue
          for (const spec of scanRelativeImports(readFileSync(join(ROOT, r), 'utf8'))) {
            const t = resolveRelative(ROOT, r, spec)
            if (!t || !paths.has(t)) bad.push(`${r} -> ${spec}`)
          }
        }
      }
    }
    walk('src/lib/mcptest')
    expect(bad).toEqual([])
  })

  it('the closure of the driver entry is fully contained in the staged set and has no unresolved import', () => {
    const c = importClosure(ROOT, ['src/lib/mcptest/driver.ts'])
    expect(c.unresolved).toEqual([])
    for (const f of c.files) expect(paths.has(f), f).toBe(true)
  })

  it('importClosure reports an unresolved relative import and follows transitive ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'closure-'))
    try {
      const put = (rel: string, body: string) => {
        mkdirSync(dirname(join(dir, rel)), { recursive: true })
        writeFileSync(join(dir, rel), body)
      }
      put('a/entry.ts', "import './x'\nimport '../shared/s'\nawait import('./missing')\n")
      put('a/x.ts', "export * from '../shared/t'\n")
      put('shared/s.ts', 'export const s = 1\n')
      put('shared/t.ts', 'export const t = 1\n')
      const c = importClosure(dir, ['a/entry.ts'])
      expect(c.files).toEqual(['a/entry.ts', 'a/x.ts', 'shared/s.ts', 'shared/t.ts'])
      expect(c.unresolved).toEqual([{ from: 'a/entry.ts', spec: './missing' }])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

function readdirNames(p: string): string[] {
  return readdirSync(p).sort()
}
function isDir(p: string): boolean {
  return statSync(p).isDirectory()
}
