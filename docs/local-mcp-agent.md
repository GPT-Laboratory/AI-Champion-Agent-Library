# Local MCP agent (LVI-INFO)

Internal. Local only. Not part of the public release.

## 1. What this is

One agent, `lvi-info-product-match`, that makes real calls to a locally running LVI-INFO MCP server through an app-side proxy and drafts a product-match table for an input list (draft for engineer review; no purchasing decisions). It uses the LVI-INFO MCP server (local only; not available in the public release). Three shelved MCP-server catalog entries (`stk-mcp`, `stk-catalog-mcp`, `lvi-info-mcp`) belong to the same local surface. The DDC agents contain nothing from this work.

## 2. The flag

`LOCAL_MCP_AGENTS` (default off; truthy values 1, true, on, yes, like every other flag).

- On: ingest also reads `data/agents-local/` (the three `mcp-server` entries additionally need `AGENT_KINDS=on`, as before), the route `/api/local-mcp/v1/tools/<name>` is live and its prefix is public in the auth hook (the route does its own bearer check), the staged Pi tool exists for the local agent.
- Off: none of that exists. The route answers 404 as an unmatched route, the hook does not know the prefix, ingest does not read `data/agents-local/` and deletes the rows of the local slugs (`src/lib/localMcp/slugs.ts`) from `agents`, `agent_kinds` and `agent_embeddings`. Ingest output is byte-identical to the state before the flag existed (`scripts/flag-off.golden.test.ts`).

## 3. Layout

Everything below is removed from the release branch by Phase 38:

- `src/lib/localMcp/slugs.ts`
- `data/agents-local/`
- `data/tryitout-prompts-local/`
- `src/lib/server/localMcp/`
- `src/routes/api/local-mcp/`
- `docs/local-mcp-agent.md`

## 4. Route decision

App-side MCP proxy (per-lease token, per-job budget, allow-list, size caps) instead of a sidecar; the Pi side uses a staged extension with plain tools. The network guard, compose file and Containerfile are unchanged. See D-635, D-636 and D-637 in `.planning/AUTONOMOUS-DECISIONS.md`.

## 5. How to run

TODO(36-04): mock mode and real mode commands.

## 6. Security notes

TODO(36-05).

## 7. Turning it off

Unset `LOCAL_MCP_AGENTS` and re-run `npm run ingest`; the purge removes the local rows. The route returns 404 again without a restart of anything else.
