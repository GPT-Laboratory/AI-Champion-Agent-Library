// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/svelte'
import McpTestPanel from './McpTestPanel.svelte'
import { apiFetch, CASES, jsonRes, SUBJECTS } from './mcpTestFixtures'

const running = (done: number) => ({ status: 'running', progress: { done, total: 12, current: 'T2-CATALOG-API' }, events: [], error: null })
const doneStatus = { status: 'done', progress: { done: 12, total: 12, current: null }, events: [], error: null }

function mount(fetchFn: typeof fetch, pollMs = 5) {
  return render(McpTestPanel, { props: { subjects: SUBJECTS, cases: CASES, fetchFn, pollMs } })
}
const run = () => fireEvent.click(screen.getByRole('button', { name: 'Run' }))

describe('McpTestPanel idle', () => {
  it('shows controls, grouped cases with badges and the fake disclaimer', () => {
    mount(apiFetch().fn)
    expect(screen.getByRole('heading', { name: 'Run the benchmark' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Tier 1' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Tier 3' })).toBeTruthy()
    expect(document.body.textContent).toContain('Source: needs real runtime')
    expect(document.body.textContent).toContain('Source: generator-only')
    expect(document.body.textContent).toContain('score the scorer fixtures, not a real generator')
    const reruns = screen.getByLabelText(/Reruns/) as HTMLInputElement
    expect(reruns.min).toBe('1')
    expect(reruns.max).toBe('3')
    const select = screen.getByLabelText('Subject') as HTMLSelectElement
    const real = [...select.options].find((o) => o.value === 'real:server')!
    expect(real.disabled).toBe(true)
    expect([...select.options].find((o) => o.value === 'fake:good')!.disabled).toBe(false)
    expect(document.body.textContent).toContain('Needs a real runtime; run from the command line.')
  })

  it('hides the disclaimer for a generator subject', async () => {
    mount(apiFetch().fn)
    await fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'generator:openapi' } })
    expect(document.body.textContent).not.toContain('score the scorer fixtures')
  })
})

describe('McpTestPanel run', () => {
  it('posts, polls with progress, then renders the report', async () => {
    const { fn, calls } = apiFetch({ statuses: [running(3), doneStatus] })
    mount(fn, 150)
    await fireEvent.input(screen.getByLabelText(/Reruns/), { target: { value: '2' } })
    await run()
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ subject: 'fake:good', reruns: 2 })
    expect(calls[0].url).toBe('/api/mcp-test/runs')
    await vi.waitFor(() => expect(screen.getByRole('status').textContent).toBe('Running: 3 of 12 cells, current T2-CATALOG-API'))
    expect((screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement).disabled).toBe(true)
    await vi.waitFor(() => expect(screen.getByRole('heading', { name: 'Results' })).toBeTruthy())
    expect(calls.some((c) => c.url === '/api/mcp-test/runs/run-1')).toBe(true)
    const text = document.body.textContent ?? ''
    expect(text).toContain('Verdict: BLOCKED')
    expect(text).toContain('3 of 4 cases run')
    const flags = [...screen.getByRole('heading', { name: 'Flags' }).nextElementSibling!.querySelectorAll('li')].map((l) => l.textContent ?? '')
    expect(flags[0]).toContain('LEAK')
    expect(flags[0]).toContain('Blocker')
    expect(flags[1]).toContain('SECRET_ECHO')
    expect(flags[2]).toContain('NO_RETRY')
    expect(flags[2]).toContain('Warning')
    const table = screen.getByRole('table')
    expect(table.querySelector('caption')?.textContent).toContain('Results per case')
    expect(table.querySelectorAll('th[scope="col"]').length).toBe(4)
    expect(table.querySelectorAll('th[scope="row"]').length).toBe(4)
    expect(text).toContain('Pending human')
    expect(text).toContain('N/A (input kind)')
    const link = screen.getByRole('link', { name: 'Download report.json' })
    expect(link.getAttribute('href')).toBe('/api/mcp-test/runs/run-1/report')
    expect(link.hasAttribute('download')).toBe(true)
    expect((screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it.each([
    [400, 'Unknown subject.'],
    [413, 'Body too large.'],
    [429, 'A run is already in progress.']
  ])('shows the %i error body in the alert', async (status, error) => {
    const fn = (async () => jsonRes({ ok: false, message: error }, status)) as unknown as typeof fetch
    mount(fn)
    await run()
    await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toBe(error))
    expect((screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows the run error when the run failed', async () => {
    const { fn } = apiFetch({ statuses: [{ status: 'failed', progress: { done: 1, total: 12, current: null }, events: [], error: 'Run timed out' }] })
    mount(fn)
    await run()
    await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Run timed out'))
  })

  it('shows a generic message on network failure', async () => {
    const fn = vi.fn(async () => {
      throw new Error('boom secret detail')
    }) as unknown as typeof fetch
    mount(fn)
    await run()
    await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Could not reach the test platform. Try again.'))
  })

  it('stores nothing and stops polling on unmount', async () => {
    const ls = vi.spyOn(Storage.prototype, 'setItem')
    const cookie = vi.spyOn(document, 'cookie', 'set')
    const { fn, calls } = apiFetch({ statuses: [running(1)] })
    const view = mount(fn, 5)
    await run()
    await vi.waitFor(() => expect(screen.getByRole('status').textContent).toContain('Running'))
    view.unmount()
    const n = calls.length
    await new Promise((r) => setTimeout(r, 40))
    expect(calls.length).toBeLessThanOrEqual(n + 1)
    const after = calls.length
    await new Promise((r) => setTimeout(r, 40))
    expect(calls.length).toBe(after)
    expect(ls).not.toHaveBeenCalled()
    expect(cookie).not.toHaveBeenCalled()
  })
})
