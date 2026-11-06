---
phase: 21-generator-stage-0
plan: 04
requirements: [CUST-02]
status: complete
---
# 21-04 Summary: deterministic order

## What changed
- `determinism.test.ts` (147 tests, committed first): http, dataset, sql, OData, openapi and sql fixtures plus every proposal scenario, regenerated from reversed and 5 seeded permutations (small LCG, no Math.random) of operations, entities, nested collections, gaps and dropped writes; compared to the baseline output, not to a fixed order. Also: collision tie-break, proposal op order (each multi-op scenario reversed, plus an independent merge/hide/projection set shuffled, wrapper and internal tools included). The proposal file hash is masked in those comparisons because it legitimately follows file text.
- Leaks found and fixed: input order of operations/entities/gaps reached report.json gap order, collision suffix assignment and the proposal baseline fingerprint (so proposals failed to apply on a permuted model).
  - `plan.ts`: `canonicalModel()` sorts operations (id, method, path, entity), entities (id), nested collections (field), model gaps and dropped writes by code unit before planning; tools sort by name, entity, operation; derived by id; `plan.gaps` sorted by `gapOrder` (severity, code, path, message). Exported `gapOrder`.
  - `proposals/apply.ts`: tool and internal-tool sort gets an entity tie-break, gaps sorted; `proposals/index.ts`: provenance `applied` and `rejected` sorted by id.
- Deliberately not sorted: entity field order, parameter order and composite key order. They are declared order (column order, positional arguments, default projection), as the plan's action text says; the plan's behaviour bullet that also lists fields and params was not followed, so those are not permuted in the tests.

## Behaviour notes
- Dataset backends emit "the first entity"; that is now the first by id rather than the first in the file.
- Gap order in report.json is now sorted (severity, code, path, message), not emission order.

## Tests
`npx tsc --noEmit` clean; `npx vitest run src/lib/mcpgen scripts`: 1167 passed, 30 failed, all the known golden tests (no new failures). Golden churn grows only inside those same files (gap order, entity/op order).
