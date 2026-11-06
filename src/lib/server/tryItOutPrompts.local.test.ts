import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('./db', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ get: () => ({ systemPrompt: 'SP' }) }) }) }) },
  agents: {},
}))

import { loadPiSkill } from './tryItOutPrompts'

const SLUG = 'lvi-info-product-match'
const SKILL = `---\nname: ${SLUG}\ndescription: local skill\n---\nBODY`
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'prompts-local-'))
  await mkdir(join(root, SLUG), { recursive: true })
  await writeFile(join(root, SLUG, 'SKILL.md'), SKILL)
  process.env.TRYITOUT_PROMPTS_LOCAL_DIR = root
})
afterEach(async () => {
  delete process.env.TRYITOUT_PROMPTS_LOCAL_DIR
  delete process.env.LOCAL_MCP_AGENTS
  await rm(root, { recursive: true, force: true })
})

describe('local prompt fallback', () => {
  it('flag on and local slug: falls back to the local prompts directory', async () => {
    process.env.LOCAL_MCP_AGENTS = '1'
    const r = await loadPiSkill(SLUG)
    expect(r.skillMarkdown).toBe(SKILL)
    expect(r.basePrompt).toBe('SP')
  })
  it('flag off: the existing missing-skill error, local dir never consulted', async () => {
    const err = await loadPiSkill(SLUG).catch((e: Error) => e)
    expect((err as Error).message).toMatch(/missing skill file for agent lvi-info-product-match/)
    expect((err as Error).message).not.toContain(root)
  })
  it('flag on but a slug outside the local registry: not consulted', async () => {
    process.env.LOCAL_MCP_AGENTS = '1'
    await mkdir(join(root, 'other-agent'), { recursive: true })
    await writeFile(join(root, 'other-agent', 'SKILL.md'), SKILL.replace(SLUG, 'other-agent'))
    await expect(loadPiSkill('other-agent')).rejects.toThrow(/missing skill file/)
  })
  it('traversal guard still runs first', async () => {
    process.env.LOCAL_MCP_AGENTS = '1'
    await expect(loadPiSkill('../x')).rejects.toThrow()
  })
})
