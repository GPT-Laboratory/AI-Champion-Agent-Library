// Field-name-agnostic payload walkers. All tolerate non-object payloads.
import type { ToolOutcome } from './types'

export const DEFAULT_ID_ALIASES = ['id', 'ID', 'item_id', 'itemId', 'product_id', 'productId', 'sku', 'code', 'identifier', 'key']
const NAME_ALIASES = ['name', 'title', 'label']

type Dict = Record<string, unknown>
const isDict = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v)

/** structuredContent, else parsed JSON text, else raw text. */
export function payload(outcome: ToolOutcome): unknown {
  if (outcome.kind !== 'result') return outcome.message
  if (outcome.structured !== undefined && outcome.structured !== null) return outcome.structured
  try {
    return JSON.parse(outcome.text)
  } catch {
    return outcome.text
  }
}

/** All text of an outcome: text content plus serialised structured content. */
export function textBlob(outcome: ToolOutcome): string {
  if (outcome.kind !== 'result') return outcome.message
  let s = outcome.text ?? ''
  if (outcome.structured !== undefined) {
    try {
      s += JSON.stringify(outcome.structured)
    } catch {
      /* ignore */
    }
  }
  return s
}

/** Depth-first over every nested object. */
export function* iterDicts(p: unknown): Generator<Dict> {
  if (Array.isArray(p)) {
    for (const v of p) yield* iterDicts(v)
  } else if (isDict(p)) {
    yield p
    for (const v of Object.values(p)) yield* iterDicts(v)
  }
}

export function findDictWithField(p: unknown, aliases: string[]): Dict | undefined {
  for (const d of iterDicts(p)) if (aliases.some((a) => a in d)) return d
  return undefined
}

const eq = (a: unknown, b: unknown) =>
  a !== undefined && a !== null && typeof a !== 'object' && String(a).toLowerCase() === String(b).toLowerCase()

export function findProductByValue(p: unknown, idKeys: string[], value: string): Dict | undefined {
  for (const d of iterDicts(p)) if (idKeys.some((k) => k in d && eq(d[k], value))) return d
  return undefined
}

/** Objects that look like items: carry an id alias or a name-like field. */
export function findAllProducts(p: unknown, idKeys: string[] = DEFAULT_ID_ALIASES): Dict[] {
  // DRAFT-15-08-fix-2: outermost item-like objects only; objects nested inside an item (a supplier with an id,
  // an attribute entry with a key) are parts of that item, not further items.
  const out: Dict[] = []
  const visit = (v: unknown) => {
    if (Array.isArray(v)) for (const x of v) visit(x)
    else if (isDict(v)) {
      if (idKeys.some((k) => k in v) || NAME_ALIASES.some((k) => k in v)) out.push(v)
      else for (const x of Object.values(v)) visit(x)
    }
  }
  visit(p)
  return out
}

/** Three alias rules: key equals/endswith an alias and value equals; same with value contained; whole-object text contains. */
export function productBelongsToPartition(obj: unknown, keys: string[], value: string): boolean {
  if (!isDict(obj)) return false
  const v = value.toLowerCase()
  for (const [k, val] of Object.entries(obj)) {
    const kl = k.toLowerCase()
    const keyHit = keys.some((a) => kl === a.toLowerCase() || kl.endsWith(a.toLowerCase()))
    if (keyHit && val !== null && val !== undefined) {
      const s = (typeof val === 'object' ? JSON.stringify(val) : String(val)).toLowerCase()
      if (s === v || s.includes(v)) return true
    }
  }
  try {
    return JSON.stringify(obj).toLowerCase().includes(v)
  } catch {
    return false
  }
}
