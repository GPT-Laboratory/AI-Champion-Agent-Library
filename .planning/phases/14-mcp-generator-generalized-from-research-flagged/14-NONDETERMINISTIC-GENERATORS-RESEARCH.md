# Phase 14 follow-up: non-deterministic (LLM-assisted and agentic) MCP generators

**Researched:** 2026-10-14 (branch `autonomous/overnight-improvements`)
**Question (from Ville):** what is known about MCP generators with an LLM or an agent in the generation loop, and how could such a layer sit next to the deterministic Phase 14 generator?
**Counterpart to:** `14-INPUT-KINDS-RESEARCH.md` (deterministic input kinds) and `docs/mcp-generator-design.md` (D-159: deterministic only, LLM layer deferred).
**Confidence:** MEDIUM overall. Study scores are HIGH (quoted from `RESEARCH-SYNTHESIS.md`). External paper numbers are HIGH where I fetched the paper page, MEDIUM where only a search summary was available, LOW or UNVERIFIED where marked. Costs, effort and the recommended architecture are my judgement, not measured.

Not read, by instruction: the external comparison repositories. All study evidence comes through `RESEARCH-SYNTHESIS.md`. No real data, product numbers or keys appear here.

---

## 1. Summary

There is a large and growing set of tools that put an LLM into MCP server creation, but the evidence about their output quality is thin. The published work that I could verify measures whether the generated server runs and whether tool calls succeed (Code2MCP: 64 percent final conversion over 50 repositories; AutoMCP: 76.5 percent of sampled calls succeed out of the box, 99.9 percent after small spec fixes, and it is a compiler, not an LLM system). Nothing I found scores the behaviours our study showed to matter (trimmed responses, clamping, honest empty and not-found, synthesized filters, safe errors). The one study that did (via the synthesis) found every automated arm at 6 of 9 or less, and the LLM arms (single prompt 6, spec-driven workflow 5, agentic 0 to 2 and unstable) were not better than the deterministic converter at the "mirror the API" half and were worse on reproducibility.

What the literature does support is a narrower role: an LLM is good at the words around a tool (names, descriptions, parameter explanations). Two preprints show description quality changes agent tool selection substantially (a standard-compliant description was picked 72 percent of the time against a 20 percent uniform baseline; augmenting descriptions raised task success by a median 5.85 percentage points but raised execution steps by 67 percent and regressed 16.67 percent of cases). That is exactly the part a deterministic generator does worst, and it is data, not code, so it can be validated and reviewed.

The platform constraints (no paid API calls unless Ville opts in, reproducible output, the generator library is pure with no network, generated servers are black boxes) point the same way: keep the deterministic core as the only thing that writes code, and add an optional proposal layer that emits a small, schema-validated, reviewable JSON file (renames, descriptions, projection overrides, derived-tool specs, annotations). The pure generator consumes that file as an ordinary input. The Phase 15 scorer is the regression gate; a human reviews the diff before anything is published. Fully agentic generators are not integrated; they can still be benchmarked today through the existing `cmd:` subject.

**Primary recommendation:** build a `ProposalSet` (data only) that the pure generator can apply, plus a separate opt-in CLI that fills it from any OpenAI-compatible endpoint (local model by default), flag `MCP_GENERATOR_LLM` default off. Never let a model write server code. Gate every proposal on schema validation, grounding checks, the Phase 15 scorer (no regression versus the deterministic baseline) and human review.

---

## 2. Approaches surveyed

Evidence legend: S = from the earlier study via the synthesis; P = published paper or official doc fetched; V = vendor or blog claim; U = unverified.

### 2.1 Deterministic converters (baseline, no LLM)

- FastMCP `from_openapi` / `OpenAPIProvider` (3.x). Every endpoint becomes a tool by default; `RouteMap` rules and `mcp_names` / `mcp_component_fn` customise. Official docs say LLMs perform better with curated servers than auto-converted ones and recommend it for bootstrapping and prototyping. Source: https://gofastmcp.com/integrations/openapi.md (fetched; HIGH). Study score: 4 of 9 (S).
- FastMCP security record: CVE-2026-32871 / GHSA-vv7q-7jx5-f767, SSRF plus path traversal in the OpenAPI provider; path parameter values were put into the URL template unencoded and resolved with `urljoin`, so `../` escaped the API prefix and requests carried the provider's credentials; fixed in 3.2.0; CVSS reported as 10.0 by one source. Sources: https://osv.dev/vulnerability/CVE-2026-32871 , https://advisories.gitlab.com/pypi/fastmcp/CVE-2026-32871/ (search summaries, MEDIUM; dates differ slightly between sources). Lesson for us: runtime converters and generated code must URL-encode and allow-list path parameters; our design already requires validated and escaped params (design doc section 7 item 4). The FastMCP docs page I fetched says path values must not contain `.` or `..` segments, which is the post-fix behaviour (HIGH).
- AutoMCP (arXiv 2507.16044): a compiler from OpenAPI 2.0/3.0 to MCP servers, 50 real APIs, 5,066 endpoints, 76.5 percent of 1,023 sampled tool calls succeed out of the box, 99.9 percent after spec fixes averaging 19 lines per API; failures traced to spec inconsistencies. The page I fetched does not mention an LLM. One secondary source (the DADL paper, arXiv 2605.05247, not read in full) calls it an automated repair pipeline, so "does it use an LLM" is UNRESOLVED; I treat it as deterministic. Sources: https://arxiv.org/abs/2507.16044v3 (HIGH for numbers). Correction to `RESEARCH-SYNTHESIS.md` section 2, which described automcp as "automated spec repair"; the paper's own framing is compiler plus manual spec fixes.
- openapi-mcp-generator (npm), cnoe-io `openapi-mcp-codegen` (Jinja2 templates; optional LangGraph agent) and similar: deterministic, template-based (V). Study: openapi-mcp-generator 2 of 9, cause UNVERIFIED (S).

### 2.2 LLM-assisted (LLM fills a bounded slot)

- Description rewriting. Study 1: arXiv 2602.14878 (856 tools, 103 servers; six-component rubric: purpose, guidelines, limitations, parameter explanation, length and completeness, examples). A small hosted model (gpt-4.1-mini) augmented descriptions; scanner flagged 97.1 percent of descriptions with at least one smell; augmenting all components raised task success by a median 5.85 percentage points, average evaluator score 15.12 percent, execution steps by 67.46 percent, and 16.67 percent of cases regressed; shorter targeted combinations often matched full ones; examples were the costliest and least necessary. Source: https://arxiv.org/html/2602.14878v1 (fetched, first 100k of 193k characters read; HIGH for quoted numbers).
- Study 2: arXiv 2602.18914 (10,831 servers, 18 smell categories, four dimensions: accuracy, functionality, information completeness, conciseness). Functionality (+11.6 points) and accuracy (+8.8) mattered most for tool selection; in groups of five equivalent servers the standard-compliant description was selected 72 percent of the time. Descriptions in the ablation were LLM-generated from code per dimension. Source: https://arxiv.org/html/2602.18914v1 (fetched; HIGH). Both are preprints.
- Vendor platforms that take an OpenAPI document and let the author override names, descriptions and scopes (Speakeasy/Gram; Stainless's "code tool" architecture that exposes a sandboxed code-execution tool instead of one tool per operation, marked experimental). Per Zuplo, Fast.io and the Stainless docs via search; I found no claim that these use an LLM to author descriptions (V, MEDIUM). Sources: https://zuplo.com/blog/mcp-server-generators-compared , https://www.stainless.com/docs/mcp/index.md , https://docs.inkeep.com/guides/mcp-servers/gram .

### 2.3 Single-prompt and spec-driven LLM code generation

- Study arms "plain" (single prompt) and "gsd" (spec-driven agent workflow, sonnet-class model): 6 and 5 of 9. gsd cost about 16 minutes, about 10.1M tokens (mostly cache reads), about 4.60 USD, the only recorded D6 value (S). Both under-implemented behaviours the brief explicitly demanded: "telling the model" was not enough (S, synthesis 1.4).
- Anthropic's `mcp-builder` skill (anthropics/skills repository): four phases (research and planning, implementation, review and testing, evaluations); recommends TypeScript, supports Python/FastMCP; asks for tool annotations and output schemas; ends with 10 read-only, multi-call, string-verifiable evaluation questions and a bundled script that runs them through a Claude model (so it needs an API key; per third-party listings, UNVERIFIED in detail). Notably it says "when uncertain, prioritize comprehensive API coverage" (from a model-summarised fetch of `SKILL.md`, MEDIUM), which is the opposite of the study's finding that task-shaped, trimmed tools win. Sources: https://raw.githubusercontent.com/anthropics/skills/main/skills/mcp-builder/SKILL.md , https://huggingface.co/spaces/Luminia/README/blob/main/mcp-builder/reference/evaluation.md (mirror). Our `docs/agent-types.md` already records the Agent Skills format.
- Community "meta" servers that write servers from natural language or specs (mcp-toolforge, MCP Server Creator, Mcp Tool Factory, MCPForge): vendor or listing claims only, no independent evaluation found (V/U). Sources: https://mcpservers.org/servers/GongRzhe/MCP-Server-Creator , https://ai.g2.com/marketplace/tools/mcp-tool-factory .

### 2.4 Agentic generators with a run-review-fix loop

- Code2MCP (arXiv 2509.05941v4): repository to MCP service. Agents for code analysis, environment setup, tool design, generation; Run-Review-Fix loop (run generated tests, review agent diagnoses, generation agent rewrites only affected files). gpt-4o, temperature 1 for all models. 50 repositories over 10 scientific domains: environment setup 38/50, basic tests passed 24/50, final conversion 32/50 (64 percent); the repair loop fixed 8 of 19 initial failures, about 1.4 rounds. Failures dominated by environment and interface inference. Authors acknowledge executing third-party code and describe isolated workers, restricted filesystem, bounded runtime and network off by default; adversarial repositories not evaluated. Output is not deterministic (temperature 1). Source: https://arxiv.org/html/2509.05941v4 (fetched, 100k of 126k characters read; HIGH). The code link differs between versions (v4 anonymous mirror, v3 a GitHub organisation), so availability is MEDIUM. In the study the Code2MCP arm was never installed (S), so there is no comparable score.
- The study's agentic arm (generate, QA, refine): 0 to 2 of 9 across about 10 runs, one mega-tool then a filter tool that took a caller-supplied list instead of fetching (S). I could not find a paper or repository for it by search on 2026-10-14 (U for provenance; the synthesis calls it mcpybarra).
- OSWorld-MCP's tool pipeline (code generation, code filter, tool wrap modules) is a research pipeline for desktop tools, not a server generator for APIs (P via search; irrelevant to us except as the pattern "generate then filter").
- ToolFactory (docs to tool definitions) is only known to me through the DADL paper's description (U). The DADL paper (arXiv 2605.05247) argues that generating one server per API keeps each server's deployment and context costs and proposes a declarative description language instead (search summary only; U).

### 2.5 Docs and website to MCP

- Documentation-serving MCP servers (LangChain `mcpdoc` over llms.txt, `@mcpframework/docs`, docs crawlers) expose docs as searchable tools. They do not turn docs into API-calling tools (MEDIUM, from search). Source: https://www.mcp-framework.com/docs/docs-package .
- The study's docs-only modality: designed (suite case T3-RT-DOCS), fixture empty, one arm install_failed (S). So there is no measured evidence for docs-to-API-tool generation at all. Grounding (every route the server calls must be documented) is the scoring idea already ported (Phase 15, case T3-RT-DOCS).
- No reliable published tool found for "wrap this website from its docs" that I could verify. LOW.

### 2.6 Evaluation literature

- MCP-Bench (arXiv 2508.20453, ICLR 2026 poster): 28 live MCP servers, 250 tools, 104 multi-step tasks, rule-based plus LLM-judge scoring, 20 LLMs. It evaluates agents, not servers; the server is the fixed part (search summary, MEDIUM). Source: https://arxiv.org/pdf/2508.20453 . MCP-AgentBench and MCPEval are named in the same results without detail (U).
- MCP-Flow (arXiv 2510.24284): training data from 1,166 existing servers and 11,536 tools; does not generate servers (HIGH, fetched abstract).
- Description-quality scoring: the two preprints above; a practitioner "Tool Definition Quality Score" (talk listing; LOW).
- Nothing found that benchmarks server design behaviours (clamping, honest empties, derived filters). Our Phase 15 platform is, as far as I could find, the only harness covering them. LOW-MEDIUM: absence of evidence from search.

### 2.7 MCP spec features that matter

Current revision 2026-07-28 (fetched https://modelcontextprotocol.io/specification/latest/server/tools ; HIGH):

- `outputSchema` optional; if provided, servers MUST return conforming `structuredContent`; `structuredContent` may be any JSON value; a tool that returns structured content SHOULD also return serialized JSON in a text block.
- `annotations` exist and clients MUST treat them as untrusted unless from trusted servers. The four hint names (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) are not on the fetched page; they come from the `mcp-builder` guidance and vendor docs, with defaults reported as false, true, false, true (MEDIUM, one model-assisted fetch and vendor pages; check the schema page at implementation time).
- Servers SHOULD return tools in deterministic order (same across requests); names 1 to 128 chars of `A-Za-z0-9_-.`; tool execution errors use `isError: true` and clients SHOULD show them to the model for self-correction.
- Security section: servers MUST validate inputs, rate limit, sanitize outputs.

Consequence: annotations, `outputSchema` and deterministic ordering are mechanical and belong in the deterministic emitter, not in an LLM layer (see section 6).

### 2.8 Safety literature on descriptions

Tool poisoning: hidden instructions in tool or parameter descriptions are read by the model and often not shown to the user; manifests load at initialisation so the effect persists; "rug pull" changes to definitions after approval. Mitigations named: treat descriptions as untrusted, snapshot and diff them, keep poisonable agents away from secrets and an outbound path. Sources: https://labs.cloudsecurityalliance.org/research/csa-research-note-mcp-tool-poisoning-ai-agent-exfiltration-2/ , https://policylayer.com/attacks/hidden-instructions-in-tool-descriptions , https://kayssel.substack.com/p/mcp-security-poisoning-the-tools (MEDIUM, blogs and a research note). I found no source specific to OpenAPI-to-MCP converters copying spec descriptions; that is my inference (spec text often comes from third parties). It applies to the deterministic generator too (section 7).

---

## 3. Comparison table

Columns: what the LLM does; determinism; quality evidence; cost; safety; fit with our architecture.

| Approach | What the LLM does | Determinism and reproducibility | Quality evidence | Cost model | Main safety risks | Fit with SourceModel / DerivedTool / Phase 15 |
|---|---|---|---|---|---|---|
| A. Deterministic converter (FastMCP `from_openapi`, openapi-mcp-generator, AutoMCP, our Phase 14) | Nothing | Byte-identical, golden files | Study: 4 of 9 (from_openapi), 2 (npm tool, cause unverified); AutoMCP 76.5 percent calls OK, 99.9 after spec fixes (P) | Zero tokens | SSRF/path traversal in runtime converters (CVE-2026-32871); spec text copied into descriptions | This is the core. Phase 14 adds the behaviours converters lack |
| B. LLM description/naming layer (research: arXiv 2602.14878, 2602.18914; vendor override fields) | Rewrites names, descriptions, parameter text | Not deterministic; made reproducible only by freezing the output (replay file) | Selection +8.8 to +11.6 points for functionality/accuracy; task success +5.85 pts median but +67 percent steps, 16.67 percent regressions (P, preprints) | Small: one call per spec, a few thousand output tokens (estimate); runs on a local model | Prompt injection from spec into model and from model into descriptions; semantic drift (description no longer matches behaviour) | Excellent: data-only, fits `PlannedTool.name/description`. Phase 15 does not score selection quality, so a new eval is needed (section 8) |
| C. LLM proposes derived tools and projection | Reads entities, suggests `DerivedTool` specs and projection fields | As B | None published. Study shows the discriminating behaviour is synthesis, and that LLM arms noticed but did not implement it (S) | As B, a bit larger | Wrong field choices; filters over wrong fields give confident wrong answers | Good: spec is data validated against `SourceModel`; deterministic templates implement it; Phase 15 `derived_filter` scores it |
| D. LLM extracts a SourceModel or draft OpenAPI from docs (docs-only inputs) | Reads prose, emits an API description | Not deterministic; freeze the draft | None. Docs modality never scored (S); ToolFactory known only secondhand (U) | Larger input (docs), medium | Hallucinated endpoints (the whole risk of docs-only, S), injection from web pages | Fits as "LLM authors the spec, deterministic generator compiles it", with quote-grounding and the T3-RT-DOCS case |
| E. Single-prompt code generation | Writes the whole server | Not deterministic | Study: 6 of 9 (S) | One call, modest | Unreviewed generated code; secrets handling | Does not fit (violates "never free-form code"); can be scored as a `cmd:` subject |
| F. Spec-driven agent workflow / skill (gsd, Claude Code `mcp-builder`) | Plans, writes, reviews, tests | Not deterministic; process varies | Study: 5 of 9, very stable score, 16 min, 10.1M tokens, 4.60 USD (S); `mcp-builder` has no published score and prefers coverage over curation (MEDIUM) | High, key required | Agent executes code and tools; writes files | External lane only: score the result via `cmd:` |
| G. Agentic gen+QA+refine, run-review-fix (Code2MCP, the study's agentic arm) | Analyses, generates, runs tests, repairs | Temperature 1 in Code2MCP; study arm 0 to 2 across runs | Code2MCP 64 percent conversion of 50 repos (P); study arm 0 to 2 of 9 (S) | High and open-ended | Executes third-party code during setup; Code2MCP says isolation, no adversarial evaluation (P) | External lane only. Useful idea to borrow: the run-review-fix loop, but over proposals, not code |
| H. Runtime LLM-ish wrappers (Stainless code tool, Speakeasy dynamic mode) | Model writes code or meta-tool calls at runtime | Not deterministic at runtime | Vendor claims | Pay per use at runtime | Code execution tool | Out of scope: different product shape (not reviewable source) |
| I. Docs-serving MCP servers (`mcpdoc`, llms.txt) | None at generation; serve docs | Deterministic | n/a | None | Fetches arbitrary URLs | Not a generator of API tools; out of scope |

Reading of the evidence: B and C are the only rows where an LLM contributes something a deterministic generator cannot do well and where the output can be fully constrained. E to G are measured (study) or reported (papers) as less reliable than the deterministic baseline on behaviours, costly, and unsafe to integrate without a sandbox.

---

## 4. What the study scores say (via the synthesis)

Quoted from `RESEARCH-SYNTHESIS.md` section 1.3 (maximum 9 scored checks):

| Arm | Score | Note |
|---|---|---|
| hand-authored | 9 (8 once) | the five design rules |
| single prompt | 6 | missing synthesized filter; empty and bad input unhandled |
| spec-driven agent | 5 | understood the hard problems, under-implemented all three; very stable |
| FastMCP `from_openapi` | 4 | fully deterministic, 0.08 to 0.15 s |
| npm converter | 2 | functional checks all fail, cause UNVERIFIED |
| agentic gen+QA+refine | 1 to 2 (range 0 to 2) | unstable |

Three consequences for an LLM layer: (1) LLM arms did not beat the deterministic converter by enough to justify the cost, and they added variance; (2) the discriminating behaviour (synthesis) was missed by every LLM arm even when asked explicitly; (3) the study did not test an LLM layer on top of a deterministic backbone. That is the untested "combined" hypothesis and is what this document proposes to test. Caveat inherited from the synthesis: scores come from one API, 9 checks, a few runs; D3 and D5 were never scored.

---

## 5. Recommended hybrid architecture

### 5.1 Principle

The LLM never writes code and never touches the generator's trust boundary. It produces a `ProposalSet`, a JSON document of bounded kinds. The pure generator (`src/lib/mcpgen/`, no I/O, no network) reads the `ProposalSet` exactly like it reads `GenerateOptions`. Same input plus same `ProposalSet` gives byte-identical output (D-159 invariant preserved). The LLM call itself lives in a separate module outside `src/lib/mcpgen/` and is never imported by it (extend the existing invariant test that the core imports no adapters, and that the library makes no network calls).

```
RawInput --adapter--> SourceModel --(deterministic planner)--> ServerPlan0
                                      |
                  [opt-in, separate CLI module]
                  SourceModel (sanitised, redacted) --> LLM --> ProposalSet (JSON)
                                      |
                          validate (schema + grounding + safety)
                                      |
                 human review (diff vs ServerPlan0) --> commit proposals file
                                      |
ServerPlan0 + ProposalSet --(deterministic apply)--> ServerPlan --> templates --> package
                                      |
              Phase 15 scorer on baseline vs proposal-applied package: regression gate
```

Properties: replayable (the committed `*.proposals.json` is the artefact; regenerating needs no model), offline-capable (anyone, including Ville with his own agent session, can hand-write or externally produce the file and feed it in), and the LLM step can be removed with no change to the deterministic path.

### 5.2 ProposalSet shape (proposal for the design doc; names are suggestions)

```ts
interface ProposalSet {
  version: 1
  modelFingerprint: string          // sha256 of canonical JSON of the SourceModel it was made for
  producer: { kind: 'llm' | 'human' | 'external-agent'; model?: string; promptId?: string; createdAt?: string }
  renames: { operation: string; name: string }[]                    // regex ^[a-z][a-z0-9_]{2,47}$, unique
  descriptions: { tool: string; text: string; params?: Record<string, string> }[]   // length caps, no URLs
  projectionOverrides: Record<string, string[]>                     // entity -> existing field names, cap 12
  derived: { kind: 'inMemoryFilter' | 'schemaDiscovery' | 'crossFieldSearch'; entity: string; source: string; description: string }[]
  annotationsOverride?: never                                       // annotations stay deterministic
  rationale?: Record<string, string>                                // for review only, never emitted into code
}
```

The apply step stamps `origin: 'proposed'` on derived tools (extend `DerivedTool.origin`, currently `'detected' | 'user'`). A stale fingerprint (model changed) rejects the file with a gap, never silently applies.

### 5.3 Validation gates (all deterministic, all run before apply)

1. Schema (zod, strict, unknown keys rejected, size caps on every string and array).
2. Grounding: every `operation`, `entity`, field, param and `source` named must exist in the `SourceModel`; derived-tool `kind` must be one of the three existing templates; projection fields must exist and respect the 12 cap.
3. Name rules: MCP name character set and length (spec), uniqueness, no collision with deterministic names unless it is a rename of that tool; renames cannot change method, path or params.
4. Description hygiene: length cap (suggest 600 chars, 80 for param text; tune with the smell studies, which found short targeted descriptions often match long ones), no URLs, no markdown links, no instruction-like patterns aimed at the model (imperatives about other tools, "ignore", "always call", "do not tell the user", credential words), no content from outside the model; must not claim write capability on a read-only tool; must not mention clamp numbers that differ from the model's limits.
5. Behaviour invariants stay untouchable: the nine emitter behaviours cannot be turned off by any proposal field (there is no field for them).
6. Scorer gate (section 8): applied package must not score below the deterministic baseline on any scored check or raise any flag.
7. Human review: the CLI prints a diff of names, descriptions and derived tools against the deterministic plan; writing the proposals file into a package requires an explicit `--accept` (or the file simply is not accepted by the generator without a `reviewed: true` marker added by a human edit).

### 5.4 Where the model is called, and with what

- Input to the model: the sanitised `SourceModel` (names, types, descriptions truncated), not the raw spec, not credentials (the credential scanner already rejects them before an adapter runs), not row data. Spec-derived text is wrapped as quoted data with an explicit instruction that it is untrusted; because output is schema-validated and hygiene-checked, a successful injection can at most produce a bad description that the gates catch or a reviewer sees.
- Output: JSON constrained by the `ProposalSet` schema. Constrained decoding exists in local servers (Ollama accepts a JSON schema in `format`, per a tutorial; vLLM and others have structured-output modes), but it guarantees shape, not truth, so gates still run (https://www.glukhov.org/post/2025/09/llm-structured-output-with-ollama-in-python-and-go/ , MEDIUM; Ollama's own docs not fetched, UNVERIFIED). JSONSchemaBench (arXiv 2501.10868) notes effectiveness of constrained decoding in practice is poorly understood.
- Provider interface: one thin adapter speaking an OpenAI-compatible chat API (base URL from env), so local servers (Ollama, llama.cpp, vLLM) and hosted APIs share one code path. Anthropic's native API would be a second adapter, only if Ville wants it. Default config: local loopback only.

---

## 6. Where an LLM adds value, and what must stay deterministic

Ranked by expected value and by safety:

| Rank | Task | Why an LLM | Constraint |
|---|---|---|---|
| 1 | Tool descriptions: purpose, when to use, limits, parameter meaning | Strongest published effect on selection (functionality +11.6, accuracy +8.8 points); deterministic output copies terse spec summaries | Data only, hygiene-checked, no examples (costly, least necessary per 2602.14878) |
| 2 | Task-oriented tool names where operation ids are poor (`GetV2ItemsByIdUsingGET`) | Rules produce collisions and ugly names | Regex and uniqueness gate; keep deterministic name as fallback and in the report |
| 3 | Suggesting derived filters for unusual APIs (nested arrays the structural rule misses) and projection field choice | Domain judgement; the discriminating behaviour in the study | Template kinds only; fields must exist; scorer `derived_filter` and `projection` gate |
| 4 | Docs-only and prose inputs that no deterministic adapter can parse | The only way to cover that input class | LLM authors a draft OpenAPI or SourceModel that then goes through the deterministic adapter; every operation must carry a verbatim quote from the input (substring-checked); marked draft; mandatory human review; T3-RT-DOCS grounding must pass |
| 5 | Generated test ideas (extra seed cases for the Phase 15 suite) | Cheap creativity | Output is a case file reviewed before adding; golden-isolation test still applies |
| 6 | Summarising the generation report for authors | Nice to have | Presentation only |

Must stay deterministic (never delegate):

- Parsing, canonical model, credential scan, size caps, gap reporting.
- All nine emitter behaviours: clamp, ceiling, honest empty and not-found, structured safe errors, auth message, read-only default, projection cap, retry/backoff, validation of identifier codes.
- Derived-tool coverage reporting and every line of emitted Python, requirements pins, tests.
- Tool annotations and `outputSchema`/`structuredContent` (mechanical from the projection and the read-only guarantee; section 2.7).
- Deterministic tool ordering (spec SHOULD).
- Selection of write operations: never proposed, never enabled by a proposal (`allowWrite` stays a human option).
- Any decision to execute code, call a network, read an environment variable beyond the documented names.

---

## 7. Safety model for the LLM layer

| Risk | Control |
|---|---|
| Prompt injection from spec or docs into the model | Treat input as data; schema-constrained output; hygiene filters; no tool access for the model; no network for the model beyond the configured endpoint; human diff. Note the same untrusted-text problem already exists in the deterministic path, which copies spec summaries and descriptions into tool descriptions: add the same hygiene filter (strip control and zero-width characters, length cap, flag instruction-like patterns as gaps) to the deterministic emitter as a Stage 0 item, independent of any LLM |
| Poisoned description in generated output (tool poisoning, rug pull) | Generated package ships `descriptions.lock` (hash of every tool name and description); the report lists them; changes require regeneration, which is a visible diff |
| Credential handling | Key only from an environment variable at call time; never read from files the platform writes; never logged, echoed, put in reports or proposals; redaction of the key value in all error strings; the credential scanner continues to run on the input before it can reach the model; CLI refuses to run if the input contains findings |
| Data egress | Sending a spec to a hosted provider discloses it. Local endpoint is default; non-loopback base URL needs an explicit `--allow-remote` and prints the destination host and estimated bytes before sending |
| Executing generated code | None by design for B to D (no code from the model). External agentic outputs are only run via the existing `cmd:` subject with `--allow-local-exec`, in the runner container with no egress |
| Supply chain | The layer adds no runtime dependency to generated servers; at most one HTTP client in the CLI module; pin model id in the proposals file |
| Semantic drift | Gate 4 grounding; the scorer; deterministic fallback; reviewers see rationale |
| Cost runaway | Section 9 |

---

## 8. Evaluation protocol using the Phase 15 harness

What the harness gives (from `docs/mcp-test-platform.md`): subjects including generator subjects and `cmd:` subjects (real process, `--allow-local-exec`), 12 cases, 10 behaviour checks, `--reruns 1-3` with per-check majority vote and ties to FAIL, verdicts (`PASS`, `FAIL`, `BLOCKED`, ...), blocker flags, headline score (unweighted mean of Tier 2 and 3 pass rates; formula an assumption), `T4-PARTIAL-SPEC` byte-identical reruns, zero LLM tokens in the scorer. Known gaps that matter here: real generated Python has never been executed by the platform (pending human), so all numbers for real servers are still pending; description quality is D3 advisory only; there is no agent-in-the-loop case.

Important honest limit: the harness scores server behaviour, not whether an agent picks the right tool. Names and descriptions mostly do not change harness results (they change tool binding by hint, where ambiguity is a scorer ERROR). So the harness protects against regressions (a rename that breaks binding, a derived tool that returns wrong results) but cannot show that B improves anything. Showing improvement needs a separate selection eval (stage 7).

### 8.1 Variants

- V0: deterministic baseline (one run suffices; it is byte-identical, confirmed by T4-PARTIAL-SPEC).
- V1..Vk: proposal sets from (model, prompt version) pairs: for example a local 7 to 14B class model, a local larger model, and, only with opt-in, one hosted model. Keep the model id in the report.

### 8.2 Procedure for one variant and one input

1. Generate K proposal sets (K = 5 for a first study; 3 minimum) with identical prompt and the provider's seed if it has one. Temperature 0 and a seed reduce but do not remove variation: sources say temperature 0 is not deterministic and a seed covers only the sampler (https://tianpan.co/blog/2026/06/30/temperature-zero-is-not-determinism , https://arxiv.org/pdf/2408.04667v5; blogs plus a paper, MEDIUM); one source says Anthropic offers no seed parameter as of May 2026 (UNVERIFIED). So treat K as the measurement of variance, not as a cure.
2. Validate each; count rejections by gate (rejection rate is itself a metric: schema invalid, grounding failed, hygiene failed).
3. Apply each valid set deterministically and score through the Phase 15 scorer with `--reruns 3` (this detects server flakiness; the generation variance is across K).
4. Aggregate across K by the harness's own rule: per check, majority over the K reports; a tie goes to FAIL. Also report the per-check pass rate (for example 4 of 5) and the min over K. A variant passes the regression gate only if its majority result is not worse than V0 on any scored check, no run raises a blocker flag, and the worst of K is not worse than V0 on D1 and the Tier 1 gate.
5. Report cost: tokens in and out, wall time, rejections, estimated price (zero for local).
6. Compare variants paired on the same inputs; do not average over inputs of different difficulty.

Note the harness cap of 3 reruns is per scorer invocation; K is an outer loop in a small script, not a harness change. If an outer aggregation helper is wanted, it should reuse the existing majority and tie-break function rather than re-implement it (Stage 2).

### 8.3 Inputs

Synthetic Acme fixtures only (existing `src/lib/mcpgen/testing/fixtures/acme-openapi.yaml`, tabular and DDL fixtures, partial-spec fixtures). Add an adversarial fixture set for the layer: spec text containing injection strings in summaries and descriptions, extremely long descriptions, names colliding with others, descriptions that lie about writes. Pass means the gates reject or neutralise them and the scorer's `T4-SEC-SECRETS` (injection text not obeyed) stays green. Golden-isolation still applies: no expected string in anything shown to the model.

### 8.4 What to measure beyond the harness

- Description smell check (cheap, deterministic): rubric-style lint over the six components of arXiv 2602.14878 (purpose present, parameter text present, length bounds) as an advisory score, plus a duplicate/overlap check between tool descriptions (functionality overlap hurt selection in 2602.18914).
- Selection eval (optional, costly, opt-in): a small set of synthetic questions per Acme fixture, a model or scripted agent client picks tools; compare V0 against variants on selection accuracy and steps. This mirrors the `mcp-builder` evaluation idea (10 read-only, string-verifiable questions) and MCP-Bench's approach, but needs an LLM client so it is gated like the proposal step. Note the published trade-off (more steps, 16.67 percent regressions) so report steps and regressions, not only accuracy.
- Generation stability: Jaccard similarity of tool names across the K sets; proportion of identical descriptions.

---

## 9. Cost, credential and opt-in model

Constraint from Ville: the platform must stay unable to call paid APIs unless he opts in.

Flags and variables (all default off or unset; none set in any committed file):

| Name | Default | Meaning |
|---|---|---|
| `MCP_GENERATOR_LLM` | off (`1`/`true`/`on`/`yes` enable) | Master gate for the proposal layer. Requires `MCP_GENERATOR` on as well. Off: the code path is unreachable, the library imports nothing LLM-related |
| `MCP_GENERATOR_LLM_BASE_URL` | unset | OpenAI-compatible endpoint. Unset = layer refuses to run. A loopback URL is the recommended setting (local model). A non-loopback host additionally needs `--allow-remote` on the command line |
| `MCP_GENERATOR_LLM_MODEL` | unset | Model id; recorded in the proposals file |
| `MCP_GENERATOR_LLM_API_KEY` | unset | Read from the environment at call time only. Never written to disk, never in the report, proposals, logs or errors; local servers need no key |
| `MCP_GENERATOR_LLM_MAX_TOKENS` | small default (suggest 40,000 input plus 16,000 output per run) | Hard per-run budget. Input size is counted before sending (bytes divided by 4 as the existing platform approximates tokens); output uses the provider's max-tokens parameter; the run aborts at the cap and writes nothing |
| `MCP_GENERATOR_LLM_MAX_CALLS` | 3 | Hard cap on requests per run (including repair retries) |

Behaviour rules:

- CLI only at first (`npm run generate-mcp -- --propose ...` or a separate script). No web route and no UI until Ville decides (the web routes are unauthenticated-by-flag in places and a paid call must not be triggerable by a visitor). The `/api/mcp-generate` route never calls a model.
- A confirmation step prints model, host, estimated input tokens, the budget, and requires `--yes` (non-interactive CI sets it explicitly and never has the key).
- CI and tests use a fake provider (a recorded or scripted OpenAI-compatible stub bound to loopback). No test or CI job has a key; an invariant test asserts no key variable is read outside the provider module and that the library does not import the provider module.
- Local-model option: the same adapter pointed at Ollama, llama.cpp or vLLM. Cost is zero marginal; risk shifts to quality and hardware. Smaller local models should be expected to need more gate rejections and a repair retry (UNVERIFIED for any named model; the first study, section 8, measures it).
- Estimated cost scale (my estimate, not measured): a proposal run sends the sanitised model (up to the 262,144-byte input cap, so at most about 65k tokens, typically a few thousand for a small API) and gets back a few thousand output tokens. Compared with the only recorded agentic run (about 10.1M tokens, about 4.60 USD, S), that is two to three orders of magnitude fewer tokens. A selection eval costs more (many calls) and gets its own budget.
- External-agent route (no platform spend, no key in the platform): Ville can ask any agent session he already pays for to produce a `ProposalSet` against the published schema, then feed it with `--proposals file.json`. The platform never learns the key.

---

## 10. Staged adoption plan

Sizes as in the sibling document: S under about 1 day with fixtures and tests; M 2 to 4 days; L a week or more or needs a core change plus a decision.

| Stage | Content | Size | Flag | Exit criterion |
|---|---|---|---|---|
| 0 | Deterministic hardening independent of any LLM: description hygiene filter on spec-derived text; emit annotations (read-only hint), `outputSchema`/`structuredContent`; deterministic tool order; confirm FastMCP pin (>= the fixed version for CVE-2026-32871, 3.2.0) | M | none (`MCP_GENERATOR`) | invariant tests; golden outputs updated; scorer unchanged or better |
| 1 | `ProposalSet` schema, validator (gates 1 to 5), deterministic apply, fingerprint check, `descriptions.lock`, `--proposals` input to the CLI; human-authored sample file; adversarial fixtures | M | none (data input only, no model) | byte-identical output for same input plus file; adversarial proposals rejected; works fully offline |
| 2 | Evaluation script: baseline versus proposals through the scorer, outer K aggregation reusing the harness majority/tie rule, gate 6 as exit code | M | none | script runs on fake and generator subjects in CI; documents that real-server cells stay `PENDING_HUMAN` until Ville runs them |
| 3 | Provider module (OpenAI-compatible adapter), budget accounting, confirmation step, fake provider for tests, key-handling invariant test | M | `MCP_GENERATOR_LLM` | no network or key access outside the module (test); budget cap abort test; local endpoint documented |
| 4 | Prompts and first study for names and descriptions (rank 1 and 2): run protocol of section 8 with a local model; description lint; write findings | M | `MCP_GENERATOR_LLM` | decision recorded: keep, tune or drop; rejection rate and stability numbers |
| 5 | Derived-tool and projection proposals (rank 3), extend `DerivedTool.origin` with `'proposed'`; tests against `derived_filter` and `projection` | M | `MCP_GENERATOR_LLM` | no regression on the scorer; at least one case where proposal beats structural detection, else drop |
| 6 | Docs-only inputs: LLM drafts OpenAPI/SourceModel with verbatim-quote grounding; marked draft; human review required; add grounding fixtures to T3-RT-DOCS | L | `MCP_GENERATOR_LLM` | grounding check rejects fabricated routes in adversarial fixtures; needs Ville's decision on product scope |
| 7 | Optional selection eval with an agent client (costly), report steps and regressions | L | separate opt-in and budget | only if Ville wants evidence that descriptions help, not just that nothing regressed |
| 8 | Agentic lane (not integrated): documentation of how to benchmark any externally produced server via `cmd:` and the same report format | S | none | doc only |

Stages 0 to 2 deliver value without any model, and make a later LLM layer safe to add. Stop after stage 4 if the numbers do not justify the rest.

---

## 11. Don't hand-roll and pitfalls

Don't hand-roll:

| Problem | Use instead |
|---|---|
| JSON schema validation of the ProposalSet | zod, already used for `ReportSchema`; strict mode |
| Provider SDK sprawl | one OpenAI-compatible HTTP adapter over `fetch`, base URL from env; do not add per-vendor SDKs |
| Majority/tie-break for repeated runs | the existing harness function (ties go to FAIL) |
| Token counting | the platform's bytes/4 approximation for the pre-check, provider-reported usage for accounting |
| Secret redaction | the existing credential scanner and report redaction |

Pitfalls:

1. Treating temperature 0 or a seed as determinism. Freeze the output; replay it.
2. Letting a rename break scorer tool binding (hint regex; ambiguity is a scorer ERROR). Gate 6 catches it; keep names stable where the binding hint matches.
3. Fixing descriptions with long text: published results show more steps and 16.67 percent regressions; cap length, omit examples.
4. Descriptions that overstate (claim filtering the server lacks, wrong clamp number). Grounding gate must compare numbers with `limits`.
5. Putting the key in a repo file, the generation report or a `.mcp.json` snippet. Env only, placeholders only.
6. Prompts that include real catalogs or row data. Inputs are headers and specs only (existing invariant).
7. Using the leak-word pitfall in proposal text: a description containing 3 of timestamp, status, error and path is harmless at listing time, but the scorer's leak detector scans outputs; descriptions are not outputs, yet keep error-shape keys unchanged (`ok/kind/message/hint`).
8. Calling a hosted API from CI or from a web route.
9. Assuming the vendor and blog claims in section 2.3 (MCPForge validation engine, Tool Factory) are verified. They are not.

---

## 12. Open questions for Ville

1. Is an LLM layer wanted at all? D-159 says deterministic only; this document argues for a data-only proposal layer behind a second flag. The decision is yours, and stages 0 to 2 are useful either way.
2. Which model options are acceptable: local only (Ollama/vLLM class, no cost), or also one hosted API behind an explicit opt-in? If hosted, which provider and what per-run and monthly cap?
3. Should the external-agent route (you produce the `ProposalSet` in your own agent session, platform consumes the file) be the only supported LLM path, with no model call inside the platform?
4. Is a human review gate before publishing a hard requirement (recommended), and who reviews: the author submitting the spec, or a platform admin?
5. Product scope: should generated or proposal-assisted servers be hostable (Phase 8 runtime), or only downloaded? That changes how strict the supply-chain and description-lock rules must be.
6. Do you want a selection eval (stage 7) with an agent client? It is the only way to show that better descriptions help; it costs tokens and needs a key.
7. For docs-only inputs, is "LLM drafts an OpenAPI, human reviews, deterministic compiler builds" acceptable, or must docs-only stay unsupported?
8. Provenance of the study's agentic arm: I could not find a paper or repository for it by search. Can the study author supply it so the comparison is attributable?
9. AutoMCP: the synthesis and the paper disagree on whether it repairs specs automatically (paper says manual spec fixes). Worth a one-line correction in the synthesis.
10. The unfinished "combined" arm of the study (deterministic backbone plus agent layer): was a score ever produced? It is the closest prior art for this proposal.

---

## 13. Validation architecture (for the planner)

| Property | Value |
|---|---|
| Framework | the existing TypeScript test runner used for `src/lib/mcpgen` and `src/lib/mcptest` (check `package.json`; not re-verified here) |
| Quick run | the existing mcpgen test file glob plus `src/lib/mcptest/criteria.test.ts` |
| Phase gate | full suite green, plus the Phase 15 scorer on baseline versus proposals using fake and generator subjects |

| Requirement (proposed) | Behaviour | Test type |
|---|---|---|
| P-1 | Same input plus same `ProposalSet` gives byte-identical package | unit (golden) |
| P-2 | Stale fingerprint, unknown field, bad name, oversize string, injection-like text, ungrounded field, write-capable claim are all rejected with a gap | unit with adversarial fixtures |
| P-3 | Library imports no provider module; key variable is read only in the provider module; no network in `src/lib/mcpgen` | invariant test |
| P-4 | Layer unreachable with `MCP_GENERATOR_LLM` unset; web route never calls a model | unit and route test |
| P-5 | Budget cap aborts and writes nothing; key never appears in any output or error | unit with fake provider |
| P-6 | Gate 6: proposal-applied package never scores below baseline on fake subjects; any blocker flag fails | integration (scorer) |
| P-7 | Wording scan: this document and new docs avoid the reserved study-specific tokens | existing invariant scan |

Wave 0 gaps: `ProposalSet` zod schema, adversarial fixtures, fake provider, outer-K aggregation helper. Real-model runs and real FastMCP execution remain pending human.

---

## 14. Sources

Primary (fetched, HIGH for what they state):
- MCP tools spec, revision 2026-07-28: https://modelcontextprotocol.io/specification/latest/server/tools
- FastMCP OpenAPI integration docs: https://gofastmcp.com/integrations/openapi.md
- AutoMCP, arXiv 2507.16044: https://arxiv.org/abs/2507.16044v3
- Code2MCP, arXiv 2509.05941v4: https://arxiv.org/html/2509.05941v4
- Description smells, arXiv 2602.14878: https://arxiv.org/html/2602.14878v1
- Docs to Descriptions, arXiv 2602.18914: https://arxiv.org/html/2602.18914v1
- MCP-Flow, arXiv 2510.24284: https://arxiv.org/abs/2510.24284
- Anthropic `mcp-builder` SKILL.md (model-summarised fetch): https://raw.githubusercontent.com/anthropics/skills/main/skills/mcp-builder/SKILL.md
- Repo documents: `RESEARCH-SYNTHESIS.md`, `docs/mcp-generator-design.md`, `docs/mcp-test-platform.md`, `docs/mcp-test-port-fidelity.md`, `14-INPUT-KINDS-RESEARCH.md`, `docs/agent-types.md`

Secondary (MEDIUM, search summaries):
- FastMCP CVE-2026-32871: https://osv.dev/vulnerability/CVE-2026-32871 , https://advisories.gitlab.com/pypi/fastmcp/CVE-2026-32871/
- MCP-Bench, arXiv 2508.20453: https://arxiv.org/pdf/2508.20453
- Tool poisoning: https://labs.cloudsecurityalliance.org/research/csa-research-note-mcp-tool-poisoning-ai-agent-exfiltration-2/ , https://policylayer.com/attacks/hidden-instructions-in-tool-descriptions , https://kayssel.substack.com/p/mcp-security-poisoning-the-tools
- Generator comparisons and vendor docs: https://zuplo.com/blog/mcp-server-generators-compared , https://www.stainless.com/docs/mcp/index.md , https://docs.inkeep.com/guides/mcp-servers/gram , https://speakeasy.com/blog/generate-mcp-from-openapi
- LLM nondeterminism: https://tianpan.co/blog/2026/06/30/temperature-zero-is-not-determinism , https://arxiv.org/pdf/2408.04667v5
- Structured output: https://www.glukhov.org/post/2025/09/llm-structured-output-with-ollama-in-python-and-go/ , https://arxiv.org/abs/2501.10868
- Annotations defaults (vendor docs): https://www.speakeasy.com/docs/mcp/build/gram-functions/tool-annotations

Tertiary / UNVERIFIED (LOW): the MCPForge and Mcp Tool Factory claims; ToolFactory and DADL details (DADL PDF could not be read); whether the study's agentic arm has a public paper; Anthropic having no seed parameter; exact annotation defaults in the 2026-07-28 schema; the Ollama `format` behaviour from Ollama's own docs.

## 15. Metadata

**Confidence breakdown**
- Landscape and paper numbers: MEDIUM-HIGH (three papers fetched; several tools only through listings).
- Study-based conclusions: MEDIUM (one API, few runs; causal reasons inferred).
- Recommended architecture and staging: MEDIUM (reasoned, not built or measured).
- Cost estimates: LOW-MEDIUM (order-of-magnitude reasoning only).

**Research date:** 2026-10-14. **Valid until:** about 30 days; the MCP spec, FastMCP and the preprints move fast.
