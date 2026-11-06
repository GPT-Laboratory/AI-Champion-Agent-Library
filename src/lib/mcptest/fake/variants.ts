// Registry of fake MCP server variants. Every variant is a scorer fixture (it exists to prove the
// platform's scorer discriminates), never a tested real server. Consumed by 15-08's discrimination test.
import type { FlagId } from '../core/types'
import { GOOD, type Behaviour } from './behaviour'

export interface VariantDef {
  id: string
  description: string
  behaviour: Behaviour
  /** Check kinds (or dimension ids such as 'D1') this variant must fail. */
  mustFail: string[]
  /** Risk flags this variant must raise. */
  flags: FlagId[]
  expectScoreBand?: 'full' | 'partial' | 'low'
}

const def = (
  id: string,
  description: string,
  over: Partial<Behaviour>,
  mustFail: string[],
  flags: FlagId[] = [],
  expectScoreBand?: VariantDef['expectScoreBand']
): VariantDef => ({
  id,
  description: `Scorer fixture: ${description}`,
  behaviour: { ...GOOD, ...over },
  mustFail,
  flags,
  expectScoreBand
})

const LIST: VariantDef[] = [
  def('good', 'satisfies behaviour checks 1-9; expected full score and no flags.', {}, [], [], 'full'),
  def(
    'mirror',
    '1:1 endpoint tools, raw payload, no derived tool, leaky errors (modelled on the converter pattern).',
    { mirror: true, derivedTool: false, projection: false, clamp: false, errorStyle: 'leaky' },
    ['derived_filter', 'projection', 'pagesize_clamp', 'bad_input', 'empty_vs_error', 'auth_fail'],
    ['LEAK'],
    'low'
  ),
  def('no-derived-tool', 'omits the synthesized attribute filter.', { derivedTool: false }, ['derived_filter'], [], 'partial'),
  def('raw-passthrough', 'forwards 20+ field objects unprojected.', { projection: false }, ['projection'], [], 'partial'),
  def('no-clamp', 'forwards an oversize page size to the upstream.', { clamp: false }, ['pagesize_clamp'], [], 'partial'),
  def(
    'leaky-errors',
    'returns upstream envelope and traceback text in errors.',
    { errorStyle: 'leaky' },
    ['bad_input', 'empty_vs_error', 'auth_fail'],
    ['LEAK'],
    'partial'
  ),
  def('bare-empty', 'returns the raw empty envelope for no matches.', { errorStyle: 'bare-empty' }, ['empty_vs_error'], [], 'partial'),
  def('no-auth-message', 'generic failure text on 401/403.', { errorStyle: 'no-auth-message' }, ['auth_fail'], [], 'partial'),
  def('write-tool', 'exposes a delete tool on a read-only source.', { writeTool: true }, [], ['WRITE_TOOL'], 'partial'),
  def('secret-echo', 'includes the API key value in output and on stderr.', { echoSecret: true }, [], ['SECRET_ECHO'], 'partial'),
  def('no-retry', 'single attempt on 429/5xx.', { retry: false }, ['fault_retry'], ['NO_RETRY'], 'partial'),
  def(
    'confident-wrong',
    'turns a malformed upstream body into a fabricated answer.',
    { malformed: 'fabricate' },
    ['fault_malformed'],
    ['CONFIDENT_WRONG'],
    'partial'
  ),
  def('hallucinated-endpoint', 'also calls an undocumented upstream route.', { grounded: false }, ['grounding'], [], 'partial'),
  def(
    'bad-code-accept',
    'forwards invalid check-digit codes to the upstream.',
    { validateCodes: false },
    ['i18n_codes'],
    ['UNVALIDATED_CODE'],
    'partial'
  ),
  def('huge-payload', 'returns a very large slice of the big set.', { largeResponse: 'huge' }, ['large_response'], [], 'partial'),
  def('crash-on-init', 'the process ends before replying to initialize.', { processFault: 'crash-on-init' }, ['D1']),
  def('hang', 'never replies to any request.', { processFault: 'hang' }, ['D1']),
  def('stdout-noise', 'writes a non-JSON banner line to stdout before valid messages.', { processFault: 'stdout-noise' }, [], ['STDOUT_NOISE']),
  def('old-protocol', 'negotiates the older known protocol version 2024-11-05; a finding at most.', { processFault: 'old-protocol' }, []),
  def('unknown-protocol', 'replies with a protocol version nobody knows (1999-01-01); recorded as a finding.', { processFault: 'unknown-protocol' }, []),
  def('no-trunc-signal', 'caps the big set silently, no truncated or coverage signal.', { largeResponse: 'silent-cap' }, ['large_response'], [], 'partial')
]

export const VARIANTS: Record<string, VariantDef> = Object.fromEntries(LIST.map((v) => [v.id, v]))

export function variantIds(): string[] {
  return Object.keys(VARIANTS)
}
export function getVariant(id: string): VariantDef | undefined {
  return Object.prototype.hasOwnProperty.call(VARIANTS, id) ? VARIANTS[id] : undefined
}
