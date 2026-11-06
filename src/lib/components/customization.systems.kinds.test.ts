// @vitest-environment jsdom
// Phase 13: the Customization panel must not offer LLM or system prompt for systems. Synthetic data only.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/svelte'
import { createRawSnippet } from 'svelte'
import { readable } from 'svelte/store'

vi.mock('$app/navigation', () => ({ goto: vi.fn(), afterNavigate: vi.fn(), replaceState: vi.fn() }))
vi.mock('$app/stores', () => ({ page: readable({ url: new URL('http://localhost/agents/synthetic-team') }) }))

import Layout from '../../routes/+layout.svelte'
import DetailPage from '../../routes/agents/[slug]/+page.svelte'

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

describe('customization panel on system pages', () => {
  it('flag on, system: no Language Model, Temperature or System Prompt in the aside', () => {
    const container = mount(data(system))
    const aside = container.querySelector('aside[aria-labelledby="customization-heading"]')
    expect(aside).not.toBeNull()
    expect(aside!.textContent).not.toContain('Language Model')
    expect(aside!.textContent).not.toContain('Temperature')
    expect(aside!.textContent).not.toContain('System Prompt')
    expect(aside!.textContent).toContain('Tools')
  })

  it('flag off (no kindInfo): panel unchanged and still lists the Language Model', () => {
    const container = mount(data(null))
    const aside = container.querySelector('aside[aria-labelledby="customization-heading"]')
    expect(aside!.textContent).toContain('Language Model')
  })
})
