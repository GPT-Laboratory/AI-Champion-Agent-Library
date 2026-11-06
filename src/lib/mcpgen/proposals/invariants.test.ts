// Architecture invariants of the proposal layer (D-594): data only, no model call, no network, no process,
// no environment access, no dynamic code, nothing provider-shaped; the new docs and code use no reserved
// study-specific token. Tokens are assembled at runtime so this file does not match itself.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(process.cwd())
const read = (p: string) => readFileSync(p, 'utf8')
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]))

const proposalsDir = join(ROOT, 'src/lib/mcpgen/proposals')
const sources = [...walk(proposalsDir), join(ROOT, 'src/lib/mcpgen/emit/proposed.ts'), join(ROOT, 'src/lib/mcpgen/emit/pytestProposed.ts'), join(ROOT, 'src/lib/mcptest/proposalEval.ts')].filter((p) => p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('testkit.ts'))

describe('proposal layer is data only', () => {
  it('no network, process, file system, environment or dynamic code in the library or the evaluation module', () => {
    const banned: [string, RegExp][] = [
      ['fetch', /\bfetch\(/],
      ['http client', /from ['"](?:node:)?(?:http|https|net|tls|dgram)['"]/],
      ['child_process', /child_process/],
      ['fs', /from ['"](?:node:)?fs(?:\/promises)?['"]/],
      ['process.env', /process\.env/],
      ['eval', /\beval\(|new Function\(|vm\.run/],
      ['sdk', /@anthropic-ai|openai|@modelcontextprotocol/i],
    ]
    for (const p of sources) {
      const text = read(p).split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')
      for (const [name, re] of banned) {
        // proposalEval.ts holds the regex SOURCE text of the invariants it checks in generated Python; allow that line only.
        const scrubbed = p.endsWith('proposalEval.ts') ? text.replace(/for \(const re of \[[^\n]*\]\) \{/, '') : text
        expect(re.test(scrubbed), `${relative(ROOT, p)} uses ${name}`).toBe(false)
      }
    }
  })
  it('no key variable name appears in the proposal layer', () => {
    for (const p of sources) expect(/API_KEY|_TOKEN|MCP_GENERATOR_LLM/.test(read(p)), relative(ROOT, p)).toBe(false)
  })
  it('the generator core does not import the evaluation module or the test platform', () => {
    for (const p of walk(join(ROOT, 'src/lib/mcpgen')).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      expect(/from ['"][^'"]*mcptest[^'"]*['"]/.test(read(p)), relative(ROOT, p)).toBe(false)
    }
  })
  it('the proposal schema has no field that could hold code', () => {
    const t = read(join(proposalsDir, 'schema.ts'))
    expect(/\b(code|script|python|expression|shell|command)\s*:\s*z\./.test(t)).toBe(false)
  })
})

describe('wording', () => {
  const forbidden = [
    ['mcp-gen', '-comparison'].join(''),
    ['L', 'VI'].join(''),
    ['E', 'TIM'].join(''),
    ['T', 'T0'].join(''),
    ['S', 'TK'].join(''),
  ]
  const files = [
    ...sources,
    ...walk(proposalsDir).filter((p) => p.endsWith('.test.ts')),
    join(ROOT, 'docs/mcp-generator-proposals.md'),
    join(ROOT, 'scripts/mcp-propose-eval.ts'),
    join(ROOT, 'scripts/mcp-pack-io.ts'),
    join(ROOT, 'scripts/generate-mcp.ts'),
    join(ROOT, '.planning/exploration/E14-proposals.md'),
  ]
  it('no reserved study-specific token in new code, tests, docs or fixtures', () => {
    for (const p of files) {
      const text = read(p)
      for (const t of forbidden) expect(new RegExp(`\\b${t}`).test(text), `${relative(ROOT, p)} contains a forbidden token`).toBe(false)
    }
  })
  it('the generated pack and goldens contain no secret-shaped string', () => {
    const shapes = [new RegExp(['sk', '-[A-Za-z0-9_-]{16,}'].join('')), new RegExp(['AK', 'IA[0-9A-Z]{16}'].join(''))]
    for (const p of walk(join(ROOT, 'src/lib/mcpgen/__golden__/proposals'))) for (const re of shapes) expect(re.test(read(p)), relative(ROOT, p)).toBe(false)
  })
})
