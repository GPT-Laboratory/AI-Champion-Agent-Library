import { describe, it, expect } from 'vitest'
import { buildBm25Index } from './bm25.js'

const doc = (slug: string, title: string, text: string, tags: string[] = []) => ({ slug, title, tags, text })

describe('bm25', () => {
  const docs = [
    doc('a', 'Alpha', 'general purpose helper'),
    doc('b', 'Beta', 'runs sql queries on warehouses'),
    doc('c', 'Gamma', 'sprinkler design checker'),
  ]
  const idx = buildBm25Index(docs)

  it('single keyword ranks the containing doc first, others absent', () => {
    const r = idx.search('sql')
    expect(r.map(x => x.slug)).toEqual(['b'])
    expect(r[0].score).toBeGreaterThan(0)
  })

  it('prefix on last token matches with lower weight than exact', () => {
    const d = [doc('x', 'X', 'hvac load calc'), doc('y', 'Y', 'hvacsystem load calc')]
    const i = buildBm25Index(d)
    const r = i.search('hva')
    expect(r.map(s => s.slug).sort()).toEqual(['x', 'y'])
    const exact = i.search('hvac', { prefixLast: false })
    const prefix = i.search('hva')
    const exactX = exact.find(s => s.slug === 'x')!.score
    const prefixX = prefix.find(s => s.slug === 'x')!.score
    expect(prefixX).toBeLessThan(exactX)
    expect(i.search('hva', { prefixLast: false })).toEqual([])
  })

  it('no match returns []', () => {
    expect(idx.search('xyzzy')).toEqual([])
  })

  it('title term outranks one body mention in a long doc', () => {
    const filler = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')
    const i = buildBm25Index([
      doc('body', 'Something', `${filler} widget ${filler}`),
      doc('title', 'Widget', filler),
      doc('other', 'Other', 'nothing'),
    ])
    expect(i.search('widget')[0].slug).toBe('title')
  })

  it('tag tokens are weighted above body', () => {
    const i = buildBm25Index([doc('t', 'T', 'filler text here', ['robotics']), doc('b', 'B', 'robotics filler text here')])
    expect(i.search('robotics')[0].slug).toBe('t')
  })

  it('empty docs and empty query do not throw', () => {
    expect(buildBm25Index([]).search('x')).toEqual([])
    expect(idx.search('')).toEqual([])
    expect(idx.search('the and')).toEqual([])
  })

  it('ties break by slug asc and results are sorted desc', () => {
    const i = buildBm25Index([doc('z', 'Same', 'same'), doc('m', 'Same', 'same')])
    expect(i.search('same').map(s => s.slug)).toEqual(['m', 'z'])
    const r = idx.search('design sql')
    for (let k = 1; k < r.length; k++) expect(r[k - 1].score).toBeGreaterThanOrEqual(r[k].score)
  })
})

describe('bm25 non-ASCII (WR-05)', () => {
  const idx = buildBm25Index([
    doc('fi', 'Päätöstuki', 'työkalu päätösten tekoon'),
    doc('en', 'Decision aid', 'tool for decisions'),
    doc('ru', 'Помощник', 'помощник по данным'),
  ])

  it('a Finnish query finds the Finnish doc, not garbage', () => {
    expect(idx.search('työkalu').map(r => r.slug)).toEqual(['fi'])
    expect(idx.search('päätösten').map(r => r.slug)).toEqual(['fi'])
  })

  it('prefix matching works on non-ASCII terms', () => {
    expect(idx.search('työka').map(r => r.slug)).toEqual(['fi'])
  })

  it('Cyrillic queries match', () => {
    expect(idx.search('данным').map(r => r.slug)).toEqual(['ru'])
  })
})

