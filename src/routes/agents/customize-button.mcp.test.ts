// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/svelte'
import { tick } from 'svelte'

// The page.server module imports server-only code; mock it so the pure helper can be imported.
vi.mock('$lib/server/db', () => ({ db: { select: vi.fn() }, agents: { slug: 'slug' } }))
vi.mock('$lib/server/search/index.js', () => ({ related: vi.fn(async () => []) }))
vi.mock('$lib/server/tryitout/service', () => ({ warmForSession: vi.fn(() => Promise.resolve()) }))
vi.mock('drizzle-orm', () => ({ eq: vi.fn(), inArray: vi.fn() }))
vi.mock('@sveltejs/kit', () => ({ error: vi.fn() }))

import Page from './[slug]/+page.svelte'
import { mcpGeneratorData } from '$lib/pageFlags'

const baseAgent = {
  slug: 'example-agent',
  title: 'Example Agent',
  summary: 'An example agent used for testing.',
  systemPrompt: 'You are a helpful assistant.',
  llmName: 'gpt-4o',
  llmTemperature: 0.7,
  llmMaxTokens: null,
  llmTopP: null,
  toolNames: [] as string[],
  requiresHumanApproval: false,
  category: null,
  githubUrl: null as string | null,
  maturityStatus: 'experimental',
  tags: [] as string[],
  specId: null,
  lastIngestedAt: '2026-08-18T00:00:00.000Z',
  tryItOutMode: 'none',
  tryItOutUrl: null as string | null,
  tryItOutTaskTemplate: null,
  customizableFields: [] as string[] | null,
  fixedFields: [] as string[],
  fixedNote: null,
}

async function openCustomize(extra: Record<string, unknown>) {
  render(Page, { props: { data: { agent: baseAgent, openTryOut: false, ...extra } as never } })
  await fireEvent.click(screen.getByRole('button', { name: /customize/i }))
  await tick()
  await tick()
}

describe('detail page Generate MCP gating', () => {
  it('flag off (key absent): three placeholders, no Generate MCP', async () => {
    await openCustomize({})
    expect(screen.getAllByRole('menuitem')).toHaveLength(3)
    expect(document.body.textContent).not.toContain('Generate MCP')
  })

  it('mcpGeneratorEnabled false is treated as off', async () => {
    await openCustomize({ mcpGeneratorEnabled: false })
    expect(screen.getAllByRole('menuitem')).toHaveLength(3)
  })

  it('flag on: Generate MCP item present', async () => {
    await openCustomize({ mcpGeneratorEnabled: true })
    const items = screen.getAllByRole('menuitem')
    expect(items).toHaveLength(4)
    expect(items[3].textContent).toContain('Generate MCP')
  })
})

describe('mcpGeneratorData load helper', () => {
  it('returns an empty object (no key) when the flag is off', () => {
    const off = mcpGeneratorData({})
    expect(off).toEqual({})
    expect('mcpGeneratorEnabled' in off).toBe(false)
    expect('mcpGeneratorEnabled' in mcpGeneratorData({ MCP_GENERATOR: '0' })).toBe(false)
  })
  it('returns mcpGeneratorEnabled true when the flag is on', () => {
    expect(mcpGeneratorData({ MCP_GENERATOR: '1' })).toEqual({ mcpGeneratorEnabled: true })
  })
})
