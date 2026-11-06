# Phase 23 human checks

Items that were changed but could not be verified in this run (no Podman, no real engine).

| Item | Finding | Status |
|---|---|---|
| `Containerfile` runtime stage now copies `src/lib/mcptest`, `src/lib/mcpgen` and `src/lib/spec/security.ts` next to the build. Build the image once (`podman build -t aic-agent-library -f Containerfile .`), start it, and check that an MCP test run through the container path no longer ends in `exec_failed: driver sources could not be read`. | CR-47, D-622 | not built, pending human |
| `Containerfile.mcp-test-runner` now installs `sax@1.6.1`. Build it and run the in-container pipeline on an OData EDMX XML file. The pip pins (`fastmcp`, `httpx`, `pyyaml`) are still ranges: decide the pins. | CR-58, D-622, D-630 | not built, pending human |
| `podman-compose.yml` hardening (loopback publish, cap_drop, read-only rootfs, `${XDG_RUNTIME_DIR:?...}`) was not changed. Decide which of the options fit the deployment. | CR-54, D-630 | pending human |
