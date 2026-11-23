# Try It Out example (optional, per agent)

An agent can ship an example so visitors see what input it needs and what it returns, without spending tokens.

## Where it lives

Only in the agent's prompt folder, next to `SKILL.md`:

```
data/tryitout-prompts/<slug>/
  SKILL.md
  example.yaml          # names the default task, file and saved result
  sample-*.txt          # the default input file (the existing sample; no copy)
  example-result.md     # the saved result
```

`example.yaml`:

```yaml
task: >-                # required; prefilled in the Task field
  Compile the attached upload ...
file: sample-ifc-elements.txt     # optional; attached by default, viewable as "View example input"
result: example-result.md         # optional; shown as "Show example result (no model call)"
result_label: Expected result ... # required with result: says where the result came from
task_label: Scope rules in your own words, one per line   # optional; label of the task field (default "Task")
file_label: E-BOM input file the rules apply to         # optional; label of the file field
hint: The rules are matched against ...                 # optional; one line under the task field
task_placeholder: "One rule per line, ..."              # optional; shown when the task field is empty
```

The four optional wording keys are for agents whose task field is not a free instruction. The Scope Rule Drafter
uses them: its task field holds the scope rules typed in plain language, one per line, and the file is the E-BOM
input they apply to. A multi-line example task opens the field with room for its lines.

File names are bare names in the same folder. Each file is capped at 200 KB, the same as an upload. Unknown keys are rejected.

## What the visitor sees

- The task is prefilled and the example file is attached. Both can be edited, removed or replaced.
- "View example input" shows the file, so the input format is visible: `# ` lines as notes, `key: value` lines as
  fields, and each CSV or `|`-separated section as a table under its `## ` heading. "Show raw text" shows the file
  exactly as it is.
- "Show example result" shows the saved result with its label, its tables as tables, and "Download tables as Excel
  (.xlsx)". It makes no request and no model call.
- Run is unchanged: it always does a real run, with whatever task and file are in the form.

Agents without `example.yaml` get the panel as before.

## The result of a run

After a run succeeds, the panel shows its result on the page under "Result", next to "Download results" (which stays). This holds for every runnable agent, with or without an example.

- The panel reads the same artifact as the download (`GET /api/tryitout/jobs/<id>/artifact`) and unzips it in the browser (`src/lib/tryItOutResult.ts`). The job API and `src/lib/tryItOut.ts` are unchanged.
- Text files are shown (`.md`, `.txt`, `.csv`, `.json`): `result.*` first and open, then the others by name (for example `ebom-join-check.md`).
- Markdown tables are shown as tables (`src/lib/components/ResultView.svelte`, parser `src/lib/resultMarkdown.ts`); short status words such as `bill`, `review`, `expired` or `register-ok` get a coloured chip, and the word is always shown too. "Show raw text" shows the file exactly. JSON starts as raw text. The view is built from plain strings with Svelte elements: nothing from a result is ever rendered as HTML.
- "Download tables as Excel (.xlsx)" writes the result's tables as a workbook in the browser (`src/lib/xlsx.ts`, one sheet per table, named after its heading; plain decimals as numbers, text never as a formula). When the artifact already has a spreadsheet (ifc-ebom-compiler's `ebom.xlsx`, written by the post-run check), the panel offers "Download ebom.xlsx" instead.
- For an agent with a tool check, a badge above the result says "Checked by tool: matches", "differences found" or "Not checked by tool", with the check's summary. It comes from the server (`GET /api/tryitout/jobs/<id>/check`), never from a file in the artifact; see [tryitout-post-run-check.md](tryitout-post-run-check.md).
- Size caps are checked before anything is decompressed: a zip over 1 MB, or text files over 200 KB in total, are left to the download. Then the panel says "The result cannot be shown here; use Download results."

## Handing a result to the next agent

Some results are the input of another agent (`src/lib/handoff.ts`). Today: the Scope Rule Drafter's rules go to the
IFC EBOM Compiler.

- Under "Show example result" and under a run's result, the panel shows "Use these rules in the IFC EBOM Compiler" when the
  result has at least one rule and the input had E-BOM data (a file with `## ELEMENTS`). It builds the compiler's
  upload from that data (the example file, or the file the run used): the rules are added to `## RULES` (a
  `## RULE TEXT` section, if the file had one, is removed)
  (`src/lib/rules/splice.ts`; rules from an earlier hand-over, `text:...`, are replaced; the upload's own rules stay).
  From the example result this works without a model call.
- The upload is kept in the browser's session storage (never sent to the server, never in the URL) and the
  compiler's page opens with Try It Out open. Its panel takes the hand-over once, attaches it as the file and says
  so ("From the Scope Rule Drafter: 2 rules added ..."), with "View the handed-over input" and "Use the example file
  instead". A hand-over older than an hour, or meant for another agent, is ignored.

## Rules

- The saved result must be honest about its source. Say in `result_label` whether it is a helper's answer key, a counted live run (give the job id) or something else.
- If the result doubles as an answer key in a consistency test (as for `ifc-ebom-compiler`), that test keeps it correct.
- `src/lib/server/tryItOutExample.test.ts` loads every shipped `example.yaml`, so a broken one fails `npm test`. On the live site a broken example is logged and the panel shows no example.
