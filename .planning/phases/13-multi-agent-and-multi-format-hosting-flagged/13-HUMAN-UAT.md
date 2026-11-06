# Phase 13 Human UAT (pending)

## 13-06 System detail page (AGENT_KINDS=1)
Status: pending human (no browser available in the unattended run).
- Start with `AGENT_KINDS=1`, open a system agent at /agents/<slug> (needs an agent_kinds row with kind system and members).
- Expect: kind badge, "Members" section with topology, no Language Model line when n/a, no runnable Try It Out.
- Expect with the flag off: page identical to before.

## 13-07 Catalog kind badge and Type filter (AGENT_KINDS=1)
Status: pending human (no browser available in the unattended run).
- Start with `AGENT_KINDS=1` and at least one non-agent row in agent_kinds; open /catalog.
- Expect: non-agent cards show a kind badge; a "Type" select appears (only if more than one kind); choosing "system" sets `?kind=system` and filters, combining with search/category and pagination; "Clear filters" resets it; Model filter has no "n/a".
- `/catalog?kind=bogus` is ignored. With the flag off: catalog and filters look identical to before, no Type select.
