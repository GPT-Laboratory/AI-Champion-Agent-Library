// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/svelte'
import { strFromU8, unzipSync } from 'fflate'
import ResultView from './ResultView.svelte'
import { expectNoAxeViolations } from '$lib/testing/axe'

const RESULT = [
  '## Warranty register check',
  'as_of: 2026-03-02',
  '',
  '| warranty_id | verdict |',
  '|---|---|',
  '| W-01 | register-ok |',
  '| W-03 | expired |',
  '',
  '## Warranties needing attention',
  'W-03: expired',
  '',
  'Draft for engineer review. Uses `days_remaining`.',
].join('\n')

afterEach(() => vi.restoreAllMocks())

describe('ResultView', () => {
  it('renders headings, a table with chips and plain lines; no HTML from the text', () => {
    const { container } = render(ResultView, { props: { text: `${RESULT}\n<img src=x onerror=alert(1)>`, label: 'Result file result.md' } })
    expect(Array.from(container.querySelectorAll('h3')).map((h) => h.textContent)).toEqual(['Warranty register check', 'Warranties needing attention'])
    expect(Array.from(container.querySelectorAll('th')).map((h) => h.textContent?.trim())).toEqual(['warranty_id', 'verdict'])
    const chips = Array.from(container.querySelectorAll('tbody span'))
    expect(chips.map((c) => [c.textContent, /green/.test(c.className) ? 'good' : /red/.test(c.className) ? 'bad' : '?'])).toEqual([
      ['register-ok', 'good'],
      ['expired', 'bad'],
    ])
    expect(container.querySelector('code')?.textContent).toBe('days_remaining')
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('input mode shows notes, fields and CSV sections as tables', () => {
    const text = '# SYNTHETIC SAMPLE\nas_of: 2026-03-02\n## BLOCKS\nblock_id,title\nK1,"Stair, B"'
    const { container } = render(ResultView, { props: { text, mode: 'input', label: 'Example input' } })
    expect(container.querySelector('p.italic')?.textContent).toBe('SYNTHETIC SAMPLE')
    expect(container.querySelector('dt')?.textContent).toBe('as_of')
    expect(Array.from(container.querySelectorAll('td')).map((t) => t.textContent?.trim())).toEqual(['K1', 'Stair, B'])
  })

  it('an input never gets colour chips', () => {
    const { container } = render(ResultView, { props: { text: 'a,check\n1,agree\n2,fail', mode: 'input', label: 'Example input' } })
    expect(container.querySelector('tbody span')).toBeNull()
  })

  it('the toggle switches to the exact raw text and back', async () => {
    const { container, getByRole } = render(ResultView, { props: { text: RESULT, label: 'R' } })
    await fireEvent.click(getByRole('button', { name: 'Show raw text' }))
    expect(container.querySelector('pre')?.textContent).toBe(RESULT)
    expect(container.querySelector('table')).toBeNull()
    await fireEvent.click(getByRole('button', { name: 'Show as tables' }))
    expect(container.querySelector('table')).not.toBeNull()
  })

  it('startRaw starts with the raw text (JSON)', () => {
    const { container } = render(ResultView, { props: { text: '{"a":1}', label: 'R', startRaw: true } })
    expect(container.querySelector('pre')?.textContent).toBe('{"a":1}')
  })

  it('Excel button only with a name and a table; it saves a workbook with one sheet per table', async () => {
    const none = render(ResultView, { props: { text: 'no tables here', label: 'R', excelName: 'x.xlsx' } })
    expect(none.container.textContent).not.toContain('Excel')
    none.unmount()
    const noName = render(ResultView, { props: { text: RESULT, label: 'R' } })
    expect(noName.container.textContent).not.toContain('Excel')
    noName.unmount()

    let saved: Blob | null = null
    let name = ''
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => ((saved = b as Blob), 'blob:x'))
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      name = this.download
    })
    const { getByRole } = render(ResultView, { props: { text: RESULT, label: 'R', excelName: 'demo-result.xlsx' } })
    await fireEvent.click(getByRole('button', { name: 'Download table as Excel (.xlsx)' }))
    expect(name).toBe('demo-result.xlsx')
    const parts = unzipSync(new Uint8Array(await saved!.arrayBuffer()))
    expect(strFromU8(parts['xl/workbook.xml'])).toContain('name="Warranty register check"')
    expect(strFromU8(parts['xl/worksheets/sheet1.xml'])).toContain('register-ok')
  })

  it('has no axe violations', async () => {
    const { container } = render(ResultView, { props: { text: `${RESULT}\n\n- a\n- b\n\n\`\`\`\ncode\n\`\`\``, label: 'Result', excelName: 'r.xlsx' } })
    await expectNoAxeViolations(container)
  })
})
