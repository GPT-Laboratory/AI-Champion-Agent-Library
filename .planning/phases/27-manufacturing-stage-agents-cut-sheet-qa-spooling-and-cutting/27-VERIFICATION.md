---
phase: 27
status: human_needed
---

# Phase 27 Verification

All outputs are drafts for engineer review. Inputs are synthetic or public only.

Harness, procedure and ledger as in Phases 25 and 26 (see ../26-*/26-VERIFICATION.md): Option A (compose stack, internal network `aic-pi-internal`, image `localhost/aic-agent-library:tryitout`, catalog and prompts bind-mounted), `scripts/tryout-run.ts`, model gpt-4.1-mini in the Pi container, ledger `.planning/spend-log.md`.

## Agent evidence

### Agent 8: Cut-sheet QA
COUNTED (SKILL v1, first run, rubric R1-R7 met).

- Entry: data/agents/cut-sheet-qa.yaml (validate-submission INGESTIBLE, validate-entries 0 errors; stage manufacturing, agent_no 8). Related existing entry data/agents/submittal-review-router.yaml is unchanged. Input label: synthetic (data/tryitout-prompts/cut-sheet-qa/sample-cutsheet-spec.txt: 10-line invented cut sheet, 6 requirements). Option A, gpt-4.1-mini, Pi container, 3 requests, usage observed (countable).
- Job fb46b86d-daa5-448e-83ad-77e4173e22ca, 10539 tokens, est. 0.0169 USD (ledger row 27-01). Single run, no failed runs.
- Answer key: S-01 compliant, S-02 compliant, S-03 deviation (110 < 120), S-04 deviation (compression vs press), S-05 deviation with unit-differs note (bar vs MPa, no conversion), S-06 not-stated (NONE).
- Verdict: R1 pass (one result.md; 6 check lines and 6 table rows, S-01..S-06 in input order); R2 pass (every non-NONE cut_sheet_line verbatim from the cut sheet); R3 pass (all six verdicts equal the key); R4 pass (S-05 note "unit differs MPa vs bar, not converted", no 0.16 or 160 anywhere, S-06 NONE, review NO only for S-01 and S-02); R5 pass (no rows for nominal_diameter_dn, seal_material, certification; open items S-03, S-04, S-05, S-06); R6 pass (no counts, totals, overall pass/fail, approval or rejection); R7 pass (draft caveat present).
- Excerpt of the counted output:
  ```
  S-03 key=max_temperature test=ge req=120 C | cs_line="max_temperature: 110 C" cs_val=110 cs_unit=C | unit_same=Y | flag=N | verdict=deviation
  S-05 key=test_pressure test=ge req=1.6 MPa | cs_line="test_pressure: 25 bar" cs_val=25 cs_unit=bar | unit_same=N | flag=- | verdict=deviation
  S-06 key=fire_class test=eq req=SYN-FR-1 - | cs_line=NONE cs_val=NONE cs_unit=- | unit_same=- | flag=- | verdict=not-stated
  S-05 | Test pressure | >= 1.6 MPa | test_pressure: 25 bar | deviation | YES | unit differs MPa vs bar, not converted
  S-06 | Fire class | = SYN-FR-1 | NONE | not-stated | YES | not stated on cut sheet
  Draft for engineer review. Verdicts come only from the supplied synthetic cut sheet and specification excerpt; no manufacturer data was looked up.
  ```
- Caveat: draft for engineer review; counted for the scoped step only (6 requirements, one synthetic sample, a single run). Text only.
- Teardown: stack down, `podman ps -a --filter label=aic.tryitout` empty.
- Ledger: one 27-01 row (0.0169 USD).

### Agent 9: Spooling & cutting
COUNTED (SKILL v1, first run, rubric R1-R7 met).

- Entry: data/agents/spooling-and-cutting.yaml (validate-submission INGESTIBLE, validate-entries 0 errors; stage manufacturing, agent_no 9; the name is "Spooling and Cutting" so the derived slug is spooling-and-cutting). Input label: synthetic (data/tryitout-prompts/spooling-and-cutting/sample-segments.txt: 6 invented segments). Option A, gpt-4.1-mini, Pi container, 2 requests, usage observed (countable).
- Job a7f0ad36-a6a5-4d5e-abe1-9a69d589af76, 6296 tokens, est. 0.0101 USD (ledger row 27-02). Single run, no failed runs.
- Answer key vs result: cut list P-01..P-06 in order, lengths/stock/dn/material/spool copied, P-05 remainder 300 copied; only P-04 `to compute (tool)` (6200 > 5000): match. Spool groups SP-A P-01,P-02,P-03; SP-B P-04,P-05; SP-C P-06: match. Cut groups 22 copper P-01,P-02,P-05 (1850,720,950); 28 copper P-03,P-04 (2400,6200); 50 steel P-06 (3100); stock_pieces `to compute (tool)` in all: match.
- Verdict: R1 pass (one result.md, 6 check lines and 6 cut-list rows in input order); R2 pass (all copied values equal input); R3 pass; R4 pass; R5 pass; R6 pass (no sums, counts, waste or piece numbers; open items contain P-04, the fixed to-compute line and the P-05 remainder-copied line); R7 pass (draft caveat).
- Excerpt:
  ```
  P-04 spool=SP-B grp=28|copper len=6200 stock=5000 len_le_stock=N rem=none => to compute (tool)
  P-05 | SP-B | 22 | copper | 950 | 5000 | 300 | cut-list
  SP-B | P-04,P-05
  22 | copper | P-01,P-02,P-05 | 1850,720,950 | to compute (tool)
  28 | copper | P-03,P-04 | 2400,6200 | to compute (tool)
  P-04: length exceeds stock; needs joint or longer stock; to compute (tool)
  P-05: remainder 300 copied, not used
  Draft for fabricator review. Grouping and lengths are copied from the supplied synthetic segment list; cutting quantities and nesting were not computed.
  ```
- Caveat: draft for fabricator review; counted for the scoped step only (6 segments, one synthetic sample, single run); no optimisation performed. The model emitted the result inside a code fence preceded by "output/result.md:" in the captured text (file content itself correct).
- Teardown: stack down, `podman ps -a --filter label=aic.tryitout` empty.
- Ledger: one 27-02 row (0.0101 USD).

## Phase result (aggregated)
Agents 8 and 9 counted (both on first run, one sample each; limited reliability evidence, see 27-HUMAN-UAT.md). `npm run check` green (273 files, 3118 tests).
