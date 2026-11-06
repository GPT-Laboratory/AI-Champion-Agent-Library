# Phase 23 File Set

Baseline: d45f59b (Phase 14 review fixes merge; review 1f78305, fixes 5b8b31a). Source: `git diff --name-only d45f59b..HEAD`, non-test, non-golden, non-fixture. Line counts at HEAD.

Note: Pass E is split into E1 (emit/plan/hygiene, Phases 21-22) and E2 (container path, CLI, routes). Stray files placed in nearest pass: scripts/bench.ts, scripts/ingest.ts (E2), src/lib/mcpgen/proposals/testkit.ts (D), src/lib/mcptest/core/{types,redact}.ts, src/lib/server/mcptest/*, src/lib/server/tryitout/redact.ts (E2).

## Pass A

- src/lib/mcpgen/adapters/openapi.ts (787)
- src/lib/mcpgen/adapters/openapi-swagger2.ts (106)
- src/lib/mcpgen/adapters/index.ts (9)
- src/lib/mcpgen/registry.ts (110)
- src/lib/mcpgen/types.ts (159)

Total: 1171 lines

## Pass B

- src/lib/mcpgen/adapters/sql-common.ts (122)
- src/lib/mcpgen/adapters/sql-ddl.ts (458)
- src/lib/mcpgen/adapters/sql-dialect.ts (49)
- src/lib/mcpgen/adapters/sql-scan.ts (202)
- src/lib/mcpgen/adapters/prisma.ts (404)
- src/lib/mcpgen/sqlcopy.ts (56)

Total: 1291 lines

## Pass C

- src/lib/mcpgen/adapters/odata.ts (390)
- src/lib/mcpgen/adapters/odata-csdl.ts (352)
- src/lib/mcpgen/adapters/odata-xml.ts (126)
- src/lib/mcpgen/adapters/sax.d.ts (30)
- src/lib/mcpgen/emit/odata.ts (343)

Total: 1241 lines

## Pass D

- src/lib/mcpgen/proposals/apply.ts (180)
- src/lib/mcpgen/proposals/contextPack.ts (291)
- src/lib/mcpgen/proposals/examples.ts (260)
- src/lib/mcpgen/proposals/gates.ts (614)
- src/lib/mcpgen/proposals/hygiene.ts (84)
- src/lib/mcpgen/proposals/index.ts (168)
- src/lib/mcpgen/proposals/inventory.ts (77)
- src/lib/mcpgen/proposals/model.ts (72)
- src/lib/mcpgen/proposals/review.ts (92)
- src/lib/mcpgen/proposals/schema.ts (151)
- src/lib/mcpgen/proposals/selector.ts (59)
- src/lib/mcpgen/proposals/signature.ts (133)
- src/lib/mcpgen/emit/proposed.ts (408)
- src/lib/mcpgen/emit/pytestProposed.ts (166)
- src/lib/mcptest/proposalEval.ts (245)
- scripts/mcp-pack-io.ts (88)
- scripts/mcp-propose-eval.ts (143)
- src/lib/mcpgen/binding.ts (148)
- src/lib/mcptest/core/binding.ts (51)
- src/lib/mcptest/core/bindingSchema.ts (33)
- src/lib/mcptest/core/packageBinding.ts (19)

Total: 3482 lines

## Pass E

### E1 (emit/plan/hygiene, Phases 21-22)

- src/lib/mcpgen/plan.ts (669)
- src/lib/mcpgen/hygiene.ts (84)
- src/lib/mcpgen/emit/python.ts (505)
- src/lib/mcpgen/emit/runtime.ts (460)
- src/lib/mcpgen/emit/pytest.ts (490)
- src/lib/mcpgen/emit/pyutil.ts (87)
- src/lib/mcpgen/emit/requirements.ts (15)
- src/lib/mcpgen/generate.ts (139)
- src/lib/mcpgen/pipeline.ts (71)
- src/lib/mcpgen/limits.ts (75)
- src/lib/mcpgen/report.ts (69)
- src/lib/mcpgen/api-contract.ts (18)

Total: 2682 lines

### E2 (container path, CLI, routes)

- Containerfile.mcp-test-runner (54)
- podman-compose.yml (57)
- src/lib/mcptest/generatorSubject.ts (135)
- src/lib/mcptest/driver.ts (131)
- src/lib/mcptest/driverRequest.ts (85)
- src/lib/mcptest/core/cellRun.ts (415)
- src/lib/mcptest/core/types.ts (173)
- src/lib/mcptest/core/redact.ts (47)
- src/lib/mcptest/api-contract.ts (32)
- src/lib/server/mcptest/containerRun.ts (369)
- src/lib/server/mcptest/driverClosure.ts (62)
- src/lib/server/mcptest/methodFallback.ts (11)
- src/lib/server/tryitout/redact.ts (58)
- scripts/smoke.ts (189)
- scripts/tryout-run.ts (334)
- scripts/generate-mcp.ts (309)
- scripts/mcp-test.ts (286)
- scripts/validate-entries.ts (123)
- scripts/validate-submission.ts (252)
- scripts/set-try-it-out-mode.ts (69)
- scripts/bench.ts (270)
- scripts/ingest.ts (470)
- src/routes/api/mcp-generate/+server.ts (116)
- src/routes/api/tryitout/jobs/+server.ts (99)
- src/routes/api/tryitout/jobs/[id]/usage/+server.ts (29)

Total: 4175 lines

