# Performance: ingest and search (E2)

Run with `npm run bench` (not part of `npm run check`). Sizes via `BENCH_SIZES=150,1000`, raw JSON via `BENCH_JSON=out.json`.

## Machine

Intel Core M-5Y10c @ 0.8 GHz (4 threads), 3.8 GB RAM, Linux 7.0, Node v22.23.3. This is a slow, thermally limited laptop CPU; absolute numbers on a normal server will be several times lower. A second identical run came out up to 1.5x slower on some rows (see "Noise"), so read the figures as order of magnitude.

## Methodology

- `scripts/bench.ts` generates N synthetic agents with `scripts/fixtures/generate-scale.ts` (seed fixed) into an OS temp dir with its own SQLite files. `db/catalog.db` and `data/agents` are never touched. Temp dir is removed afterwards.
- One child process per N (own heap), started with `--expose-gc`; memory deltas are `process.memoryUsage()` after a forced GC.
- Ingest: the real `ingest()` against a fresh DB, once with `embedder: null` (embeddings off) and once with the deterministic fake embedder from `src/lib/server/search/embedder.fake.ts`; "re-ingest" is a second run over the same files.
- Search: `createSearchService` over the ingested DB. BM25 = no embedder; hybrid = fake embedder and the vectors ingest wrote. Latency is measured over the 20+ labeled scale queries (`src/lib/server/search/fixtures/queries.ts`) x 10 / 5 / 3 repetitions (N = 150 / 1000 / 5000), after a cold first query. `limit` 50 is the API default, `Infinity` is what the catalog page uses.
- Catalog: the real `src/routes/catalog/+page.server.ts` `load()` against the temp DB (via `CATALOG_DB_PATH`), after warm-up.
- No network, no model download, `SEARCH_EMBEDDINGS=off`; the real embedder is never used. The fake embedder is a sha256 token hash, so hybrid timing excludes real model inference (a real MiniLM query costs tens of ms on top).

## Results (run 1, ms unless stated)

| metric | N=150 | N=1000 | N=5000 |
|---|---:|---:|---:|
| ingest first, embeddings off | 784 | 2773 | 17799 |
| ingest re-ingest, embeddings off | 492 | 2423 | 12719 |
| ingest first, fake embedder | 883 | 5028 | 26049 |
| ingest re-ingest, fake embedder | 499 | 2425 | 13979 |
| load rows from SQLite | 8.8 | 28.2 | 70.5 |
| build search documents | 2.7 | 8.8 | 43.8 |
| buildBm25Index | 26.7 | 62.8 | 240 |
| load vectors (blobs) | 6.7 | 10.5 | 36.4 |
| cold first query, BM25 | 19.4 | 77.6 | 363 |
| cold first query, hybrid | 30.2 | 108 | 431 |
| BM25 query p50 / p95 (limit 50) | 0.05 / 0.26 | 0.14 / 0.89 | 0.64 / 2.20 |
| BM25 query p50 / p95 (limit Infinity) | 0.03 / 0.07 | 0.09 / 0.33 | 0.41 / 1.69 |
| hybrid query p50 / p95 (limit 50) | 0.49 / 0.77 | 1.70 / 3.16 | 7.84 / 13.7 |
| hybrid query p50 / p95 (limit Infinity) | 0.47 / 0.67 | 1.61 / 2.27 | 7.69 / 10.5 |
| fake embed of one query | 0.27 / 0.73 | 0.21 / 0.60 | 0.27 / 1.54 |
| related() p50 / p95, fallback | 0.35 / 0.67 | 2.40 / 3.18 | 13.0 / 16.6 |
| related() p50 / p95, embedding | 0.24 / 0.48 | 1.76 / 2.04 | 9.26 / 9.90 |
| catalog load page 1, no filter | 2.65 / 4.42 | 3.83 / 4.23 | 14.1 / 18.7 |
| catalog load last page | 2.92 / 4.37 | 8.48 / 8.68 | 46.5 / 53.9 |
| catalog load category+maturity filter, page 2 | 1.32 / 1.91 | 3.22 / 4.23 | 10.6 / 10.9 |
| catalog load llm filter | 1.79 / 1.86 | 3.09 / 6.48 | 11.2 / 15.5 |
| catalog load q (BM25), page 1 | 1.56 / 2.07 | 3.84 / 4.03 | 16.6 / 20.2 |
| catalog load q + category, page 2 | 1.77 / 1.89 | 7.29 / 11.2 | 32.5 / 34.2 |
| BM25 index heap (MB) | 0.3 | 1.4 | 7 |
| search service incl. rows heap (MB) | 0.4 | 2.4 | 12.4 |
| hybrid vectors extra heap / external (MB) | 0.5 / 0.7 | 2.7 / 4.6 | 13.7 / 22 |
| final RSS (MB) | 145 | 164 | 264 |

Run 2 (same machine, later) gave ingest first/off 1004 / 4101 / 17755 and hybrid p50 0.50 / 2.80 / 13.0, i.e. 0 to 1.6x slower per row.

## Bottlenecks found

1. **Ingest is CPU-bound on YAML parsing.** A probe of the ingest steps at N=1000: reading files 28 ms, `yaml` `parse()` 1820 ms, `normalize()` 95 ms, against about 2.4 s total re-ingest. So roughly 70 percent of ingest is the `yaml` library, 1.8 ms per file on this CPU, linear in N (about 2.5 to 3.5 ms per agent end to end). The SQLite writes are not the bottleneck: an experiment wrapping the upsert loop in one transaction (to avoid a WAL fsync per row) gave no gain (runs were within noise or slower) and was reverted. A faster parser would need a new dependency, which is out of scope, so no fix was made.
2. **Fake-embedder ingest adds 1.3 to 1.9x on first run** (sha256 per token plus 384-float vectors); re-ingest skips unchanged content via the content hash, so it costs only the hashing (re-ingest with fake is about equal to off). A real model would dominate everything else on first ingest.
3. **Hybrid query cost is the brute-force cosine over all vectors**: p50 7.8 ms at N=5000, linear (about 1.6 µs per vector). Fine up to tens of thousands of agents; beyond about 50k it would pass 80 ms and needs an ANN index or a top-k prefilter from BM25.
4. **related() scans all agents per call** (O(N), 9 to 13 ms at 5000), and the fallback path is slower than cosine because of Jaccard on arrays. Acceptable per detail-page render.
5. **Catalog load without a query paginates the last page via OFFSET and counts by selecting every slug** (`totalRows ... .all()`), so the last page is 46 ms at 5000 vs 14 ms for page 1; with `q` the whole ranked slug list is fetched back in chunks of 500 and sorted in JS. Linear and still small. A `COUNT(*)` and an id-keyed seek would cut it, but changes are not worth it at the current catalog size (about 10 agents in production).
6. **Cold start** after every ingest (fingerprint change) or every 30 s check when changed: row load plus index build is 363 ms at 5000 on this machine, blocking the first query; once built, queries are cheap. Memory for the whole search state is about 12 MB (BM25) plus 14 MB heap and 22 MB external with vectors at 5000.

## Scaling notes

Everything measured is linear in N with small constants; nothing superlinear appeared between 150 and 5000. Ingest is the only operation that is slow in absolute terms (17 s at 5000 here, happening at build or deploy time, not request time). At the real catalog size (single or double digits) every request-time number is under 5 ms. The first limit to hit at much larger scale would be hybrid cosine scan latency, then catalog `q` pagination (full ranked list per request).

## Not measured

Real transformer embedding cost (model download forbidden); the AGENT_KINDS flag-on ingest path, which uses one transaction per file and has not been profiled; concurrent request load.
