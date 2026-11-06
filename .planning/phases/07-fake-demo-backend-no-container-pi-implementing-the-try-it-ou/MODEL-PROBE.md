# MODEL-PROBE.md

Real, live probe output captured 2026-08-19 against the deployed `OPENAI_API_KEY`
via `npx tsx --env-file=.env scripts/probe-openai-model.ts`. This closes
RESEARCH.md Open Questions §1 with empirical evidence rather than a guess.

## models.list() candidate presence

```
gpt-4.1-mini: present
gpt-4.1: present
gpt-5-chat-latest: present
gpt-5(.x)-* fallback family (non -pro): gpt-5-2025-08-07, gpt-5-chat-latest, gpt-5-codex, gpt-5-mini, gpt-5-mini-2025-08-07, gpt-5-nano, gpt-5-nano-2025-08-07, gpt-5-search-api, gpt-5-search-api-2025-10-14, gpt-5.1-2025-11-13, gpt-5.1-chat-latest, gpt-5.1-codex, gpt-5.1-codex-max, gpt-5.1-codex-mini, gpt-5.2-2025-12-11, gpt-5.2-chat-latest, gpt-5.2-codex, gpt-5.3-chat-latest, gpt-5.3-codex, gpt-5.4-2026-03-05, gpt-5.4-mini, gpt-5.4-mini-2026-03-17, gpt-5.4-nano, gpt-5.4-nano-2026-03-17, gpt-5.5-2026-04-23, gpt-5.6-luna, gpt-5.6-sol, gpt-5.6-terra

chosen candidate: gpt-4.1-mini
```

`gpt-4.1-mini` is present in the live `client.models.list()` response for this
deployed key. This resolves the contradiction RESEARCH.md flagged between the
live-fetched official pricing page (listed it as active) and third-party
migration-guide blogs (claimed it 404'd in mid-February 2026) — for THIS key,
`gpt-4.1-mini` is reachable today.

## temperature probe result

```
TEMPERATURE_ACCEPTED
```

A real `client.responses.create({ model: 'gpt-4.1-mini', temperature: 0.2, input: 'ping', max_output_tokens: 16 })` call succeeded — no retry-without-temperature was needed.

## Decision

```
CHOSEN_MODEL=gpt-4.1-mini
TEMPERATURE_SUPPORTED=true
```

- **MODEL:** `gpt-4.1-mini`
- **TEMPERATURE:** `0.2`
- **Rationale:** Took the primary-recommendation branch of RESEARCH.md Open Questions §1 — `gpt-4.1-mini` was confirmed present in `models.list()` for the deployed key, so it is used with `temperature: 0.2` as D-07 intends, rather than falling back to the `gpt-5.6-*` family (which RESEARCH.md's cross-corroborated forum/bug-tracker evidence says rejects any non-default `temperature`). No fallback branch was needed; D-07's "fixed low temperature" requirement is met exactly, not best-effort.

## Task 4 checkpoint resolution (D-07 costly-reversibility lock)

**User decision:** `accept-probe`

The user confirmed `CHOSEN_MODEL=gpt-4.1-mini` and `TEMPERATURE_SUPPORTED=true` (both quoted literally from the "Decision" block above) as the single fixed `MODEL`/`TEMPERATURE` pair for all runnable demo agents (D-07). No override and no D-07 revisit was selected. `src/lib/server/tryItOutModel.ts` already encodes this choice exactly as probed — no code change was required to close this task.
