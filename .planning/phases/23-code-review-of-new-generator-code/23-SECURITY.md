---
phase: 23-code-review-of-new-generator-code
plan: 03
verdict: SECURED
threats_total: 21
mitigated: 15
fixed_in_this_audit: 1
accepted: 5
open: 0
---

# Phase 23 Security Audit

Method: attacker view of each surface that takes untrusted input, evidence from code (file and line) and from
malicious-input tests. Tests live in `src/lib/mcpgen/security.hardening.test.ts` (20 tests) and
`scripts/generate-mcp.security.test.ts` (6 tests); older hardening suites are cited where they already cover a shape.
Generated Python is never run against a network; the two dynamic tests execute the emitted server template with
stubbed `fastmcp` and `httpx` modules, hostile call arguments and a throwaway SQLite file.
Method note: two first drafts of the dynamic tests were vacuous (wrong env name, wrong key); they were caught by a
positive control (a legitimate query must return its row) and fixed before the results below were taken.

## Threat register

| Id | Surface | STRIDE | Disposition | Evidence | Test |
|---|---|---|---|---|---|
| T-23-01a | sax reader: entity expansion, DOCTYPE, external and parameter entities | DoS, Info disclosure | mitigated | `adapters/odata-xml.ts:51-66` precheck rejects every `<!` except comment and CDATA before the parser sees text; parser never gets entity options | security.hardening `T-23-01` billion laughs / parameter / SYSTEM entity, each rejected under 500 ms; odata.adversarial.test.ts |
| T-23-01b | sax reader: nesting, width, attributes, text, size | DoS | mitigated | `XML_LIMITS` (1 MB, depth 32, 20k elements, 64 attributes, 4096 chars) enforced as events arrive, handler throws to stop | security.hardening `T-23-01` 100k-deep, 90k-wide, 5000 attributes, 5000 xmlns declarations all bounded in time |
| T-23-01c | sax reader: processing instructions, undeclared entity | Tampering | mitigated | `precheckXml` PI check; strict parser errors on unknown entity | same suite (`&undeclared;`) |
| T-23-02a | Proposal file: size, JSON depth, envelope | DoS | mitigated | `proposals/index.ts:94` byte cap 262144 before `JSON.parse`; `strictObject` envelope; 64 ops max | `T-23-02` oversize (ASCII and multi-byte), 200k-deep brackets |
| T-23-02b | Proposal file: `__proto__` / `constructor` keys, prototype pollution | Tampering | mitigated | zod strict objects; null-prototype tables in emitters (D-612); no deep merge | `T-23-02` four hostile documents, `Object.prototype` unchanged after strict and lenient runs |
| T-23-02c | Proposal file: injection strings in names, text, constants, selectors; ReDoS | Tampering, DoS | mitigated | gate 1 and 3 name patterns, selector grammar `selector.ts:16-47` (anchored, bounded), `cleanText` for text | `T-23-02` eight injection ops all rejected, text fields clean, 100k-char and `(a+)+$` selectors under 3 s, lenient pinned constants audited by AST |
| T-23-02d | Proposal file: fingerprint bypass | Spoofing | mitigated | gate 5, sha256 of model, tools, derived; mismatch is fatal in both modes | existing `proposals/gates.test.ts`, `index.review23.test.ts` |
| T-23-03a | Context pack: path arguments, symlinks, traversal, environment files | Info disclosure | mitigated | `scripts/mcp-pack-io.ts` lstat before read, symlinks skipped, `isEnvFileName`, depth 3, 200 entries, extension allow-list | `T-23-03` real file system: symlinked file and directory, `.env`, dotfile, 4-deep tree, FIFO; secret text absent from result |
| T-23-03b | Context pack: credentials in source, samples, docs | Info disclosure | mitigated | `contextPack.ts` credential scan before anything is written, errors never echo the match, SQL row data removed (CR-27) | credentials.hardening, contextPack.test.ts |
| T-23-04 | Binding file loader | Tampering, Elevation | mitigated | `core/bindingSchema.ts` strict schema, 64 KB cap, IDENT-only argMap names; `packageBinding.ts` lstat (CR-36); `tool` is compared to the server tool list, never used as a path | `T-23-04` `__proto__` / `constructor` keys, traversal-looking tool name; packageBinding.review23.test.ts |
| T-23-05a | Emitted Python: spec and proposal strings landing in code | Tampering | mitigated | `emit/pyutil.ts:7` `pyStr` (JSON escapes plus U+2028/9), `cleanText:60` for docstrings, `pyIdent`/`pyNum`/`sqlIdent` throw on anything else | `T-23-05` AST audit: six JSON/YAML documents, with hostile values (and hostile keys) carrying `"""`, `'''`, CR, U+2028, U+2029, `\N{}`, format fields, backtick, `import os; os.system(...)`; plus SQL, Prisma, two tabular and one OData XML input. Result: parses, no call to system/popen/eval/exec/`__import__`, same import set as the baseline, no payload identifier, requirements and JSON files stay well formed |
| T-23-05b | Emitted SQL server: injection through arguments | Tampering | mitigated | `runtime.ts` SQL runtime: allow-listed table and column names, `?` parameters, `LIKE ... ESCAPE`, read-only URI plus `query_only` (`runtime.ts:319-320`) | `T-23-05` SQL: injection in field, value, fields, limit, offset, match with positive control; table intact, hostile equals matches nothing |
| T-23-05c | Emitted OData server: key and `$filter` injection | Tampering | mitigated | `_odata_literal` type check and quote doubling, `_odata_path` `quote(..., safe="'")`, `_seg` dot-segment refusal | `T-23-05` OData: 13 hostile values through lookups and filters; every path is one `/Set(key)`, every `$filter` one quoted literal |
| T-23-05d | Package bundle and output paths | Tampering | mitigated | `bundle.ts validPath`, `toZip` folder pattern | bundle.test.ts, route test |
| T-23-06a | Output directory: write through a planted symbolic link (`--force`, `--write-packages`) | Tampering | FIXED in this audit (D-632) | was: only the final file was lstat-checked. Now `scripts/generate-mcp.ts:153-180` and `scripts/mcp-propose-eval.ts` check every directory component | `scripts/generate-mcp.security.test.ts` (context-pack, generate and propose-eval cases, failing first) |
| T-23-06b | Container path: driver request, package paths, env names, egress, user | Elevation, Tampering | mitigated | `driverRequest.ts:25-70` (no option-like args, no `..`, reserved env names, cwd under the package root, `.strict()`), `containerRun.ts checkPackage` + `isSafeRelativePath`, `runtimeDockerode.ts:60-72` (`CapDrop ALL`, `no-new-privileges`, internal network, read-only root, memory, pids), runner never gets egress, user `node`, report re-validated by schema (WR-05), route accepts known subjects only | `T-23-06` eight bad requests and six bad package paths: refused with no engine call; containerRun.*.test.ts, driverRequest.hardening.test.ts |
| T-23-A1 | Prompt-injection text from a spec, sample or doc copied into the context pack | Tampering | accepted (D-633) | UNTRUSTED banner in the pack, data-only proposal schema, strict gates, human review before publishing | n/a (not code-testable) |
| T-23-A2 | CLI input and proposal paths named by the author may be symlinks | Info disclosure | accepted (D-633) | the author chose the file | n/a |
| T-23-A3 | Size-check to read gap in the CLI readers | DoS | accepted (D-633) | author-local; the text is size-checked again by the pipeline | n/a |
| T-23-A4 | `tool_hint` regex compiled from the suite | DoS | accepted (D-633) | hints are repository constants, not package input | n/a |
| T-23-A5 | `podman-compose.yml` mounts the host Podman socket and is not hardened | Elevation | accepted, pending human (D-633, D-630, 23-HUMAN-UAT.md) | severity medium, deployment only; not changed because it alters the deployment contract and cannot be tested without Podman | none |

Counts: 15 mitigated rows (T-23-01a to c, 02a to d, 03a, 03b, 04, 05a to d, 06b), 1 fixed (06a), 5 accepted (A1 to A5), 0 open. Real threats found: 1 (T-23-06a, low: needs a symbolic link planted in a reused output directory and `--force`),
fixed with a failing-first test. Nothing exploitable remains open.

Not probed, stated honestly: the real container engine (no Podman here), the real `fastmcp` and `httpx` (stubbed),
network behaviour of an emitted server against a hostile upstream (response parsing is size-capped and
schema-shaped, covered by existing emitted tests, not re-audited), and the dependency tree (`npm audit` is outside
this plan).

## Verdict

SECURED
