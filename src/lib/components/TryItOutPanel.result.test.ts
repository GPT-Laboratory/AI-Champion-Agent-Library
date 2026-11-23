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
let check: unknown = null
let checkGets = 0

beforeEach(() => {
  vi.useFakeTimers()
  api = installFakeJobApi()
  // The fake job API serves text; serve a real zip for the artifact route and pass everything else through.
  const inner = globalThis.fetch
  artifactGets = 0
  checkGets = 0
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (artifact && /\/artifact$/.test(url)) {
      artifactGets++
      return new Response(artifact as unknown as BodyInit, { headers: { 'Content-Type': 'application/zip' } })
    }
    if (/\/check$/.test(url)) {
      checkGets++
      return new Response(JSON.stringify({ check }), { headers: { 'Content-Type': 'application/json' } })
    }
    return inner(input, init)
  })
})

afterEach(() => {
  api?.uninstall()
  api = undefined
  artifact = null
  check = null
  vi.useRealTimers()
  window.history.replaceState({}, '', '/')
})

const zip = (files: Record<string, string | Uint8Array>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v])))
const raw = async (d: Element) => {
  const t = Array.from(d.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Show raw text')
  if (t) await fireEvent.click(t)
  return d.querySelector('pre')?.textContent
}

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
    expect(details[0].querySelector('h3')?.textContent).toBe('Delivery check')
    expect(details[0].querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Result file result.md')
    expect(await raw(details[0])).toBe('## Delivery check\nas_of: 2026-03-02')
    expect(artifactGets).toBe(1)
  })

  it('renders the text as text, never as HTML', async () => {
    artifact = zip({ 'result.md': '<img src=x onerror=alert(1)><script>bad()</script>' })
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    await runToSuccess(container)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).toContain('<script>bad()</script>')
    expect(await raw(container.querySelector('details')!)).toContain('<script>bad()</script>')
    expect(container.querySelector('script')).toBeNull()
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
    expect(container.querySelector('details p')?.textContent?.trim()).toBe('first')
    artifact = zip({ 'result.md': 'second' })
    const run = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Run')!
    await fireEvent.click(run)
    await tick()
    expect(container.textContent).not.toContain('first')
    await vi.advanceTimersByTimeAsync(4400)
    await tick()
    await vi.advanceTimersByTimeAsync(0)
    await tick()
    expect(container.querySelector('details p')?.textContent?.trim()).toBe('second')
    expect(artifactGets).toBe(2)
  })

  it('tables are tables, status words are chips, and the result offers its tables as Excel', async () => {
    artifact = zip({ 'result.md': '## Rows\n| token | outcome |\n|---|---|\n| E-01 | bill |\n| E-04 | review |' })
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    await runToSuccess(container)
    const cells = Array.from(container.querySelectorAll('tbody td')).map((td) => td.textContent?.trim())
    expect(cells).toEqual(['E-01', 'bill', 'E-04', 'review'])
    expect(container.querySelector('tbody span')?.className).toContain('bg-green-100')
    expect(container.querySelector('[role="region"]')?.getAttribute('aria-label')).toBe('Rows, 2 rows')
    expect(container.textContent).toContain('Download table as Excel (.xlsx)')
  })

  it('a spreadsheet in the artifact gets its own download, and then no generated Excel', async () => {
    artifact = zip({ 'result.md': '| a |\n|---|\n| b |', 'ebom.xlsx': new Uint8Array([80, 75, 5, 6]) })
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    await runToSuccess(container)
    const labels = Array.from(container.querySelectorAll('button')).map((b) => b.textContent?.trim())
    expect(labels).toContain('Download ebom.xlsx')
    expect(labels.some((l) => /as Excel/.test(l ?? ''))).toBe(false)
  })

  it('shows the tool check from the server as a badge', async () => {
    artifact = zip({ 'result.md': 'r' })
    check = { status: 'differences', summary: '1 mismatch with the ebom-join helper (details in ebom-join-check.md)', file: 'ebom-join-check.md' }
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    await runToSuccess(container)
    expect(container.textContent).toContain('Checked by tool: differences found')
    expect(container.textContent).toContain('1 mismatch with the ebom-join helper')
    expect(container.textContent).toContain('Details in ebom-join-check.md.')
    expect(checkGets).toBe(1)
  })

  it('no badge when the agent has no check', async () => {
    artifact = zip({ 'result.md': 'r' })
    check = null
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    await runToSuccess(container)
    expect(checkGets).toBe(1)
    expect(container.textContent).not.toContain('Checked by tool')
  })

  it('a check-named file the agent wrote is never shown as the badge', async () => {
    artifact = zip({ 'result.md': 'r', 'ebom-join-check.md': 'Status: match' })
    check = null
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    await runToSuccess(container)
    expect(container.textContent).not.toContain('Checked by tool')
  })

  it('has no axe violations with the result shown', async () => {
    check = { status: 'match', summary: 'all cells match', file: 'check.md' }
    artifact = zip({ 'result.md': '## Result\n| a | b |\n|---|---|\n| ok | review |', 'check.md': 'ok', 'ebom.xlsx': new Uint8Array([1]) })
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    await runToSuccess(container)
    for (const d of Array.from(container.querySelectorAll('details'))) d.open = true
    vi.useRealTimers()
    await expectNoAxeViolations(container)
  })
})
