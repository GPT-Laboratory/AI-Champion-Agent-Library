# Try It Out live run (real model, Pi container)

Procedure for one real-model run through the app's job API and the Pi runner container, driven by `scripts/tryout-run.ts`. Env var names only; never put or print key values. The OpenAI key stays in `.env` and reaches the app through compose `env_file`.

## 1. Purpose and limits

- Real model (`gpt-4.1-mini`), real container runner, one run at a time.
- Spend cap through the ledger `.planning/spend-log.md`: 10 USD total, the harness refuses (exit 3) when ledger total + 0.50 reserve would exceed it. Costs are an upper bound (all tokens at the output rate); the OpenAI dashboard is ground truth.
- Per-job limits: `PI_JOB_TOKEN_BUDGET=100000`, `PI_JOB_REQUEST_BUDGET=40`.
- Do not run podman while `npm run check` or `vite build` runs (about 3.8 GB RAM). Check `free -m` first.
- Synthetic or public input only. Output is a draft for engineer review.

## 2. Option A (preferred): compose stack, internal network, dedicated image tag

The usage endpoint (`TRYITOUT_USAGE_ENDPOINT=1`) is compiled into the app image, so the image must be built from the current checkout. Use a separate tag so the original image is untouched.

Pre-flight:

```bash
free -m                                   # >= 1 GB available
systemctl --user enable --now podman.socket
podman images | grep -E 'pi-runner|aic-agent-library'
podman network ls | grep aic-pi-internal
npx tsx scripts/smoke-pi-runner.ts
```

Refresh the host catalog (compose runs the app; do not start vite dev):

```bash
npm run db:push && npm run ingest && npm run tryout:configure
```

Build the image once (re-run after code changes; takes several minutes; nothing else heavy at the same time):

```bash
podman build -t localhost/aic-agent-library:tryitout -f Containerfile .
```

`override.tryitout.yml` (gitignored) sets the image tag, the flags and bind-mounts the fresh catalog and prompts so new agents work without a rebuild:

```yaml
services:
  aic-agent-library:
    image: localhost/aic-agent-library:tryitout
    environment:
      AUTH_ENABLED: "false"
      PI_JOB_TOKEN_BUDGET: "100000"
      PI_JOB_REQUEST_BUDGET: "40"
      TRYITOUT_USAGE_ENDPOINT: "1"
      ORIGIN: "http://localhost:3000"
    volumes:
      - ./db/catalog.db:/app/db/catalog.db:ro,Z
      - ./data/tryitout-prompts:/app/data/tryitout-prompts:ro,Z
```

Network settings stay as in `podman-compose.yml` (`PI_RUNNER_NETWORK=aic-pi-internal`, proxy `http://aic-agent-library:3000/api/llm/v1` via the network alias). If the read-only single-file catalog mount fails (WAL/journal files), mount the `./db` directory instead.

Start (never `--build`; the image is built above):

```bash
podman-compose -f podman-compose.yml -f override.tryitout.yml up -d --no-build
until curl -s -o /dev/null http://127.0.0.1:3000/; do sleep 1; done
npx tsx scripts/smoke-pi-runner.ts --proxy-host aic-agent-library   # optional
```

Run:

```bash
npx tsx scripts/tryout-run.ts --plan 25-01 --agent demo-rfi-triage \
  --task "Triage the attached RFI" \
  --file data/tryitout-prompts/demo-rfi-triage/sample-rfi.txt \
  --label synthetic --base-url http://127.0.0.1:3000 --origin http://localhost:3000
```

The harness prints one JSON evidence line on stdout (job id, model, tokens, requests, estimated cost, `countable`, first output lines) and logs the run to the ledger. Artifacts land in `.tryitout-runs/<jobId>/` (gitignored). Exit codes: 0 ok, 1 job failed, 2 usage, 3 budget refusal, 4 timeout, 5 transport error.

Teardown:

```bash
podman-compose -f podman-compose.yml -f override.tryitout.yml down
podman ps -a --filter label=aic.tryitout    # must be empty; remove stragglers with podman rm -f <id>
```

Networks stay (harmless).

## 3. Option B (fallback, dev only, weaker isolation)

App on the host, container reaches it through the host gateway:

```bash
PI_RUNNER_NETWORK=podman PI_RUNNER_ALLOW_OPEN_EGRESS=true \
PI_LLM_PROXY_URL=http://host.containers.internal:5173/api/llm/v1 \
PI_JOB_TOKEN_BUDGET=100000 PI_JOB_REQUEST_BUDGET=40 TRYITOUT_USAGE_ENDPOINT=1 AUTH_ENABLED=false \
node --env-file=.env ./node_modules/.bin/vite dev --host 0.0.0.0 --port 5173
```

The container can then reach the internet; acceptable only because the input is synthetic and the container holds only a per-lease token. Listen on 0.0.0.0 only on this dev machine and stop vite afterwards. Use B only when A cannot be made to work, and record which option produced each piece of evidence.

## 4. Evidence checklist (copy into the plan's VERIFICATION)

Job id, model, total tokens, requests, estimated cost, input label (public/synthetic), output excerpt, "draft for engineer review" caveat, ledger row present. Optional once per phase: `podman inspect` of a runner container as in `docs/human-verification-guide.md` section 8 step 3.

## 5. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| 403 on POST | Origin header differs from app `ORIGIN` (compose default `http://localhost:3000`, while the base URL is 127.0.0.1); pass `--origin http://localhost:3000` |
| 429 on POST | Anonymous session cap (5 per client per 10 min); wait or restart the app |
| `unknown agent` | Catalog not refreshed or `db/catalog.db` not mounted |
| `missing skill file` | `data/tryitout-prompts` not mounted or no SKILL.md for the slug |
| Proxy 429 `job token budget exceeded` | Raise `PI_JOB_TOKEN_BUDGET` or shorten the input |
| No Pi tool lines in events, usage 404 | Fell back to the direct model call; the run is NOT countable |
| Usage 404 but Pi ran | Image built before the usage route, or `TRYITOUT_USAGE_ENDPOINT` not set; rebuild the tagged image |

## 6. Smoke test with an LLM judge (ifc-ebom-compiler)

`scripts/smoke.ifc-ebom-compiler.ts` checks one live run of the agent on its Try It Out example (`data/tryitout-prompts/ifc-ebom-compiler/example.yaml`: task, sample file, answer key). It uses the app as in Option A or B, and the harness above for the run (budget guard, ledger).

1. **Gate 1, deterministic (no model):** `ebom-join` contract and cell comparison, then the review items, the rules not tied to data, the Totals line and the closing line against the helper and the answer key.
2. **Gate 2, LLM judge:** a second model call grades only what free text can get wrong: no arithmetic of its own, nothing beyond the required sections, no claim of being final, input treated as data. Every fail must quote the output. A quote that is not in the output is reported as a judge error.

The judge needs `OPENAI_API_KEY` in the shell (and `OPENAI_BASE_URL` for Azure OpenAI v1). Each judge call gets its own ledger row.

```bash
# Before trusting a judge model: it must pass the answer key and fail four hand-made bad outputs (5 judge calls).
npx tsx --env-file=.env scripts/smoke.ifc-ebom-compiler.ts --calibrate --judge-model <model>

# One run on the example, then both gates. --case injection hides an instruction in one element's type_name.
npx tsx --env-file=.env scripts/smoke.ifc-ebom-compiler.ts --judge-model <model> [--case injection]

# Check an output you already have (e.g. downloaded from Try It Out); --no-judge = gate 1 only, no key, no cost.
npx tsx scripts/smoke.ifc-ebom-compiler.ts --result path/to/result.md --no-judge
```

The default judge model is `JUDGE_MODEL`, else the agent's own model (`gpt-4.1-mini`); a model judging its own output is weak evidence, so prefer a different, stronger one. Use `--judge-temperature none` for models that reject a temperature. A run writes `smoke-report.json` next to the artifact in `.tryitout-runs/<jobId>/`. Exit codes: 0 pass, 1 a check failed, 2 usage or no key, 3 budget refusal, 5 run or API error. The offline tests (`scripts/smoke.ifc-ebom-compiler.test.ts`, in `npm test`) use a fake judge and a fake run.
