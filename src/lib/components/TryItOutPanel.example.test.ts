// @vitest-environment jsdom
// The optional agent example (data/tryitout-prompts/<slug>/example.yaml, docs/tryitout-example.md). A new file, so the
// existing TryItOutPanel tests stay unmodified (src/lib/mcptest/criteria.test.ts).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/svelte'
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

const example = {
  task: 'Compile the attached upload',
  file: { name: 'sample-x.txt', text: '## ELEMENTS\nE-1' },
  result: { label: 'From the helper. Not a model run.', text: '## E-BOM class rows\n| E-1 |' },
}

function button(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as
    | HTMLButtonElement
    | undefined
}

describe('TryItOutPanel example', () => {
  it('without an example the panel is unchanged: empty task, no example controls', () => {
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('')
    expect(container.querySelector('details')).toBeNull()
    expect(container.textContent).not.toMatch(/example/i)
  })

  it('prefills the task, attaches the example file and shows the input and the labelled result', () => {
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo', example } })
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe(example.task)
    expect(button(container, 'Run')!.disabled).toBe(false)
    expect(container.textContent).toContain('Attached: sample-x.txt (example input)')
    const details = Array.from(container.querySelectorAll('details'))
    expect(details.map((d) => d.querySelector('summary')?.textContent?.trim())).toEqual([
      'View example input (sample-x.txt)',
      'Show example result (no model call)',
    ])
    expect(details[0].querySelector('pre')?.textContent).toBe(example.file.text)
    expect(details[1].textContent).toContain(example.result.label)
    expect(details[1].querySelector('pre')?.textContent).toBe(example.result.text)
  })

  it('showing the example result makes no request', async () => {
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo', example } })
    await fireEvent.click(container.querySelectorAll('summary')[1])
    expect(api!.requests).toHaveLength(0)
  })

  it('Run sends the example task with the example file attached', async () => {
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo', example } })
    await fireEvent.click(button(container, 'Run')!)
    expect(api!.requests[0]).toMatchObject({ fields: { agentId: 'demo', task: example.task }, hasFile: true })
  })

  it('Remove detaches the example file; Use example file attaches it again', async () => {
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo', example } })
    await fireEvent.click(button(container, 'Remove')!)
    expect(container.textContent).not.toContain('Attached: sample-x.txt')
    await fireEvent.click(button(container, 'Run')!)
    expect(api!.requests[0].hasFile).toBe(false)
    await fireEvent.click(button(container, 'Use example file')!)
    expect(container.textContent).toContain('Attached: sample-x.txt (example input)')
  })

  it('choosing an own file replaces the example file', async () => {
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo', example } })
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    Object.defineProperty(fileInput, 'files', { value: [new File(['own'], 'own.txt')], configurable: true })
    await fireEvent.change(fileInput)
    expect(container.textContent).not.toContain('Attached: sample-x.txt')
    expect(button(container, 'Use example file')).toBeTruthy()
  })

  it('has no axe violations with both example views open', async () => {
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo', example } })
    for (const d of Array.from(container.querySelectorAll('details'))) d.open = true
    vi.useRealTimers()
    await expectNoAxeViolations(container)
  })
})
