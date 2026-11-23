import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cellTone, hasTable, parseDocument, parseInline, splitCsvLine, splitPipeRow, type Block } from './resultMarkdown'

const kinds = (b: Block[]) => b.map((x) => x.kind)
const tables = (b: Block[]) => b.filter((x): x is Extract<Block, { kind: 'table' }> => x.kind === 'table')

describe('row splitting', () => {
  it('pipe rows honour \\| and code spans', () => {
    expect(splitPipeRow('| a | b \\| c | `x|y` |')).toEqual(['a', 'b | c', '`x|y`'])
    expect(splitPipeRow('a | b | c', false)).toEqual(['a', 'b', 'c'])
  })
  it('CSV keeps quoted commas and doubled quotes', () => {
    expect(splitCsvLine('Q-02,ilmanvaihto,"36,4",m')).toEqual(['Q-02', 'ilmanvaihto', '36,4', 'm'])
    expect(splitCsvLine('a,"say ""hi""",')).toEqual(['a', 'say "hi"', ''])
  })
})

describe('parseInline', () => {
  it('reads code spans and strong runs, keeps the rest as text (no HTML)', () => {
    expect(parseInline('use `a` and **b** <i>c</i>')).toEqual([
      { t: 'text', v: 'use ' },
      { t: 'code', v: 'a' },
      { t: 'text', v: ' and ' },
      { t: 'strong', v: 'b' },
      { t: 'text', v: ' <i>c</i>' },
    ])
  })
})

describe('parseDocument, result mode', () => {
  const doc = [
    '## E-BOM class rows',
    '| token | outcome |',
    '|---|---|',
    '| E-01 | bill |',
    '| E-02 | review | extra |',
    '',
    '- one',
    '- two',
    '1. first',
    '',
    '```',
    '| not | a table |',
    '```',
    'Draft for review.',
    'Second line.',
  ].join('\n')
  const b = parseDocument(doc)

  it('headings, tables (named after their heading, made rectangular), lists, code and lines', () => {
    expect(kinds(b)).toEqual(['heading', 'table', 'list', 'list', 'code', 'lines'])
    expect(tables(b)[0]).toEqual({ kind: 'table', header: ['token', 'outcome', ''], rows: [['E-01', 'bill', ''], ['E-02', 'review', 'extra']], title: 'E-BOM class rows' })
    expect(b[4]).toEqual({ kind: 'code', text: '| not | a table |' })
    expect((b[5] as Extract<Block, { kind: 'lines' }>).lines).toHaveLength(2)
    expect(hasTable(b)).toBe(true)
  })

  it('CSV and # lines are not special in a result', () => {
    expect(kinds(parseDocument('# Title\na,b\nc,d'))).toEqual(['heading', 'lines'])
  })
})

describe('parseDocument, input mode', () => {
  it('notes, fields, CSV and bar tables; rule lines stay lines', () => {
    const t = ['# SYNTHETIC SAMPLE', 'as_of: 2026-03-02', '## BLOCKS', 'id,title', 'K1,"Stair, B"', '## RULES', 'rules:1: system = X -> exclude (r)', 'a | b', '1 | 2'].join('\n')
    const b = parseDocument(t, 'input')
    expect(kinds(b)).toEqual(['note', 'fields', 'heading', 'table', 'heading', 'lines', 'table'])
    expect(b[1]).toEqual({ kind: 'fields', rows: [['as_of', '2026-03-02']] })
    expect(tables(b)[0].rows).toEqual([['K1', 'Stair, B']])
    expect(tables(b)[1]).toMatchObject({ header: ['a', 'b'], rows: [['1', '2']] })
  })

  const dir = join(process.cwd(), 'data/tryitout-prompts')
  const slugs = readdirSync(dir).filter((s) => existsSync(join(dir, s, 'example.yaml')))
  it.each(slugs)('%s: the shipped sample has a table and its first line is a note', (slug) => {
    const file = /^file:\s*(\S+)/m.exec(readFileSync(join(dir, slug, 'example.yaml'), 'utf8'))![1]
    const b = parseDocument(readFileSync(join(dir, slug, file), 'utf8'), 'input')
    expect(b[0].kind).toBe('note')
    expect(hasTable(b)).toBe(true)
  })
  it.each(slugs.filter((s) => existsSync(join(dir, s, 'example-result.md'))))('%s: the saved result has a table', (slug) => {
    expect(hasTable(parseDocument(readFileSync(join(dir, slug, 'example-result.md'), 'utf8')))).toBe(true)
  })
})

describe('cellTone', () => {
  it('colours single status words only', () => {
    expect(['bill', 'register-ok', 'delivered', 'match'].map(cellTone)).toEqual(['good', 'good', 'good', 'good'])
    expect(['expired', 'documents-missing', 'dates-inconsistent', 'fail'].map(cellTone)).toEqual(['bad', 'bad', 'bad', 'bad'])
    expect(['review', 'expiring-soon', 'ambiguous', 'pending'].map(cellTone)).toEqual(['warn', 'warn', 'warn', 'warn'])
    expect(cellTone('exclude')).toBe('muted')
    for (const v of ['E-01', '12.5', 'SYN Round duct 250', '-', 'K1', 'missing a document entirely here']) expect(cellTone(v)).toBeNull()
  })
})
