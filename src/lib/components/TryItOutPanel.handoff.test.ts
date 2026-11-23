// @vitest-environment jsdom
// Hand-over of the scope rules to the IFC EBOM Compiler (src/lib/handoff.ts, docs/tryitout-example.md). A new file,
// so the existing TryItOutPanel tests stay unmodified (src/lib/mcptest/criteria.test.ts).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/svelte'
import { tick } from 'svelte'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import TryItOutPanel from './TryItOutPanel.svelte'
import { installFakeJobApi, type InstalledFakeJobApi } from '$lib/testing/fakeJobApi'
import { expectNoAxeViolations } from '$lib/testing/axe'
import { HANDOFF_KEY } from '$lib/handoff'

const opened: string[] = []
vi.mock('$lib/handoff', async (orig) => ({ ...(await orig<typeof import('$lib/handoff')>()), openAgentPage: (slug: string) => void opened.push(slug) }))
vi.mock('$app/navigation', () => ({
  replaceState: (url: string | URL) => {
    const target = url instanceof URL ? url : new URL(url, window.location.origin)
    window.history.replaceState({}, '', target)
  },
}))

const read = (slug: string, f: string) => readFileSync(join(process.cwd(), 'data/tryitout-prompts', slug, f), 'utf8')
const RULES_SAMPLE = read('scope-rule-drafter', 'sample-scope-rules.txt')
const RULES_KEY = read('scope-rule-drafter', 'example-result.md')
const rulesExample = {
  task: 'Turn the sentences into rules',
  file: { name: 'sample-scope-rules.txt', text: RULES_SAMPLE },
  result: { label: 'Not a model run.', text: RULES_KEY },
}
const ifcExample = {
  task: 'Compile the attached upload',
  file: { name: 'sample-ifc-elements.txt', text: read('ifc-ebom-compiler', 'sample-ifc-elements.txt') },
  result: null,
}
const LABEL = 'Use these rules in the IFC EBOM Compiler →'
const buttons = (c: HTMLElement) => Array.from(c.querySelectorAll('button'))
const byText = (c: HTMLElement, t: string) => buttons(c).find((b) => b.textContent?.replace(/\s+/g, ' ').trim() === t)

let api: InstalledFakeJobApi | undefined
let artifact: Uint8Array | null = null

beforeEach(() => {
  vi.useFakeTimers()
  api = installFakeJobApi()
  opened.length = 0
  sessionStorage.clear()
  const inner = globalThis.fetch
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (artifact && /\/artifact$/.test(url)) return new Response(artifact as unknown as BodyInit)
    if (/\/check$/.test(url)) return new Response(JSON.stringify({ check: null }))
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

describe('sending: the scope rule drafter', () => {
  it('the example result offers the hand-over; it stores the spliced upload and opens the compiler page', async () => {
    const { container } = render(TryItOutPanel, { props: { agentId: 'scope-rule-drafter', example: rulesExample } })
    await fireEvent.click(byText(container, LABEL)!)
    expect(opened).toEqual(['ifc-ebom-compiler'])
    const stored = JSON.parse(sessionStorage.getItem(HANDOFF_KEY)!)
    expect(stored).toMatchObject({ from: 'scope-rule-drafter', to: 'ifc-ebom-compiler', fileName: 'ebom-upload-with-rules.txt' })
    expect(stored.text).toContain('## RULES\ntext:1: system = SYN-SPRINKLER')
    expect(stored.text).not.toContain('## RULE TEXT')
    expect(api!.requests).toHaveLength(0) // no request, no model call
  })

  it('a run result offers the hand-over too, built from the file the run used', async () => {
    artifact = zipSync({ 'result.md': strToU8(RULES_KEY) })
    const { container } = render(TryItOutPanel, { props: { agentId: 'scope-rule-drafter', example: rulesExample } })
    await fireEvent.click(byText(container, 'Run')!)
    await vi.advanceTimersByTimeAsync(4400)
    await tick()
    await vi.advanceTimersByTimeAsync(0)
    await tick()
    const hand = buttons(container).filter((b) => b.textContent?.replace(/\s+/g, ' ').trim() === LABEL)
    expect(hand).toHaveLength(2) // under the example result and under the run's result
    await fireEvent.click(hand[1])
    expect(JSON.parse(sessionStorage.getItem(HANDOFF_KEY)!).text).toContain('text:2: type_name = Temporary duct')
  })

  it('other agents and results without a rule offer no hand-over', () => {
    const none = render(TryItOutPanel, { props: { agentId: 'scope-rule-drafter', example: { ...rulesExample, result: { label: 'x', text: '## RULES\nnone' } } } })
    expect(byText(none.container, LABEL)).toBeUndefined()
    none.unmount()
    const other = render(TryItOutPanel, { props: { agentId: 'ifc-ebom-compiler', example: { ...ifcExample, result: { label: 'x', text: RULES_KEY } } } })
    expect(byText(other.container, LABEL)).toBeUndefined()
  })
})

describe('receiving: the IFC EBOM Compiler', () => {
  const handOver = (to = 'ifc-ebom-compiler') =>
    sessionStorage.setItem(
      HANDOFF_KEY,
      JSON.stringify({ from: 'scope-rule-drafter', to, fileName: 'ebom-upload-with-rules.txt', text: '## RULES\ntext:1: a = b -> exclude (S-1: s)\n## ELEMENTS\nx', note: 'From the Scope Rule Drafter: 1 rule added.', at: Date.now() }),
    )

  it('attaches the handed-over file with a note; Run sends it; the example is one click away', async () => {
    handOver()
    const { container } = render(TryItOutPanel, { props: { agentId: 'ifc-ebom-compiler', example: ifcExample } })
    await tick()
    expect(container.textContent).toContain('From the Scope Rule Drafter: 1 rule added.')
    expect(container.textContent).toContain('Attached: ebom-upload-with-rules.txt')
    expect(container.textContent).not.toContain('(example input)')
    expect(byText(container, 'Use example file')).toBeUndefined() // only the note's own link
    expect(sessionStorage.getItem(HANDOFF_KEY)).toBeNull() // taken once
    await fireEvent.click(byText(container, 'Run')!)
    expect(api!.requests[0]).toMatchObject({ fields: { agentId: 'ifc-ebom-compiler', task: ifcExample.task }, hasFile: true })
    await fireEvent.click(byText(container, 'Use the example file instead')!)
    expect(container.textContent).not.toContain('From the Scope Rule Drafter')
    expect(container.textContent).toContain('Attached: sample-ifc-elements.txt (example input)')
  })

  it('a hand-over for another agent is left alone', async () => {
    handOver('qto-normalization')
    const { container } = render(TryItOutPanel, { props: { agentId: 'ifc-ebom-compiler', example: ifcExample } })
    await tick()
    expect(container.textContent).not.toContain('From the Scope Rule Drafter')
    expect(sessionStorage.getItem(HANDOFF_KEY)).not.toBeNull()
  })

  it('has no axe violations with the hand-over note shown', async () => {
    handOver()
    const { container } = render(TryItOutPanel, { props: { agentId: 'ifc-ebom-compiler', example: ifcExample } })
    await tick()
    for (const d of Array.from(container.querySelectorAll('details'))) d.open = true
    vi.useRealTimers()
    await expectNoAxeViolations(container)
  })
})
