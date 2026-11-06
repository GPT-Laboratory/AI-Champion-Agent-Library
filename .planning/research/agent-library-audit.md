# Agent library audit: intended vs actual

Date: 2026-10-15. Read-only audit (no code, entries, branches or planning files changed; no model runs, no spend).
Scope: working branch `autonomous/overnight-improvements` and local branch `release/agents-2026-10` (tip `f9ef5d0`).
DDC = github.com/datadrivenconstruction/DDC_Skills_for_AI_Agents_in_Construction (MIT; the repo has 238 SKILL.md files, not 221).

## 0. One-screen summary

| Group | Intended | Actual |
|---|---|---|
| 1. The 12 slide agents, each built on its DDC skill | 12 agents, each based on a DDC skill/agent | 12 entries exist and all passed one rubric run, but **none is built on a DDC skill**. All 12 are own-design "text in, lookup table, verdict out" checkers. Their `attribution` says "ideas adapted from ..." and the mapping was chosen from names and descriptions, not from the skill bodies. 3 of the 12 carry MCP/LVI/Rakennustieto material (ETIM repair, Product sourcing, Carbon & EPD). |
| 2. Further DDC agents | any number | 4 (daily report cross-check, punch list closure, change-order consistency, safety observation classification). Same own-design pattern, "ideas adapted" attribution. None uses MCP or consortium data. |
| 3. Exactly one agent that uses the LVI-INFO MCP server | 1 | **0 agents use it.** 3 MCP-server entries are listed (stk-mcp, stk-catalog-mcp, lvi-info-mcp), visible only with `AGENT_KINDS` on (default off). Product sourcing (agent 5) was framed as the LVI/STK agent in the planning but cannot call the server: it takes a pasted synthetic catalog excerpt. |
| Release notes claim | | 25 agents by default (16 new + 9 older), 28 with `AGENT_KINDS` on. "Agents 13 to 16 are derived from public skills". "No consortium data was used". |

Root cause: the first prompt ranked "my MCP agents first, DDC second" and put the LVI-INFO catalog into the Sourcing stage name. Phases 24 and 26 therefore treated MCP servers and LVI/STK data as the data layer of the slide agents, and the planning, entries, gaps list and inventory carry that assumption. The DDC skills were treated as loose inspiration. Neither the "exactly one LVI-INFO agent" nor the "12 built on DDC skills" intent was built as stated.

Key facts the report rests on:
- DDC has no agent pipeline or stage grouping. It has no ETIM, D2, BMS, spooling or E-BOM/M-BOM skill. Only agents 2, 3, 4, 6, 8, 11 have a clear skill counterpart. Details in section 2.
- Most DDC skills are Python class dumps; only a few are prose guidance. "Building on a skill" therefore means taking its data model, field set and rules, not running it.

## 1. Inventory (28 listed files on each branch)

Both branches hold the same 28 entries (diff of `data/agents` listing: identical). The release branch differs in content only (wording edits, two internal docs removed). Kind = Oracle AgentSpec `agent` unless stated. "Visible" = listed with the default `AGENT_KINDS` off.

| Entry (slug) | Kind | Source | Created in | Visible by default |
|---|---|---|---|---|
| airo | agent | earlier (AIC seed) | pre-v1 | yes |
| demo-rfi-triage | agent | earlier demo (Try It Out demo) | Phase 7 | yes |
| electrical-panel-scheduler, energy-model-sync, hvac-load-calculator, mep-scope-planner, plumbing-fixture-unit-counter, rfi-triage-assistant, submittal-review-router | agent | earlier seed set (initial GSD-generated commit) | pre-Phase 1 | yes (7) |
| etim-classification-repair | agent | own design (attribution: DDC bim-classification-ai) | 25 | yes |
| qto-normalization | agent | own design (DDC ifc-qto-extraction) | 25 | yes |
| clash-prioritization | agent | own design (DDC clash-resolution-analyzer, bim-clash-detection) | 25 | yes |
| rfi-generation-from-findings | agent | own design (DDC rfi-management) | 25 | yes |
| product-sourcing-mbom | agent | own design (DDC material-procurement-tracker, specification-extractor) + MCP framing | 26 | yes |
| quote-comparison | agent | own design (DDC bid-analysis-comparator, oce-tendering) | 26 | yes |
| carbon-epd-enrichment | agent | own design (DDC embodied-carbon-esg, carbon-calculator) | 26 | yes |
| cut-sheet-qa | agent | own design (DDC submittal-tracker, specification-extractor) | 27 | yes |
| spooling-and-cutting | agent | own design (DDC prefab-optimization) | 27 | yes |
| d2-code-validation | agent | own design (DDC ids-checker, standards-compliance-checker) | 28 | yes |
| om-completeness | agent | own design (DDC project-closeout-checklist, as-built-tracker, warranty-tracker) | 28 | yes |
| bms-digital-twin | agent | own design (DDC digital-twin-sync, ontology-mapper) | 28 | yes |
| daily-report-cross-check | agent | own design (DDC daily-report-generator, n8n-daily-report) | 29 | yes |
| punch-list-closure-check | agent | own design (DDC punch-list-manager) | 29 | yes |
| change-order-consistency-check | agent | own design (DDC change-order-processor, change-order-manager) | 29 | yes |
| safety-observation-classification | agent | own design (DDC safety-inspection, safety-inspection-checklist) | 29 | yes |
| stk-mcp | mcp-server | my MCP (mcp-gen-comparison-2, gsd-only arm) | 24 | **no** (AGENT_KINDS) |
| stk-catalog-mcp | mcp-server | my MCP (mcp-gen-comparison-2, codex arm) | 24 | **no** |
| lvi-info-mcp | mcp-server | my MCP (mcp-gen-comparison, handauthored arm) | 24 | **no** |

Totals: 25 visible by default (9 older + 16 new), 28 with `AGENT_KINDS`. `data/agents/fixtures/` (3 test files) is excluded from ingest.
Other observations:
- Every new entry carries a `github_url` of the form `https://github.com/aic-consortium/<slug>`. The older seed entries use the same pattern, so it is a placeholder convention, but none of these repositories is verified to exist. This is a release-hygiene item (a public link to a repo that may not exist, under an organisation name).
- The MCP entries' `repo_url` points at the personal repo `villelaaksotuni/mcp-gen-comparison`.

## 2. The 12 slide agents

Mapping below is **provisional** (found by reading the DDC repo tree and the top candidates; Alok's links will replace it). "Uses MCP/consortium data" = any form: text excerpts, samples, catalog data, gap entries.

| # | Agent (built entry) | Built on now | DDC candidates (path under repo root) | Conf. | How the built agent differs from the skill | MCP / consortium material? | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | ETIM & classification repair (`etim-classification-repair`) | Own design; attribution to bim-classification-ai | 1. `1_DDC_Toolkit/BIM-Analysis/bim-classification-ai`; 2. `2_DDC_Book/2.2-Open-Data-Standards/ontology-mapper`; 3. `2_DDC_Book/2.6-Data-Quality-Validation/validation-rules-builder` | med (task) / low (ETIM: no ETIM anywhere in DDC) | Skill assigns UniFormat/MasterFormat/OmniClass codes with confidence from keyword and IFC-class rules (Python). Built agent repairs wrong/missing classes against a pasted synthetic `SYN-` class excerpt, flags, never invents codes. Different codelist, different task (repair vs assign). | **Yes (light):** gap line says LVI-INFO/stk-mcp class search is done by the engineer; G-009..G-012 in the gaps list. | Align with the skill (field set, confidence levels); strip the MCP lines. |
| 2 | QTO normalization (`qto-normalization`) | Own design; attribution to ifc-qto-extraction | 1. `2_DDC_Book/3.2-QTO-Auto-Estimates/bim-qto`; 2. `1_DDC_Toolkit/BIM-Analysis/ifc-qto-extraction`; 3. `5_DDC_Innovative/ifc-data-extraction` (avoid `cwicr-quantity-matcher`: CWICR licence) | high | Skills extract and group quantities (type, level, zone) from BIM/CAD exports via pandas and converters. Built agent normalises units/number formats on text rows and flags duplicates; no grouping report. | No | Align with the skill (add grouping dimensions); keep the normaliser. |
| 3 | Clash prioritization (`clash-prioritization`) | Own design; attribution to clash-resolution-analyzer, bim-clash-detection | 1. `2_DDC_Book/4.3-BIM-Validation-Pipeline/clash-resolution-analyzer`; 2. `1_DDC_Toolkit/BIM-Analysis/bim-clash-detection`; 3. `5_DDC_Innovative/clash-detection-analysis` | high (1) | Near-exact task match (Navisworks-style export in, priority/pattern/discipline out). Built agent uses its own P1-P3 + five-test rule and requires a `location_key` column that real exports do not have; the skill uses CRITICAL/HIGH/MEDIUM/LOW, pattern grouping, resolution type, responsible discipline. | No | Align with the skill's priority scale and field set; drop the invented preprocessing column if the skill's pattern grouping can replace it. |
| 4 | RFI generation (`rfi-generation-from-findings`) | Own design; attribution to rfi-management | 1. `1_DDC_Toolkit/Document-Control/rfi-management`; 2. `4_DDC_Curated/Document-Generation/email-construction` (own source licence); 3. `5_DDC_Innovative/document-classification-nlp` | high | Skill has an RFI schema, submission template (question, attachments, impact), routing, deadlines. Built agent drafts RFIs from a findings table using the RFI field set. Closest to the skill of all 12. | No | Keep; check field set against the skill when links arrive. |
| 5 | Product sourcing E-BOM to M-BOM (`product-sourcing-mbom`) | Own design; attribution to material-procurement-tracker, specification-extractor; **framed around stk-mcp/lvi-info-mcp** | 1. `1_DDC_Toolkit/Procurement/material-procurement-tracker`; 2. `1_DDC_Toolkit/Procurement/material-tracker`; 3. `2_DDC_Book/2.4-PDF-CAD-to-Data/specification-extractor` | low-med (no BOM-conversion skill in DDC; avoid `cwicr-material-procurement`) | Skills track requisitions/vendors/lead times and extract specs. Built agent matches E-BOM lines to a pasted catalog excerpt (exact attribute equality), valid only for ~6 lines x 6 rows. | **Yes (heavy):** entry names stk-mcp and lvi-info-mcp as the intended catalog source; sample modelled on an LVI/STK-style catalog (labelled synthetic); gaps G-030, G-031. | **Rebuild on the skill** once Alok's link arrives, with the MCP/LVI framing removed. The catalog-matching idea belongs to the separate LVI-INFO agent (section 4). |
| 6 | Quote comparison (`quote-comparison`) | Own design; attribution to bid-analysis-comparator, oce-tendering | 1. `1_DDC_Toolkit/Procurement/bid-analysis-comparator`; 2. `6_OpenConstructionERP/oce-tendering`; (avoid `cwicr-bid-analyzer`) | high | Skill scores bids, finds scope gaps, recommends a winner. Built agent deliberately does not score or recommend: flags basis differences, picks `lowest_comparable`. | No | Keep (deliberate difference documented); align flag vocabulary with the skill. |
| 7 | Carbon & EPD enrichment (`carbon-epd-enrichment`) | Own design; attribution to embodied-carbon-esg, carbon-calculator | 1. `1_DDC_Toolkit/Sustainability/carbon-calculator`; 2. `5_DDC_Innovative/embodied-carbon-esg`; 3. `1_DDC_Toolkit/BIM-Analysis/co2-carbon-footprint`, `2_DDC_Book/3.3-4D-BIM-CO2-Simulation/lifecycle-carbon-calculator` | med-high | Skill computes carbon = quantity x factor with a hard-coded factor table; EPD appears only as passing mentions. Built agent maps products to a pasted synthetic EPD excerpt and flags unit/expiry issues, **no calculation**. | **Yes (light):** names EPD Finland / Rakennustieto, EPD Norway, ECO Platform as intended connected sources; G-044. Rakennustieto is on your list of MCP data sources. | Align with the skill (factor lookup mode); remove the Rakennustieto-as-data-source framing or label it as a future option. |
| 8 | Cut-sheet QA (`cut-sheet-qa`) | Own design; attribution to submittal-tracker, specification-extractor | 1. `1_DDC_Toolkit/Document-Control/submittal-tracker`; 2. `2_DDC_Book/2.4-PDF-CAD-to-Data/specification-extractor`; 3. `1_DDC_Toolkit/Document-Control/as-built-documentation` | med | Skills track submittal status and parse spec sections. Built agent checks a cut sheet against requirement rows (eq/ge tests). The earlier `submittal-review-router` is a separate seed entry. | No | Keep; align with the spec-extractor field set. |
| 9 | Spooling & cutting (`spooling-and-cutting`) | Own design; attribution to prefab-optimization | 1. `5_DDC_Innovative/prefab-optimization`; (cutting-loss only in `cwicr-waste-calculator`: excluded) | low (nothing on pipe spools or cut lists; "spool/cutting/nesting" 0 matches) | Skill is about modules, factory scheduling, transport. Built agent groups pipe segments into spool and cut groups, no optimisation. | No | Keep as own design, pending Alok's link; likely no skill exists. |
| 10 | D2 code validation (`d2-code-validation`) | Own design; attribution to ids-checker, standards-compliance-checker; assumes D2 = Finnish building code part D2 | Depends on reading: (a) Finnish code D2: no DDC content, nearest `5_DDC_Innovative/energy-simulation`, `3_DDC_Insights/Safety-Quality/compliance-tracker`; (b) data/model validation: `2_DDC_Book/4.3-BIM-Validation-Pipeline/ids-checker`, `bim-validation-pipeline`, `2_DDC_Book/2.5-Data-Modeling-Standards/standards-compliance-checker`; (c) generic: `6_OpenConstructionERP/oce-validation-engine`, `validation-rules-builder` | low ("D2": 0 matches in DDC) | Skills validate model data against IDS/COBie/rule packs. Built agent checks a ventilation extract against **placeholder** requirement rows. | No (entry text names "Ville/Jussi" on the working branch; fixed on the release branch) | **Hold:** meaning of D2 is unconfirmed; rebuild after Alok's answer. |
| 11 | O&M completeness (`om-completeness`) | Own design; attribution to project-closeout-checklist, as-built-tracker, warranty-tracker | 1. `5_DDC_Innovative/as-built-documentation`; 2. `1_DDC_Toolkit/Project-Closeout/project-closeout-checklist`; 3. `1_DDC_Toolkit/Closeout/as-built-tracker`, `warranty-tracker` | high | Skill holds a handover document list per system and an O&M manual generator. Built agent checks a required-documents list against a delivered index. | No | Keep; align the required-documents list with the skill's HandoverDocument set. |
| 12 | BMS digital twin (`bms-digital-twin`) | Own design; attribution to digital-twin-sync, ontology-mapper | 1. `5_DDC_Innovative/digital-twin-sync`; 2. `5_DDC_Innovative/sensor-data-aggregator`; 3. `5_DDC_Innovative/energy-simulation` | low-med (no BMS content in DDC) | Skill binds BIM elements to IoT sensor streams and detects anomalies. Built agent maps a BMS point list to an asset list and proposes tags (no live data). | No | Align with the skill's sensor-to-element binding fields; keep otherwise. |

Summary of verdicts: keep 4 (RFI, quote comparison, cut-sheet QA, O&M), align 5 (ETIM, QTO, clash, carbon, BMS), rebuild 1 (Product sourcing), hold 2 (spooling, D2) pending Alok's links. "Keep" and "align" both preserve the one-step lookup design; the skills are Python classes, so alignment means adopting field sets and rules, not code.

## 3. The phase 29 DDC agents

| Agent | Skills (path) | Follows the skill? |
|---|---|---|
| daily-report-cross-check | `1_DDC_Toolkit/Field-Operations/daily-report-generator`; `3_DDC_Insights/Automation-Workflows/n8n-daily-report` | Loosely. Skill generates a PDF site report (workforce, weather, progress); agent reconciles report lines against a timesheet. Only the report fields and the timesheet source come from the skill. |
| punch-list-closure-check | `1_DDC_Toolkit/Field-Operations/punch-list-manager` (a duplicate exists under `1_DDC_Toolkit/Project-Closeout/`) | Loosely. Skill is a deficiency log with assignment, photos and a Telegram bot; closure rules and the overdue test are own design. |
| change-order-consistency-check | `1_DDC_Toolkit/Cost-Management/change-order-processor`; `4_DDC_Curated/Contract-Legal/change-order-manager` (third-party source licence) | Loosely. Skill logs cost, approval and schedule impact; agent compares a log to forms. |
| safety-observation-classification | `1_DDC_Toolkit/Field-Operations/safety-inspection`; `3_DDC_Insights/Safety-Quality/safety-inspection-checklist` | Loosely. Skill covers checklists, hazards, incident reporting; agent labels observations from a placeholder keyword table. The categories are own design. |

None uses MCP servers, STK/LVI/Prysmian/Rakennustieto data or consortium data (grep clean). Their sample files are labelled synthetic. They pass the "separate from MCP work" requirement; the only gap is the same as for the 12: they are ideas-adapted own designs rather than agents built on the skill.

## 4. LVI-INFO MCP

What is in the library: three `kind: mcp-server` entries (`lvi-info-mcp` = the hand-authored arm of the generation comparison, with 7 tools: lookup by LVI number, by product link, by GTIN, search, filter by ETIM class, supplier list, changed products; needs `LVI_API_BASE` and `LVI_API_KEY`; Python/FastMCP over stdio, calls the live LVI-INFO Read-API with httpx), `stk-mcp` (2 tools, local Excel, not public) and `stk-catalog-mcp` (5 tools, plain JSON-RPC, no tests). Five generated LVI-INFO variants are mentioned only as `variants` in the lvi-info-mcp entry. All three are hidden unless `AGENT_KINDS` is on. The `used_by_phases: [26]` and `stage: sourcing` fields tie them to Phase 26.

Does any agent use the LVI-INFO MCP server? **No.** `product-sourcing-mbom` and `etim-classification-repair` only say it cannot be called from the Try It Out container; both work on pasted synthetic excerpts.

Why it cannot work today: the Pi container sits on an internal network that reaches only the app's LLM proxy; the key never enters containers by design; Pi's tools are read/write/edit/grep/find/ls (no bash by default, no MCP client; the Pi README I could read does not mention MCP, so MCP support would come through Pi extensions, unverified).

Options for one working LVI-INFO agent (assessment only):

| # | Option | What it needs | Pros | Cons / risks |
|---|---|---|---|---|
| A | Keep pasted excerpts (today) | nothing | safe, deterministic, already works | not an MCP agent; excerpt is synthetic or hand-copied; not "using" the server |
| B | Host-side tool proxy: the app exposes a narrow endpoint per lease (like the LLM proxy) that calls the LVI-INFO MCP server/API; Pi calls it via a skill script or extension | new route + per-lease token, Pi extension or `bash` tool, rate/budget limits, network allow only to the app | key stays on the host; same trust model as the existing LLM proxy; real server used | most new code; enabling bash/extension in Pi widens the container surface; needs hardening and a hostile-output review |
| C | Run the MCP server inside the Pi container | image with Python+fastmcp, MCP client extension for Pi, egress to the LVI API, key in the container | simplest conceptually | breaks "keys never in containers" and the internal-network rule; larger image; hardest to secure |
| D | Sidecar container: server in its own container; egress only to the LVI API; the Pi container connects over the internal network (HTTP transport) | new compose service, HTTP transport for the server, per-job isolation story, a Pi MCP extension | key isolated from the Pi container; reusable by other agents | most moving parts; a shared sidecar must be per-lease or read-only; needs two containers per run on a 3.7 GB machine |
| E | Pre-fetch on the host: the app/harness calls the MCP tool(s) before the job, stages results as `input/` files; Pi only reads them | a pre-step in the job runner (tool call list from the entry), result size cap | no new container capability; keeps the one-step pattern; deterministic and cheap | the agent cannot make follow-up queries; the query plan must be fixed or model-planned outside the container |
| F | Run Pi on the host (no container) | none | trivial | loses isolation; contradicts the existing security model |

Recommendation for planning: E first (cheapest, safest, lets one agent genuinely use the server on real catalog data), B if multi-step queries are needed. Needs the key and live API access from the host (not tested here). Whether the LVI-INFO API terms allow showing results publicly is open.

## 5. Where MCP or consortium material ended up in the DDC agents and release

Entries and prompts (current branch; identical on the release branch unless noted):
- `data/agents/product-sourcing-mbom.yaml` lines 25, 32, 33: stk-mcp/lvi-info-mcp named as intended source; gaps about real LVI-INFO/STK data. `data/tryitout-prompts/product-sourcing-mbom/SKILL.md` ("Never claim to have queried a catalog or an MCP server") and `sample-ebom-catalog.txt` line 1 ("Not a real STK/LVI-INFO export"). The sample's catalog format imitates a Finnish product catalog.
- `data/agents/etim-classification-repair.yaml` line 31: LVI-INFO/stk-mcp class search by the engineer.
- `data/agents/carbon-epd-enrichment.yaml` line 25 and `SKILL.md` line 12: EPD Finland / Rakennustieto as the intended source.
- `data/agents/d2-code-validation.yaml` lines 27 and 35: "Ville/Jussi" (fixed in the release branch) and "consortium-confidential" statements on `d2-code-validation` and `spooling-and-cutting` (line 33).
- All 16 new entries and all 9 older: `github_url` `https://github.com/aic-consortium/<slug>` (placeholder, unverified).
Docs:
- `docs/consortium-agents-gaps.md` (internal, excluded from the release): G-003..G-008, G-010, G-030, G-031, G-044 and similar rows mix MCP servers into DDC-stage agents; it uses "Ville"/"Jussi" and "consortium" throughout.
- `docs/consortium-agents-inventory.md` (excluded from release): an MCP servers section; names stk/lvi servers beside the 12 agents.
- `docs/agent-entry-template.md`, `docs/third-party-notices.md`: reference the slide/consortium framing; third-party notices are fine.
Release branch:
- Contains the 16 DDC-based entries with the lines above, the three MCP entries, `docs/` without inventory and gaps, and RELEASE-NOTES (not in the tree) that list the three MCP entries in the 28-count, and describe the agents "by stage". README mentions the AIC consortium generically (was already there).
- Sweep result (`.planning/phases/30-*/release/SWEEP.md`) found no TUNI/company names, keys, exports. The sample files are labelled synthetic. This audit adds: the LVI/STK/Rakennustieto mentions above, and the placeholder GitHub URLs.
Confidential material: no consortium data, no real STK/LVI/Prysmian/Rakennustieto exports and no slide were found in the repo or the release branch. All mixing is conceptual (framing, gap entries, intended-source statements), not data.

## 6. Planning based on the wrong assumption

- `.planning/ROADMAP.md`, Phase 24 goal ("add Ville's own MCP agents ... as MCP-server kind entries") and Phase 26 goal ("Use Ville's MCP servers (stk-mcp etc.) for catalog data where applicable"; stage described as "LVI-INFO catalog stage"). Phase 29 goal ("Choose further DDC skills") is fine.
- `24-CONTEXT.md`: A-03/A-05/A-07 and the "Done when" line treating MCP entries as part of the agent work. `24-01`..`24-03` plans and summaries, `24-VERIFICATION.md`, B-004 in `.planning/AUTONOMOUS-BLOCKERS.md`.
- `25-CONTEXT.md` A-03 and `26-CONTEXT.md` A-02, A-07 (and the 26 plans/summaries): catalog data lookup via stk-mcp/LVI-INFO assumed as the intended source; agent 5 designed as the catalog agent. `28-CONTEXT.md` A-01 (D2 reading) is a separate unconfirmed assumption.
- Phase 24-29 `*-CONTEXT.md` "DDC building blocks" ranking: MCP agents first, DDC second (the first prompt's order); Phase 25 plans name DDC skills only as inspiration.
- `docs/consortium-agents-inventory.md` "MCP servers" section and the gaps list rows named in section 5; G-005/G-006 are open questions that exist only because of the mixing.
- STATE.md progress lines and `.planning/phases/30-*/release/RELEASE-NOTES.md`, `PR-DESCRIPTION.md`, `PENDING-HUMAN.md` count the MCP entries in the 28 and say the agents are "derived from" DDC skills for 13-16 only; no note that agents 1-12 are not built on skills.
- `.planning/phases/26-*/26-VERIFICATION.md` and `26-01-SUMMARY.md`: agent 5 counted with the MCP framing.

## 7. Counts

| Group | Intended | Actual |
|---|---|---|
| Slide agents (built on DDC skills) | 12 | 12 entries, 0 built on a skill; 6 have a clear skill counterpart (2, 3, 4, 6, 8, 11), 4 only a loose one (1, 5, 7, 12), 2 none (9, 10) |
| DDC extras | any | 4 (own design, ideas adapted) |
| LVI-INFO agent | exactly 1 | 0 (3 MCP-server entries, hidden by default) |
| Earlier entries (not in the three groups) | n/a | 9 (airo, demo-rfi-triage, 7 MEP/seed entries) |
| Release notes | | 25 / 28 (see above); say "16 new agents"; list MCP entries; note counted agents passed one rubric run each |

## 8. Fix plan (proposals only; not added to the roadmap)

Spend figures are OpenAI estimates at about $0.02 per live run (earlier runs cost $0.01-0.03), 2-3 runs per rebuilt or aligned agent. Planning and build effort is a separate Claude subagent cost of roughly 80-130k subagent tokens per agent; shown as effort.

| Step | Phase proposal | Type | Effort | Model spend |
|---|---|---|---|---|
| 1 | Confirm assumptions with you and Alok (D2 meaning, skill links, which agent is the LVI one) | blocker | you: minutes | $0 |
| 2 | **Decouple**: strip MCP/LVI/STK/Rakennustieto framing from the 16 DDC-agent entries, prompts, samples and gap rows; correct ROADMAP 24/26, contexts 24/25/26, inventory, gaps list, release notes; keep the MCP entries as a separate group; fix placeholder `github_url`s | rework | S (1 agent session) | $0 |
| 3 | **Skill alignment pass for 2, 3, 4, 6, 8, 11** (provisional mapping is already clear): adopt the skill's field set/rules in the entry and SKILL.md, rerun one live step each | align | M (6 agents' worth, can be one phase) | ~$0.4-0.7 |
| 4 | **Align 1, 5, 7, 12 and rebuild 5 on the skill** once Alok's links arrive; agent 5 loses the MCP framing | rebuild/align | M-L | ~$0.3-0.6 |
| 5 | **Hold items 9 and 10**: wait for Alok; if no skill exists, mark them "own design (no DDC counterpart)" in the entry and notes | hold / keep | S | $0, then ~$0.1 |
| 6 | **Rewrite attribution**: replace "ideas adapted" with an accurate statement per agent (adapted fields, deliberately different points), update `docs/third-party-notices.md`, add the skill path and commit hash | rework | S | $0 |
| 7 | **LVI-INFO agent**: decide the option (recommend E), pick one agent (a new one or agent 5 rebuilt as the LVI variant), implement, one live run with the real key | add | L (E) / XL (B, D) | ~$0.1-0.3 plus LVI API calls |
| 8 | **Further DDC agents** from the candidates list (any number) | add | S-M each | ~$0.05-0.1 each |
| 9 | Release rebuild: rerun release prep on the corrected set (release branch, notes with accurate counts, MCP entries only if wanted; phases 21-23 can be added in the same PR) | rework | M | $0 |
| 10 | Optional: make MCP entries visible by default or leave them off; decide `AGENT_KINDS` | decision | S | $0 |

Total live-run spend for steps 3-8 is roughly $1-2, well inside the remaining cap ($10 total, ~$1.09 used). Order: 1, 2, (3 and 5 in parallel with 4 when links arrive), 6, 7, 8, 9.

## 9. Open questions for you

1. Which agent should be "the one using LVI-INFO MCP": a new, separate agent or agent 5 rebuilt for it? (The slide's Sourcing stage is labelled LVI-INFO catalog, but you said the DDC agents are separate from MCP work.)
2. LVI-INFO access route for the agent: option E (host pre-fetch), B (proxy), D (sidecar)? Is live API access and the key allowed for demo runs, and may real LVI-INFO results appear in public outputs?
3. Should the three MCP-server entries stay in the library (hidden by default), be shown, or be removed from the release?
4. "Exactly one": does "one agent" include a possible follow-up (e.g. ETIM repair using LVI-INFO's `filter_by_etim_class`), or strictly one?
5. Are the earlier 9 entries part of the intended set, or should the release count only the new agents?
6. What does "D2" mean in agent 10?
7. Should rework keep the "own design, one-step lookup" style, or should agents literally use the skill's logic (Python)? (Those skills need code execution; the Try It Out container has no bash/pip by default.)
8. Placeholder `github_url` (`github.com/aic-consortium/<slug>`) on all entries: replace, remove or keep?
9. For the extras: any further DDC skills you or Alok want built, or are the four enough?

## 10. Matches Alok must confirm

Confirm or replace each provisional mapping (path, then my confidence):
1. `1_DDC_Toolkit/BIM-Analysis/bim-classification-ai` (med; no ETIM skill exists)
2. `2_DDC_Book/3.2-QTO-Auto-Estimates/bim-qto` or `1_DDC_Toolkit/BIM-Analysis/ifc-qto-extraction` (high)
3. `2_DDC_Book/4.3-BIM-Validation-Pipeline/clash-resolution-analyzer` (high)
4. `1_DDC_Toolkit/Document-Control/rfi-management` (high)
5. `1_DDC_Toolkit/Procurement/material-procurement-tracker` (low-med; no E-BOM/M-BOM skill)
6. `1_DDC_Toolkit/Procurement/bid-analysis-comparator` (high)
7. `1_DDC_Toolkit/Sustainability/carbon-calculator` or `5_DDC_Innovative/embodied-carbon-esg` (med-high; no EPD skill)
8. `1_DDC_Toolkit/Document-Control/submittal-tracker` (med)
9. `5_DDC_Innovative/prefab-optimization` (low; likely no match)
10. unknown: (a) none for Finnish D2; (b) `2_DDC_Book/4.3-BIM-Validation-Pipeline/ids-checker` if D2 means model/data validation
11. `5_DDC_Innovative/as-built-documentation` (high)
12. `5_DDC_Innovative/digital-twin-sync` (low-med; no BMS skill)
Licence notes: avoid the `cwicr-*` skills (CC BY-NC + commercial) and the book/PDF; `4_DDC_Curated/*` skills inherit third-party source licences.
