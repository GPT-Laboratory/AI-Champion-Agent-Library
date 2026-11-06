---
phase: 22-proposal-layer-follow-ups
plan: 01
requirements: [CUST-02]
status: complete (human review pending)
---

# 22-01 Summary: first real proposal

A Claude agent session exported a context pack for the synthetic Acme OpenAPI fixture, read only the pack (README-FOR-AGENT, FINGERPRINT, tool-inventory, examples, schema, source) and wrote `src/lib/mcpgen/proposals/real/acme-openapi.proposals.json`: 9 ops (rename_tool x2, describe_tool x2, describe_arg x2, set_arg_default page_size 10, hide_tool `filter_part_by_features`, composite_tool `find_part_details`), each with a reviewer-facing reason. merge_tools and split_tool were not used.

- Strict mode: ACCEPTED on the first validation, zero rejections, so there is no gate-3 friction from the real proposal. Details, plus 8 supplementary throwaway probes (2 correct blocks for instruction and limit claims, 1 borderline credential-word, 1 clear false positive: a negated "does not delete or change any data" is blocked as `text-write-claim`) are in `22-01-FINDINGS.md` as input for plan 03. The probes are synthetic, not proposal rejections.
- Two accuracy mistakes in my own first draft (composite "full record", an unverified "names and descriptions" match claim) were corrected by hand; no gate catches that class, so the reviewer must.
- `real/real.test.ts`: strict accept with zero rejected ops against the current fingerprint (clear message on fingerprint mismatch), determinism (same file twice byte-identical; reversed op order gives identical server.py, binding and requirements, only the provenance file hash differs, which is expected), no URL or credential-shaped text. `npx vitest run src/lib/mcpgen/proposals`: 134 tests green.
- `22-HUMAN-UAT.md`: review by Ville listed as pending, nothing ticked; gates and tests are the interim evidence.

Commits: first proposal and findings; regression test and UAT. No hygiene.ts change (plan 03). No .env read, no network or model call, pack kept in scratchpad and deleted.
