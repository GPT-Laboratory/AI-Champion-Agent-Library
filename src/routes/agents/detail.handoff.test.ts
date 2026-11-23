// @vitest-environment jsdom
// Moving between agent pages (e.g. a "Related agents" link) reuses the page component; the Try It Out panel must start
// fresh for the new agent, and a hand-over (src/lib/handoff.ts) must show only on the page the hand-over button opened.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/svelte'
import { tick } from 'svelte'
import { HANDOFF_KEY } from '$lib/handoff'

vi.mock('$app/navigation', () => ({ goto: vi.fn(), afterNavigate: vi.fn(), replaceState: vi.fn() }))

import DetailPage from './[slug]/+page.svelte'

const data = (slug: string, task: string) => ({
  agent: {
    slug,
    title: slug,
    summary: 'An agent.',
    systemPrompt: 'You are helpful.',
    llmName: 'gpt-4o',
    llmTemperature: 0.7,
    llmMaxTokens: 1000,
    llmTopP: null,
    toolNames: [],
    requiresHumanApproval: false,
    category: null,
    githubUrl: null,
    linkLabel: 'Source',
    maturityStatus: 'beta',
    tags: [],
    specId: null,
    lastIngestedAt: '2026-08-18T00:00:00.000Z',
    tryItOutMode: 'runnable',
    tryItOutUrl: null,
    tryItOutTaskTemplate: null,
    customizableFields: null,
    fixedFields: [],
    fixedNote: null,
    inputFields: [],
  },
  related: [],
  openTryOut: true,
  tryItOutExample: { task, file: { name: `sample-${slug}.txt`, text: '## ELEMENTS\nx' }, result: null },
})

const storeHandOver = () =>
  sessionStorage.setItem(
    HANDOFF_KEY,
    JSON.stringify({ from: 'scope-rule-drafter', to: 'ifc-ebom-compiler', fileName: 'ebom-upload-with-rules.txt', text: '## RULES\nr\n## ELEMENTS\nx', note: 'From the Scope Rule Drafter: 1 rule added.', at: Date.now() }),
  )

beforeEach(() => sessionStorage.clear())
afterEach(() => window.history.replaceState({}, '', '/'))

describe('agent page: Try It Out panel per agent', () => {
  it('opened by the hand-over button: the note shows; moving to a related agent starts that agent fresh', async () => {
    window.history.replaceState({}, '', '/agents/ifc-ebom-compiler?tryout=1&handoff=1')
    storeHandOver()
    const { container, rerender } = render(DetailPage, { props: { data: data('ifc-ebom-compiler', 'Compile the upload') } as never })
    await tick()
    expect(container.textContent).toContain('From the Scope Rule Drafter: 1 rule added.')

    window.history.replaceState({}, '', '/agents/qto-normalization')
    await rerender({ data: data('qto-normalization', 'Normalise the table') } as never)
    await tick()
    expect(container.textContent).not.toContain('From the Scope Rule Drafter')
    expect(container.textContent).not.toContain('ebom-upload-with-rules.txt')
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Normalise the table')
    expect(container.textContent).toContain('Attached: sample-qto-normalization.txt (example input)')
  })

  it('opened any other way (no handoff flag): no note, and a left-over hand-over is discarded', async () => {
    window.history.replaceState({}, '', '/agents/ifc-ebom-compiler?tryout=1')
    storeHandOver()
    const { container } = render(DetailPage, { props: { data: data('ifc-ebom-compiler', 'Compile the upload') } as never })
    await tick()
    expect(container.textContent).not.toContain('From the Scope Rule Drafter')
    expect(container.textContent).toContain('Attached: sample-ifc-ebom-compiler.txt (example input)')
    expect(sessionStorage.getItem(HANDOFF_KEY)).toBeNull()
  })
})
