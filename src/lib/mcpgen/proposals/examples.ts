// One valid example proposal file per op type, built from the baseline inventory so each example
// refers to tools, arguments and fields that really exist for THIS input. Every example is run
// through the real gates (strict) before it is offered; an op type that does not apply to the
// baseline (for example derived filters when the only nested collection already has one) is listed
// as skipped with the reason. The context pack writes these to examples/.
import { entityFieldNames, snake, toolKind } from '../plan.js'
import type { PlannedTool, ServerPlan, SourceModel, DerivedTool, GenerateOptions } from '../types.js'
import { evaluateProposals } from './index.js'
import { baselineSignature } from './signature.js'
import { OP_TYPES, type OpType } from './schema.js'
import type { SigArg } from './model.js'

export interface Example {
  op: OpType
  file: string
  /** The ProposalSet document (plain data). */
  set: Record<string, unknown>
}
export interface SkippedExample {
  op: OpType
  reason: string
}

const FREE_TEXT = ['q', 'query', 'search', 'keyword', 'keywords', 'text', 'term', 'free_text']
const words = (s: string) => snake(s).replace(/_/g, ' ')

function uniqueName(base: string, taken: Set<string>): string {
  let n = base.slice(0, 44).replace(/_+$/, '')
  let i = 2
  while (taken.has(n)) n = `${base.slice(0, 40).replace(/_+$/, '')}_${i++}`
  return n
}

export function buildExamples(
  model: SourceModel,
  options: GenerateOptions,
  extraDerived: DerivedTool[],
  baseline: ServerPlan,
  fingerprint: string,
): { examples: Example[]; skipped: SkippedExample[] } {
  const tools = baseline.tools
  const taken = new Set(tools.map((t) => t.name))
  const sigOf = (t: PlannedTool) => baselineSignature(baseline, t)
  const kindOf = (t: PlannedTool) => toolKind(baseline, t)
  const nonDescribe = tools.filter((t) => kindOf(t) !== 'describe')
  const withArg = (names: string[]) => nonDescribe.find((t) => sigOf(t).some((a) => names.includes(a.name)))
  const doc = (ops: unknown[]) => ({ version: 1, baseline: { fingerprint }, producer: { kind: 'tool', note: 'example generated from the baseline inventory' }, ops })
  const base = (id: string) => ({ id, reason: 'Example only: shows the shape of this op for the reviewer.' })
  const candidates: { op: OpType; ops: unknown[] | null; why?: string }[] = []

  const first = nonDescribe[0]
  candidates.push({
    op: 'rename_tool',
    ops: first ? [{ op: 'rename_tool', ...base('rename-1'), tool: first.name, name: uniqueName(`find_${first.name.replace(/^[a-z]+_/, '')}`, taken) }] : null,
    why: 'the baseline has no tool to rename',
  })

  const argTool = nonDescribe.find((t) => sigOf(t).some((a) => a.name !== 'fields' && a.type !== 'array'))
  const argSig = argTool ? sigOf(argTool).find((a) => a.name !== 'fields' && a.type !== 'array')! : undefined
  const renameTo = (a: SigArg) => (a.name === 'page_size' ? 'per_page' : a.name === 'limit' ? 'row_limit' : a.name === 'page' ? 'page_number' : `${a.name}_value`.slice(0, 32))
  candidates.push({
    op: 'rename_arg',
    ops: argTool && argSig ? [{ op: 'rename_arg', ...base('rename-arg-1'), tool: argTool.name, arg: argSig.name, name: renameTo(argSig), keepAlias: true }] : null,
    why: 'no tool has a renameable argument',
  })

  candidates.push({
    op: 'describe_tool',
    ops: first
      ? [{ op: 'describe_tool', ...base('describe-1'), tool: first.name, text: `Reads ${words(first.entity === '*' ? 'records' : first.entity)} records from the source, read-only. Says clearly when nothing matches.` }]
      : null,
    why: 'the baseline has no tool to describe',
  })
  candidates.push({
    op: 'describe_arg',
    ops: argTool && argSig ? [{ op: 'describe_arg', ...base('describe-arg-1'), tool: argTool.name, arg: argSig.name, text: `The ${words(argSig.name)} to use, exactly as it appears in the source.` }] : null,
    why: 'no tool has an argument to describe',
  })

  const hideCand = nonDescribe.length >= 2 ? nonDescribe[nonDescribe.length - 1] : undefined
  candidates.push({ op: 'hide_tool', ops: hideCand ? [{ op: 'hide_tool', ...base('hide-1'), tool: hideCand.name }] : null, why: 'hiding needs at least two tools' })

  const matchTool = withArg(['match'])
  const sizeTool = withArg(['page_size', 'limit'])
  candidates.push({
    op: 'set_arg_default',
    ops: matchTool
      ? [{ op: 'set_arg_default', ...base('default-1'), tool: matchTool.name, arg: 'match', value: 'contains' }]
      : sizeTool
        ? [{ op: 'set_arg_default', ...base('default-1'), tool: sizeTool.name, arg: sizeTool.name && sigOf(sizeTool).some((a) => a.name === 'page_size') ? 'page_size' : 'limit', value: 10 }]
        : null,
    why: 'no tool has an argument with a checkable default',
  })

  const pinArg = sizeTool ? (sigOf(sizeTool).some((a) => a.name === 'page_size') ? 'page_size' : 'limit') : undefined
  candidates.push({
    op: 'pin_arg',
    ops: sizeTool && pinArg ? [{ op: 'pin_arg', ...base('pin-1'), tool: sizeTool.name, arg: pinArg, value: 10 }] : null,
    why: 'no tool has a paging argument to pin',
  })

  const entity = model.entities.find((e) => baseline.tools.some((t) => t.entity === e.id) && entityFieldNames(e).length >= 3)
  candidates.push({
    op: 'set_projection',
    ops: entity ? [{ op: 'set_projection', ...base('projection-1'), entity: entity.id, fields: entityFieldNames(entity).slice(0, 3) }] : null,
    why: 'no entity has at least three fields',
  })

  candidates.push({
    op: 'set_paging_default',
    ops: sizeTool && pinArg ? [{ op: 'set_paging_default', ...base('paging-1'), tool: sizeTool.name, arg: pinArg, value: 5 }] : null,
    why: 'no tool has a page size argument',
  })

  const two = nonDescribe.slice(0, 2)
  candidates.push({
    op: 'merge_tools',
    ops:
      two.length === 2
        ? [
            {
              op: 'merge_tools',
              ...base('merge-1'),
              name: uniqueName(`explore_${snake(model.name).slice(0, 20)}`, taken),
              description: 'One entry point that runs either of two read-only operations; choose it with the operation argument.',
              mode: 'dispatch',
              sources: two.map((t, k) => ({ tool: t.name, value: mergeValue(two, k) })),
            },
          ]
        : null,
    why: 'merging needs at least two tools',
  })

  const splitTool = matchTool ?? sizeTool
  const splitArg = matchTool ? 'match' : pinArg
  candidates.push({
    op: 'split_tool',
    ops:
      splitTool && splitArg
        ? [
            {
              op: 'split_tool',
              ...base('split-1'),
              tool: splitTool.name,
              tools: matchTool
                ? [
                    { name: uniqueName(`prefix_${splitTool.name}`, taken), description: 'Same query, fixed to prefix matching: rows whose value starts with the text.', fixed: { match: 'startsWith' } },
                    { name: uniqueName(`exact_${splitTool.name}`, taken), description: 'Same query, fixed to exact matching.', fixed: { match: 'equals' } },
                  ]
                : [
                    { name: uniqueName(`preview_${splitTool.name}`, taken), description: 'A short preview page of the same list.', fixed: { [splitArg]: 5 } },
                    { name: uniqueName(`full_${splitTool.name}`, taken), description: 'A full page of the same list.', fixed: { [splitArg]: 20 } },
                  ],
            },
          ]
        : null,
    why: 'no tool has an argument that can be fixed to presets',
  })

  candidates.push({ op: 'composite_tool', ops: compositeExample(model, baseline, nonDescribe, sigOf, kindOf, taken, base), why: 'a composite needs a list or query tool and a lookup that an identifier from the first can feed' })

  const derivedCand = derivedCandidate(model, baseline)
  candidates.push({
    op: 'derived_filter',
    ops: derivedCand ? [{ op: 'derived_filter', ...base('derived-1'), entity: derivedCand.entity, source: derivedCand.source, description: 'Find items whose nested entries match a key; candidate pages are scanned in memory and the coverage is reported.' }] : null,
    why: 'every nested collection already has a derived filter, or the backend has none to filter (OData models no nested collections and filters server-side with $filter: final limitation)',
  })

  const examples: Example[] = []
  const skipped: SkippedExample[] = []
  for (const c of candidates) {
    if (!c.ops) {
      skipped.push({ op: c.op, reason: `not applicable to this baseline: ${c.why}` })
      continue
    }
    const set = doc(c.ops)
    const ev = evaluateProposals({ model, options, extraDerived, text: JSON.stringify(set) })
    if (!ev.ok) {
      skipped.push({ op: c.op, reason: `the generated example did not pass the gates (${[...ev.fatal, ...ev.rejected].map((i) => i.code).join(', ')})` })
      continue
    }
    examples.push({ op: c.op, file: `${c.op}.example.json`, set })
  }
  void OP_TYPES
  return { examples, skipped }
}

function mergeValue(two: PlannedTool[], k: number): string {
  const seg = (t: PlannedTool) => t.name.split('_')[0].slice(0, 20)
  return seg(two[0]) === seg(two[1]) ? `${seg(two[k])}_${k === 0 ? 'a' : 'b'}` : seg(two[k])
}

function derivedCandidate(model: SourceModel, baseline: ServerPlan): { entity: string; source: string } | undefined {
  if (model.backend.kind !== 'http') return undefined
  const have = new Set(baseline.derived.map((d) => d.id))
  for (const e of model.entities) {
    for (const n of e.nested) {
      if (have.has(`${e.id}.${n.field}`) || (n.keyFields.length === 0 && n.valueFields.length === 0)) continue
      return { entity: e.id, source: n.field }
    }
  }
  return undefined
}

function compositeExample(
  model: SourceModel,
  baseline: ServerPlan,
  tools: PlannedTool[],
  sigOf: (t: PlannedTool) => SigArg[],
  kindOf: (t: PlannedTool) => string,
  taken: Set<string>,
  base: (id: string) => Record<string, string>,
): unknown[] | null {
  const idOf = (t: PlannedTool) => model.entities.find((e) => e.id === t.entity)?.identifierFields[0]
  if (model.backend.kind === 'http') {
    const finder = tools.find((t) => (kindOf(t) === 'search' || kindOf(t) === 'list') && sigOf(t).some((a) => FREE_TEXT.includes(a.name)) && idOf(t))
    const getter = tools.find((t) => kindOf(t) === 'get' && t.entity === finder?.entity)
    if (!finder || !getter) return null
    const textArg = sigOf(finder).find((a) => FREE_TEXT.includes(a.name))!.name
    const idArg = sigOf(getter).find((a) => a.required)?.name
    const idField = idOf(finder)
    if (!idArg || !idField) return null
    const hasSize = sigOf(finder).some((a) => a.name === 'page_size')
    return [
      {
        op: 'composite_tool',
        ...base('composite-1'),
        name: uniqueName(`find_${snake(finder.entity)}_details`, taken),
        description: 'Searches by text, takes the first match and returns its full record in one call. Says clearly when nothing matches.',
        args: [{ name: 'text', type: 'string', description: 'Text to search for.' }],
        steps: [
          { id: 'find', tool: finder.name, args: { [textArg]: { from: 'input.text' }, ...(hasSize ? { page_size: { const: 1 } } : {}) }, select: [idField] },
          { id: 'detail', tool: getter.name, args: { [idArg]: { from: `find.results[0].${idField}` } } },
        ],
      },
    ]
  }
  const q = tools.filter((t) => kindOf(t) === 'query')
  const t1 = q.find((t) => idOf(t) && model.entities.find((e) => e.id === t.entity)?.fields.some((f) => f.nameLike))
  if (!t1) return null
  const e1 = model.entities.find((e) => e.id === t1.entity)!
  const nameField = e1.fields.find((f) => f.nameLike)!.name
  const idField = idOf(t1)!
  // The second step looks up rows of an entity that has a column named like the identifier, else the same entity again.
  const t2 = q.find((t) => t.name !== t1.name && model.entities.find((e) => e.id === t.entity)?.fields.some((f) => f.name === idField)) ?? t1
  void baseline
  return [
    {
      op: 'composite_tool',
      ...base('composite-1'),
      name: uniqueName(`find_${snake(e1.id)}_details`, taken),
      description: 'Finds the first row whose name contains the text, then returns the rows that belong to it in one call. Says clearly when nothing matches.',
      args: [{ name: 'name', type: 'string', description: 'Text the name must contain.' }],
      steps: [
        { id: 'find', tool: t1.name, args: { field: { const: nameField }, value: { from: 'input.name' }, match: { const: 'contains' }, limit: { const: 1 } }, select: [idField] },
        { id: 'detail', tool: t2.name, args: { field: { const: idField }, value: { from: `find.results[0].${idField}` }, match: { const: 'equals' }, limit: { const: 10 } } },
      ],
    },
  ]
}
