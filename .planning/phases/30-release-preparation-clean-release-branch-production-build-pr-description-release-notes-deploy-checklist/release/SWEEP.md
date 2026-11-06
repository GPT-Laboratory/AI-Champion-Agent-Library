# Confidentiality sweep of the release diff

Scope: `origin/main..release/agents-2026-10` in `/home/ville/projects/aic-release` (765 files, +89380/-936 at tip f9ef5d0). ADDED = added lines of `git diff origin/main...HEAD` (89378 lines). Run 2026-10-15.

Verdict: CLEAN-WITH-NOTES (2 items for Ville, see "Decisions for Ville").

## Fix commits on the release branch (after the sweep)
- 70ab99b "Remove internal references": 11 files, wording only (internal branch name, decision ids tied to a person, `*-HUMAN-UAT.md` and `12-RESEARCH.md` pointers to files that are not shipped, "Ville/Jussi" in `data/agents/d2-code-validation.yaml`).
- f9ef5d0 "Label demo RFI sample as synthetic": one added header line in `data/tryitout-prompts/demo-rfi-triage/sample-rfi.txt`.
- Re-run after fixes: `npx vitest run src/lib/spec scripts data` = 50 files / 556 tests pass; `src/lib/server/tryItOutRunner.test.ts scripts` = 25 files / 237 tests pass. Not mirrored to the working branch (the working branch keeps its internal history; the release branch is the shipped copy).

## Checks

| # | Check | Hits | Triage |
|---|---|---|---|
| 1a | Secret patterns over ADDED (`sk-`, api_key=, private key, password=, bearer, ghp_, xox) | 56 lines | All false positives: redaction/credential-scanner tests and fixtures with obviously fake values (`sk-FAKE...`, `sk-abcdefghijklmnopqrstuvwx`, `Bearer abcdef...`), regex definitions in `src/lib/mcpgen/credentials.ts`, and `.env.example` placeholders (`replace-with-your-...`). No real key. |
| 1b | Secret-like file names (`git diff --diff-filter=A`) | 7 | `.env.example` (placeholders only: BREVO_API_KEY, OPENAI_API_KEY = `replace-with-...`), 3 `src/lib/mcpgen/credentials*` source/test files, 3 `T4-SEC-SECRETS` suite files (synthetic). No `.env`, `.pem`, `.key`, `.db`, `.sqlite`. |
| 2 | Excluded paths in the release diff (`.planning`, `.claude`, `.tryitout`, `db/`, `runtime/`, `override.tryitout`, `spend-log`, `AUTONOMOUS`) | 0 in the diff | `git ls-files` shows 206 `.planning`/`.claude` files, all inherited unchanged from origin/main (identical to main, no diff). Nothing of ours added. |
| 3 | Internal/AI-session wording (GSD, .planning, AUTONOMOUS, overnight, Claude Code, Co-Authored-By, spend log, phase NN, D-nnn) | 323 added lines, 150 files before fixes | Narrowed to strict process wording (gsd, .planning, overnight, Claude Code): 14 lines. Fixed: dependency-health branch name. Remaining and harmless: `.gitignore` (`.gsd/`, `.claude/worktrees/` entries), `variants: [gsd, plain, ...]` in `lvi-info-mcp/catalog.yaml` (a generator variant name), `.claude/agents/` as a path in subagent adapter tests and docs (the Claude subagent file format), `package-lock` hash matches, `scripts/tryout-run.ts` spend-log header ("the autonomous run", runtime text, left alone). Remaining "Phase NN" and "D-nnn" ids appear in about 150 docs/comments as plain cross-references; they are harmless but read as internal. See decisions. |
| 4a | Named companies / confidentiality words in data, docs, README, src | TUNI 0, Tampere 0, Skanska/Ramboll/Sweco/Granlund/Fira/Lemminkäinen/NCC/NDA 0, YIT 0 (1 hit is inside `docs/images/spec-shim.png` binary), "slide" 1, "confidential" 13, "consortium" 51 | "slide": `docs/agent-entry-template.md` says "The source slide is not in the repo" (a statement, no slide material). "confidential": all are "real data is confidential and was not used" disclaimers in agent gaps/ddc docs. "consortium": generic project name (README, login page "AI Champion consortium", auth error text, agent metadata). No named company. |
| 4b | Agents added since origin/main carry a synthetic/public label | 21 added files under data/agents; 18 agent YAML + 3 MCP catalog.yaml | `grep -Li "synthetic\|public"` returned 2: `airo.yaml` (a real public ChatGPT GPT link, pre-existing, not a synthetic-sample agent; description is public regulatory text) and `demo-rfi-triage.yaml` (description states "DEMO ONLY", sample fictional). Both accepted. All 16 new agents carry "Sample is synthetic" in `metadata.gaps`. |
| 4c | Samples under data/tryitout-prompts contain "synthetic" | 17 sample files | 1 missing before fix (`demo-rfi-triage/sample-rfi.txt`, fictional "Riverside Office Tower"); fixed in f9ef5d0. 0 missing now. |
| 5a | Real exports / binaries (`.ifc .xls(x) .dwg .rvt .pdf .zip .bsdd`) | 0 | Only 5 PNGs in `docs/images` (screenshot and diagrams, no data). |
| 5b | E-mail addresses in ADDED | 18 distinct, all placeholders | `member@example.org`, `library@example.org`, `a@example.com`, `jussi@example.org` and `mikko@example.org` (first-name placeholders, example.org, in `.env.example`), `Pw@db.internal` (fake DB URL in a redaction test), `a@b.fi`, `u@x.fi` (test inputs). Ville's own address does not appear. |
| 5c | Phone numbers, Finnish personal ids | 0 / 0 | Regex matches in the phone check were only color-math constants and sample GUIDs (false positives). |
| 5d | Real STK/LVI-INFO export markers; STK/LVI sample files | 1 text hit | `product-sourcing-mbom/sample-ebom-catalog.txt` line 1: "SYNTHETIC SAMPLE - invented data. Not a real STK/LVI-INFO export". The only STK/LVI-named files are three catalog.yaml (< 1.4 KB each). |
| 5e | Personal GitHub account | 2 hits | `repo_url: https://github.com/villelaaksotuni/mcp-gen-comparison` in `data/agents/stk-mcp/catalog.yaml` and `data/agents/lvi-info-mcp/catalog.yaml`. Not secret, but a personal account URL in shipped data; the three mcp-server entries are listed only with AGENT_KINDS on. Needs Ville (public repo? keep, change, or drop). |
| 6 | Links to the excluded inventory/gaps docs | 0 | Both docs absent and no reference remains. |

## Decisions for Ville
1. Internal inventory and gaps docs: default EXCLUDED (as done in the branch). Alternative: include `docs/consortium-agents-inventory.md` and `-gaps.md` after review; they name the 12 consortium agents and their open gaps, so check with the consortium first. Per-entry `metadata.gaps` and assumptions are kept.
2. Personal repo URL in two MCP entries (check 5e).
3. Docs that read as internal; flagged only, not excluded (no hit in checks 3-5 after fixes):

| Doc | Recommendation |
|---|---|
| docs/agent-hosting-decision-memo.md | Keep; research output, linked from README and two docs. Mentions Phase numbers. |
| docs/dependency-health.md | Keep; linked from the runbook. Dated snapshot. |
| docs/ddc-agent-candidates.md | Keep or exclude, nothing links to it; it records why DDC skills were chosen (cites an MIT-licensed public repository). Titled "Phase 29". |
| docs/human-verification-guide.md | Keep; linked from README. Contains a manual checklist with phase labels. |
| docs/phase13-adapters.md | Keep; linked from README and the intake guide. |
| docs/mcp-generator-design.md, mcp-generator-proposals.md, mcp-test-port-fidelity.md | Keep; linked from code comments and README. |
| docs/deploy-runbook.md section 9 | Keep but consider trimming: a "pending human live checks" table by phase number. Also says the Containerfile image build was never run (see BUILD-SMOKE.md: build outside the container ran). |
4. Leftover cosmetic items not fixed: `.env.example` comment "Container-backed Try it out (Phase 8)", "Phase NN"/"D-nnn" cross-references in about 150 docs and code comments.
