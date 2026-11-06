// generate(model, options, extraDerived?) -> GenerationResult. Pure and deterministic: no network,
// no file reads, no clock. The generated Python is text only; it is never executed here.
import { MAX_OUTPUT_BYTES } from './api-contract.js'
import { scanForCredentials } from './credentials.js'
import { BINDING_FILE, emitBinding } from './binding.js'
import { gap } from './diagnostics.js'
import { emitPython } from './emit/python.js'
import { emitPytest } from './emit/pytest.js'
import { emitRequirements } from './emit/requirements.js'
import { cleanText } from './emit/pyutil.js'
import { buildPlan, OAUTH2_PURPOSE, resolveEnv, serverSlug } from './plan.js'
import { buildReport } from './report.js'
import type { DerivedTool, GenerateOptions, GeneratedFile, GenerationResult, ServerPlan, SourceModel } from './types.js'

/** JSON with sorted keys and a trailing newline, so equal data gives equal bytes. */
export function stableJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort)
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as object)
          .sort()
          .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
      )
    }
    return v
  }
  return JSON.stringify(sort(value), null, 2) + '\n'
}

/** Source text in Markdown: link, image and tag syntax is neutralised with backslashes (review IN-07). */
export function mdText(s: string): string {
  return s.replace(/[\\`\[\]()<>]/g, (c) => `\\${c}`)
}

function emitReadme(plan: ServerPlan): string {
  const m = plan.model
  const env = resolveEnv(m)
  const slug = serverSlug(m)
  const envNames = [env.baseUrl, env.auth, env.dataFile, env.dsn].filter((x): x is string => !!x)
  const purposes: Record<string, string> = {}
  if (env.baseUrl) purposes[env.baseUrl] = 'Base address of the upstream service'
  if (env.auth) purposes[env.auth] = m.auth.oauth2 ? OAUTH2_PURPOSE : 'API key for the upstream service'
  if (env.dataFile) purposes[env.dataFile] = 'Location of the CSV data file'
  if (env.dsn) purposes[env.dsn] = 'Location of the SQLite database file'
  const snippet = {
    mcpServers: {
      [slug]: {
        command: 'python',
        args: ['server.py'],
        env: Object.fromEntries(envNames.map((n) => [n, `<set ${n}>`])),
      },
    },
  }
  const out: string[] = [
    `# ${mdText(cleanText(m.name, 80))} MCP server (generated)`,
    '',
    'Read-only MCP server over stdio, generated deterministically from a source description.',
    'Review it before use. The generator never executed this code.',
    '',
    '## Tools',
    '',
    ...plan.tools.map((t) => `- \`${t.name}\`: ${mdText(cleanText(t.description, 200))}`),
    '',
    '## Environment variables',
    '',
    'Values are read from the environment only and are never stored in this package.',
    '',
    '| Name | Purpose |',
    '| --- | --- |',
    ...envNames.map((n) => `| ${n} | ${purposes[n]} |`),
    '',
    '## Setup',
    '',
    '1. Install the requirements (the fastmcp pin is unverified; confirm it first).',
    '2. Set the environment variables above.',
    '3. Run `python server.py` (stdio transport), or register it with an MCP client:',
    '',
    '```json',
    JSON.stringify(snippet, null, 2),
    '```',
    '',
    ...(plan.proposals
      ? [
          '## Provenance',
          '',
          `This package was assisted by a proposal file (sha256 ${plan.proposals.sha256}, baseline fingerprint ${plan.proposals.fingerprint}, mode ${plan.proposals.mode}).`,
          `Applied ops: ${plan.proposals.applied.length}. Rejected ops: ${plan.proposals.rejected.length}. Tool names and descriptions hash: ${plan.proposals.descriptionsSha256}.`,
          'A person must review the diff against the deterministic baseline before this package is published. See `report.json` for every applied and rejected op.',
          '',
        ]
      : []),
    '## Tests',
    '',
    '`test_server.py` stubs the upstream or data source and checks the server behaviours. Run `pytest test_server.py`.',
    '',
    'See `report.json` for dropped operations, gaps and assumptions.',
  ]
  return out.join('\n') + '\n'
}

export function generate(model: SourceModel, options: GenerateOptions = {}, extraDerived: DerivedTool[] = []): GenerationResult {
  return generateFromPlan(buildPlan(model, options, extraDerived))
}

/** Render a plan (the baseline plan, or one a proposal set was applied to). Pure and deterministic. */
export function generateFromPlan(plan: ServerPlan): GenerationResult {
  const report = buildReport(plan)
  if (plan.gaps.some((g) => g.severity === 'error' && g.code === 'no-tools')) {
    return { files: [], report }
  }
  const files: GeneratedFile[] = [
    { path: 'server.py', content: emitPython(plan) },
    { path: 'test_server.py', content: emitPytest(plan) },
    { path: 'requirements.txt', content: emitRequirements(plan) },
    { path: 'README.generated.md', content: emitReadme(plan) },
    { path: 'report.json', content: stableJson(report) },
    // E10 D3: tool binding for the test platform, next to the server (docs/mcp-generator.md).
    { path: BINDING_FILE, content: emitBinding(plan) },
  ]
  // Output-side guarantee (review CR-03): whatever the input scan let through, no credential-like text
  // may leave in any generated file. Findings carry file, line and kind only, never the text.
  const leaks = files.flatMap((f) => scanForCredentials(f.content).map((x) => ({ path: f.path, line: x.line, kind: x.kind })))
  if (leaks.length > 0) {
    const gaps = leaks.slice(0, 20).map((l) =>
      gap('credential-in-output', `Generated file ${l.path} line ${l.line} contains credential-like text (${l.kind}); nothing was produced. Remove it from the source and use an env-var placeholder.`, {
        severity: 'error',
        path: `${l.path}:${l.line}`,
      }),
    )
    return { files: [], report: { ...report, gaps: [...report.gaps, ...gaps] } }
  }
  const bytes = files.reduce((n, f) => n + Buffer.byteLength(f.content, 'utf8'), 0)
  if (bytes > MAX_OUTPUT_BYTES) {
    const g = gap('output-too-large', `Generated package exceeds the ${MAX_OUTPUT_BYTES} byte limit.`, { severity: 'error' })
    return { files: [], report: { ...report, gaps: [...report.gaps, g] } }
  }
  return { files, report }
}
