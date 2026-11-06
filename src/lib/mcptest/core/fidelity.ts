// Machine-readable twin of docs/mcp-test-port-fidelity.md.
export const CASE_IDS = [
  'T1-STD-CATALOG',
  'T2-CATALOG-API',
  'T2-CATALOG-DUMP',
  'T2-CATALOG-HTTP',
  'T3-RT-DOCS',
  'T3-PROFILE-CONTRACT',
  'T3-COMPOSITE',
  'T3-LARGE-RESP',
  'T4-FAULT-UPSTREAM',
  'T4-PARTIAL-SPEC',
  'T4-SEC-SECRETS',
  'T4-I18N-CODES'
] as const

export const CHECK_IDS = [
  'lookup_by_id',
  'lookup_by_alt_key',
  'partition_filter',
  'derived_filter',
  'projection',
  'pagesize_clamp',
  'pagination_ceiling',
  'bad_input',
  'empty_vs_error',
  'auth_fail'
] as const

export type PlatformStatus = 'implemented' | 'implemented-minimal' | 'designed-only-gap'

export interface FidelityEntry {
  id: string
  group: 'component' | 'check' | 'case'
  tier?: 1 | 2 | 3 | 4
  sourceStatus: 'implemented' | 'designed-only' | 'n/a'
  port: 'ported' | 're-implemented' | 'not-ported'
  platformStatus: PlatformStatus
  where?: 'S' | 'G' | 'S+G' | 'S-real'
  note: string
}

type CaseRow = [
  id: (typeof CASE_IDS)[number],
  tier: 1 | 2 | 3 | 4,
  src: 'implemented' | 'designed-only',
  port: FidelityEntry['port'],
  status: PlatformStatus,
  where: NonNullable<FidelityEntry['where']>,
  note: string
]

const CASES: CaseRow[] = [
  ['T1-STD-CATALOG', 1, 'designed-only', 're-implemented', 'implemented', 'S+G', 'Synthetic catalog gate case'],
  ['T2-CATALOG-API', 2, 'implemented', 'ported', 'implemented', 'S+G', 'Re-authored content, same 9 check ids plus behaviour pack'],
  ['T2-CATALOG-DUMP', 2, 'designed-only', 're-implemented', 'implemented', 'S-real', 'Header-only fixture, synthetic CSV at test time; fake variant in CI'],
  ['T2-CATALOG-HTTP', 2, 'designed-only', 're-implemented', 'implemented-minimal', 'S', 'Client side only; generator subjects get NA_TRANSPORT'],
  ['T3-RT-DOCS', 3, 'designed-only', 're-implemented', 'implemented', 'S', 'Invented manual; undocumented route use scores D3 = 0'],
  ['T3-PROFILE-CONTRACT', 3, 'designed-only', 're-implemented', 'implemented-minimal', 'S', 'Invented Acme profile only; real mapping pending human'],
  ['T3-COMPOSITE', 3, 'designed-only', 're-implemented', 'implemented-minimal', 'S', 'Purpose-built composite fake; no generator subject'],
  ['T3-LARGE-RESP', 3, 'designed-only', 're-implemented', 'implemented', 'S', 'Large seeded category; bytes/4 token approximation'],
  ['T4-FAULT-UPSTREAM', 4, 'designed-only', 're-implemented', 'implemented', 'S', 'Seeded fault injection with attempt log'],
  ['T4-PARTIAL-SPEC', 4, 'designed-only', 're-implemented', 'implemented', 'G', 'Generator-side, in-process, reruns byte-identical'],
  ['T4-SEC-SECRETS', 4, 'designed-only', 're-implemented', 'implemented', 'S+G', 'Canary key, write-tool and injection checks'],
  ['T4-I18N-CODES', 4, 'designed-only', 're-implemented', 'implemented', 'S', 'Checksum code rejected before upstream call']
]

const CHECK_NOTES: Record<(typeof CHECK_IDS)[number], string> = {
  lookup_by_id: 'Primary-identifier lookup',
  lookup_by_alt_key: 'NA when the case declares no alternate key',
  partition_filter: 'Every item attributable to the filter value',
  derived_filter: 'Derived nested-attribute filter; mock rejects the native parameter',
  projection: 'At most 12 top-level keys by default',
  pagesize_clamp: 'Oversize request clamped or cleanly rejected',
  pagination_ceiling: 'Scorable offline via mock ceiling; NA when x-ceiling is null',
  bad_input: 'Explicit not-found signal evaluated before item detection',
  empty_vs_error: 'Empty result explained, not a raw envelope',
  auth_fail: 'Wrong key relaunch; strict auth-word regex'
}

const COMPONENTS: [string, FidelityEntry['port'], PlatformStatus, string][] = [
  ['check-validators', 're-implemented', 'implemented', 'Generic behaviour pack'],
  ['helper-functions', 'ported', 'implemented', 'Field-name-agnostic search and leak detector'],
  ['selfcheck', 're-implemented', 'implemented', 'Canned results plus mock dataset invariants'],
  ['csv-row', 'ported', 'implemented', 'Export only'],
  ['expected-values', 'ported', 'implemented', 'Shape only; values never copied'],
  ['base-module', 're-implemented', 'implemented', 'Subject interface'],
  ['runner', 're-implemented', 'implemented', 'Thresholds enforced'],
  ['expect-evaluation', 'ported', 'implemented', 'Tightened clean_not_found'],
  ['tool-binding', 're-implemented', 'implemented', 'Explicit or unique hint'],
  ['report-matrix', 'ported', 'implemented', 'Pessimistic tie-break'],
  ['report-arm-table', 'not-ported', 'designed-only-gap', 'Specific to the study arm list'],
  ['leak-guard-isolation', 'ported', 'implemented', 'Explicit minimum length'],
  ['leak-guard-hosts-block', 'not-ported', 'implemented', 'Replaced by structural no-egress'],
  ['arm-registry', 're-implemented', 'implemented', 'Subjects registry'],
  ['arm-adapters', 'not-ported', 'designed-only-gap', 'Setup gaps, not evidence'],
  ['case-yaml', 'ported', 'implemented', 'x- prefixed platform keys'],
  ['golden-jsonl', 'ported', 'implemented', 'Additive inject, repeat, check_kind'],
  ['rubric-yaml', 'ported', 'implemented', 'Advisory auto-checks'],
  ['mock-server-and-spec', 'not-ported', 'implemented', 'Re-authored synthetic TypeScript mock'],
  ['suite-design-doc', 'ported', 'implemented', 'Case specs and scoring doc']
]

export const FIDELITY: FidelityEntry[] = [
  ...COMPONENTS.map(
    ([id, port, platformStatus, note]): FidelityEntry => ({
      id,
      group: 'component',
      sourceStatus: 'implemented',
      port,
      platformStatus,
      note
    })
  ),
  ...CHECK_IDS.map(
    (id): FidelityEntry => ({
      id,
      group: 'check',
      sourceStatus: 'implemented',
      port: 'ported',
      platformStatus: 'implemented',
      note: CHECK_NOTES[id]
    })
  ),
  ...CASES.map(
    ([id, tier, sourceStatus, port, platformStatus, where, note]): FidelityEntry => ({
      id,
      group: 'case',
      tier,
      sourceStatus,
      port,
      platformStatus,
      where,
      note
    })
  )
]

export const GAPS: { id: string; reason: string }[] = [
  { id: 'legacy-http-sse', reason: 'Legacy HTTP+SSE transport is deprecated by the specification; reported as unsupported' },
  { id: 'real-profile-mapping', reason: 'Only an invented Acme profile is scored; the real profile document is needed' },
  { id: 'generator-http-transport', reason: 'The generator emits stdio only, so HTTP cases give NA_TRANSPORT for generator subjects' },
  { id: 'generator-composite', reason: 'The generator cannot produce composite tools' },
  { id: 'real-fastmcp-run', reason: 'Real FastMCP execution needs the runner image; pending human' }
]
