---
phase: 22-proposal-layer-follow-ups
plan: 02
requirements: [CUST-02]
status: complete with limits (criterion 2 evidenced; sign-off pending human)
---

# 22-02 Summary: baseline vs proposal-assisted

- `mcp-propose-eval --reruns 3`: exit 0, no regression. Generator-side Tier 1 gate pass in both, pass rate 100 percent both, 0 blocker and 0 warning flags, zero per-check deltas, verdict INCOMPLETE (normal for generator subjects).
- `mcp-test --allow-local-exec --reruns 2` with a throwaway python 3.12 venv (fastmcp 3.4.8, httpx; pip had network): both packages ran and are DISQUALIFIED at Tier 1, with no headline score. The cause is the scorer mock serving the suite's own catalogue, not the Acme spec, so most data checks fail identically for both. Check pass counts 18/51 baseline vs 20/51 proposed come from two differences only: the hidden feature filter (FAIL either way, "no tool" vs "missing ids") and a description containing the word "category" that makes the suite's `category` regex hint bind a tool (accident, not quality). No binding ERROR; renamed tools bound via `mcptest-binding.json`.
- Honest reading: shows no regression and that renames survive binding; does not show the proposal is better, does not test the composite, and does not measure agent tool selection. Details in `22-COMPARISON.md`.
- Spend 0 USD; spend log untouched. Venv, packages, pack and result files deleted from the scratchpad. `22-HUMAN-UAT.md` item 2 updated with exact re-run commands, left unchecked. Scorer not modified.
