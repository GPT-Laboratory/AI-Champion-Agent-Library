# 31-01 Summary: strip MCP framing, exact attribution, real URLs

Status: done (full `npm run check` recorded in 31-VERIFICATION.md; run once at the end of the phase per the one-heavy-process rule).

## Changed
- Entries (wording only, no verdict logic): product-sourcing-mbom (stk-mcp/lvi-info-mcp source and LVI/STK gap lines removed), etim-classification-repair (class-search gap line), carbon-epd-enrichment (Rakennustieto/EPD Finland replaced by "public EPD registers", EPD Norway and ECO Platform kept as generic examples), d2-code-validation and spooling-and-cutting ("Ville/Jussi", "consortium-confidential" removed).
- Prompts/samples: product-sourcing-mbom SKILL.md (no MCP wording; "Do not claim to have queried any catalog"), sample-ebom-catalog.txt line 1 (generic labelled synthetic; the layout was already generic with SYN- ids), carbon-epd-enrichment SKILL.md.
- Attribution: all 16 DDC entries carry an exact skill path. Agents 9 and 10: "No DDC basis (own design)", D2 = Finnish building code part D2 stays visible in 10. Agent 5: inspired by cwicr-material-procurement, method only, no CWICR data. Agent 2: qto-report primary, method only, no book text.
- github_url: DDC-based agents point to https://github.com/datadrivenconstruction/DDC_Skills_for_AI_Agents_in_Construction/tree/main/<primary path>; agents 9, 10 and the older entries with a github_url (airo + 7 seed entries) and the test fixture point to https://github.com/mikauran/AI-Champion-Agent-Library (origin remote). demo-rfi-triage has no github_url (pre-existing, "partial" in validate-submission, unchanged).
- Docs: docs/third-party-notices.md (table slug -> exact paths -> relation), docs/agent-entry-template.md, docs/templates/agent-entry.template.yaml, README.md clone URL, golden flag-off.json regenerated.

## Evidence
validate-entries: 25 entries, 0 errors. validate-submission accepts the new URLs (24 ingestible; demo-rfi-triage partial as before). vitest spec/validate/criteria: 290 passed. MCP entry directories untouched.

## Deviation
The plan's verify grep (case-insensitive "LVI") matches "resolving" in the carbon-epd-enrichment SKILL.md answer-key sentence. The sentence is left unchanged; the gate script in 31-02 uses word-boundary matching.
