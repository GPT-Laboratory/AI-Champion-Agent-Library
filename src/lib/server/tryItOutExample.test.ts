import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs'
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

  it('optional wording: task and file labels, a hint and a placeholder; only the ones given', async () => {
    agent('a', { [EXAMPLE_FILE]: 'task: |-\n  Rule one.\n  Rule two.\ntask_label: Rules, one per line\nfile_label: Data the rules apply to\nhint: Matched against the file.\ntask_placeholder: One per line\n' })
    expect(await loadTryItOutExample('a', root)).toEqual({
      task: 'Rule one.\nRule two.',
      file: null,
      result: null,
      labels: { task: 'Rules, one per line', file: 'Data the rules apply to', hint: 'Matched against the file.', placeholder: 'One per line' },
    })
    agent('b', { [EXAMPLE_FILE]: 'task: t\nhint: Just a hint\n' })
    expect((await loadTryItOutExample('b', root))?.labels).toEqual({ hint: 'Just a hint' })
    agent('c', { [EXAMPLE_FILE]: `task: t\ntask_label: ${'x'.repeat(101)}\n` })
    await expect(loadTryItOutExample('c', root)).rejects.toThrow(/task_label/)
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

  // Every agent with a Try It Out prompt folder ships an example (AIRO has no folder: it links out instead).
  it('every prompt folder ships one', () => {
    const folders = readdirSync(shipped, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    expect(folders.length).toBeGreaterThanOrEqual(21)
    expect(folders.filter((s) => !slugs.includes(s))).toEqual([])
  })

  it.each(slugs)('%s/example.yaml loads, and its files are in the folder', async (slug) => {
    const ex = await loadTryItOutExample(slug, shipped)
    expect(ex).not.toBeNull()
  })

  it.each(slugs)('%s: the default file is the folder\'s synthetic sample', async (slug) => {
    const ex = (await loadTryItOutExample(slug, shipped))!
    if (ex.file) {
      expect(ex.file.name).toMatch(/^sample-[a-z0-9-]+\.txt$/)
      expect(ex.file.text.split('\n')[0]).toMatch(/synthetic/i)
    }
  })

  it('every file an example names reaches the app image (.containerignore drops *.md unless re-included)', async () => {
    const ignore = readFileSync(join(process.cwd(), '.containerignore'), 'utf8').split('\n').map((l) => l.trim())
    for (const slug of slugs) {
      const ex = (await loadTryItOutExample(slug, shipped))!
      const yaml = readFileSync(join(shipped, slug, EXAMPLE_FILE), 'utf8')
      const named = [ex.file?.name, /^result:\s*(\S+)/m.exec(yaml)?.[1]].filter((n): n is string => !!n)
      for (const n of named.filter((x) => x.endsWith('.md'))) {
        expect(ignore, `${slug}/${n} would be left out of the image`).toContain('!data/tryitout-prompts/**/*.md')
      }
    }
  })
})
