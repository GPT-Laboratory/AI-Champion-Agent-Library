# MCP test platform: port-fidelity map

This document records, for every component of the study repository (read-only reference), what exists in the source, what the platform does with it, and where the platform is honest about gaps. It is derived from the Phase 15 research sections "Port-Fidelity Map" (Components, Harness checks 1-10, The 12 designed cases), "Scoring Semantics to Preserve" and "Common Pitfalls" 3-7. All fixtures in the platform are synthetic (invented Acme terms); no source literal, captured page or real value is copied.

The machine-readable twin of this map is `src/lib/mcptest/core/fidelity.ts`; a test asserts that every id there appears here.

## 1. Legend

Port decision values:

- **Ported**: logic carried over 1:1, rewritten in TypeScript because the host language differs; semantics identical and test-pinned.
- **Wrapped**: the original artefact is invoked or consumed unchanged. Nothing is Wrapped literally, because the platform never runs the source Python. Where the roadmap says "reused or wrapped where possible", the reuse is of file formats (case.yaml, golden.jsonl, rubric.yaml, registry shapes) and of validator logic.
- **Re-implemented**: same purpose, deliberately different mechanics.
- **Not ported**: left out, with a reason.

Source status values: **implemented** (code and data exist in the study) or **designed only** (described in the suite design document, no fixture, golden or rubric).

Platform status values: **implemented**, **implemented-minimal**, **designed-only-gap**.

Where it runs: **S** = scores any server (fake variants in CI); **G** = needs the platform generator in the loop (runs in-process in CI); **S+G** = both; **S-real** = needs a real Python process, so unattended CI scores only the fake variant and a real run is pending human.

## 2. Components

| Source component | Status in source | Port decision | Notes |
|---|---|---|---|
| Check validators (10) in the live harness | Implemented, single API, live key from a dotenv file, binding per arm | Re-implemented as a generic behaviour pack parameterised by case config (identity aliases, expected values, limits) | Logic ported 1:1 (section 3). Live API, real key and dotenv loading are not ported |
| Helper functions (dict walking, find-by-value, find-all, belongs-to-partition, nested-attribute search, payload extraction, text blob, leak detector) | Implemented | Ported | Field-name-agnostic search is the key property. Python-dataclass conversion is unnecessary; payload is structured content, else JSON-parsed text |
| Harness selfcheck | Implemented (6 checks against a captured real page) | Re-implemented | Scorer self-test: validators run on canned results plus invariants of the synthetic mock dataset. The captured real page is not read or copied |
| CSV row append / results file | Implemented | Ported as export only | Optional legacy CSV row for continuity; canonical output is the report JSON |
| Expected-values module | Implemented, frozen real values | Not ported (values); ported (shape) | Becomes the per-case expect block and identity aliases in Acme terms. The alias-set idea is kept; no literal is copied |
| Base module (modality and status enums, adapter base, never raises) | Implemented | Re-implemented | Becomes the Subject interface; prepare never throws; same vocabularies |
| Runner (registry load, case, modality resolution, mock lifecycle, golden checks, run states, JSON output) | Implemented | Re-implemented | Status resolution order and the 8 states kept verbatim; thresholds are enforced (source never reads them). Replaced: Python adapter import, Python stdio transport, thread-based mock on a random port, whole-environment copy |
| Runner expect evaluation and check types tool_exists / call / auth | Implemented | Ported with tightening | Source expect keys kept; clean_not_found now needs an explicit not-found signal or isError plus no leak; additive keys empty_with_message, max_items, max_fields, no_leak, status_category |
| Runner tool binding (first regex match on name or description) | Implemented | Re-implemented | Explicit tool wins; a hint must match exactly one tool, else the check is ERROR (ambiguous or unbound); bound-by is recorded |
| Report module matrix (majority vote, legend) | Implemented | Ported | Pure renderMatrix (text and markdown), 8 states kept distinct; tie-break made pessimistic (FAIL wins) |
| Report module arm status table | Implemented, hard-coded to 4 arm ids | Not ported | Specific to the study's arm list |
| Leak-guard module: golden isolation | Implemented | Ported | No golden expected string appears in any fixture shown to a generator; explicit minimum length (source stores strings above 8 characters but only compares above 16) |
| Leak-guard module: hosts-file block, blocked-host list, network policy summary | Implemented as documentation only (manual hosts edit) | Not ported; replaced by structural no-egress | Mock bound to 127.0.0.1, subject env carries only mock URLs, container network internal, a test that no non-loopback URL literal exists in fixtures. The network policy text stays a registry field |
| Arm registry | Implemented, 9 arms | Re-implemented | Subjects registry with the same fields and state semantics (spec / docs / dump / repo / any; installed / install_failed / unavailable). Legacy arms are not registered as runnable |
| Arm adapters (converters, generators, stubs) | Partly implemented, others stubs or unavailable | Not ported | Need third-party installs, network and LLM keys. The adapter contract is ported as Subject; their statuses are setup gaps, not evidence |
| case.yaml format | Implemented (1 case) | Ported unchanged | Platform keys added with an x- prefix (x-upstream, x-env, x-binding, x-identity, x-applies-to, x-strict, x-ceiling) which the source runner ignores |
| golden.jsonl format | Implemented (9 lines) | Ported unchanged plus additive fields | inject, repeat and check_kind added; unknown keys ignored; blank and # lines skipped |
| rubric.yaml format | Implemented, never run or scored | Ported unchanged | Parsed and rendered; automatable items are auto-checked (advisory), the rest stay manual |
| Mock server and OpenAPI spec | Implemented (Python http.server) | Not read, not ported | Re-authored as a synthetic TypeScript mock and spec in Acme terms |
| Suite design document | Design doc | Ported as case specs and scoring doc | This file and docs/mcp-test-platform.md |

## 3. The 10 harness checks

Source status: all implemented. auth_fail is the only one needing its own subprocess; pagination_ceiling was not applicable for every arm in the study (no bound source with more than 15,000 results).

| # | Check | Source criterion (logic) | Port | Offline needs |
|---|---|---|---|---|
| 1 | lookup_by_id | An item whose id-alias key equals the known id (primary-identifier lookup) appears anywhere in the payload | Ported | Mock dataset with a known item |
| 2 | lookup_by_alt_key | Same item through the alternate key | Ported; NA if the case declares no alternate key | Alternate key in dataset |
| 3 | partition_filter | At least 1 item; every one attributable to the filter value through any of three alias rules (endswith, equals, text-contains) | Ported | Dataset with 2+ partitions |
| 4 | derived_filter | Derived nested-attribute filter: no tool is FAIL; response text must contain all expected ids (no server-side parameter exists, so the filter happens in memory) | Ported; the mock exposes no query parameter for the nested field and rejects unknown query parameters with 400 | Nested-array dataset, mock rejects the nested-field parameter |
| 5 | projection | Located item has at most 12 top-level keys | Ported; cap configurable, default 12 | Items with 20+ fields |
| 6 | pagesize_clamp | Request 5x the documented max; leak is FAIL; isError is PASS (clean reject); more items than max is FAIL; else PASS | Ported | Mock honours size up to its max and returns oversize when asked |
| 7 | pagination_ceiling | NA unless a large source is bound; leak is FAIL else PASS | Ported and made scorable offline: the mock has a small configurable ceiling beyond which it returns HTTP 500 with the legacy envelope text. NA only if the case sets x-ceiling to null | Mock ceiling and fault envelope |
| 8 | bad_input | Leak is FAIL; explicit not-found signal (isError or a not-found phrase) evaluated before item detection; a returned item is FAIL; no signal is FAIL | Ported, order preserved (echoing the queried id must not read as a hit) | Mock 404 for unknown id |
| 9 | empty_vs_error | Leak is FAIL; zero items and text matches an empty-result phrase; a raw empty envelope is FAIL | Ported | Mock returns 200 with empty results |
| 10 | auth_fail | Relaunch with a deliberately wrong key; transport-level error counts if it has auth words and no leak; else the response must match the strict auth regex and not leak | Ported (second launch with a wrong key; the mock enforces the key) | Mock enforces key, returns 401/403 envelope |

Total is the count of PASS; max is 10 minus the NA count.

## 4. The 12 cases

Source status: one case was implemented in the study (the Tier 2 API case, with 9 golden checks, a rubric, a spec and a Python mock; its golden is lenient, with no projection, clamp, ceiling or synthesis check). The other eleven were designed only; even their fixture directories are empty. Generic descriptions are used for the unnamed source cases: "Tier 2 dump case", "Tier 2 HTTP case", "Tier 3 partner-profile case".

| Platform id | Tier | Loads | Source status | Port decision | Where it runs | Platform status |
|---|---|---|---|---|---|---|
| T1-STD-CATALOG | 1 (gate) | D1, D2, D3 | designed only (golden not authored) | Synthetic Acme catalog, get_by_id plus keyword search, stdio. Pass: D1 pass, D2 >= 95%, D3 = 3 | S+G | implemented |
| T2-CATALOG-API | 2 | D1-D4, D6 | implemented (source id T2-STK-API) | Ported with content re-authored (neutral Acme names, same structure, same 9 check ids) and extended with the behaviour pack (checks 3-10) so the case discriminates | S+G | implemented |
| T2-CATALOG-DUMP | 2 | D1, D2, D3, D5 | designed only (Tier 2 dump case) | Header/dictionary-only fixture for the generator; server reads a synthetic CSV supplied at test time through a data-path env var; numeric filters must behave numerically | S-real (fake variant in CI) | implemented |
| T2-CATALOG-HTTP | 2 | D1 (both transports), D5, D6 | designed only (Tier 2 HTTP case) | Client side: Streamable HTTP transport, configurable health GET, env-driven config, key from env. Generator subjects get NA_TRANSPORT because the generator emits stdio only | S (fake); S-real pending human | implemented-minimal (client side only) |
| T3-RT-DOCS | 3 | D3, D5, hallucination | designed only | Docs fixture is an invented prose manual with a closed list of operations; every tool must trace to a documented operation and the mock records any undocumented route (invented endpoint gives D3 = 0). Generator subjects get NA_MODALITY (no docs-only input) | S | implemented |
| T3-PROFILE-CONTRACT | 3 | D3 vs contract | designed only (Tier 3 partner-profile case; the real profile document was not available) | Scored against a synthetic "Acme MCP profile" (required tool set, naming regex, metadata, non-empty descriptions, annotations). Pass: checklist >= 90% | S | implemented-minimal (invented profile only) |
| T3-COMPOSITE | 3 | D2, D3, composition | designed only | Two mock backends on two loopback ports; a composite tool joins them; backend B down must degrade sanely (partial answer with notice). Needs a purpose-built composite fake; the generator cannot produce it | S | implemented-minimal (no generator subject) |
| T3-LARGE-RESP | 3 | D4, D6 | designed only | Mock category of 5,000 seeded items with nested attributes; response byte cap, bounded item count, truncation signalled, no silent truncation. Token budget approximated as bytes/4 | S | implemented |
| T4-FAULT-UPSTREAM | 4 | risk flags | designed only | Fault injection: 429 with and without Retry-After, 500, 503, timeout, reset, malformed JSON, HTML, truncated body. Retry/backoff observed in the attempt log, bounded retries, deadline respected, malformed gives an honest tool error | S | implemented |
| T4-PARTIAL-SPEC | 4 | risk flags, reproducibility | designed only | Partial or contradictory spec fixtures through the generator pipeline in-process; pass means a gap is reported and the affected tool omitted or marked, never silently guessed; 3 reruns byte-identical. Other subjects: NA_MODALITY | G | implemented |
| T4-SEC-SECRETS | 4 | risk flags | designed only | Canary key injected only via env; scan all tool outputs and stderr; no write tools from a read-only source; injection parameters recorded raw by the mock and asserted escaped. Generator side: credential-looking input rejected | S+G | implemented |
| T4-I18N-CODES | 4 | risk flags | designed only | Invented checksum code and controlled vocabulary; an invalid code must be rejected before any upstream call (mock hit count 0); multilingual UTF-8 fields round-trip intact | S | implemented |

Counts: Tier 1 x1, Tier 2 x3, Tier 3 x4, Tier 4 x4 = 12. Implemented in the source: 1, plus the separate 10-check live harness. Designed only: 11. All 12 are implemented in some form by this phase (offline, synthetic).

## 5. Deliberate deviations

1. Strict not-found: clean_not_found requires an explicit not-found signal or isError plus no leak (the source passes on "no error text OR a signal").
2. Pessimistic tie-break: rerun majority vote makes FAIL win ties (the source lets PASS win).
3. Thresholds enforced: case pass_thresholds decide case PASS/FAIL (the source never reads them).
4. Explicit-or-unique tool binding: an ambiguous hint is ERROR, not first-match.
5. Environment allowlist instead of inherited environment: the subject process gets PATH, LANG, a temporary HOME and only case-declared variables.
6. Leak-guard minimum length is one explicit value (default 8) tested on both sides of the boundary.
7. Additive cell states NA_TRANSPORT and PENDING_HUMAN; the original 8 states stay distinct and are never averaged.
8. Structural no-egress (loopback mock, internal network, URL-literal test) instead of advisory hosts-file blocking.
9. The strict auth-word regex is kept; the runner's looser "invalid" alternative is not ported.

## 6. Honest residual gaps

- `legacy-http-sse`: legacy HTTP+SSE transport (deprecated by the specification): unsupported, listed in the report rather than skipped silently.
- `real-profile-mapping`: only the invented Acme profile is scored; mapping to the real partner profile needs the real document (pending human).
- `generator-http-transport` and `generator-composite`: T2-CATALOG-HTTP and T3-COMPOSITE for generator subjects; the generator emits neither an HTTP transport nor composite tools.
- `real-fastmcp-run`: any real FastMCP execution; needs the runner image and a pinned FastMCP; pending human.
- D3 and D5 were never scored in the source; here they are advisory only and never part of the headline score.
- Tokens and cost are 0 for non-LLM subjects; human interventions are not applicable.
