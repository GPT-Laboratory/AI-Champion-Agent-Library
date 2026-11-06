# Phase 34 Context: Own-design agents relabelled and cleaned (1 ETIM, 5 E-BOM->M-BOM, 8 Cut-sheet QA, 9 Spooling & cutting, 10 D2 code validation)

Read first: .planning/research/ddc-fix-run-rules.md; Phase 31 summaries (attribution/URL/MCP removal already applied); Phase 32-33 summaries (patterns, lessons).

## Scope
Per Ville: weak and none matches stay OWN DESIGNS. Do not force them onto a skill. For each entry make the label explicit and consistent in `metadata.attribution`, the entry description/assumptions, docs/third-party-notices.md and docs/consortium-agents-inventory.md:
- 1 ETIM: "inspired by 1_DDC_Toolkit/BIM-Analysis/bim-classification-ai (own design for ETIM-style mapping)"
- 5 E-BOM->M-BOM: "inspired by 1_DDC_Toolkit/CWICR-Database/cwicr-material-procurement (method only; no CWICR data)" (CWICR licence caveat stays in notices), generic/synthetic product catalog data, no MCP/LVI/STK framing (done in 31: verify)
- 8 Cut-sheet QA: "inspired by 1_DDC_Toolkit/Document-Control/submittal-tracker (+ 2_DDC_Book/2.4-PDF-CAD-to-Data/specification-extractor)"
- 9 Spooling & cutting: "no DDC basis" (prefab-optimization is not a pipe-spool skill; say so)
- 10 D2 code validation: "no DDC basis"; keep the assumption D2 = Finnish building code part D2 visible in the entry description AND assumptions, with the alternatives listed as open (Alok/Jussi to confirm).
Check each entry for any claim that it "follows" a skill. Where the alignment lessons make an agent clearly better (e.g. one simple extra field), do NOT rebuild: scope is labels + cleaning + verification.
Done bar for changed entries: complete entry (template) + one real-model Try It Out step with evidence in 34-VERIFICATION.md/34-HUMAN-UAT.md (a rerun on the existing sample; if a sample changes, update its answer key and rubric). Max 2 revisions + 1 scope-shrink retry; do not rerun for a lucky pass. Spend <$0.50/run, ledger after the fix-run marker (fix-run total $5; ~$0.34 used).

## Assumptions
- A-01: Reruns are sequential, one container at a time; all five in one executor session is fine (small scope).
- A-02: If a rerun reveals a regression from the Phase 31 wording edits (verdict logic untouched, so unlikely), fix the SKILL.md minimally and record.
