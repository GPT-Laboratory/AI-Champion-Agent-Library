// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/svelte'
import { tick } from 'svelte'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import TryItOutPanel from './TryItOutPanel.svelte'
import { installFakeJobApi, type InstalledFakeJobApi } from '$lib/testing/fakeJobApi'

// The panel's ?job= restore/persist wiring (07-05) calls $app/navigation's
// replaceState. Without a full SvelteKit router present, the real module
// throws (caught internally as a no-op — see tryItOutSession.ts), which
// would hide URL-persistence bugs from these tests. Mock it to actually
// mutate window.location, mirroring the real replace-semantics behavior, so
// the new restore describe block below can assert on window.location.search.
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
  window.history.replaceState({}, '', '/agents/demo-rfi-triage')
})

describe('TryItOutPanel idle render', () => {
  it('renders a Task label, a placeholder textarea, and a disabled Run button; no Progress label yet', () => {
    const { container, getByText } = render(TryItOutPanel, { props: { agentId: 'demo' } })

    const label = getByText('Task')
    expect(label.tagName).toBe('LABEL')

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea).not.toBeNull()
    expect(textarea.placeholder).toBe('Describe the task you want this agent to do…')

    const button = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Run'
    ) as HTMLButtonElement
    expect(button).not.toBeUndefined()
    expect(button.disabled).toBe(true)

    expect(container.textContent).not.toMatch(/Progress/)
  })

  it('enables Run once the task is non-empty', async () => {
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    const button = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Run'
    ) as HTMLButtonElement

    await fireEvent.input(textarea, { target: { value: 'summarize the csv' } })
    expect(button.disabled).toBe(false)
  })
})

describe('TryItOutPanel success flow', () => {
  it('runs a job to succeeded through submitJob + subscribeProgress', async () => {
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    await fireEvent.input(textarea, { target: { value: 'summarize the csv' } })

    const runButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Run'
    ) as HTMLButtonElement
    await fireEvent.click(runButton)

    await vi.advanceTimersByTimeAsync(400)
    await tick()

    const runningButton = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Running')
    ) as HTMLButtonElement
    expect(runningButton).not.toBeUndefined()
    expect(runningButton.disabled).toBe(true)
    expect(container.textContent).toMatch(/Progress/)

    await vi.advanceTimersByTimeAsync(1000)
    await tick()
    expect(container.textContent).toContain('using task text as input…')
    expect(container.textContent).toMatch(/\d{2}:\d{2}:\d{2}\s+using task text as input…/)

    await vi.advanceTimersByTimeAsync(3000)
    await tick()
    expect(container.textContent).toContain('using task text as input…')
    expect(container.textContent).toContain('calling model…')
    expect(container.textContent).toContain('writing output…')
    expect(container.textContent).toContain('agent settled (clean exit)')

    const finalButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Run'
    ) as HTMLButtonElement
    expect(finalButton).not.toBeUndefined()
    expect(finalButton.disabled).toBe(false)
  })

  it('works standalone with no props at all', async () => {
    const { container } = render(TryItOutPanel)
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    await fireEvent.input(textarea, { target: { value: 'summarize the csv' } })

    const runButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Run'
    ) as HTMLButtonElement
    await fireEvent.click(runButton)

    await vi.advanceTimersByTimeAsync(4400)
    await tick()

    expect(container.textContent).toContain('agent settled (clean exit)')
  })
})

describe('TryItOutPanel transport discipline', () => {
  it('imports only from $lib/tryItOut and contains no transport details or {@html}', () => {
    const src = readFileSync('src/lib/components/TryItOutPanel.svelte', 'utf8')
    expect(src).toMatch(/from '\$lib\/tryItOut'/)
    expect(src).not.toMatch(/fetch\s*\(/)
    expect(src).not.toMatch(/EventSource/)
    expect(src).not.toMatch(/XMLHttpRequest/)
    expect(src).not.toMatch(/https?:\/\//)
    expect(src).not.toMatch(/\{@html/)
  })
})

function getRunButton(container: HTMLElement): HTMLButtonElement {
  return Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === 'Run'
  ) as HTMLButtonElement
}

function findButtonByText(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === text
  ) as HTMLButtonElement | undefined
}

describe('TryItOutPanel fail path', () => {
  it('T2.6 shows the red Job failed block with the verbatim error and no Download button', async () => {
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    await fireEvent.input(textarea, { target: { value: 'please fail now' } })
    await fireEvent.click(getRunButton(container))

    await vi.advanceTimersByTimeAsync(4400)
    await tick()

    expect(container.textContent).toContain('Job failed')
    expect(container.textContent).toContain('model returned no output text')
    expect(container.textContent).toContain('Adjust your task and try again.')
    expect(container.querySelector('.bg-red-50')).not.toBeNull()
    expect(findButtonByText(container, 'Download results')).toBeUndefined()
    expect(container.textContent).toContain('calling model…')
    expect(container.textContent).toContain('agent failed')
  })
})

describe('TryItOutPanel download button visibility', () => {
  it('T2.7 success reveals a Download results button and no failed block', async () => {
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    await fireEvent.input(textarea, { target: { value: 'summarize the csv' } })
    await fireEvent.click(getRunButton(container))

    await vi.advanceTimersByTimeAsync(4400)
    await tick()

    expect(findButtonByText(container, 'Download results')).not.toBeUndefined()
    expect(container.querySelector('.bg-red-50')).toBeNull()
  })

  it('T2.8 no Download button at idle or immediately after clicking Run', async () => {
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    expect(findButtonByText(container, 'Download results')).toBeUndefined()

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    await fireEvent.input(textarea, { target: { value: 'summarize the csv' } })
    await fireEvent.click(getRunButton(container))

    expect(findButtonByText(container, 'Download results')).toBeUndefined()
  })
})

describe('TryItOutPanel download interaction', () => {
  it('T2.9 clicking Download triggers a real artifact and never leaks object URLs', async () => {
    let capturedBlob: Blob | null = null
    const createObjectURL = vi.fn((blob: Blob) => {
      capturedBlob = blob
      return 'blob:mock'
    })
    const revokeObjectURL = vi.fn()
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    await fireEvent.input(textarea, { target: { value: 'summarize the csv' } })
    await fireEvent.click(getRunButton(container))
    await vi.advanceTimersByTimeAsync(4400)
    await tick()

    const downloadButton = findButtonByText(container, 'Download results') as HTMLButtonElement
    await fireEvent.click(downloadButton)
    // downloadArtifact is fire-and-forget from the click handler and now
    // does a real `await fetch(...)` — flush that microtask chain.
    await vi.advanceTimersByTimeAsync(0)

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(capturedBlob).not.toBeNull()
    const text = await (capturedBlob as unknown as Blob).text()
    expect(text).toContain('summarize the csv')
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledTimes(createObjectURL.mock.calls.length)

    await fireEvent.click(downloadButton)
    await vi.advanceTimersByTimeAsync(0)
    expect(revokeObjectURL).toHaveBeenCalledTimes(createObjectURL.mock.calls.length)

    clickSpy.mockRestore()
  })
})

describe('TryItOutPanel XSS-shape assertion', () => {
  it('T2.10 renders the error as text, never markup', async () => {
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    await fireEvent.input(textarea, { target: { value: 'please fail now' } })
    await fireEvent.click(getRunButton(container))
    await vi.advanceTimersByTimeAsync(4400)
    await tick()

    const failedBlock = container.querySelector('.bg-red-50')
    expect(failedBlock).not.toBeNull()
    expect(failedBlock!.querySelector('script')).toBeNull()
    expect(failedBlock!.textContent).toContain('model returned no output text')

    const src = readFileSync('src/lib/components/TryItOutPanel.svelte', 'utf8')
    expect(src).not.toMatch(/\{@html/)
  })
})

describe('TryItOutPanel file input', () => {
  it('T2.12 renders a label bound to a single-file input', () => {
    const { container, getByText } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    const label = getByText('Attach a file (optional)')
    expect(label.tagName).toBe('LABEL')

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(fileInput).not.toBeNull()
    expect(label.getAttribute('for')).toBe(fileInput.id)
    expect(fileInput.hasAttribute('multiple')).toBe(false)
  })

  it('T2.13 an attached file reaches the client end-to-end into the downloaded artifact', async () => {
    let capturedBlob: Blob | null = null
    URL.createObjectURL = vi.fn((blob: Blob) => {
      capturedBlob = blob
      return 'blob:mock'
    }) as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['a,b\n1,2\n'], 'sample.csv', { type: 'text/csv' })
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true })
    await fireEvent.change(fileInput)

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    await fireEvent.input(textarea, { target: { value: 'summarize the csv' } })
    await fireEvent.click(getRunButton(container))
    await vi.advanceTimersByTimeAsync(4400)
    await tick()

    const downloadButton = findButtonByText(container, 'Download results') as HTMLButtonElement
    await fireEvent.click(downloadButton)
    await vi.advanceTimersByTimeAsync(0)

    expect(capturedBlob).not.toBeNull()
    const text = await (capturedBlob as unknown as Blob).text()
    expect(text).toContain('attached file: sample.csv')

    clickSpy.mockRestore()
  })
})

describe('TryItOutPanel bounded feed', () => {
  it('T2.14 feed container is capped, scrollable, monospace and lines wrap', async () => {
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    await fireEvent.input(textarea, { target: { value: 'summarize the csv' } })
    await fireEvent.click(getRunButton(container))
    await vi.advanceTimersByTimeAsync(400)
    await tick()

    const feed = container.querySelector('.font-mono') as HTMLElement
    expect(feed).not.toBeNull()
    expect(feed.className).toContain('max-h-64')
    expect(feed.className).toContain('overflow-y-auto')

    await vi.advanceTimersByTimeAsync(1000)
    await tick()
    const lines = Array.from(feed.querySelectorAll('p'))
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(line.className).toContain('whitespace-pre-wrap')
      expect(line.className).toContain('break-words')
    }
  })

  it('T2.15 the auto-scroll effect writes scrollTop to scrollHeight', async () => {
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    await fireEvent.input(textarea, { target: { value: 'summarize the csv' } })
    await fireEvent.click(getRunButton(container))
    await vi.advanceTimersByTimeAsync(400)
    await tick()

    const feed = container.querySelector('.font-mono') as HTMLElement
    Object.defineProperty(feed, 'scrollHeight', { value: 999, configurable: true })

    let recordedScrollTop: number | undefined
    Object.defineProperty(feed, 'scrollTop', {
      configurable: true,
      get() {
        return recordedScrollTop ?? 0
      },
      set(value: number) {
        recordedScrollTop = value
      }
    })

    await vi.advanceTimersByTimeAsync(1000)
    await tick()

    expect(recordedScrollTop).toBe(999)
  })

  it('T2.16 feed lines render in emission order, newest at bottom', async () => {
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    await fireEvent.input(textarea, { target: { value: 'summarize the csv' } })
    await fireEvent.click(getRunButton(container))
    await vi.advanceTimersByTimeAsync(4400)
    await tick()

    const feed = container.querySelector('.font-mono') as HTMLElement
    const lineTexts = Array.from(feed.querySelectorAll('p')).map((p) => p.textContent ?? '')
    const inputIndex = lineTexts.findIndex((t) => t.includes('using task text as input…'))
    const writeIndex = lineTexts.findIndex((t) => t.includes('writing output…'))
    expect(inputIndex).toBeGreaterThanOrEqual(0)
    expect(writeIndex).toBeGreaterThan(inputIndex)
  })
})

describe('TryItOutPanel re-run reset', () => {
  it('T2.11 clears the failed block and stale feed before the new job starts', async () => {
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    await fireEvent.input(textarea, { target: { value: 'please fail now' } })
    await fireEvent.click(getRunButton(container))
    await vi.advanceTimersByTimeAsync(4400)
    await tick()
    expect(container.querySelector('.bg-red-50')).not.toBeNull()

    await fireEvent.input(textarea, { target: { value: 'summarize the csv' } })
    await fireEvent.click(getRunButton(container))
    await tick()

    expect(container.querySelector('.bg-red-50')).toBeNull()
    expect(container.textContent).not.toContain('agent failed')

    await vi.advanceTimersByTimeAsync(4400)
    await tick()
    expect(findButtonByText(container, 'Download results')).not.toBeUndefined()
  })
})

describe('TryItOutPanel subscription cleanup', () => {
  it('T2.17 unmount mid-job clears every pending timer (threat T2)', async () => {
    const { container, unmount } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    await fireEvent.input(textarea, { target: { value: 'summarize the csv' } })
    await fireEvent.click(getRunButton(container))
    await vi.advanceTimersByTimeAsync(1000)
    await tick()

    unmount()

    expect(vi.getTimerCount()).toBe(0)

    await vi.advanceTimersByTimeAsync(10000)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('T2.18 no post-unmount console errors', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { container, unmount } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    await fireEvent.input(textarea, { target: { value: 'summarize the csv' } })
    await fireEvent.click(getRunButton(container))
    await vi.advanceTimersByTimeAsync(1000)
    await tick()

    unmount()
    await vi.advanceTimersByTimeAsync(10000)

    expect(errSpy).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('T2.19 terminal state releases the subscription: no further updates after succeeded', async () => {
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    await fireEvent.input(textarea, { target: { value: 'summarize the csv' } })
    await fireEvent.click(getRunButton(container))
    await vi.advanceTimersByTimeAsync(4400)
    await tick()

    const feed = container.querySelector('.font-mono') as HTMLElement
    const lineCountBefore = feed.querySelectorAll('p').length

    await vi.advanceTimersByTimeAsync(10000)
    await tick()

    const lineCountAfter = feed.querySelectorAll('p').length
    expect(lineCountAfter).toBe(lineCountBefore)
    expect(findButtonByText(container, 'Run')).not.toBeUndefined()
    expect(findButtonByText(container, 'Running…')).toBeUndefined()
  })

  it('T2.20 re-run does not stack subscriptions', async () => {
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement

    await fireEvent.input(textarea, { target: { value: 'summarize the csv' } })
    await fireEvent.click(getRunButton(container))
    await vi.advanceTimersByTimeAsync(4400)
    await tick()

    await fireEvent.input(textarea, { target: { value: 'summarize the csv' } })
    await fireEvent.click(getRunButton(container))
    await vi.advanceTimersByTimeAsync(4400)
    await tick()

    const feed = container.querySelector('.font-mono') as HTMLElement
    // 4, not 8: the real runner's frozen stage-line count (input, calling
    // model, writing output, settled) per job — not Phase 6's 5-event mock
    // script. Proves re-run replaced the old job's events rather than
    // appending to them.
    expect(feed.querySelectorAll('p').length).toBe(4)
  })
})

describe('TryItOutPanel job restore (?job=)', () => {
  function setUrl(path: string) {
    window.history.replaceState({}, '', path)
  }

  it('mounts with no ?job= param and stays idle — identical to Phase 6 behavior', () => {
    setUrl('/agents/demo-rfi-triage')
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })

    expect(container.textContent).not.toMatch(/Progress/)
    expect(api!.requests).toHaveLength(0)
  })

  it('restores a running job from ?job= without calling submitJob, and reaches the terminal state', async () => {
    const jobId = randomUUID()
    api?.uninstall()
    api = installFakeJobApi({
      scripts: {
        [jobId]: [
          { status: 'running', events: [{ ts: '00:00:00', type: 'info', summary: 'calling model…' }], error: null },
          {
            status: 'succeeded',
            events: [
              { ts: '00:00:00', type: 'info', summary: 'calling model…' },
              { ts: '00:00:01', type: 'info', summary: 'writing output…' },
              { ts: '00:00:02', type: 'info', summary: 'agent settled (clean exit)' },
            ],
            error: null,
          },
        ],
      },
    })
    setUrl(`/agents/demo-rfi-triage?job=${jobId}`)

    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    await vi.advanceTimersByTimeAsync(0)
    await tick()

    expect(container.textContent).toMatch(/Progress/)
    expect(container.textContent).toContain('calling model…')
    expect(api.requests.some((r) => r.method === 'POST')).toBe(false)

    await vi.advanceTimersByTimeAsync(1000)
    await tick()

    expect(container.textContent).toContain('agent settled (clean exit)')
    expect(findButtonByText(container, 'Download results')).not.toBeUndefined()
    expect(api.requests.some((r) => r.method === 'POST')).toBe(false)
  })

  it('restores a succeeded job showing the completed feed and a working Download button, with no re-run', async () => {
    const jobId = randomUUID()
    api?.uninstall()
    api = installFakeJobApi({
      scripts: {
        [jobId]: [
          {
            status: 'succeeded',
            events: [{ ts: '00:00:00', type: 'info', summary: 'agent settled (clean exit)' }],
            error: null,
          },
        ],
      },
      artifactTextFor: () => 'a real restored triage result',
    })
    setUrl(`/agents/demo-rfi-triage?job=${jobId}`)

    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    await vi.advanceTimersByTimeAsync(0)
    await tick()

    expect(container.textContent).toContain('agent settled (clean exit)')
    expect(container.querySelector('.bg-red-50')).toBeNull()
    expect(api.requests.some((r) => r.method === 'POST')).toBe(false)

    let capturedBlob: Blob | null = null
    URL.createObjectURL = vi.fn((blob: Blob) => {
      capturedBlob = blob
      return 'blob:mock'
    }) as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const downloadButton = findButtonByText(container, 'Download results') as HTMLButtonElement
    expect(downloadButton).not.toBeUndefined()
    await fireEvent.click(downloadButton)
    await vi.advanceTimersByTimeAsync(0)

    expect(capturedBlob).not.toBeNull()
    const text = await (capturedBlob as unknown as Blob).text()
    expect(text).toBe('a real restored triage result')

    clickSpy.mockRestore()
  })

  it('degrades a stale ?job= id (404 -> unknown job) to idle with no red block, and removes the job param', async () => {
    const jobId = randomUUID()
    api?.uninstall()
    api = installFakeJobApi({ statusPollNotFound: true })
    setUrl(`/agents/demo-rfi-triage?job=${jobId}`)

    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    await vi.advanceTimersByTimeAsync(0)
    await tick()

    expect(container.textContent).not.toMatch(/Progress/)
    expect(container.textContent).not.toContain('Job failed')
    expect(container.querySelector('.bg-red-50')).toBeNull()
    expect(window.location.search).not.toContain('job=')
  })

  it('treats a malformed ?job= value as no param at all — idle, no network call', () => {
    setUrl('/agents/demo-rfi-triage?job=not-a-uuid')
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })

    expect(container.textContent).not.toMatch(/Progress/)
    expect(api!.requests).toHaveLength(0)
  })

  it('writes the new jobId into the URL after a successful run()', async () => {
    setUrl('/agents/demo-rfi-triage')
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement

    await fireEvent.input(textarea, { target: { value: 'summarize the csv' } })
    await fireEvent.click(getRunButton(container))
    await vi.advanceTimersByTimeAsync(0)
    await tick()

    const search = new URLSearchParams(window.location.search)
    expect(search.get('job')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)

    const postReq = api!.requests.find((r) => r.method === 'POST')
    expect(postReq).toBeDefined()
  })

  it('clears the previous ?job= before writing the new one on re-run', async () => {
    setUrl('/agents/demo-rfi-triage')
    const { container } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement

    await fireEvent.input(textarea, { target: { value: 'summarize the csv' } })
    await fireEvent.click(getRunButton(container))
    await vi.advanceTimersByTimeAsync(0)
    await tick()

    const firstJobId = new URLSearchParams(window.location.search).get('job')
    expect(firstJobId).not.toBeNull()

    await vi.advanceTimersByTimeAsync(4400)
    await tick()

    await fireEvent.input(textarea, { target: { value: 'summarize the csv' } })
    await fireEvent.click(getRunButton(container))

    // Immediately on re-run — before the new submitJob resolves — the
    // stale previous job's id must already be gone from the URL.
    expect(window.location.search).not.toContain(`job=${firstJobId}`)

    await vi.advanceTimersByTimeAsync(4400)
    await tick()

    const secondJobId = new URLSearchParams(window.location.search).get('job')
    expect(secondJobId).not.toBeNull()
    expect(secondJobId).not.toBe(firstJobId)
  })

  it('unmounting mid-restore clears the pending poll timer (extends T2.17 to the restore path)', async () => {
    const jobId = randomUUID()
    api?.uninstall()
    api = installFakeJobApi({
      scripts: {
        [jobId]: [
          { status: 'running', events: [], error: null },
          { status: 'running', events: [], error: null },
        ],
      },
    })
    setUrl(`/agents/demo-rfi-triage?job=${jobId}`)

    const { unmount } = render(TryItOutPanel, { props: { agentId: 'demo' } })
    await vi.advanceTimersByTimeAsync(0)
    await tick()

    unmount()
    expect(vi.getTimerCount()).toBe(0)

    await vi.advanceTimersByTimeAsync(10000)
    expect(vi.getTimerCount()).toBe(0)
  })
})
