---
phase: 22-proposal-layer-follow-ups
plan: 04
requirements: [CUST-02]
status: complete (final limitation)
---

# 22-04 Summary: derived_filter on OData

Spike outcome (D-610): final documented limitation. The OData adapter produces `nested: []` for every entity (navigation properties are never expanded), so no nested collection exists and no candidate is in the acme OData fixtures; support would need adapter ($expand modelling), plan and template changes, beyond the bound. OData filters server-side with `$filter` and nested filtering is `any`/`all` lambdas.

Changes: gate message (code `odata-unsupported-op` unchanged) says final and why; context pack op table and the example skip reason say final; docs row and Limits section updated; `odata.test.ts` (json and xml fixtures) asserts message, empty nested collections and the skipped example. No other op or gate behaviour changed, goldens unchanged. `npx vitest run src/lib/mcpgen`: 51 files, 1016 tests green.
