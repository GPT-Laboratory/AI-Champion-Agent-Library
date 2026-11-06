---
phase: 20-proposal-layer-and-context-pack
status: passed
verified: 2026-10-14
execution: outside-gsd-flow
---

# Phase 20 Verification

Status: passed for what was scoped (the deterministic machinery and its tests); what remains is real-world use and is planned as Phase 22. Executed outside the normal GSD flow.

## Final verified numbers (main, after the last merge, 2026-10-14)

- `npm run check` twice exit 0: 269 test files passed (1 skipped), 3072 tests passed (1 skipped). `SEARCH_EMBEDDINGS=off npx vite build` exit 0. `npm run smoke` 104/104.
- Proposal-assisted generated packages pass pytest on FastMCP 3.4.8 and 4.1.0: Acme OpenAPI and Acme SQL, 5 tests each; OData with proposals, 5 each.

## Evidence

| Item | Status | Evidence |
| --- | --- | --- |
| Proposal format, 13 op types, selector grammar | Met | D-580, D-581; schema and emitter tests |
| Gates, apply, fingerprint, pipeline wiring | Met | D-582..D-586; gate and golden tests over Acme fixtures |
| Context pack, review summary, CLI modes | Met | D-587..D-592; context pack and CLI tests |
| Baseline vs proposal evaluation | Met | D-593, `npm run mcp-propose-eval` |
| Determinism and no in-platform model calls | Met | op-order independence test (D-582); tests D-594; D-596 records what was deliberately not built (no LLM provider, prompt, budget or key handling); `docs/mcp-generator-proposals.md` |

## Not run (carried to Phase 22 / 23)

- OData with filter/split proposal ops; `derived_filter` on OData is reported unsupported (`odata-unsupported-op`) and skipped in examples.
- No real proposal from an agent session has been written or reviewed by Ville yet; baseline and proposal-assisted packages have not been run through `mcp-test --allow-local-exec` side by side.
- Text hygiene gate 3 (D-585) is heuristic and deliberately strict; false positives are untuned.
- No code review of this code (Phase 23).
