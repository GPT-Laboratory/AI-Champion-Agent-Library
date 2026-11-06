---
phase: 22-proposal-layer-follow-ups
plan: 03
requirements: [CUST-02]
status: complete
---

# 22-03 Summary: hygiene tuning

Tuned only the false positive found in 22-01-FINDINGS.md: a negated read-only statement ("Does not delete or change any data") was blocked as `text-write-claim`. `proposals/hygiene.ts` now uses `hasWriteClaim`: a write verb directly negated in its clause (negation, then only write verbs, "or", "nor", "ever") is accepted, and "update(s)" as a data noun ("last update time", "update timestamp") is accepted. Decision D-609 with revert steps.

- New `proposals/hygiene.test.ts`: 8 accepted phrasings, 11 still-rejected claims (verb forms, "Does not delete, but updates rows", "Does not delete and updates rows", "Never fails and deletes rows", ...), limit claim both ways, and still-rejected cases for credential words (API key, password), a token-shaped string, an https link, a backtick and two injection phrases, plus a timing guard on adversarial input.
- Not changed: CREDENTIAL_WORD, scanForCredentials, URL, MARKUP, INJECTION, limit rule. The "not the API key" probe stays blocked by design.
- Docs: text rules paragraph states exact behaviour. `npx vitest run src/lib/mcpgen/proposals`: green, goldens unchanged, real proposal still accepted.
