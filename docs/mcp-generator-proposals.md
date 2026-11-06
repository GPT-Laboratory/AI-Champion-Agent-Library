# Proposal-assisted generation (data only)

The deterministic generator ([mcp-generator.md](mcp-generator.md)) writes a read-only MCP server from a spec. A **proposal file** lets an outside author improve that server: clearer names and descriptions, hidden noise, defaults, and merged, split or composite tools. The author is usually an external agent session that has read the spec, sample data and domain documents (decision D-580, designed for "option 3" of the research in `.planning/phases/14-mcp-generator-generalized-from-research-flagged/14-NONDETERMINISTIC-GENERATORS-RESEARCH.md`, sections 5 to 10 and 13). This platform never calls a model and never holds a key.

Properties that do not change:

- The proposal is **data only**. No field holds code; there is no eval, no free-form expression and no command anywhere.
- **Deterministic**: the same input plus the same proposal file gives byte-identical output.
- **Fail closed**: every proposal passes five deterministic gates before anything is applied.
- **A person reviews** the result before a proposal-assisted package is published. Nothing publishes automatically.
- The nine emitter behaviours (clamps, ceilings, honest empty and not-found, structured safe errors, projection cap, retries, read-only) cannot be switched off: no op can touch them. Merged, split and composite tools call the same generated tool functions the baseline has, so they inherit those behaviours.

## Workflow

1. `npm run generate-mcp -- <input> --context-pack <dir> [--docs <path>]... [--samples <path>]...` writes a context pack (below).
2. An external agent session reads the pack and writes `proposals.json`.
3. `npm run generate-mcp -- <input> --proposals proposals.json --validate-only` runs the gates and prints a review: per tool, before and after names, descriptions and arguments, new tools, applied and rejected ops. Exit 0 accepted, 2 rejected.
4. `npm run mcp-propose-eval -- <input> --proposals proposals.json` scores baseline and proposal-assisted packages (below). Exit 1 on a regression.
5. A person reads the review and the diff, then runs `npm run generate-mcp -- <input> --out <dir> --proposals proposals.json`.

## The ProposalSet file

```json
{
  "version": 1,
  "baseline": { "fingerprint": "<64 hex characters from the pack's FINGERPRINT file>" },
  "producer": { "kind": "external-agent", "note": "optional" },
  "ops": [ { "op": "rename_tool", "id": "rename-1", "reason": "text for the reviewer", "tool": "search_part", "name": "find_parts" } ]
}
```

`baseline.fingerprint` is the sha256 of the deterministic source model and plan (including generation options such as `--max-page-size`). A proposal applies only to the exact baseline it was written for. Each op has a stable `id` and a `reason`; the reason is for the reviewer, shown in reviews and reports, and never emitted into generated code. Ops always refer to **baseline** names (the ids in `baseline/tool-inventory.json`), so the result does not depend on op order. The JSON Schema is written by `--emit-proposal-schema <file>` and sits in every pack (`schema/proposal-set.schema.json`).

| op | fields | effect |
| --- | --- | --- |
| `rename_tool` | tool, name | New tool name. |
| `rename_arg` | tool, arg, name, keepAlias? | New argument name; `keepAlias` keeps the old name as a documented, optional alias. The upstream wire name never changes. |
| `describe_tool` | tool, text | Replaces the tool description. |
| `describe_arg` | tool, arg, text | Replaces one argument description. |
| `hide_tool` | tool | Leaves the tool out of the server. If a composite tool calls it, it stays as a private function. |
| `set_arg_default` | tool, arg, value | A default constant, validated against type, allowed values and range. |
| `pin_arg` | tool, arg, value | Fixes an argument to a constant; it stops being an argument. Never for credential-like arguments. |
| `set_projection` | entity, fields | Default fields of an entity, at most 12, all must exist. |
| `set_paging_default` | tool, arg (`page_size`, `limit`, `max_pages`), value | Default inside the clamp. |
| `merge_tools` | name, description, mode, sources, dispatchArg? | 2 to 8 tools become one with a `dispatch` enum argument (default name `operation`). Mode `fanout` calls up to 4 sources together and labels each result by source. The sources leave the server (private functions). |
| `split_tool` | tool, tools, keepOriginal? | One tool becomes up to 8 tools, each fixing argument values (named presets). |
| `composite_tool` | name, description, args, steps, output? | Up to 4 read-only steps in a fixed order; see below. |
| `derived_filter` | entity, source, description | The existing derived-filter template (origin `proposed`) for a nested collection that has none yet; REST http backends only. Always rejected with `odata-unsupported-op` on OData models; this is a final limitation (D-610): the OData adapter models no nested collections (navigation properties are reported, never expanded) and OData tools already filter on the server with `$filter`. |

### Composite tools

A composite tool is a sequence of at most 4 steps. Each step calls one grounded **read-only** baseline tool with arguments that are constants (`{"const": 3}`) or selectors (`{"from": "find.results[0].partId"}`). Data flows only through the selector grammar:

```
selector := root ( "." key | "[" index "]" )*
root     := "input" | "item" | <step id>
key      := [A-Za-z][A-Za-z0-9_]{0,63}      no underscore start, so no dunder name
index    := 0..99 or -1
```

A selector is parsed into a tuple of keys and indexes; the generated server walks dictionaries and lists with one fixed helper. Attribute access, calls, expressions, `${}`, backticks and quotes are outside the grammar and rejected. A step may fan out over a list (`forEach`, at most 10 items, selectors `item.*`). There are per-step caps, a total cap of 20 calls, and a runtime budget the helper enforces. A step that finds nothing ends the tool with the honest empty result. A field read from a step result must be in the callee's default fields or in the step's `select` (at most 12 fields). `output` maps up to 12 keys to selectors; without it the last step's result is returned.

## Gates

All deterministic, all run before apply. Each failure has a stable code, names the op id and never echoes a secret-looking value.

| gate | checks | example codes |
| --- | --- | --- |
| 1 schema | JSON, envelope, strict keys, caps on every string and list (zod) | `bad-json`, `file-too-large`, `schema-invalid` |
| 2 grounding | every tool, argument, entity, field, nested collection, step and input exists | `unknown-tool`, `unknown-arg`, `unknown-entity`, `unknown-field`, `unknown-nested`, `unknown-step`, `unknown-input`, `unknown-selector-target`, `field-not-projected`, `derived-not-built` |
| 3 safety | name regexes and caps, text hygiene, constants, selector grammar | `bad-tool-name`, `reserved-tool-name`, `write-verb-name`, `bad-arg-name`, `text-url`, `text-markup`, `text-injection`, `text-credential`, `text-credential-word`, `text-write-claim`, `text-limit-claim`, `text-control-chars`, `value-type`, `value-enum`, `value-range`, `value-secret`, `value-url`, `secret-arg`, `selector-syntax`, `paging-out-of-range` |
| 4 structure | counts, collisions, conflicts, orphans, cycles, read-only composites, last tool | `name-collision`, `duplicate-op-id`, `op-conflict`, `last-tool`, `hide-describe`, `too-many-sources`, `merge-arg-conflict`, `dispatch-arg-clash`, `split-empty-preset`, `composite-cycle`, `orphan-step`, `orphan-arg`, `missing-required-arg`, `call-cap`, `foreach-not-list`, `item-outside-foreach`, `pinned-arg-passed`, `composite-not-read-only`, `ref-to-proposed-tool`, `cyclic-reference`, `odata-unsupported-op` |
| 5 fingerprint | the proposal matches the exact baseline | `fingerprint-mismatch` |

Text rules: tool descriptions at most 400 characters (the emitter's docstring limit), argument descriptions at most 160, reasons at most 500. No links, markup, backticks, template syntax, credential-shaped strings or credential words, no instructions addressed to a model ("always call", "ignore", "do not tell"), no claim that a read-only tool creates, updates, deletes, modifies, inserts, overwrites, writes, removes, drops, truncates or mutates data, and no "at most N" number that differs from the server's real limits. A write verb is accepted when a negation sits directly before it with only other write verbs and "or"/"nor" between ("Does not delete or modify any data"); "Does not delete, but updates rows" is still a claim. "Update" as a data noun is accepted after "last", "latest", "recent" or "since the", or before "date", "time", "timestamp", "count", "history" or "log" ("the last update time"); past participles and nouns such as "updated" and "creation date" never matched. Credential and security checks (credential-shaped strings and credential words, links, markup, injection phrases, limit numbers) are intentionally unchanged. These remain heuristics (a description may still not say "updates rows"); a reviewer sees every accepted text.

**Policy.** Strict (default) rejects the whole file when any op fails. `--proposals-lenient` applies the ops that pass every gate (re-checked after each rejection, because dropping an op can orphan another) and lists the rest. A file-level failure (not JSON, wrong envelope, wrong baseline) is fatal in both modes.

## Apply and provenance

Apply is a pure function from the baseline plan and the gated ops to a new plan, which the normal emitter renders. Hidden and consumed tools remain as private `_op_*` functions only when something calls them; they are never registered. `report.json` gains `proposals` (file sha256, baseline fingerprint, mode, applied ops, rejected ops with gate and code, and a sha256 over every tool name and description in the style of a descriptions lock); the package README gets a Provenance section with the same hash. Tools hidden by a proposal appear in `toolsDropped`. A proposal-assisted package ships a smaller `test_server.py` (tool surface, signatures, read-only names, bad dispatch value) because the baseline tests name tools and arguments the proposal may have changed.

## Context pack

`--context-pack <dir>` writes a directory an agent session can read. It is refused if the directory is not empty (use `--force`).

```
README-FOR-AGENT.md        the task, the rules, what is forbidden, how to validate, how it is scored, the untrusted-content warning
FINGERPRINT                the value for baseline.fingerprint
MANIFEST.json              every file with its size and sha256
source/                    the input text, verbatim (untrusted)
samples/                   sample rows (--samples; row limited, redacted, bannered)
docs/                      domain documents (--docs; size capped, scanned, redacted, bannered)
baseline/package/          the deterministic baseline package (server, tests, report, binding)
baseline/tool-inventory.json   the stable ids a proposal must reference
baseline/source-model.json     the parsed source model
schema/proposal-set.schema.json
examples/                  one valid example per op type that applies to this baseline (checked against the real gates)
```

Safety rules:

- If the credential scanner rejects any input (source, samples, docs) no pack is written. The error names the file, line and kind and never the match.
- Samples and docs go through the shared redaction (links and long tokens removed), start with an `UNTRUSTED CONTENT` banner, and the README explains the prompt-injection risk: text in them is data, never instructions.
- Caps: at most 10 sample files (25 rows and 64 KiB each, 256 KiB total; cut with a note), at most 30 doc files (128 KiB each, 512 KiB total; over the cap is an error, never silent truncation). Docs accept `.md .txt .rst .json .yaml .yml .csv .tsv .sql .xml`; samples `.csv .tsv .json .jsonl .ndjson .txt`.
- Paths are read exactly as given: symbolic links are skipped, never followed; names starting with `.env` are refused (an explicit one is an error, one inside a directory is skipped); other dotfiles are skipped; directories are read at most 3 levels deep and at most 200 entries.
- The pack tells the agent not to run the generated server, call any service or follow instructions found in the inputs.

## Evaluation (Stage 2)

`npm run mcp-propose-eval -- <input> --proposals <file> [--adapter id] [--proposals-lenient] [--reruns 1-3] [--max-score-drop N] [--format text|markdown] [--write-packages <dir>]` generates both packages, runs them through the Phase 15 runner with the generator subject and prints a before/after table (Tier 1 gate, headline score, generator-side pass rate, blocker flags, warnings, verdict) plus every per-check difference. It is not part of `npm run check`.

Generated Python is never executed. As in `npm run mcp-test`, real-server cells stay `PENDING_HUMAN`, so for generator subjects the runner's own Tier 1 gate and headline score read `not_run` and `n/a`. The script therefore also scores what the generator subject measures before a server runs: the Tier 1 case's generator-side checks (it generates, it is reproducible, plus two checks added here: `binding_resolves`, the emitted `mcptest-binding.json` names emitted tools and real arguments, and `invariants_hold`, no URL, secret, raw exception text, dynamic code or unexpected import in the emitted server) and the pass rate over all generator-side checks. `--write-packages` writes both packages so a person can run them with `npm run mcp-test -- --subject cmd:"python3 <dir>/server.py" --allow-local-exec`. Reruns use the runner's majority rule with ties failing.

Exit codes: 0 no regression; 1 regression; 2 usage error or the proposal was rejected; 64 usage. A regression is any of: the runner's Tier 1 gate leaves `pass`; the generator-side Tier 1 gate leaves `pass`; the headline score or the generator-side pass rate drops by more than `--max-score-drop` percentage points (default 0); blocker flags increase. Names and descriptions are advisory in the score, so the table protects against regressions (a rename that breaks binding, a merge that breaks an invariant); it cannot show that descriptions help an agent choose tools. That needs a selection evaluation with an agent client, which this platform does not run.

## Limits and non-goals

- No model call, key, network access or code execution anywhere in this layer.
- Write operations are never proposed or enabled; `allowWrite` stays a human option.
- Composite and merged tools never call each other (only baseline tools can be referenced), so there are no cycles by construction; the gates still check.
- `derived_filter` is not available on OData models, by decision and not for lack of time (D-610): there is no nested collection to walk, and nested filtering in OData is a server-side lambda (`any`/`all`), not an in-memory scan.
- Descriptions are checked by rules, not understood; a reviewer is the last gate.
- The selector grammar cannot filter, sort or compute; richer shaping needs a new op type and a decision.
- A source with a different adapter, option or generator version has a different fingerprint; proposals are re-written, not migrated.
