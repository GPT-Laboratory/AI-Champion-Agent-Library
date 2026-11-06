// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import TryItOutPanel from './TryItOutPanel.svelte'
import { installFakeJobApi, type InstalledFakeJobApi } from '$lib/testing/fakeJobApi'
import { expectNoAxeViolations } from '$lib/testing/axe'

vi.mock('$app/navigation', () => ({
  replaceState: (url: string | URL) => {
    const target = url instanceof URL ? url : new URL(url, window.location.origin)
    window.history.replaceState({}, '', target)
  },
}))

let api: InstalledFakeJobApi | undefined

beforeEach(() => {
  vi.useFakeTimers()
  api = installFakeJobApi()
})

afterEach(() => {
  api?.uninstall()
  api = undefined
  vi.useRealTimers()
  window.history.replaceState({}, '', '/')
})

async function submit(container: HTMLElement, task: string) {
  const textarea = container.querySelector('textarea') as HTMLTextAreaElement
  await fireEvent.input(textarea, { target: { value: task } })
  await fireEvent.click(screen.getByRole('button', { name: 'Run' }))
}

describe('TryItOutPanel accessibility', () => {
  it('labels the controls and names the complementary landmark', () => {
    render(TryItOutPanel, { props: { agentId: 'demo' } })
    expect(screen.getByRole('textbox', { name: 'Task' })).toBeTruthy()
    expect(screen.getByLabelText('Attach a file (optional)')).toBeTruthy()
    expect(screen.getByRole('complementary', { name: 'Try it out' })).toBeTruthy()
  })

  it('has a persistent status region that announces job state changes', async () => {
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    const region = container.querySelector('[role="status"]') as HTMLElement
    expect(region).not.toBeNull()
    expect(region.textContent).toBe('')

    await submit(container, 'summarize the csv')
    await vi.advanceTimersByTimeAsync(400)
    await tick()
    expect(container.querySelector('[role="status"]')).toBe(region)
    expect(region.textContent).toMatch(/Job (queued|running)/)

    await vi.advanceTimersByTimeAsync(4000)
    await tick()
    expect(region.textContent).toBe('Job succeeded')
  })

  it('renders progress as a labelled, focusable log', async () => {
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    await submit(container, 'summarize the csv')
    await vi.advanceTimersByTimeAsync(1500)
    await tick()
    const log = screen.getByRole('log', { name: 'Progress' })
    expect(log.getAttribute('tabindex')).toBe('0')
  })

  it('announces a failure through role=alert', async () => {
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    await submit(container, 'please fail now')
    await vi.advanceTimersByTimeAsync(5000)
    await tick()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Job failed')
  })

  // axe schedules its own timers, so these tests switch to real timers once the job is terminal.
  it('has no axe violations idle', async () => {
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    vi.useRealTimers()
    await expectNoAxeViolations(container)
  })

  it('has no axe violations after success', async () => {
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    await submit(container, 'summarize the csv')
    await vi.advanceTimersByTimeAsync(5000)
    await tick()
    expect(screen.getByRole('log', { name: 'Progress' })).toBeTruthy()
    vi.useRealTimers()
    await expectNoAxeViolations(container)
  })

  it('has no axe violations after failure', async () => {
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    await submit(container, 'please fail now')
    await vi.advanceTimersByTimeAsync(5000)
    await tick()
    expect(screen.getByRole('alert')).toBeTruthy()
    vi.useRealTimers()
    await expectNoAxeViolations(container)
  })
})
