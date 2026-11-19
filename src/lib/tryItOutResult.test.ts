import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { MAX_INLINE_TEXT_BYTES, MAX_INLINE_ZIP_BYTES, fetchResultFiles, orderResultFiles, textFilesOfZip } from './tryItOutResult'

const zip = (files: Record<string, string | Uint8Array>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v])))

describe('textFilesOfZip', () => {
  it('returns the text files, result.* first, and skips other files', () => {
    const files = textFilesOfZip(zip({ 'ebom-join-check.md': 'check', 'result.md': '## E-BOM class rows', 'plot.png': new Uint8Array([1, 2, 3]), 'out/notes.txt': 'n' }))
    expect(files).toEqual([
      { name: 'result.md', text: '## E-BOM class rows' },
      { name: 'ebom-join-check.md', text: 'check' },
      { name: 'out/notes.txt', text: 'n' },
    ])
  })

  it('keeps UTF-8 text (Finnish letters) intact', () => {
    expect(textFilesOfZip(zip({ 'result.md': 'Sähkö, lämmitys' }))).toEqual([{ name: 'result.md', text: 'Sähkö, lämmitys' }])
  })

  it('null for a non-zip, a zip without text files, or a zip over the size cap', () => {
    expect(textFilesOfZip(strToU8('plain text, not a zip'))).toBeNull()
    expect(textFilesOfZip(zip({ 'image.png': new Uint8Array([1]) }))).toBeNull()
    expect(textFilesOfZip(new Uint8Array(MAX_INLINE_ZIP_BYTES + 1))).toBeNull()
  })

  it('never inflates more than the text cap in total; files past it are left out', () => {
    const big = 'x'.repeat(MAX_INLINE_TEXT_BYTES - 10)
    const files = textFilesOfZip(zip({ 'result.md': big, 'second.md': 'y'.repeat(100) }))!
    expect(files.map((f) => f.name)).toEqual(['result.md'])
    expect(textFilesOfZip(zip({ 'result.md': 'x'.repeat(MAX_INLINE_TEXT_BYTES + 1) }))).toBeNull()
  })
})

describe('orderResultFiles', () => {
  it('result.md and result.txt first, then by name', () => {
    const names = orderResultFiles(['b.md', 'result.txt', 'a.md'].map((name) => ({ name, text: '' }))).map((f) => f.name)
    expect(names).toEqual(['result.txt', 'a.md', 'b.md'])
  })
})

describe('fetchResultFiles', () => {
  it('reads the artifact route of the job and unzips it', async () => {
    const urls: string[] = []
    const fake = (async (u: string) => (urls.push(u), new Response(zip({ 'result.md': 'ok' })))) as unknown as typeof fetch
    expect(await fetchResultFiles('job-1', fake)).toEqual([{ name: 'result.md', text: 'ok' }])
    expect(urls).toEqual(['/api/tryitout/jobs/job-1/artifact'])
  })

  it('null on an HTTP error, a network error or a declared size over the cap', async () => {
    expect(await fetchResultFiles('j', (async () => new Response('', { status: 409 })) as unknown as typeof fetch)).toBeNull()
    expect(await fetchResultFiles('j', (async () => { throw new Error('offline') }) as unknown as typeof fetch)).toBeNull()
    const big = (async () => new Response(zip({ 'result.md': 'ok' }), { headers: { 'content-length': String(MAX_INLINE_ZIP_BYTES + 1) } })) as unknown as typeof fetch
    expect(await fetchResultFiles('j', big)).toBeNull()
  })
})
