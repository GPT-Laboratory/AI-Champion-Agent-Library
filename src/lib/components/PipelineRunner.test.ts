// @vitest-environment jsdom
// The pipeline page's runner (docs/pipelines.md): three Try It Out jobs with tool hand-overs and two approval gates.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/svelte'
import { tick } from 'svelte'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import PipelineRunner from './PipelineRunner.svelte'
import { installFakeJobApi, type InstalledFakeJobApi } from '$lib/testing/fakeJobApi'
import { expectNoAxeViolations } from '$lib/testing/axe'
import { RESULT_COLS, classRows, parseUpload } from '$lib/ebom/ebomJoin'
import { table } from '$lib/ebom/ebomCheck'

vi.mock('$app/navigation', () => ({ replaceState: vi.fn(), goto: vi.fn() }))

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const RULE_DATA = read('data/tryitout-prompts/scope-rule-drafter/sample-ebom-input.txt')
const RULE_KEY = read('data/tryitout-prompts/scope-rule-drafter/example-result.md')
const IFC_SAMPLE = read('data/tryitout-prompts/ifc-ebom-compiler/sample-ifc-elements.txt')
const pipeline = (data = { name: 'sample-ebom-input.txt', text: RULE_DATA }) => ({
  steps: [
    { slug: 'scope-rule-drafter', title: 'Scope Rule Drafter', task: 'Sprinkler piping is delivered by the sprinkler contractor.', runnable: true },
    { slug: 'ifc-ebom-compiler', title: 'IFC EBOM Compiler', task: 'Compile the attached upload', runnable: true },
    { slug: 'product-sourcing-mbom', title: 'Product Sourcing MBOM', task: 'Match each E-BOM line', runnable: true },
  ],
  data,
  mapping: read('data/pipelines/rules-to-mbom/designation-mapping.csv'),
  catalog: read('data/pipelines/rules-to-mbom/catalog-excerpt.csv'),
})

/** The E-BOM agent's answer for an upload: the tool's own class rows, so the contract holds. */
const ebomResult = (upload: string) =>
  `## E-BOM class rows\n${table([...RESULT_COLS], classRows(parseUpload(upload)).map((r) => RESULT_COLS.map((c) => r[c])))}\n`

let api: InstalledFakeJobApi | undefined
let submitted: { agentId: string; text: string }[] = []

beforeEach(() => {
  vi.useFakeTimers()
  api = installFakeJobApi()
  submitted = []
  const inner = globalThis.fetch
  const agentOf = new Map<string, { agentId: string; text: string }>()
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (init?.method === 'POST' && /\/api\/tryitout\/jobs$/.test(url)) {
      const form = init.body as FormData
      const file = form.get('file') as File
      const sub = { agentId: String(form.get('agentId')), text: await file.text() }
      submitted.push(sub)
      const res = await inner(input, init)
      agentOf.set((await res.clone().json()).jobId, sub)
      return res
    }
    const art = /\/jobs\/([^/]+)\/artifact$/.exec(url)
    if (art) {
      const job = agentOf.get(art[1])!
      const result = job.agentId === 'scope-rule-drafter' ? RULE_KEY : job.agentId === 'ifc-ebom-compiler' ? ebomResult(job.text) : '## M-BOM draft\nok'
      return new Response(zipSync({ 'result.md': strToU8(result) }) as unknown as BodyInit)
    }
    if (/\/check$/.test(url)) return new Response(JSON.stringify({ check: null }))
    return inner(input, init)
  })
})

afterEach(() => {
  api?.uninstall()
  api = undefined
  vi.useRealTimers()
})

const button = (c: HTMLElement, text: string) => Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.replace(/\s+/g, ' ').trim().startsWith(text))
async function finishJob() {
  await vi.advanceTimersByTimeAsync(4400)
  await tick()
  await vi.advanceTimersByTimeAsync(0)
  await tick()
  await vi.advanceTimersByTimeAsync(0)
  await tick()
}

describe('PipelineRunner', () => {
  it('runs the three steps with the tool hand-overs and an approval at each gate', async () => {
    const { container } = render(PipelineRunner, { props: { pipeline: pipeline() } })
    expect(button(container, 'Approve and continue')).toBeUndefined()
    await fireEvent.click(button(container, 'Run the pipeline')!)
    await finishJob()

    // Gate 1: the rules of step 1, editable; nothing else ran yet.
    expect(submitted.map((s) => s.agentId)).toEqual(['scope-rule-drafter'])
    expect(submitted[0].text).toBe(RULE_DATA)
    const rules = container.querySelector('#pipeline-rules-edit') as HTMLTextAreaElement
    expect(rules.value.split('\n')).toHaveLength(2)
    await fireEvent.click(button(container, 'Approve and continue')!)
    await finishJob()

    // Step 2 got the E-BOM data with the rules spliced in; gate 2 shows the lines the tool joined.
    expect(submitted[1].agentId).toBe('ifc-ebom-compiler')
    expect(submitted[1].text).toContain('## RULES\ntext:1: system = SYN-SPRINKLER')
    expect(container.textContent).toContain('EB-03: SYN Round duct 100 in K2, 3 m (measured 2.275 m)')
    await fireEvent.click(button(container, 'Approve and continue')!)
    await finishJob()

    // Step 3 got the E-BOM lines and the catalog in the sourcing format.
    expect(submitted[2].agentId).toBe('product-sourcing-mbom')
    expect(submitted[2].text).toContain('## E-BOM\nline_id,description,req_class,req_dn,req_material,qty,unit\nEB-01,SYN Bend 100 in K1')
    expect(submitted[2].text).toContain('## CATALOG EXCERPT')
    expect(container.textContent).toContain('The pipeline is done.')
    expect(Array.from({ length: 3 }, (_, i) => container.querySelector(`[data-testid="step-${i}-status"]`)?.textContent)).toEqual(['Done', 'Done', 'Done'])
  })

  it('edited rules are what the E-BOM step gets', async () => {
    const { container } = render(PipelineRunner, { props: { pipeline: pipeline() } })
    await fireEvent.click(button(container, 'Run the pipeline')!)
    await finishJob()
    await fireEvent.input(container.querySelector('#pipeline-rules-edit')!, { target: { value: 'text:1: type_name = Bend -> exclude (S-1: bends are supplied by the owner)' } })
    await fireEvent.click(button(container, 'Approve and continue')!)
    await finishJob()
    expect(submitted[1].text).toContain('## RULES\ntext:1: type_name = Bend -> exclude')
    expect(submitted[1].text).not.toContain('SYN-SPRINKLER ->')
  })

  it('data with its own rules: the choice appears, and "use only them" skips step 1', async () => {
    const { container } = render(PipelineRunner, { props: { pipeline: pipeline({ name: 'own.txt', text: IFC_SAMPLE }) } })
    expect(container.textContent).toContain('The data already has 3 scope rules')
    await fireEvent.click(Array.from(container.querySelectorAll('input[name="pipeline-rules"]'))[2])
    await fireEvent.click(button(container, 'Run the pipeline')!)
    await finishJob()
    expect(submitted.map((s) => s.agentId)).toEqual(['ifc-ebom-compiler'])
    expect(submitted[0].text).toBe(IFC_SAMPLE)
    expect(container.querySelector('[data-testid="step-0-status"]')?.textContent).toBe('Skipped: the data’s own rules are used')
  })

  it('a failed step stops the pipeline; Start over returns to the inputs', async () => {
    const { container } = render(PipelineRunner, { props: { pipeline: pipeline() } })
    await fireEvent.input(container.querySelector('#pipeline-notes')!, { target: { value: 'please fail now' } })
    await fireEvent.click(button(container, 'Run the pipeline')!)
    await finishJob()
    expect(container.querySelector('[data-testid="step-0-status"]')?.textContent).toBe('Failed')
    expect(container.querySelector('[role="alert"]')?.textContent).toBeTruthy()
    expect(button(container, 'Approve and continue')).toBeUndefined()
    await fireEvent.click(button(container, 'Start over')!)
    expect((button(container, 'Run the pipeline') as HTMLButtonElement).disabled).toBe(false)
  })

  it('cannot run when a step is not runnable here', () => {
    const p = pipeline()
    p.steps[2].runnable = false
    const { container } = render(PipelineRunner, { props: { pipeline: p } })
    expect(container.textContent).toContain('Not every agent of this pipeline can run here')
    expect((button(container, 'Run the pipeline') as HTMLButtonElement).disabled).toBe(true)
  })

  it('has no axe violations at a gate', async () => {
    const { container } = render(PipelineRunner, { props: { pipeline: pipeline() } })
    await fireEvent.click(button(container, 'Run the pipeline')!)
    await finishJob()
    vi.useRealTimers()
    await expectNoAxeViolations(container)
  })
})
