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

- In the download, next to the agent's own files: the report (for ifc-ebom-compiler `ebom-join-check.md`) with all
  findings and the E-BOM lines joined from the agent's billed rows.

The agent's own files are never changed or removed. The job's status is the agent's: a mismatch does not fail the job,
and a check that throws only gives the line `helper check failed to run; the result is unchecked`. The report is left
out (with a feed line saying why) when the output already has a file of that name or the artifact is at its file or
size cap.

## Which agents have one

| Agent | Check | Report | Code |
|---|---|---|---|
| ifc-ebom-compiler | The class rows of `result.md` (else any `.md`/`.txt` with `## E-BOM class rows`) against the contract and, cell by cell, against the helper's own rows for the upload (or, with no upload, the task text) | `ebom-join-check.md` | `src/lib/ebom/ebomCheck.ts`, the same code as `npx tsx scripts/ebom-join.ts <upload> <result>` |

## Adding one

1. Put the check logic in `src/lib/` as pure code (no I/O), so the CLI and the app run the same thing.
2. Add a `PostRunCheck` for the slug to `POST_RUN_CHECKS` in `src/lib/server/tryitout/postRunCheck.ts`. It gets the task
   text, the upload as text (or null) and the output files, and returns the report file name, its text, one summary
   line and the findings.
3. Add tests in a new test file (pre-existing test files stay unmodified, `src/lib/mcptest/criteria.test.ts`).

The check runs on both paths: the Pi container (`src/lib/server/tryitout/piRunner.ts`) and the direct-model fallback
(`src/lib/server/tryItOutRunner.ts`).
