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
```

File names are bare names in the same folder. Each file is capped at 200 KB, the same as an upload. Unknown keys are rejected.

## What the visitor sees

- The task is prefilled and the example file is attached. Both can be edited, removed or replaced.
- "View example input" shows the file, so the input format is visible.
- "Show example result" shows the saved result with its label. It makes no request and no model call.
- Run is unchanged: it always does a real run, with whatever task and file are in the form.

Agents without `example.yaml` get the panel as before.

## The result of a run

After a run succeeds, the panel shows its result on the page under "Result", next to "Download results" (which stays). This holds for every runnable agent, with or without an example.

- The panel reads the same artifact as the download (`GET /api/tryitout/jobs/<id>/artifact`) and unzips it in the browser (`src/lib/tryItOutResult.ts`). The job API and `src/lib/tryItOut.ts` are unchanged.
- Only text files are shown (`.md`, `.txt`, `.csv`, `.json`): `result.*` first and open, then the others by name (for example `ebom-join-check.md`). Each is shown as plain text, never rendered as HTML.
- Size caps are checked before anything is decompressed: a zip over 1 MB, or text files over 200 KB in total, are left to the download. Then the panel says "The result cannot be shown here; use Download results."

## Rules

- The saved result must be honest about its source. Say in `result_label` whether it is a helper's answer key, a counted live run (give the job id) or something else.
- If the result doubles as an answer key in a consistency test (as for `ifc-ebom-compiler`), that test keeps it correct.
- `src/lib/server/tryItOutExample.test.ts` loads every shipped `example.yaml`, so a broken one fails `npm test`. On the live site a broken example is logged and the panel shows no example.
