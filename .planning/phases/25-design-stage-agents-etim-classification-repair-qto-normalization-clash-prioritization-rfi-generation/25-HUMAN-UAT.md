# Phase 25 Human UAT

Items an engineer should confirm. All agent outputs are drafts for engineer review; inputs are synthetic or public.

## Pending on Ville

- Confirm the demo-rfi-triage output (job 1e15df20-234c-4c3f-9def-4b2417fe39ff, see 25-VERIFICATION.md) looks sensible.
- Confirm the spend in the OpenAI dashboard matches `.planning/spend-log.md` within a few cents.
- Skim the ETIM repair draft (job ca984d20-c703-4138-9b52-691d6c092add, see 25-VERIFICATION.md Agent 1) for plausibility; it uses only invented SYN- codes.
- Skim the QTO normalization draft (job af4663e3-f128-4272-9b77-e0eace2acc6c, see 25-VERIFICATION.md Agent 2) for plausibility; synthetic table, re-check the model-computed totals.
- Skim the clash prioritization draft (job 1aa6f1be-baf2-465a-8b4a-a101a2bc5d20, see 25-VERIFICATION.md Agent 3); confirm the P1-P3 rule is acceptable as a generic default, and decide whether the hand-made location_key input convention (real exports need preprocessing) is acceptable. Synthetic input, counted after a redesign (earlier jobs 57e5c2cc, ab20a259, 2141f80e, 50656bb4 failed).
- Skim the RFI drafts (job a5ef49db-1061-440b-bbce-72a522f20e0c, see 25-VERIFICATION.md Agent 4); confirm the field set fits your RFI practice. Synthetic findings, draft for engineer review.
