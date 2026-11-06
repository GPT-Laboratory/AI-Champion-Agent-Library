// E7 runtime smoke test: builds the real server, starts `node build` per flag configuration and probes routes.
// Not part of `npm run check` (it runs `vite build`). Usage: npm run smoke
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { writeScaleFixtures } from './fixtures/generate-scale.js'
import { isMainModule } from './is-main.js'

const ROOT = resolve(import.meta.dirname, '..')
const FLAGS = ['AGENT_KINDS', 'AGENT_COMPARE', 'UI_SPEC_VIEWER', 'UI_DARK_MODE', 'MCP_GENERATOR', 'MCP_TESTER'] as const
type Flag = (typeof FLAGS)[number]
const REAL_SLUG = 'airo'

export interface Config { name: string; on: Flag[] }
export const CONFIGS: Config[] = [
  { name: 'all-off', on: [] },
  ...FLAGS.map((f) => ({ name: f, on: [f] as Flag[] })),
  { name: 'all-on', on: [...FLAGS] },
]

const OPENAPI = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Smoke Pets', version: '1.0.0' },
  servers: [{ url: 'https://api.invalid.example' }],
  paths: { '/pets': { get: { operationId: 'listPets', summary: 'List pets', responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' } } } } } } } } } },
})

export interface Probe {
  label: string
  method?: 'GET' | 'POST'
  path: string
  body?: string
  status: (on: Set<Flag>) => number
  type?: (on: Set<Flag>) => RegExp
  markers?: (on: Set<Flag>) => string[]
}
const html = /text\/html/
const json = /application\/json/
export const PROBES: Probe[] = [
  { label: 'health', path: '/health', status: () => 200, type: () => json, markers: () => ['"ok"'] },
  // `/` redirects to /catalog by design (src/routes/+page.server.ts).
  { label: 'home (redirect)', path: '/', status: () => 302 },
  { label: 'catalog', path: '/catalog', status: () => 200, type: () => html, markers: () => [REAL_SLUG] },
  { label: 'catalog q=sql', path: '/catalog?q=sql', status: () => 200, type: () => html },
  { label: 'catalog page=999', path: '/catalog?page=999', status: () => 200, type: () => html },
  { label: 'catalog kind=bogus', path: '/catalog?kind=bogus', status: () => 200, type: () => html },
  { label: 'agent detail', path: `/agents/${REAL_SLUG}`, status: () => 200, type: () => html, markers: () => ['AIRO'] },
  { label: 'agent 404', path: '/agents/does-not-exist', status: () => 404, type: () => html },
  { label: 'compare', path: '/compare', status: (on) => (on.has('AGENT_COMPARE') ? 200 : 404), type: () => html },
  { label: 'mcp-test page', path: '/mcp-test', status: (on) => (on.has('MCP_TESTER') ? 200 : 404), type: () => html },
  { label: 'api search', path: '/api/search?q=x', status: () => 200, type: () => json },
  {
    label: 'api mcp-generate', method: 'POST', path: '/api/mcp-generate', body: JSON.stringify({ input: OPENAPI }),
    status: (on) => (on.has('MCP_GENERATOR') ? 200 : 404),
    type: (on) => (on.has('MCP_GENERATOR') ? /application\/zip/ : /./),
  },
  // POST-only route: with the flag on a GET is a 405 (fallback handler), off it is a 404.
  { label: 'api mcp-test runs', path: '/api/mcp-test/runs', status: (on) => (on.has('MCP_TESTER') ? 405 : 404), type: () => /./ },
]

const LEAK = [/node_modules/, /\n\s+at\s+\S+.*\(.*:\d+:\d+\)/, /\n\s+at\s+file:\/\//]

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv) {
  const r = spawnSync(cmd, args, { cwd: ROOT, env, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status})\n${r.stdout}\n${r.stderr}`)
}

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer()
    s.once('error', rej)
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port
      s.close(() => res(p))
    })
  })
}

/** cpSync filter: skips a `fixtures` directory below the agents directory, whatever the checkout path is called (CR-57). */
export const skipFixtures = (base: string) => (src: string) => !/(^|[\\/])fixtures([\\/]|$)/.test(relative(base, src))

async function waitUp(base: string, child: ChildProcess, log: () => string) {
  const end = Date.now() + 30_000
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`server exited early (${child.exitCode})\n${log()}`)
    try {
      const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) })
      if (r.status === 200) return
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`server did not come up\n${log()}`)
}

export interface Row { config: string; probe: string; status: number; expected: number; ok: boolean; note: string }

async function probeConfig(cfg: Config, tmp: string, dbPath: string): Promise<Row[]> {
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const f of FLAGS) delete env[f]
  Object.assign(env, {
    HOST: '127.0.0.1', PORT: String(port), ORIGIN: base, AUTH_ENABLED: 'false', SEARCH_EMBEDDINGS: 'off',
    CATALOG_DB_PATH: dbPath, PI_RUNNER_ENABLED: 'false', NODE_ENV: 'production',
  })
  for (const f of cfg.on) env[f] = '1'
  const on = new Set(cfg.on)
  let out = ''
  const child = spawn(process.execPath, [join(ROOT, 'build')], { cwd: tmp, env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout?.on('data', (d) => (out += d))
  child.stderr?.on('data', (d) => (out += d))
  const rows: Row[] = []
  try {
    await waitUp(base, child, () => out)
    for (const p of PROBES) {
      const notes: string[] = []
      let status = -1
      try {
        const r = await fetch(base + p.path, {
          method: p.method ?? 'GET',
          headers: p.body ? { 'content-type': 'application/json', origin: base } : {},
          body: p.body,
          redirect: 'manual',
          signal: AbortSignal.timeout(15_000),
        })
        status = r.status
        const ct = r.headers.get('content-type') ?? ''
        const buf = Buffer.from(await r.arrayBuffer())
        const isZip = /zip/.test(ct)
        const text = isZip ? '' : buf.toString('utf8')
        if (isZip && !(buf[0] === 0x50 && buf[1] === 0x4b)) notes.push('zip magic missing')
        const wantType = p.type?.(on)
        if (wantType && !wantType.test(ct)) notes.push(`content-type "${ct}"`)
        for (const m of p.markers?.(on) ?? []) if (!text.includes(m)) notes.push(`missing marker "${m}"`)
        for (const re of LEAK) if (re.test(text)) notes.push(`leak ${re}`)
      } catch (e) {
        notes.push(`fetch error: ${(e as Error).message}`)
      }
      const expected = p.status(on)
      if (status !== expected) notes.push(`status ${status} != ${expected}`)
      rows.push({ config: cfg.name, probe: p.label, status, expected, ok: notes.length === 0, note: notes.join('; ') })
    }
    if (/\n\s+at\s.*:\d+:\d+/.test(out)) {
      rows.push({ config: cfg.name, probe: 'server log', status: 0, expected: 0, ok: false, note: `stack trace in server output:\n${out.slice(0, 1500)}` })
    }
  } finally {
    child.kill('SIGKILL')
  }
  return rows
}

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), 'aic-smoke-'))
  let failed = false
  const all: Row[] = []
  try {
    const dataDir = join(tmp, 'agents')
    const dbPath = join(tmp, 'catalog.db')
    // Shipped agents are copied (data/agents stays read-only); the 150 synthetic fixtures go beside them.
    cpSync(join(ROOT, 'data/agents'), dataDir, { recursive: true, filter: skipFixtures(join(ROOT, 'data/agents')) })
    writeScaleFixtures(join(tmp, 'scale'), 150)
    for (const f of readdirSync(join(tmp, 'scale'))) cpSync(join(tmp, 'scale', f), join(dataDir, f))
    const env = { ...process.env, SEARCH_EMBEDDINGS: 'off', CATALOG_DB_PATH: dbPath, INGEST_DB_PATH: dbPath, INGEST_DATA_DIR: dataDir }
    // Temp drizzle config (plain object: needs no module resolution from the temp dir).
    const cfgPath = join(tmp, 'drizzle.config.js')
    const cfg = { schema: join(ROOT, 'drizzle/schema.ts'), out: join(tmp, 'mig'), dialect: 'sqlite', dbCredentials: { url: dbPath } }
    writeFileSync(cfgPath, `export default ${JSON.stringify(cfg)}\n`)
    console.log('[smoke] db:push to temp DB')
    run('npx', ['drizzle-kit', 'push', `--config=${cfgPath}`], env)
    console.log('[smoke] ingest')
    run('npx', ['tsx', 'scripts/ingest.ts'], env)
    run('npx', ['tsx', 'scripts/set-try-it-out-mode.ts'], env)
    console.log('[smoke] vite build')
    run('npx', ['vite', 'build'], env)
    if (!existsSync(join(ROOT, 'build/index.js'))) throw new Error('build/index.js missing after vite build')
    for (const c of CONFIGS) {
      console.log(`[smoke] config ${c.name}`)
      all.push(...(await probeConfig(c, tmp, dbPath)))
    }
  } catch (e) {
    failed = true
    console.error(`[smoke] FATAL: ${(e as Error).message}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  for (const r of all) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.config.padEnd(15)} ${r.probe.padEnd(20)} ${r.status} (want ${r.expected}) ${r.note}`)
  const bad = all.filter((r) => !r.ok)
  console.log(`[smoke] ${all.length - bad.length}/${all.length} checks passed`)
  if (failed || bad.length) process.exit(1)
}

if (isMainModule(import.meta.url, process.argv[1])) void main()
