// Review fix IN-07 (README part): spec text cannot become Markdown links or tags in README.generated.md.
import { describe, expect, it } from 'vitest'
import { generate, mdText } from './generate'
import { acmeHttp } from './testing/sample-models'

const readme = (m: typeof acmeHttp) => generate(m).files.find((f) => f.path === 'README.generated.md')!.content

describe('mdText', () => {
  it('escapes link, image, code and tag characters and nothing else', () => {
    expect(mdText('[x](y) `z` <b> back\\slash')).toBe('\\[x\\]\\(y\\) \\`z\\` \\<b\\> back\\\\slash')
    expect(mdText('plain text, with_underscores and 12 items.')).toBe('plain text, with_underscores and 12 items.')
  })
})

describe('README.generated.md', () => {
  it('a link in the server name or in an operation summary is not a Markdown link', () => {
    const m = {
      ...acmeHttp,
      name: 'Acme [click](javascript:alert) Catalog',
      operations: acmeHttp.operations.map((o) => ({ ...o, summary: 'See [more](javascript:alert) and <img src=x>' })),
    }
    const text = readme(m)
    expect(text).not.toMatch(/(?<!\\)\]\(/)
    expect(text).not.toContain('<img')
    expect(text.split('\n')[0]).toBe('# Acme \\[click\\]\\(javascript:alert\\) Catalog MCP server (generated)')
  })
  it('the sample README keeps its structure', () => {
    const text = readme(acmeHttp)
    for (const h of ['## Tools', '## Environment variables', '## Setup', '## Tests']) expect(text).toContain(h)
    expect(text).toContain('`lookup_product_by_id`')
  })
})
