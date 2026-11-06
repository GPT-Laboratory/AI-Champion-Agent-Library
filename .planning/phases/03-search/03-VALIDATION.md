---
phase: "3"
slug: "search"
status: draft
nyquist_compliant: true
wave_0_complete: false
created: "2026-10-12"
---

# Phase 3 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.1 (+ jsdom / @testing-library/svelte for components) |
| **Config file** | `vitest.config.ts` (sets `SEARCH_EMBEDDINGS=off` so no test resolves a real model) |
| **Quick run command** | `npx vitest run src/lib/server/search` |
| **Full suite command** | `npm run check` (tsc --noEmit && vitest run) |
| **Estimated runtime** | ~30 s |

## Sampling Rate

- After every task commit: task `<automated>` command (quick run of touched files)
- After every wave: `npm run check`
- Before verify-work: `npm run check` green; real-model run is pending human (03-HUMAN-UAT.md)

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 3-01-01 | 01 | 1 | SRCH-01 | unit | `npx vitest run src/lib/server/search/documents.test.ts src/lib/server/search/embedder.test.ts` | pending |
| 3-01-02 | 01 | 1 | SRCH-01 | unit | `npx vitest run scripts/ingest.test.ts scripts/ingest.scale.test.ts` | pending |
| 3-01-03 | 01 | 1 | SRCH-01 | grep | Containerfile/README checks in plan | pending |
| 3-02-01 | 02 | 1 | SRCH-02 | unit | `npx vitest run src/lib/server/search/tokenize.test.ts src/lib/server/search/bm25.test.ts` | pending |
| 3-02-02 | 02 | 1 | SRCH-01/02 | unit | `npx vitest run src/lib/server/search/hybrid.test.ts` | pending |
| 3-03-01 | 03 | 2 | SRCH-01/02 | unit | `npx vitest run src/lib/server/search/index.test.ts` | pending |
| 3-03-02 | 03 | 2 | SRCH-03 | unit | `npx vitest run src/routes/api/search src/routes/catalog` | pending |
| 3-04-01 | 04 | 3 | SRCH-03 | component | `npx vitest run src/lib/components/SearchBar.test.ts src/lib/catalogUrl.test.ts` | pending |
| 3-04-02 | 04 | 3 | SRCH-03 | suite | `npm run check` | pending |
| 3-05-01 | 05 | 2 | SRCH-01/02 | tsc | `npx tsc --noEmit` | pending |
| 3-05-02 | 05 | 2 | SRCH-01/02 | accuracy | `npx vitest run src/lib/server/search && npm run check` | pending |

## Wave 0 Requirements

Existing vitest infrastructure covers all requirements; test files are created inside the plans' TDD tasks.

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Instructions |
|----------|-------------|------------|--------------|
| Real MiniLM embeddings rank paraphrase queries (hybrid hit@3 >= 0.8) | SRCH-01 | Needs a ~90 MB model download; unattended run must not download | `SEARCH_REAL_EMBEDDINGS=1 npx vitest run src/lib/server/search/accuracy.real.test.ts` (see 03-HUMAN-UAT.md) |
| Live typing feel in browser | SRCH-03 | Visual check | Run dev server, type in catalog search box |

## Validation Sign-Off

- [x] All tasks have `<automated>` verify
- [x] No 3 consecutive tasks without automated verify
- [x] No watch-mode flags
- [ ] Wave execution complete

**Approval:** pending
