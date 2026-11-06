# 22-01 Findings: writing the first real proposal

Proposer: a Claude agent session (this autonomous run). Spec: repo fixture `src/lib/mcpgen/testing/fixtures/acme-openapi.yaml` (synthetic). Pack: exported to the scratchpad, read only `README-FOR-AGENT.md`, `FINGERPRINT`, `baseline/tool-inventory.json`, `examples/`, the schema and the source. No server was run, no `.env` read, no model or network call.

Baseline fingerprint: `7d8411e7...f03ff`. Baseline tools: `filter_part_by_features`, `lookup_part_by_id`, `search_part`.

## Gate-3 friction

**None encountered while writing the proposal.** The first draft was accepted in strict mode (exit 0, 9 ops). I wrote the text in my normal style and did not pre-sanitise it against the gates, so this is a real, if small, data point: for the descriptions this agent naturally wrote on this small API, hygiene produced no false positives.

Two things I corrected myself before commit (not gate findings, review-quality issues):
- The composite description said "full record", but the generated `lookup_part_by_id` returns the default 4 fields, so it was reworded to "details".
- The `q` argument text claimed matching on "names and descriptions"; the spec only says "Free text query", so the claim was removed. No gate catches inaccurate behaviour claims like these; the reviewer must.

## Supplementary probes (not part of the proposal)

Because the real proposal produced no rejections, I ran 8 throwaway single-op probes (scratchpad, not committed) with phrasings an agent plausibly writes, to give plan 03 some data. These are synthetic probes, not rejections hit while writing the proposal; weigh them accordingly.

| probe phrase class | result | classification |
| --- | --- | --- |
| "the catalogue is updated daily so results change" | accepted | n/a (docs warn "updates" may be blocked; it was not in this context) |
| "Sets the page size used when listing parts" | accepted | n/a |
| "See the Acme documentation page for details" (no link) | accepted | n/a |
| "Returns a token count per part" | accepted | n/a |
| "Always use this first when looking for parts" (op id probe-always) | `text-injection` | correct block (instruction to a model) |
| "Returns at most 25 parts per page" | `text-limit-claim` | correct block (server limit is 50) |
| "Pass the part code, not the API key" | `text-credential-word` | borderline: the sentence tells the caller NOT to pass a key; a plausible false positive, but credential words stay blocked by design (A-04) |
| "Does not delete or change any data" | `text-write-claim` | **false positive**: a negated, reassuring statement that the tool is read-only is blocked. This is the clearest candidate for plan 03 |

Suggested input for plan 03: negation-aware write-claim matching ("does not / never / no ... delete|change|write"), tested in both directions (a positive claim "deletes parts" stays blocked). Leave credential-word as is unless a clearer false-positive appears.

## Other observations

- The pack's `derived_filter` example was skipped ("every nested collection already has a derived filter"); the pack states why, which was clear.
- The README's validate command uses `--adapter openapi source/...`; the repo script form without `--adapter` also worked.
- With only 3 baseline tools, "hide" has to remove a real capability (the feature filter). I flagged the trade-off in the op reason. `merge_tools`/`split_tool` were not used; the composite op was chosen as the one multi-step case.
