import { describe, it, expect } from 'vitest'
import { tokenize } from './tokenize.js'

describe('tokenize', () => {
  it('lowercases, splits, keeps hyphen parts and joined form', () => {
    const t = tokenize('Check HVAC-ready ai-act, SQL!')
    for (const x of ['check', 'hvac', 'ready', 'hvac-ready', 'ai', 'act', 'ai-act', 'sql']) {
      expect(t).toContain(x)
    }
  })

  it('drops stopwords and single chars, keeps digits', () => {
    const t = tokenize('the and for of to a in on with x ISO 9001')
    expect(t).toEqual(['iso', '9001'])
  })

  it('is deterministic', () => {
    expect(tokenize('Foo bar-baz')).toEqual(tokenize('Foo bar-baz'))
  })

  it('handles empty input', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenize(' - -- ')).toEqual([])
  })

  it('keeps non-ASCII (Finnish) words intact (WR-05)', () => {
    expect(tokenize('päätös työkalu')).toEqual(['päätös', 'työkalu'])
    expect(tokenize('Ääni-ohjaus Öljy')).toEqual(expect.arrayContaining(['ääni', 'ohjaus', 'ääni-ohjaus', 'öljy']))
  })

  it('handles non-Latin scripts and normalises composed/decomposed forms', () => {
    expect(tokenize('Привет мир')).toEqual(['привет', 'мир'])
    expect(tokenize('データ 分析')).toEqual(['データ', '分析'])
    expect(tokenize('a\u0308iti')).toEqual(tokenize('\u00e4iti'))
    expect(tokenize('\uff21\uff22\uff23 123')).toEqual(['abc', '123'])
  })

  it('still splits on punctuation and symbols next to non-ASCII text', () => {
    expect(tokenize('työkalu, päätös! (ääni)')).toEqual(['työkalu', 'päätös', 'ääni'])
  })
})
