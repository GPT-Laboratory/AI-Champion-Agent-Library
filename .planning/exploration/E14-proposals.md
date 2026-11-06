# E14: data-only proposal layer and context pack (stages 1 and 2, Phase 14)

Date: 2026-10-14. Decided by Ville: "Stages 0-2, designed for option 3: an external agent session with full context writes the proposals. The proposal format must allow structural edits (merge/split/hide/rename tools, defaults, composite tools), not just names and descriptions. Add a context-pack export (spec, samples, domain docs, deterministic baseline) for the agent. No in-platform model calls." Stage 0 (emitter-wide hygiene, annotations, outputSchema) is left to another agent. Decisions: D-580 to D-596 in `.planning/AUTONOMOUS-DECISIONS.md`. Reference doc: `docs/mcp-generator-proposals.md`.

## What was built

- `src/lib/mcpgen/proposals/`: `schema.ts` (zod ProposalSet, 13 op types, JSON Schema export), `selector.ts` (restricted grammar), `hygiene.ts`, `gates.ts` (gates 2 to 4), `index.ts` (gate 1 and 5, strict and lenient policy, fingerprint, provenance), `apply.ts` (pure apply), `signature.ts`, `inventory.ts`, `examples.ts`, `review.ts`, `contextPack.ts`, `model.ts`, `testkit.ts`.
- `src/lib/mcpgen/emit/proposed.ts` and `pytestProposed.ts`: argument edits, merge, split and composite emission, the proposal-assisted test file.
- CLI: `scripts/generate-mcp.ts` (`--proposals`, `--proposals-lenient`, `--validate-only`, `--context-pack`, `--docs`, `--samples`, `--emit-proposal-schema`), `scripts/mcp-pack-io.ts`.
- Stage 2: `src/lib/mcptest/proposalEval.ts`, `scripts/mcp-propose-eval.ts`, `npm run mcp-propose-eval`.
- Tests: 5 files under `proposals/`, `scripts/generate-mcp.proposals.test.ts`, `mcptest/proposalEval.test.ts`; goldens under `src/lib/mcpgen/__golden__/proposals/`.

## Shared-file diffs (kept small)

`types.ts` (optional `PlannedTool.proposed`, `ServerPlan.internal` and `proposals`, `GenerationReport.proposals`, origin `'proposed'`), `plan.ts` (exports of existing name sets, `toolKind` for wrappers, `proposal-hidden` in `DROP_CODES`, origin pass-through), `emit/python.ts` (calls into `emit/proposed.ts`; `paramChecks` exported), `emit/pytest.ts` (delegates when a plan has provenance), `binding.ts` (final argument names for changed tools, wrappers not bound), `generate.ts` (`generateFromPlan`, README Provenance), `report.ts` (`proposals`), `pipeline.ts` (`proposals` option), `mcptest/generatorSubject.ts` (optional `samples` and `text`), `package.json` (one script). No OData files and no `Param.wireName` were touched; argument renames use a prologue so the wire names stay untouched.

## Pre-existing tests

None was edited, so nothing was added to `EXEMPT` in `src/lib/mcptest/criteria.test.ts`. Every existing golden is byte-identical (the mcpgen suite passed unchanged after each emitter step).

## Design deviations (all logged)

D-584 (400 and 160 character caps, op array shape, field names), D-593 (the runner's Tier 1 gate and headline score are `not_run` and `n/a` for generator subjects because real-server cells stay pending, so the script also scores generator-side checks and adds two of its own), D-588 (provenance in report.json and README, no extra file), D-581 (post-processing of builder output instead of rewriting builders).

## How to use with an external agent session

1. `npm run generate-mcp -- --adapter <id> <spec> --context-pack /path/pack --docs <file-or-dir> --samples <file>`; read the console notes (cut samples, skipped examples).
2. Give the pack directory to the agent session. It reads `README-FOR-AGENT.md` first and writes `proposals.json`.
3. `npm run generate-mcp -- <spec> --proposals proposals.json --validate-only` until it prints ACCEPTED; read the review.
4. `npm run mcp-propose-eval -- <spec> --proposals proposals.json --write-packages /path/out`.
5. A person reviews, then generates with `--out`. Run the written packages with `mcp-test --subject cmd:... --allow-local-exec` on a machine you control (pending human).

## Limits

- Text hygiene is rule based with known false positives (for example the word "updates"); tune after reading real proposals.
- The evaluation cannot show that better descriptions help an agent choose tools; names and descriptions are advisory in the score.
- Composite tools cannot filter or compute; they only chain read-only calls and project fields.
- Fingerprint mismatch makes a proposal unusable after any change of source, options or generator; proposals are rewritten, not migrated.
- Only `http` backends support `derived_filter`; merge, split and composite work for http and sql (the dataset backend has one entity, so little to merge).
- The generated Python for merge, split and composite tools is syntax checked (py_compile) and text-checked, never run.

## Pending human

- Run a real agent session against a pack and read the first real proposal; tune hygiene false positives.
- Run the written baseline and proposal-assisted packages with `--allow-local-exec` (real FastMCP, real runtime).
- Decide whether to add a selection evaluation (separate opt-in and budget) and Stage 3 (provider module) later.
- Stage 0 (annotations, outputSchema, emitter-wide hygiene) by the other agent; the proposal layer does not depend on it, but goldens will change there and the proposal goldens (diffs against the baseline) may need regenerating with `UPDATE_GOLDEN=1`.
