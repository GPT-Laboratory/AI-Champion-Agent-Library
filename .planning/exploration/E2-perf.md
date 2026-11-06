# E2 - performance profiling of search and ingest

Branch: worktree-agent-a1f498536e68ca5c0. Deliverables: `scripts/bench.ts` (`npm run bench`), `docs/performance.md` (full tables, methodology, bottlenecks).

Headline (slow 0.8 GHz Core M, N=5000 synthetic agents): ingest 17.8 s first / 12.7 s re-ingest (embeddings off), 26 s with fake embedder; index build 240 ms (cold first query 363 ms); BM25 query p50 0.64 ms / p95 2.2 ms; hybrid (fake embedder) p50 7.8 ms / p95 13.7 ms; related() p50 9 to 13 ms; catalog load 10 to 47 ms; search memory about 12 MB heap (+14 MB heap, 22 MB external for vectors); RSS 264 MB.

Finding: everything is linear in N. Ingest is YAML-parse bound (about 70 percent: `yaml` parse 1.8 ms per file). A single-transaction experiment for the upsert loop gave no gain and was reverted, so no code fix and no D-NNN was logged (D-320..D-339 unused). Faster parsing would need a new dependency.

Noise: a repeat run was up to 1.6x slower per row on this thermally limited machine.
Follow-ups (only if the catalog grows past thousands): COUNT(*) instead of selecting all slugs for totals, ANN or BM25 prefilter for hybrid beyond about 50k agents, profile the AGENT_KINDS ingest path.
