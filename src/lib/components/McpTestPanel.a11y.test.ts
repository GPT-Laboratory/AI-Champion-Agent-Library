// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/svelte'
import McpTestPanel from './McpTestPanel.svelte'
import { expectNoAxeViolations } from '$lib/testing/axe'
import { apiFetch, CASES, jsonRes, SUBJECTS } from './mcpTestFixtures'

function mount(fetchFn: typeof fetch, pollMs = 5) {
  return render(McpTestPanel, { props: { subjects: SUBJECTS, cases: CASES, fetchFn, pollMs } })
}

describe('McpTestPanel accessibility', () => {
  it('has no axe violations when idle', async () => {
    const { container } = mount(apiFetch().fn)
    await expectNoAxeViolations(container)
  })

  it('has no axe violations while running', async () => {
    const running = { status: 'running', progress: { done: 3, total: 12, current: 'T2-CATALOG-API' }, events: [], error: null }
    const { container } = mount(apiFetch({ statuses: [running] }).fn)
    await fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await vi.waitFor(() => expect(screen.getByRole('status').textContent).toContain('Running: 3 of 12'))
    await expectNoAxeViolations(container)
  })

  it('has no axe violations when done with a blocked verdict and flags', async () => {
    const { container } = mount(apiFetch().fn)
    await fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await vi.waitFor(() => expect(screen.getByRole('heading', { name: 'Results' })).toBeTruthy())
    expect(container.textContent).toContain('BLOCKED')
    await expectNoAxeViolations(container)
  })

  it('has no axe violations in the error state', async () => {
    const fn = (async () => jsonRes({ ok: false, message: 'A run is already in progress.' }, 429)) as unknown as typeof fetch
    const { container } = mount(fn)
    await fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toContain('already in progress'))
    await expectNoAxeViolations(container)
  })
})
