# Phase 3 Search: Human UAT (pending human)

Nothing below was run autonomously: it needs network access to download the embedding model.
Status of every item: **pending human**.

## 1. Real-model accuracy run (pending human)

Prerequisites: dependencies installed with `ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm ci` (already done in dev setups).

```bash
SEARCH_REAL_EMBEDDINGS=1 npx vitest run src/lib/server/search/accuracy.real.test.ts
```

- First run downloads about 90 MB (Xenova/all-MiniLM-L6-v2) and takes about 90 s; it caches under `db/models` (`HF_CACHE_DIR`).
- Expected: hybrid hit@3 >= 0.8 over ALL query kinds (including paraphrases) on both the 150-agent scale corpus and the 9 real agents, and hybrid paraphrase hit@3 >= BM25 paraphrase hit@3. hit@1 and MRR are printed.
- For reference, BM25-only paraphrase hit@3 is 0.40 (scale) and 0.67 (real); keyword+nl is 1.00 on both.
- Record results here:
  - [x] hybrid hit@3 (scale): 0.88 (hit@1 0.85, MRR 0.87); (real 9 agents): 1.00 (hit@1 0.92, MRR 0.96). Run 2026-10-14 by Claude with Ville present; model Xenova/all-MiniLM-L6-v2.
  - [x] paraphrase hybrid vs BM25: scale 0.60 vs 0.40; real 1.00 vs 0.67. Decision: keep MiniLM (hybrid hit@3 >= 0.8 incl. paraphrases). SIM_FLOOR left at 0.25 (not retuned; results already meet the bar).
- Decision: keep Xenova/all-MiniLM-L6-v2 if hybrid hit@3 >= 0.8 including paraphrases. Tune `SIM_FLOOR` in `src/lib/server/search/hybrid.ts` (currently an untuned 0.25) using the printed similarity distribution, and note the final value in the 03-05 or a follow-up summary.

## 2. Populate real embeddings and check search (done 2026-10-14 via API; /catalog UI part still pending human)

1. With network access, run `npm run db:push && npm run ingest` once (without `SEARCH_EMBEDDINGS=off`) to fill `agent_embeddings` in `db/catalog.db`.
2. Start the app and open `/catalog`; type a paraphrase query such as "how much air does each room need" and confirm the HVAC agent ranks near the top; check `GET /api/search?q=...` reports `mode: "hybrid"`.
3. Confirm a keyword query (for example `rfi`) still returns exact matches first.

## 3. Live typing feel in the browser (pending human)

Not verified autonomously (no browser): run `npm run dev`, open `/catalog`, and type "hvac" quickly.
- [ ] List narrows about 200 ms after the last keystroke, input keeps focus and caret, page does not jump (keepFocus/noScroll).
- [ ] URL shows `?q=hvac&page=1`; changing a filter keeps q; clearing the box (or "Clear search") restores the full catalog.
- [ ] No-results query shows `No agents match "..."`; screen reader announces "N agents found" after results update.
- [ ] Visual pass of the search box (spacing, focus ring) above the filters.

- [ ] 4. Browser check of WR-06 fix: after typing a query, use back/forward and confirm the input shows the right query, focus is kept while typing, and filters don't hide server results.

### Result of item 2 (run 2026-10-14, built server on loopback, AUTH_ENABLED=false)
- `npm run ingest` without `SEARCH_EMBEDDINGS=off`: 9 embeddings written, 0 failed.
- `GET /api/search` reports `mode: "hybrid"`. "how much air does each room need" returns demo-rfi-triage and hvac-load-calculator tied at the top (hvac at rank 2); "rfi" returns rfi-triage-assistant then demo-rfi-triage (exact matches first); "electrical panel load" returns electrical-panel-scheduler first; "triage incoming questions from site" returns the RFI agents first.
- Still pending human: the same checks in the `/catalog` page in a browser (items 3 and 4).
