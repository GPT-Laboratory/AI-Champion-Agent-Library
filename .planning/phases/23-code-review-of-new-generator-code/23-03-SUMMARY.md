# 23-03 Summary: security audit

Verdict in 23-SECURITY.md: SECURED (15 threats mitigated with tests, 1 found and fixed, 5 accepted, 0 open).

- Real threat found and fixed: T-23-06a, writes through a symlinked subdirectory with `--force` and `--write-packages` (low). Failing-first tests, commit 10e0814, D-632.
- Tests added: `src/lib/mcpgen/security.hardening.test.ts` (20 tests: AST audit of emitted Python over 12 hostile inputs, hostile proposal files, sax amplification, binding file, emitted SQL and OData servers run with hostile arguments, container request and path refusals) and `scripts/generate-mcp.security.test.ts` (6 tests on a real file system). Commit 029b08f.
- No other source change was needed: sax limits, proposal gates, pack reader, binding loader and emitter quoting held against every probe.
- Accepted risks A1 to A5 are in D-633. Only A5 (compose file mounts the Podman socket, CR-54) needs Ville, see 23-HUMAN-UAT.md.
- `npx vitest run src/lib/mcpgen src/lib/mcptest scripts`: 130 files, 1946 tests passed.
