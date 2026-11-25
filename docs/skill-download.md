# Skill download

Every agent with a skill folder (`data/tryitout-prompts/<slug>/SKILL.md`) has "Download skill (.zip)" on its page
(`GET /agents/<slug>/skill.zip`). The zip is the skill in the Agent Skills layout, for use outside the library with any
agent that reads files (Claude Code, Pi, ...):

```
<slug>/SKILL.md              the instructions, exactly as Try It Out uses them
<slug>/examples/             the synthetic example input and, if saved, the expected result
<slug>/scripts/<helper>.mjs  the agent's deterministic helper (agents with one), one file, plain `node` 18+
<slug>/README.md             what the files are and what to run before and after the skill
<slug>/LICENSE-DDC.txt       the DDC MIT licence, for skills that adapt a DDC skill
```

## Why the helpers are included

About a third of the skills are only complete with their tool:

| Tool runs | Agents | Without it |
|---|---|---|
| Before the skill (required) | warranty, procurement lead time, material delivery (precomputed date and status columns); Scope Rule Drafter (`--prepare`: the `## VALUES` list); IFC EBOM Compiler (`--prepare`: `excluded_by` and the untied rules) | the skill does not work on raw input (the rule agent and the E-BOM compiler fall back to doing it themselves, less reliably) |
| After the skill | IFC EBOM Compiler (check, E-BOM lines and sticks), QTO (totals), carbon (stage totals, option comparison), BMS (statuses), quote comparison (weighted scores), clash prioritization (pattern groups, findings for the RFI agent), product sourcing and the rule agent (checks) | the result has cells left to a tool, or is unchecked |
| None | the other agents | `SKILL.md` is the whole skill |

The README of each download gives the exact commands in order. The helper exits with 0 when everything checked
matches, 1 with the mismatches listed, 2 when an input cannot be read.

## How it is built

- `src/lib/skillHelpers.ts`: which agent has which helper, and the before/after steps and their wording.
- `scripts/build-skill-helpers.ts` (`npm run skills:build`, part of `npm run build`, `npm run dev` and the image build)
  bundles each `scripts/<helper>.ts` with the `src/lib` code it uses into `skill-helpers/<helper>.mjs` with esbuild: no
  dependencies, Node built-ins only. The directory is generated (git- and container-ignored); the image copies it into
  the runtime. A helper that was not built is named in the README instead of shipped.
- `src/lib/server/skillBundle.ts` builds the zip on request; `src/lib/server/ddcLicense.ts` holds the licence text
  (equal to `docs/third-party-notices.md`, checked by `skillBundle.test.ts`).

A new agent with a helper: add it to `SKILL_HELPERS`; the bundle, the README and the tests pick it up.
