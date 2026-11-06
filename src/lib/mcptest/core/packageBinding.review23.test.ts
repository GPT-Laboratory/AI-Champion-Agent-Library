// CR-36: the binding file is read only when the entry itself is a regular file (a symlink named mcptest-binding.json is ignored).
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { symlinkSync as link } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadPackageBinding } from './packageBinding'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

describe('loadPackageBinding and symlinks (CR-36)', () => {
  it('ignores a symlink to a valid binding file', async () => {
    const d = await mkdtemp(join(tmpdir(), 'pkgbind23-'))
    dirs.push(d)
    const real = join(d, 'elsewhere.json')
    await writeFile(real, JSON.stringify({ lookup_by_id: { tool: 'lookup_part_by_id' } }))
    link(real, join(d, 'mcptest-binding.json'))
    expect(await loadPackageBinding(d)).toBeUndefined()
  })
  it('still reads a regular file', async () => {
    const d = await mkdtemp(join(tmpdir(), 'pkgbind23-'))
    dirs.push(d)
    await writeFile(join(d, 'mcptest-binding.json'), JSON.stringify({ lookup_by_id: { tool: 'lookup_part_by_id' } }))
    expect(await loadPackageBinding(d)).toBeDefined()
  })
})
