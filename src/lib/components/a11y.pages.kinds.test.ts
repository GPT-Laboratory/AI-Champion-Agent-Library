// @vitest-environment jsdom
// Page-level axe for the flag-on system detail page (Phase 13). Synthetic data only.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/svelte'
import { createRawSnippet } from 'svelte'
import { readable } from 'svelte/store'

vi.mock('$app/navigation', () => ({ goto: vi.fn(), afterNavigate: vi.fn(), replaceState: vi.fn() }))
vi.mock('$app/stores', () => ({ page: readable({ url: new URL('http://localhost/agents/synthetic-team') }) }))

import Layout from '../../routes/+layout.svelte'
import DetailPage from '../../routes/agents/[slug]/+page.svelte'
import { expectNoAxeViolations } from '$lib/testing/axe'

const emptySnippet = createRawSnippet(() => ({ render: () => '<span></span>' }))

function data(kindInfo: unknown) {
  return {
    agent: {
      slug: 'synthetic-team',
      title: 'Synthetic Team',
      summary: 'A synthetic system.',
      systemPrompt: 'n/a',
      llmName: 'n/a',
      llmTemperature: null,
      llmMaxTokens: null,
      llmTopP: null,
      toolNames: [],
      requiresHumanApproval: false,
      category: 'ops',
      githubUrl: null,
      linkLabel: null,
      maturityStatus: 'experimental',
      tags: [],
      specId: null,
      lastIngestedAt: '2026-08-18T00:00:00.000Z',
      tryItOutMode: 'none',
      tryItOutUrl: null,
      tryItOutTaskTemplate: null,
      customizableFields: null,
      fixedFields: [],
      fixedNote: null,
    },
    related: [],
    openTryOut: false,
    ...(kindInfo ? { kindInfo } : {}),
  }
}

function mount(d: unknown) {
  document.body.innerHTML = ''
  const { container } = render(Layout, { props: { data: { user: null }, children: emptySnippet } as never })
  const main = container.querySelector('main') as HTMLElement
  render(DetailPage, { target: main, props: { data: d } as never })
  return container
}

const system = {
  kind: 'system',
  framework: 'crewai',
  topology: 'manager-workers',
  sourceFormat: 'crewai',
  members: [
    { ref: 'a', name: 'Planner', role: 'manager', description: 'Plans.', slug: 'planner-agent' },
    { ref: 'b', name: 'Coder', role: 'worker', description: 'Writes code.', slug: null },
    { ref: 'c', name: 'Reviewer', role: 'worker', description: null, slug: null },
  ],
}

describe('system detail page (AGENT_KINDS on)', () => {
  it('shows badge, members and topology; one h1; no axe violations', async () => {
    const container = mount(data(system))
    expect(container.querySelectorAll('h1')).toHaveLength(1)
    expect(container.querySelector('#system-members-heading')?.tagName).toBe('H2')
    expect(container.textContent).toContain('System · crewai')
    expect(container.textContent).toContain('Topology: Manager and workers')
    expect(container.querySelector('details')?.textContent).not.toContain('Language Model')
    await expectNoAxeViolations(container, { landmarks: true })
  })

  it('kind agent or flag off: no members section', () => {
    expect(mount(data({ ...system, kind: 'agent', members: [] })).querySelector('#system-members-heading')).toBeNull()
    expect(mount(data(null)).querySelector('#system-members-heading')).toBeNull()
  })
})
