// Machine-readable inventory of the deterministic baseline: the stable ids a proposal must reference.
// A tool's id is its baseline name; an argument's id is its name in the baseline signature; an entity
// and a field are referenced by the names the source model gives them. Written into the context pack
// and used by the tests that keep the examples and the gates honest.
import { entityFieldNames, toolKind } from '../plan.js'
import type { ServerPlan } from '../types.js'
import { baselineSignature } from './signature.js'

export interface Inventory {
  format: 1
  fingerprint: string
  server: string
  backend: string
  limits: ServerPlan['model']['limits']
  tools: {
    id: string
    kind: string
    operation: string | null
    entity: string
    readOnly: true
    description: string
    arguments: ReturnType<typeof baselineSignature>
    defaultFields: string[]
    derived: { id: string; kind: string; origin: string } | null
  }[]
  entities: {
    id: string
    label: string
    fields: { name: string; type: string; identifier?: boolean; nameLike?: boolean; classLike?: boolean; enum?: string[] }[]
    nested: { field: string; keyFields: string[]; valueFields: string[] }[]
    referenceableFields: string[]
  }[]
  /** Nested collections without a derived filter yet (a `derived_filter` op may add one, http backends only). */
  derivedCandidates: { entity: string; source: string }[]
  operations: { id: string; kind: string; method: string; path: string | null; entity: string }[]
}

export function buildInventory(plan: ServerPlan, fingerprint: string): Inventory {
  const have = new Set(plan.derived.map((d) => d.id))
  return {
    format: 1,
    fingerprint,
    server: plan.model.name,
    backend: plan.model.backend.kind,
    limits: plan.model.limits,
    tools: plan.tools.map((t) => ({
      id: t.name,
      kind: toolKind(plan, t),
      operation: t.operation ?? null,
      entity: t.entity,
      readOnly: true as const,
      description: t.description,
      arguments: baselineSignature(plan, t),
      defaultFields: t.projection,
      derived: t.derived ? { id: t.derived.id, kind: t.derived.kind, origin: t.derived.origin } : null,
    })),
    entities: plan.model.entities.map((e) => ({
      id: e.id,
      label: e.label,
      fields: e.fields.map((f) => ({
        name: f.name,
        type: f.type,
        ...(f.identifier ? { identifier: true } : {}),
        ...(f.nameLike ? { nameLike: true } : {}),
        ...(f.classLike ? { classLike: true } : {}),
        ...(f.enum ? { enum: f.enum } : {}),
      })),
      nested: e.nested.map((n) => ({ field: n.field, keyFields: n.keyFields, valueFields: n.valueFields })),
      referenceableFields: entityFieldNames(e),
    })),
    derivedCandidates:
      plan.model.backend.kind === 'http'
        ? plan.model.entities.flatMap((e) => e.nested.filter((n) => !have.has(`${e.id}.${n.field}`) && (n.keyFields.length > 0 || n.valueFields.length > 0)).map((n) => ({ entity: e.id, source: n.field })))
        : [],
    operations: plan.model.operations.map((o) => ({ id: o.id, kind: o.kind, method: o.method, path: o.path ?? null, entity: o.entity })),
  }
}
