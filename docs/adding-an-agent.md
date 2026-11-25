# Adding an agent: the files to touch

A checklist for maintainers adding a catalog agent to this repo. `<slug>` is the agent's file and folder name (lowercase, hyphens), for example `warranty-register-check`. Use an existing agent as a model: `warranty-register-check` has every part except the post-run check, and `ifc-ebom-compiler` has that too.

How much you need depends on how far the agent goes:

| Goal | Sections |
|---|---|
| Listed in the catalog only | 1 and 3 |
| Runnable in Try It Out | 1, 2 and 3 |
| Runnable, with checked output | 1 to 4 |

"Required" below means the catalog, the agent page or `npm run check` breaks without it.

## 1. Catalog entry (required)

| File | Notes |
|---|---|
| `data/agents/<slug>.yaml` | Copy [templates/agent-entry.template.yaml](templates/agent-entry.template.yaml) and fill every field; see [agent-entry-template.md](agent-entry-template.md). Consortium fields include `stage`, `purpose`, `inputs`, `outputs`, `gaps`, `draft_for_review: true` and `sample_data`. Put the final repository link in `github_url` from the start (see section 3). |

`metadata.agent_no` is optional, but if present it must be 1 to 20 (`scripts/validate-entries.ts`); a new number above 20 needs that limit raised first. Entries adapted from a DDC skill also need `metadata.attribution`.

Check the entry:

```bash
npm run validate-submission -- data/agents/<slug>.yaml
npm run validate-entries -- data/agents/<slug>.yaml
```

## 2. Try It Out, runnable mode (required for a runnable agent)

| File | Notes |
|---|---|
| `data/tryitout-prompts/<slug>/SKILL.md` | The instructions the model follows: the output format, the rule to treat the task and upload as data, and "Draft for engineer review.". |
| `data/tryitout-prompts/<slug>/sample-<name>.txt` | Synthetic sample input. The name must match `sample-*.txt` and the first line must say it is synthetic (checked by `src/lib/server/tryItOutExample.test.ts`). |
| `data/tryitout-prompts/<slug>/example.yaml` | Default `task` and `file`, optionally `result` and `result_label`. Every prompt folder must have one. See [tryitout-example.md](tryitout-example.md). |
| `data/tryitout-prompts/<slug>/example-result.md` | Optional: the expected result for the sample. It turns on "Show example result" and serves as the answer key in section 4. Write it from the skill's output format, check it with the helper, and never present it as a model run. |
| `scripts/set-try-it-out-mode.ts` | Add `{ slug: '<slug>', mode: 'runnable', url: null, taskTemplate: null }` to `UPDATES`. |
| `scripts/set-try-it-out-mode.gaps.test.ts` | Add the slug to the hard-coded lists (seeded slugs and the expected results in declared order); they fail otherwise. |

## 3. Shared lists and snapshots (required)

| File | What to do |
|---|---|
| `scripts/__golden__/flag-off.json` | Regenerate: `UPDATE_GOLDEN=1 npx vitest run scripts/flag-off.golden.test.ts`. Any new or changed entry changes this snapshot; without it `flag-off.golden`, `flag-regression` and `ingest.allformats.hinted` fail. Later edits to the entry (a new `github_url`, for example) need the same step. |
| `scripts/check-ddc-decoupling.sh` | Add the slug to `SLUGS` so the gate covers the entry, prompts and spec. |
| `docs/consortium-agents-inventory.md` | One row for the agent. |
| `docs/consortium-agents-gaps.md` | One `G-` row for each item in `metadata.gaps`. |
| `docs/third-party-notices.md` | Only when built on or inspired by a DDC skill; the label must equal `metadata.attribution`. |

## 4. Checked output (recommended)

What makes the agent's output checkable instead of taken on trust. The existing agents with a helper all have these.

| File | Purpose |
|---|---|
| `src/lib/<area>/<name>.ts` and its `.test.ts` | Pure, tested code for everything the model must not calculate: dates, sums, joins. |
| `scripts/<helper>.ts` | Command line for the helper: precomputes the input columns and compares a result table cell by cell (`runCli(input, result)`). |
| `docs/ddc-alignment/<slug>.md` | The spec with the answer key. |
| `scripts/ddc-alignment.<slug>.test.ts` | Keeps SKILL.md, sample, entry, spec and `example-result.md` consistent. Read the key from `example-result.md`; do not copy it into the test. |
| `scripts/smoke/profiles.ts` | A profile (`tableProfile({...})` when there is a helper) so `scripts/smoke-agent.ts --agent <slug>` and the LLM judge work; `scripts/smoke-agent.test.ts` then covers it. See [tryitout-live-run.md](tryitout-live-run.md). |
| `src/lib/server/tryitout/postRunCheck.ts` | Recommended: add the helper to `HELPER_CHECKS` (a `runCli(input, result)` helper) or `POST_RUN_CHECKS` (anything else), so every run gets the "Checked by tool" badge and a check report in the download. Keep the check logic in `src/lib/`, not in `scripts/`. See [tryitout-post-run-check.md](tryitout-post-run-check.md). |
| `src/lib/skillHelpers.ts` | With a helper: add it to `SKILL_HELPERS` (what to run before and after the skill), so the skill download ships the helper and says how to use it. See [skill-download.md](skill-download.md). |

## 5. Check it

```bash
npm run ingest && npx tsx scripts/set-try-it-out-mode.ts
bash scripts/check-ddc-decoupling.sh
npm run check
```

With a key, calibrate and run the judge once (`--calibrate` first), as described in [tryitout-live-run.md](tryitout-live-run.md).

## Rules

- No customer, consortium or confidential data in any entry, prompt, sample or result; samples are synthetic and labelled.
- Never commit keys or `.env` files.
- Put new tests in new files. `src/lib/mcptest/criteria.test.ts` fails when a test file that existed at its baseline is modified; if one must change, it needs an `EXEMPT` entry with the reason.
