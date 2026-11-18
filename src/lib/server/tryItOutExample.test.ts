import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, readdirSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EXAMPLE_FILE, MAX_EXAMPLE_BYTES, loadTryItOutExample } from './tryItOutExample'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tryitout-example-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function agent(slug: string, files: Record<string, string>): void {
  mkdirSync(join(root, slug), { recursive: true })
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, slug, name), text)
}

describe('loadTryItOutExample', () => {
  it('returns null when the agent folder has no example.yaml', async () => {
    agent('plain', { 'SKILL.md': '---\nname: plain\n---\n' })
    expect(await loadTryItOutExample('plain', root)).toBeNull()
    expect(await loadTryItOutExample('no-such-agent', root)).toBeNull()
  })

  it('loads the task, the file and the labelled result from the agent folder', async () => {
    agent('a', {
      [EXAMPLE_FILE]: 'task: Do the thing\nfile: in.txt\nresult: out.md\nresult_label: From the helper\n',
      'in.txt': 'INPUT',
      'out.md': 'RESULT',
    })
    expect(await loadTryItOutExample('a', root)).toEqual({
      task: 'Do the thing',
      file: { name: 'in.txt', text: 'INPUT' },
      result: { label: 'From the helper', text: 'RESULT' },
    })
  })

  it('a task alone is a valid example', async () => {
    agent('a', { [EXAMPLE_FILE]: 'task: Just a task\n' })
    expect(await loadTryItOutExample('a', root)).toEqual({ task: 'Just a task', file: null, result: null })
  })

  it('rejects a result without a label, unknown keys, an empty task and invalid YAML', async () => {
    const bad = [
      'task: t\nresult: out.md\n',
      'task: t\nprompt: x\n',
      'task: "  "\n',
      'task: [unclosed\n',
    ]
    for (const yaml of bad) {
      agent('a', { [EXAMPLE_FILE]: yaml, 'out.md': 'R' })
      await expect(loadTryItOutExample('a', root)).rejects.toThrow(/invalid a\/example\.yaml/)
    }
  })

  it('accepts only bare file names in the agent folder (no traversal)', async () => {
    for (const name of ['../secret.txt', 'sub/in.txt', '.env', '/etc/passwd']) {
      agent('a', { [EXAMPLE_FILE]: `task: t\nfile: ${JSON.stringify(name)}\n` })
      await expect(loadTryItOutExample('a', root)).rejects.toThrow(/must be a file name in the agent folder/)
    }
    await expect(loadTryItOutExample('../a', root)).rejects.toThrow()
  })

  it('fails on a missing or oversized file', async () => {
    agent('a', { [EXAMPLE_FILE]: 'task: t\nfile: gone.txt\n' })
    await expect(loadTryItOutExample('a', root)).rejects.toThrow(/ENOENT/)
    agent('b', { [EXAMPLE_FILE]: 'task: t\nfile: big.txt\n', 'big.txt': 'x'.repeat(MAX_EXAMPLE_BYTES + 1) })
    await expect(loadTryItOutExample('b', root)).rejects.toThrow(/exceeds/)
  })
})

describe('shipped examples', () => {
  const shipped = join(process.cwd(), 'data', 'tryitout-prompts')
  const slugs = readdirSync(shipped).filter((s) => existsSync(join(shipped, s, EXAMPLE_FILE)))

  it('at least ifc-ebom-compiler ships one', () => {
    expect(slugs).toContain('ifc-ebom-compiler')
  })

  it.each(slugs)('%s/example.yaml loads, and its files are in the folder', async (slug) => {
    const ex = await loadTryItOutExample(slug, shipped)
    expect(ex).not.toBeNull()
  })
})
