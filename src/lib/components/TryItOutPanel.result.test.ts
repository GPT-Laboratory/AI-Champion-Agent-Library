// @vitest-environment jsdom
// The result of a succeeded run shown on the page next to the download (docs/tryitout-example.md). A new file, so the
// existing TryItOutPanel tests stay unmodified (src/lib/mcptest/criteria.test.ts).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/svelte'
import { tick } from 'svelte'
import { strToU8, zipSync } from 'fflate'
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
let artifact: Uint8Array | null = null
let artifactGets = 0

beforeEach(() => {
  vi.useFakeTimers()
  api = installFakeJobApi()
  // The fake job API serves text; serve a real zip for the artifact route and pass everything else through.
  const inner = globalThis.fetch
  artifactGets = 0
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (artifact && /\/artifact$/.test(url)) {
      artifactGets++
      return new Response(artifact as unknown as BodyInit, { headers: { 'Content-Type': 'application/zip' } })
    }
    return inner(input, init)
  })
})

afterEach(() => {
  api?.uninstall()
  api = undefined
  artifact = null
  vi.useRealTimers()
  window.history.replaceState({}, '', '/')
})

const zip = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])))

async function runToSuccess(container: HTMLElement) {
  await fireEvent.input(container.querySelector('textarea')!, { target: { value: 'summarize the csv' } })
  const run = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Run')!
  await fireEvent.click(run)
  await vi.advanceTimersByTimeAsync(4400)
  await tick()
  await vi.advanceTimersByTimeAsync(0) // the artifact fetch
  await tick()
}

describe('TryItOutPanel result on the page', () => {
  it('shows the text files of the artifact, result.md first and open, next to the download button', async () => {
    artifact = zip({ 'ebom-join-check.md': 'helper check: match', 'result.md': '## Delivery check\nas_of: 2026-03-02' })
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    await runToSuccess(container)
    expect(container.textContent).toContain('Download results')
    expect(container.textContent).toContain('Result')
    const details = Array.from(container.querySelectorAll('details'))
    expect(details.map((d) => d.querySelector('summary')?.textContent?.trim())).toEqual(['result.md', 'ebom-join-check.md'])
    expect(details.map((d) => d.open)).toEqual([true, false])
    expect(details[0].querySelector('pre')?.textContent).toBe('## Delivery check\nas_of: 2026-03-02')
    expect(details[0].querySelector('pre')?.getAttribute('aria-label')).toBe('Result file result.md')
    expect(artifactGets).toBe(1)
  })

  it('renders the text as text, never as HTML', async () => {
    artifact = zip({ 'result.md': '<img src=x onerror=alert(1)><script>bad()</script>' })
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    await runToSuccess(container)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('pre')?.textContent).toContain('<script>bad()</script>')
  })

  it('when the artifact cannot be shown, says so and keeps the download', async () => {
    artifact = null // the fake job API serves plain text, not a zip
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    await runToSuccess(container)
    expect(container.textContent).toContain('The result cannot be shown here; use Download results.')
    expect(container.textContent).toContain('Download results')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('a new run clears the previous result until it has its own', async () => {
    artifact = zip({ 'result.md': 'first' })
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    await runToSuccess(container)
    expect(container.querySelector('pre')?.textContent).toBe('first')
    artifact = zip({ 'result.md': 'second' })
    const run = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Run')!
    await fireEvent.click(run)
    await tick()
    expect(container.textContent).not.toContain('first')
    await vi.advanceTimersByTimeAsync(4400)
    await tick()
    await vi.advanceTimersByTimeAsync(0)
    await tick()
    expect(container.querySelector('pre')?.textContent).toBe('second')
    expect(artifactGets).toBe(2)
  })

  it('has no axe violations with the result shown', async () => {
    artifact = zip({ 'result.md': '## Result\n| a | b |', 'check.md': 'ok' })
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    await runToSuccess(container)
    for (const d of Array.from(container.querySelectorAll('details'))) d.open = true
    vi.useRealTimers()
    await expectNoAxeViolations(container)
  })
})
