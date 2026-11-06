import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../tryItOutPrompts', async () => {
  const { z } = await import('zod')
  return {
    AgentIdSchema: z.string().min(1).max(64).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    loadPiSkill: vi.fn(async (slug: string) => ({
      basePrompt: 'BASE',
      skillMarkdown: `---\nname: ${slug}\ndescription: d\n---\nBODY`,
    })),
  }
})

import { __resetProxy } from './llmProxy'
import { createFakeRuntime } from './runtimeFake'
import { parseRunnerConfig } from './runnerConfig'
import { AGENT_DIR } from './runtime'
import { __setTryItOutServiceForTests, buildWarmFiles, createTryItOutService, renderModelsJson } from './service'
import { buildPiArgs, piInstruction } from './piRunner'
import { localMcpAgent, localMcpBaseUrl } from '../localMcp/agents'
import { renderLviExtension } from '../localMcp/extensionTemplate'
import { LOCAL_MCP_ALLOWED_TOOLS } from '../localMcp/types'

const LVI = 'lvi-info-product-match'
const OLD = 'demo-rfi-triage'
const dec = new TextDecoder()

beforeEach(() => {
  __resetProxy()
  __setTryItOutServiceForTests(null)
  delete process.env.LOCAL_MCP_AGENTS
})
afterEach(() => {
  delete process.env.LOCAL_MCP_AGENTS
  delete process.env.LOCAL_MCP_JOB_CALL_BUDGET
  delete process.env.CANARY_SECRET_ENV
  __setTryItOutServiceForTests(null)
})

// The pre-Phase-36 literal argv, written out independently of buildPiArgs.
function oldArgv(cfg: ReturnType<typeof parseRunnerConfig>, slug: string, hasUpload: boolean): string[] {
  return [
    'timeout', '--signal=KILL', String(Math.ceil(cfg.jobTimeoutMs / 1000)), 'pi',
    '--mode', 'json', '--no-session', '--offline', '--no-extensions', '--no-mcp', '--no-prompt-templates',
    '--no-themes', '--no-context-files', '--no-approve', '-ns',
    '--skill', `${AGENT_DIR}/skills/${slug}`,
    '--provider', 'aic', '--model', 'MODELPLACEHOLDER',
    '--tools', cfg.tools.join(','),
    '--append-system-prompt', `${AGENT_DIR}/base-prompt.md`,
    '--', `/skill:${slug} ${piInstruction(hasUpload)}`,
  ]
}
function withModel(argv: string[]): string[] {
  const real = buildPiArgs(parseRunnerConfig({}), OLD)
  const model = real[real.indexOf('--model') + 1]
  return argv.map((a) => (a === 'MODELPLACEHOLDER' ? model : a))
}

async function warm(slug: string) {
  const runtime = createFakeRuntime()
  const config = parseRunnerConfig({})
  const svc = createTryItOutService({ runtime, config, instanceId: 'i' })
  const lease = await svc.leases.ensureWarm('anon:a', slug)
  if (lease === 'busy' || lease === 'disabled') throw new Error('unexpected ' + lease)
  const [id] = runtime.containers()
  return { runtime, config, files: runtime.filesOf(id) }
}

describe('registry', () => {
  it('is null with the flag off for every slug, including the local one', () => {
    expect(localMcpAgent(LVI)).toBeNull()
    expect(localMcpAgent(OLD)).toBeNull()
  })
  it('flag on: only the LVI slug is registered', () => {
    process.env.LOCAL_MCP_AGENTS = '1'
    expect(localMcpAgent(OLD)).toBeNull()
    expect(localMcpAgent('lvi-info-mcp')).toBeNull()
    const a = localMcpAgent(LVI)!
    expect(a.extensionPath).toBe('/home/pi/agent/extensions/lvi-info.ts')
    expect(a.tools).toEqual([...LOCAL_MCP_ALLOWED_TOOLS])
  })
  it('derives the base URL from the proxy URL or throws', () => {
    expect(localMcpBaseUrl('http://aic-agent-library:3000/api/llm/v1')).toBe('http://aic-agent-library:3000/api/local-mcp/v1')
    expect(localMcpBaseUrl('http://h:1/api/llm/v1/')).toBe('http://h:1/api/local-mcp/v1')
    expect(() => localMcpBaseUrl('http://h:1/other')).toThrow('PI_LLM_PROXY_URL must end with /api/llm/v1')
  })
})

describe('flag off: byte-identical', () => {
  it('buildWarmFiles equals the old shape', () => {
    const input = { slug: OLD, basePrompt: 'B', skillMarkdown: 'S', proxyUrl: 'http://x:3000/api/llm/v1', model: 'm' }
    expect(buildWarmFiles(input)).toEqual([
      { path: 'models.json', content: renderModelsJson(input.proxyUrl, 'm'), mode: 0o600 },
      { path: 'base-prompt.md', content: 'B' },
      { path: 'skills', type: 'dir' },
      { path: `skills/${OLD}`, type: 'dir' },
      { path: `skills/${OLD}/SKILL.md`, content: 'S' },
    ])
  })
  it.each([[OLD, true], [OLD, false], ['qto-normalization', true], [LVI, true]])('argv for %s (upload %s)', (slug, up) => {
    const cfg = parseRunnerConfig({})
    expect(buildPiArgs(cfg, slug, up)).toEqual(withModel(oldArgv(cfg, slug, up)))
  })
  it('stage() writes exactly the old file set', async () => {
    const { files } = await warm(OLD)
    expect([...files.keys()].sort()).toEqual(
      ['models.json', 'base-prompt.md', 'skills', `skills/${OLD}`, `skills/${OLD}/SKILL.md`].map((p) => `${AGENT_DIR}/${p}`).sort(),
    )
  })
})

describe('flag on', () => {
  beforeEach(() => {
    process.env.LOCAL_MCP_AGENTS = '1'
  })
  it('existing slug: identical to flag off', async () => {
    const cfg = parseRunnerConfig({})
    expect(buildPiArgs(cfg, OLD, true)).toEqual(withModel(oldArgv(cfg, OLD, true)))
    const { files } = await warm(OLD)
    expect(files.has(`${AGENT_DIR}/extensions`)).toBe(false)
  })
  it('LVI slug: stages the extension and loads it with -e', async () => {
    process.env.LOCAL_MCP_JOB_CALL_BUDGET = '7'
    process.env.CANARY_SECRET_ENV = 'canary-' + Math.random().toString(36).slice(2)
    const { files, config } = await warm(LVI)
    expect(files.get(`${AGENT_DIR}/extensions`)).toBe('dir')
    const ext = files.get(`${AGENT_DIR}/extensions/lvi-info.ts`) as Uint8Array
    const text = dec.decode(ext)
    expect(text).toBe(
      renderLviExtension({ baseUrl: 'http://aic-agent-library:3000/api/local-mcp/v1', callBudget: 7 }),
    )
    expect(config.proxyUrl).toContain('aic-agent-library:3000')
    expect(text).not.toContain('sk-')
    expect(text).not.toContain(process.env.CANARY_SECRET_ENV)
    expect(files.has(`${AGENT_DIR}/models.json`)).toBe(true)

    const argv = buildPiArgs(config, LVI, true)
    const base = withModel(oldArgv(config, LVI, true))
    expect(argv[argv.indexOf('-e') + 1]).toBe(`${AGENT_DIR}/extensions/lvi-info.ts`)
    expect(argv.indexOf('-e')).toBe(argv.indexOf('--skill') - 2)
    expect(argv[argv.indexOf('--tools') + 1]).toBe([...config.tools, ...LOCAL_MCP_ALLOWED_TOOLS].join(','))
    expect(argv).toContain('--no-extensions')
    expect(argv).toContain('--no-mcp')
    expect(argv[argv.indexOf('--tools') + 1].split(',')).not.toContain('bash')
    // Everything else equals the flag-off argv.
    const strip = (a: string[]) => a.filter((x, i) => !(x === '-e' || a[i - 1] === '-e')).map((x, i, arr) => (arr[i - 1] === '--tools' ? 'T' : x))
    expect(strip(argv)).toEqual(strip(base))
  })
})
