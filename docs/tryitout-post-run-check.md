# Try It Out post-run check (optional, per agent)

An agent whose output a deterministic helper can verify gets that check after every successful Try It Out job. The
check is own code, makes no model call and costs no tokens. It catches the slips a small model makes on a lookup
(for example a row sent to review under the wrong rule) and tells the visitor about them in the same run.

## What the visitor sees

- In the progress feed, before `agent settled (clean exit)`: one summary line, then up to 5 findings, indented.
  Example for a result in which the model sent a duplicate of E-04 to review as `no-catalogue`:

  ```
  helper check: 1 mismatch with the ebom-join helper (details in ebom-join-check.md)
    E-12: rule is "no-catalogue", helper says "multi-catalogue"
  ```

- On the page, above the result: a badge "Checked by tool" with the same summary, green when every checked cell
  agrees, amber when there are differences, grey when nothing could be checked. The badge reads the status from
  `GET /api/tryitout/jobs/:id/check` (kept on the job by the server), never from a file of the download: the agent
  can write any file name, so a file could not prove anything.
- In the download, next to the agent's own files: the report (`<helper>-check.md`) with all findings. For
  ifc-ebom-compiler also `ebom.xlsx`: the E-BOM lines joined by the tool from the agent's billed rows (metres
  rounded up to whole 3 m sticks, block titles from the upload), the class rows with a per-row "tool check" column,
  the review items and the check summary. It is written only when the class rows meet the contract.

The agent's own files are never changed or removed. The job's status is the agent's: a mismatch does not fail the job,
and a check that throws only gives the line `helper check failed to run; the result is unchecked`. A report or
spreadsheet is left out (with a feed line saying why) when the output already has a file of that name or the artifact
is at its file or size cap; the badge then still shows the status, without a file name.

## Which agents have one

| Agent | Result section checked | Report | Code |
|---|---|---|---|
| ifc-ebom-compiler | `## E-BOM class rows`, against the contract and cell by cell against the helper's own rows | `ebom-join-check.md`, `ebom.xlsx` | `src/lib/ebom/ebomCheck.ts` (CLI `scripts/ebom-join.ts`) |
| warranty-register-check | `## Warranty register check` | `warranty-status-check.md` | `src/lib/warranty/resultCheck.ts` (CLI `scripts/warranty-status.ts`) |
| procurement-lead-time-check | `## Lead time check` | `procurement-lead-time-check.md` | `src/lib/procurement/resultCheck.ts` (CLI `scripts/procurement-lead-time.ts`) |
| material-delivery-check | `## Delivery check` | `delivery-check-check.md` | `src/lib/delivery/resultCheck.ts` (CLI `scripts/delivery-check.ts`) |
| bms-digital-twin | `## Point mapping` | `bms-point-status-check.md` | `src/lib/bms/resultCheck.ts` (CLI `scripts/bms-point-status.ts`) |
| carbon-epd-enrichment | `## Per-product rows` | `carbon-lifecycle-check.md` | `src/lib/carbon/resultCheck.ts` (CLI `scripts/carbon-lifecycle.ts`) |
| qto-normalization | `## Normalised rows` | `qto-group-totals-check.md` | `src/lib/qto/resultCheck.ts` (CLI `scripts/qto-group-totals.ts`) |
| scope-rule-drafter | The rules typed in the task box (numbered S-1, S-2, ... as the skill does) against the attached E-BOM data. `## Sentence mapping` and `## RULES`: every rule in the compiler's grammar, its field a column and its value in the data, its note has an exclusion wording (delivered/supplied/installed/provided/billed by, comes from, belongs to, not part of / outside this contract, excluded) and names the value; a not-an-exclusion row has no exclusion wording; one mapping row per sentence, the unturned sentences copied. The badge shows the dry run, e.g. "2 rules, all valid: text:1 excludes E-06; text:2 excludes E-05" | `rule-check-check.md` | `src/lib/rules/ruleCheck.ts` (CLI `scripts/rule-check.ts`) |

Each check reads `result.md` first, else any `.md`/`.txt` of the output with that section, and takes the upload as
input (with no upload, the task text). The six table helpers are wired through `helperCheck` with the same
`runCli(input, result)` their CLI uses, so the app and `npx tsx scripts/<helper>.ts <input> <result>` agree.

## Tool step before the run

The same idea, in front of the model: an agent can have a deterministic step that rewrites its input before the run
(`PRE_RUN_STEPS` in `src/lib/server/tryitout/preRunStep.ts`), so the model copies a tool's answer instead of working
it out. It runs on both paths, writes one feed line, and leaves the input unchanged (with a feed line saying so) if
it cannot read it. Uploads of agents without a step are passed on byte for byte.

| Agent | What the step writes | Code |
|---|---|---|
| ifc-ebom-compiler | A last ELEMENTS column `excluded_by` (the id of the first scope rule whose field holds exactly its value, or `-`) and a section `## RULES NOT TIED TO DATA` (rule lines with a broken shape or an unknown field, or `none`). The model's step 1 is "copy `excluded_by`", so an element is always excluded before any review step, and a well-formed rule that excludes nothing is never listed as untied. Given `excluded_by` values or an untied section are replaced, never trusted. Feed line: `tool step: excluded_by worked out for 11 elements from 2 rules (E-05 rules:2, E-06 rules:1); 1 not tied to data` | `src/lib/ebom/prepare.ts` |

The post-run check compares the result with the original upload, so the step and the check cannot hide each other's
mistakes. On the direct-model fallback, a job with a file also sends the task text (behind its own data delimiter),
as the container path does with `task.txt`.

## Adding one

1. Put the check logic in `src/lib/` as pure code (no I/O), so the CLI and the app run the same thing.
2. A helper with `runCli(input, result)` (exit codes 0 match, 1 `MISMATCHES (n)` then one line each, 2 bad input):
   add a row to `HELPER_CHECKS` in `src/lib/server/tryitout/postRunCheck.ts`. Anything else: add a `PostRunCheck` to
   `POST_RUN_CHECKS`. It gets the task text, the upload as text (or null) and the output files, and returns the
   report file name and text, one summary line, the status (`match`, `differences`, `not-checked`), the findings and
   optional attachments.
3. Add tests in a new test file (pre-existing test files stay unmodified, `src/lib/mcptest/criteria.test.ts`).

The check runs on both paths: the Pi container (`src/lib/server/tryitout/piRunner.ts`) and the direct-model fallback
(`src/lib/server/tryItOutRunner.ts`).
