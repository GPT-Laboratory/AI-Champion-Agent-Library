# syntax=docker/dockerfile:1
#
# Podman/Docker build for the AIC Agent Library (SvelteKit + adapter-node).
#
# Build:  podman build -t aic-agent-library -f Containerfile .
# Run:    ./deploy.sh (loads runtime settings and verifies health)
#
# The catalog is baked into the image at build time: `npm run build` runs
# drizzle-kit push + the YAML ingest script against data/agents/ before the
# SvelteKit build, so db/catalog.db ships inside the image already populated.
# To pick up new/changed agent YAML files, rebuild the image.

ARG NODE_VERSION=22-bookworm-slim

# ---- builder --------------------------------------------------------------
FROM node:${NODE_VERSION} AS builder
WORKDIR /app

# python3/make/g++ back node-gyp in case better-sqlite3's prebuilt binary
# download is unreachable from this network (falls back to compiling).
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm ci

COPY . .
# Embedding model cache lives under db/ so the COPY of /app/db below carries it
# into the runtime image. If the builder has no network, ingest warns and the
# image runs BM25-only search (by design).
ENV HF_CACHE_DIR=/app/db/models
# The database directory is excluded from the build context. Create it before
# running Drizzle; drizzle-kit currently reports a missing directory without a
# failing exit code, so the final query also guards against an empty database.
RUN mkdir -p db \
    && npx --no-install drizzle-kit push --force \
    && npm run ingest \
    && npm run tryout:configure \
    && npx --no-install vite build \
    && node --input-type=module -e \
      "import Database from 'better-sqlite3'; const db = new Database('./db/catalog.db', { readonly: true }); db.prepare('SELECT 1 FROM agents LIMIT 1').get(); db.close()"

# @sveltejs/kit and svelte are real runtime dependencies of the built
# server (adapter-node externalizes them rather than bundling), so they
# live in "dependencies" in package.json. Everything left in
# devDependencies (vite's CLI, drizzle-kit, tsx, tailwindcss, vitest, ...)
# is build-only tooling — prune it before it ships in the runtime image.
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund --offline

# ---- runtime ----------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    CATALOG_DB_PATH=/app/db/catalog.db \
    HF_CACHE_DIR=/app/db/models \
    AUTH_DB_PATH=/app/runtime/auth/auth.db \
    TRYITOUT_WORK_DIR=/app/runtime/tryitout-work \
    TRYITOUT_PROMPTS_DIR=/app/data/tryitout-prompts \
    PI_RUNNER_SOCKET=/run/podman/podman.sock

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/build ./build
COPY --from=builder /app/db ./db
COPY --from=builder /app/data/tryitout-prompts ./data/tryitout-prompts
COPY --from=builder /app/package.json ./package.json
# The MCP test runner stages the driver sources into its container (src/lib/server/mcptest/containerRun.ts reads them
# from the working directory); without these three the feature fails with "driver sources could not be read".
COPY --from=builder /app/src/lib/mcptest ./src/lib/mcptest
COPY --from=builder /app/src/lib/mcpgen ./src/lib/mcpgen
COPY --from=builder /app/src/lib/spec/security.ts ./src/lib/spec/security.ts
RUN mkdir -p /app/runtime/tryitout-work /app/runtime/auth \
    && chown -R node:node /app

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "build"]
