// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import GenerateMcpPanel from './GenerateMcpPanel.svelte'
import { expectNoAxeViolations } from '$lib/testing/axe'

async function submit(fetchFn: typeof fetch) {
  const view = render(GenerateMcpPanel, { props: { fetchFn } })
  await fireEvent.input(screen.getByLabelText('Schema or spec text'), { target: { value: 'x' } })
  await fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
  await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Generate' }).hasAttribute('disabled')).toBe(false))
  await tick()
  return view
}

describe('GenerateMcpPanel accessibility', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    HTMLAnchorElement.prototype.click = vi.fn()
  })

  it('has no axe violations in the default state', async () => {
    const { container } = render(GenerateMcpPanel)
    await expectNoAxeViolations(container)
  })

  it('has no axe violations in the error state', async () => {
    const body = { ok: false, gaps: [{ code: 'bad-input', message: 'Nope', severity: 'error' }] }
    const { container } = await submit(
      vi.fn(async () => new Response(JSON.stringify(body), { status: 422 })) as unknown as typeof fetch
    )
    expect(screen.getByRole('alert').textContent).toContain('bad-input: Nope')
    await expectNoAxeViolations(container)
  })

  it('has no axe violations after success', async () => {
    const { container } = await submit(
      vi.fn(async () => new Response(new Uint8Array([80, 75]), { status: 200, headers: { 'content-type': 'application/zip' } })) as unknown as typeof fetch
    )
    expect(screen.getByRole('status').textContent).toBe('Download started')
    await expectNoAxeViolations(container)
  })
})
