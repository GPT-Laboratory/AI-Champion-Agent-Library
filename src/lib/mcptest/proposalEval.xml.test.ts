// CR-20 / CR-32: the synchronous pipeline callers must prepare the input first, or EDMX XML is rejected with
// odata-xml-unavailable although the CLI and the route read the same file. Own file: the XML parser is loaded once per process.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { evaluateProposalEffect } from './proposalEval'
import { xmlParserLoaded } from '../mcpgen/adapters/odata-xml'

const xml = readFileSync(fileURLToPath(new URL('../mcpgen/testing/fixtures/acme-odata.xml', import.meta.url)), 'utf8')

describe('proposal evaluation on OData EDMX (CR-20, CR-32)', () => {
  it('reads the XML baseline instead of failing with odata-xml-unavailable', async () => {
    expect(xmlParserLoaded()).toBe(false)
    const r = await evaluateProposalEffect({ input: xml, filename: 'acme-odata.xml', proposalsText: '{"not":"a proposal file"}' })
    expect(xmlParserLoaded()).toBe(true)
    expect(r.kind).toBe('rejected') // the baseline was generated; only the proposal file is wrong
  })
})
