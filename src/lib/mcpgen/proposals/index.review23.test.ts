// CR-37: record keys in schema issue paths go through show(); a UTF-8 BOM does not make the file "not valid JSON".
import { describe, expect, it } from 'vitest'
import { evaluateProposals } from './index.js'
import { codes, doc, loadFixture, op } from './testkit.js'

const http = loadFixture('acme-openapi.yaml')
const secret = ['sk', 'abcdefghijklmnop1234567890'].join('-')

describe('proposal file edge cases (CR-37)', () => {
  it('does not echo a credential-shaped record key in a schema issue', () => {
    const bad = op('split_tool', 's', { tool: 'search_part', tools: [{ name: 'only_one', description: 'One.', fixed: { [secret]: { nested: true } } }] })
    const ev = evaluateProposals({ model: http.model, text: doc(http, [bad]) })
    expect(ev.ok).toBe(false)
    expect(JSON.stringify(ev)).not.toContain('abcdefghijklmnop')
    expect(JSON.stringify(ev)).not.toContain(secret.slice(0, 12))
  })
  it('reads a file that starts with a byte order mark', () => {
    const ev = evaluateProposals({ model: http.model, text: '﻿' + doc(http, []) })
    expect(codes(ev)).not.toContain('bad-json')
  })
})
