# Deploy checklist

Ville opens the PR into the publishing repository; the publisher deploys. Variable names and commands are taken from `.env.example`, `podman-compose.yml`, `Containerfile` and `package.json`; details in `docs/deploy-runbook.md`.

## 1. Before merge (Ville)
- [ ] Read `SWEEP.md` (verdict CLEAN-WITH-NOTES) and answer its decisions: inventory/gaps docs excluded, personal repo URL in `stk-mcp` and `lvi-info-mcp` entries.
- [ ] Decide AGENT_KINDS: off gives 25 agents, on gives 28 (adds three MCP server entries; needs a re-ingest).
- [ ] Confirm the D2 reading (Finnish building code part D2) or correct the entry.
- [ ] Open the PR from `release/agents-2026-10`; do not include planning files.

## 2. Environment (publisher)
- [ ] `cp .env.example .env` and replace every `replace-with-...` placeholder. Keep `.env` out of git.
- [ ] `AUTH_ENABLED=true`, `AUTH_ALLOWED_EMAILS` (and optionally `AUTH_ALLOWED_EMAIL_DOMAINS`) set to real addresses; replace the example.org values.
- [ ] Mail: `BREVO_API_KEY`, `AUTH_EMAIL_FROM`, `AUTH_EMAIL_FROM_NAME`, or `SMTP_SERVER` and `SMTP_PORT`. (There is no separate session secret variable; sessions live in the auth database.)
- [ ] `ORIGIN` equals the public URL; `AUTH_COOKIE_SECURE=true` behind HTTPS.
- [ ] `OPENAI_API_KEY` set (needed for runnable Try It Out).
- [ ] `APP_INSTANCE_NAME` set to a stable, unique value (for example `aic-prod`).
- [ ] Leave unset: `MCP_GENERATOR`, `MCP_TESTER`, `MCP_TESTER_RUNTIME`, `TRYITOUT_USAGE_ENDPOINT`, `PI_RUNNER_ALLOW_OPEN_EGRESS`. Set `AGENT_KINDS=1` only if the decision above is yes.

## 3. Build
- [ ] Host: Node 22, rootless Podman with podman-compose, `systemctl --user enable --now podman.socket`.
- [ ] Bare-metal builds only: `mkdir -p db` first (a fresh checkout has no `db/` and `npm run build` fails without it; the Containerfile already does this). Use `ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm ci`.
- [ ] Pi runner image: `podman build -t localhost/pi-runner:latest -f Containerfile.pi-runner .`
- [ ] App image: `podman-compose up -d --build`. The image build runs `drizzle-kit push`, `npm run ingest`, `npm run tryout:configure` and `vite build`, then a sanity SELECT.
- [ ] Offline build host: add `SEARCH_EMBEDDINGS=off` (keyword search only) or provide network for the model download.

## 4. Post-deploy checks
- [ ] `GET /health` returns 200 `{"status":"ok"}`.
- [ ] After sign-in, `/catalog` lists 25 agents (28 with AGENT_KINDS on).
- [ ] `/mcp-test` returns 404 and `POST /api/mcp-generate` returns 404.
- [ ] Sign in with an allowed address and a code e-mail arrives; a non-allowed address is refused.
- [ ] One Try It Out run on Demo RFI Triage completes (`sample-rfi.txt`); check logs for `Try It Out service failed to start`.
- [ ] `/api/tryitout/jobs/:id/usage` is not available (TRYITOUT_USAGE_ENDPOINT unset).
- [ ] Optional on the host: `npx tsx scripts/smoke-pi-runner.ts --proxy-host aic-agent-library`.

## 5. Rollback
- [ ] Features: unset flags and restart; `PI_RUNNER_ENABLED=false` for direct model calls only; `SEARCH_EMBEDDINGS=off` for keyword search.
- [ ] Code: revert the merge, rebuild, `podman-compose up -d --build`. `db/catalog.db` is rebuilt from `data/agents/`; back up the auth volume (`runtime/auth/auth.db`) before any change.

## Who does what
- Ville: answers the decisions, opens the PR.
- Publisher: sections 2 to 5.
