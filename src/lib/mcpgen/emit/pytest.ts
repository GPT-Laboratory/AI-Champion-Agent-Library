// ServerPlan -> test_server.py text. The tests assert the nine behaviours of RESEARCH-SYNTHESIS 3.2
// against a stubbed upstream (http), a temporary CSV (dataset) or a temporary SQLite file (sql).
// This repository never runs them; they ship with the generated package and seed Phase 15 cases.
import type { Entity, Operation, Param, PlannedTool, ServerPlan } from '../types.js'
import { effectiveMaxPageSize, resolveEnv, toolKind } from '../plan.js'
import { hasOdata, odataTests } from './odata.js'
import { joinLines, pyLit, pyNum, pyStr } from './pyutil.js'
import { annotationTests, emitProposedPytest, outputSchemaTests } from './pytestProposed.js'

function sample(p: Param): unknown {
  if (p.enum && p.enum.length) return p.enum[0]
  if (p.type === 'integer') return p.min ?? 1
  if (p.type === 'number') return p.min ?? 1
  if (p.type === 'boolean') return true
  return 'sample'
}

/** Keyword arguments for the required parameters of a tool, as Python source. */
function requiredArgs(tool: PlannedTool): Record<string, unknown> {
  const o: Record<string, unknown> = {}
  for (const p of tool.params.filter((x) => x.required || x.in === 'path')) o[p.name] = sample(p)
  return o
}

function kwargs(o: Record<string, unknown>, extra = ''): string {
  const parts = Object.entries(o).map(([k, v]) => `${k}=${pyLit(v)}`)
  if (extra) parts.push(extra)
  return parts.join(', ')
}

const HEAD = (name: string) => [
  `# Generated tests for ${name.replace(/[^A-Za-z0-9 _.-]/g, ' ')}.`,
  '# They stub the data source: no network access and no real credentials are used.',
  '# Run with: pytest test_server.py',
  'import json',
  'import re',
  '',
  'import pytest',
  '',
  'import server',
  '',
  'LEAK_PATTERNS = [',
  '    "traceback (most recent call last)",',
  '    "httpx.",',
  '    "all shards failed",',
  '    "requests.exceptions",',
  '    "connectionerror",',
  '    "jsondecodeerror",',
  ']',
  'LEAK_WORDS = ("timestamp", "status", "error", "path")',
  'ERROR_KEYS = {"ok", "kind", "message", "hint"}',
  '',
  '',
  'def looks_leaky(output):',
  '    """Same rule the study harness uses: leak patterns, or 3 of the 4 leak words."""',
  '    text = json.dumps(output).lower()',
  '    if any(pattern in text for pattern in LEAK_PATTERNS):',
  '        return True',
  '    return sum(1 for word in LEAK_WORDS if word in text) >= 3',
  '',
  '',
]

function commonTests(names: string[], openWorld: boolean, cases: [string, Record<string, unknown>][], fixture: string): string[] {
  return [
    `EXPECTED_TOOLS = ${pyLit(names)}`,
    '',
    '',
    'def test_tool_names_are_task_oriented():',
    '    for name in EXPECTED_TOOLS:',
    '        assert callable(getattr(server, name))',
    '        assert re.match(r"^(list|search|lookup|filter|query|describe)_[a-z0-9_]+$", name)',
    '        assert "using" not in name',
    '',
    '',
    'def test_only_read_tools_exist():',
    '    public = [n for n in dir(server) if callable(getattr(server, n)) and not n.startswith("_")]',
    '    assert not [n for n in public if re.match(r"^(create|update|delete|post|put|patch|remove|write)_", n)]',
    '',
    '',
    ...annotationTests(openWorld),
    ...outputSchemaTests(cases, fixture),
  ]
}

function entityFieldsOf(plan: ServerPlan, id: string): Entity {
  return plan.model.entities.find((e) => e.id === id)!
}

function httpCases(plan: ServerPlan): [string, Record<string, unknown>][] {
  return plan.tools
    .filter((t) => toolKind(plan, t) !== 'describe')
    .map((t) => [t.name, toolKind(plan, t) === 'filter' ? { ...requiredArgs(t), key: 'KEY-1' } : requiredArgs(t)])
}

function httpTests(plan: ServerPlan): string[] {
  const m = plan.model
  const env = resolveEnv(m)
  const kinds = plan.tools.map((t) => ({ t, k: toolKind(plan, t) }))
  const lists = kinds.filter((x) => x.k === 'list' || x.k === 'search')
  const pagedFirst = [...lists].sort((a, b) => Number(!!opOf(plan, b.t)?.pageSizeParam) - Number(!!opOf(plan, a.t)?.pageSizeParam))
  const list = pagedFirst[0]?.t
  const getT = kinds.find((x) => x.k === 'get')?.t
  const filter = kinds.find((x) => x.k === 'filter')?.t
  const entity = entityFieldsOf(plan, (list ?? getT ?? filter ?? plan.tools[0]).entity)
  const out: string[] = [...HEAD(m.name)]
  if (env.auth) out.push(`AUTH_ENV = ${pyStr(env.auth)}`)
  out.push(`FIELDS = ${pyLit(entity.fields.map((f) => f.name))}`, '')
  const nested = entity.nested[0]
  out.push('', 'def make_row(i):', '    row = {name: "%s-%d" % (name, i) for name in FIELDS}')
  if (nested) {
    const item: Record<string, string> = {}
    for (const k of nested.keyFields) item[k] = 'KEY-1'
    for (const v of nested.valueFields) item[v] = 'VAL-1'
    out.push(`    row[${pyStr(nested.field)}] = [{${Object.entries(item).map(([k, v]) => `${pyStr(k)}: ${pyStr(v)}`).join(', ')}}]`)
  }
  out.push('    return row', '', '')
  out.push(
    '@pytest.fixture',
    'def upstream(monkeypatch):',
    '    """Replace the single upstream call. Handlers return (status code, body text) or an exception."""',
    '    state = {"calls": [], "handler": lambda path, params: (200, "[]")}',
    '',
    '    def fake_get(path, params):',
    '        state["calls"].append((path, dict(params or {})))',
    '        result = state["handler"](path, params)',
    '        if isinstance(result, Exception):',
    '            raise result',
    '        return result',
    '',
    '    monkeypatch.setattr(server, "_raw_get", fake_get)',
    '    monkeypatch.setattr(server.time, "sleep", lambda seconds: None)',
  )
  if (env.auth) out.push('    monkeypatch.setenv(AUTH_ENV, "dummy-secret-value")')
  out.push('    return state', '', '')
  out.push(...commonTests(plan.tools.map((t) => t.name), true, httpCases(plan), 'upstream'))

  const calls = kinds
    .filter((x) => x.k !== 'describe')
    .map((x) => [x.t.name, x.k === 'filter' ? { ...requiredArgs(x.t), key: 'KEY-1' } : requiredArgs(x.t)] as const)
  out.push(
    `TOOL_CALLS = [`,
    ...calls.map(([n, a]) => `    (${pyStr(n)}, {${Object.entries(a).map(([k, v]) => `${pyStr(k)}: ${pyLit(v)}`).join(', ')}}),`),
    ']',
    '',
    '',
    'def call(name, kwargs):',
    '    return getattr(server, name)(**kwargs)',
    '',
    '',
    '@pytest.mark.parametrize("name,kwargs", TOOL_CALLS)',
    'def test_upstream_failure_is_structured_and_not_leaked(upstream, name, kwargs):',
    '    body = "Traceback (most recent call last) all shards failed httpx.ReadError timestamp status error path"',
    '    upstream["handler"] = lambda path, params: (500, body)',
    '    out = call(name, kwargs)',
    '    assert out["ok"] is False',
    '    assert set(out) == ERROR_KEYS',
    '    assert out["kind"] == "upstream"',
    '    assert not looks_leaky(out)',
    '    assert "all shards" not in json.dumps(out)',
    '    assert len(upstream["calls"]) == server.MAX_RETRIES + 1',
    '',
    '',
    '@pytest.mark.parametrize("name,kwargs", TOOL_CALLS)',
    'def test_exception_text_never_reaches_the_caller(upstream, name, kwargs):',
    '    upstream["handler"] = lambda path, params: RuntimeError("secret internal detail in /srv/data")',
    '    out = call(name, kwargs)',
    '    assert out["ok"] is False',
    '    assert "secret internal detail" not in json.dumps(out)',
    '    assert not looks_leaky(out)',
    '',
    '',
    '@pytest.mark.parametrize("name,kwargs", TOOL_CALLS)',
    'def test_unreadable_response_is_an_honest_failure(upstream, name, kwargs):',
    '    upstream["handler"] = lambda path, params: (200, "<html>not json</html>")',
    '    out = call(name, kwargs)',
    '    assert out["ok"] is False',
    '    assert set(out) == ERROR_KEYS',
    '    assert not looks_leaky(out)',
    '',
    '',
    '@pytest.mark.parametrize("name,kwargs", TOOL_CALLS)',
    'def test_auth_failure_names_the_env_var_not_the_value(upstream, name, kwargs):',
    '    upstream["handler"] = lambda path, params: (401, "{}")',
    '    out = call(name, kwargs)',
    '    assert out["ok"] is False',
    '    assert out["kind"] == "auth"',
    '    assert re.search(r"auth|api key|unauthorized|forbidden", out["message"], re.I)',
    '    assert "dummy-secret-value" not in json.dumps(out)',
    ...(env.auth ? ['    assert AUTH_ENV in out["message"]'] : []),
    '    assert not looks_leaky(out)',
    '',
    '',
  )

  const dotCases = calls.flatMap(([name, args]) => {
    const tool = plan.tools.find((t) => t.name === name)!
    const p = tool.params.find((x) => x.in === 'path' && (x.type === 'string' || x.type === 'unknown'))
    return p ? [[name, p.name, args] as const] : []
  })
  if (dotCases.length > 0) {
    out.push(
      `DOT_CASES = [`,
      ...dotCases.map(([n, a, k]) => `    (${pyStr(n)}, ${pyStr(a)}, {${Object.entries(k).map(([key, v]) => `${pyStr(key)}: ${pyLit(v)}`).join(', ')}}),`),
      ']',
      '',
      '',
      '@pytest.mark.parametrize("name,arg,kwargs", DOT_CASES)',
      'def test_dot_segment_identifiers_are_rejected_before_any_call(upstream, name, arg, kwargs):',
      '    for bad in (".", "..", " .. "):',
      '        out = getattr(server, name)(**dict(kwargs, **{arg: bad}))',
      '        assert out["ok"] is False and out["kind"] == "invalid_argument"',
      '        assert set(out) == ERROR_KEYS',
      '    assert upstream["calls"] == []',
      '',
      '',
    )
  }
  const offsetList = lists.find((x) => {
    const o = opOf(plan, x.t)
    return !!o?.offsetParam && x.t.params.some((p) => p.name === o.offsetParam)
  })?.t
  if (offsetList) {
    const o = opOf(plan, offsetList)!
    out.push(
      'def test_offset_is_passed_through_to_the_upstream(upstream):',
      '    upstream["handler"] = lambda path, params: (200, json.dumps([make_row(1)]))',
      `    out = server.${offsetList.name}(${kwargs(requiredArgs(offsetList), 'offset=40')})`,
      '    assert out["ok"] is True',
      `    assert upstream["calls"] and all(params.get(${pyStr(o.offsetParam!)}) == "40" for _, params in upstream["calls"])`,
      '',
      '',
    )
  }
  if (list) {
    const op = opOf(plan, list)!
    const args = requiredArgs(list)
    const max = effectiveMaxPageSize(m, op)
    out.push(
      'def test_projection_is_capped_at_12_fields(upstream):',
      '    upstream["handler"] = lambda path, params: (200, json.dumps([make_row(1)]))',
      `    out = server.${list.name}(${kwargs(args)})`,
      '    assert out["ok"] is True',
      '    assert 0 < len(out["results"][0]) <= 12',
      `    wide = server.${list.name}(${kwargs(args, 'fields=FIELDS')})`,
      '    assert all(len(row) <= 12 for row in wide["results"])',
      '',
      '',
      'def test_empty_result_is_an_honest_message(upstream):',
      '    upstream["handler"] = lambda path, params: (200, "[]")',
      `    out = server.${list.name}(${kwargs(args)})`,
      '    assert out["ok"] is True',
      '    assert out["results"] == [] and out["count"] == 0',
      '    assert re.search(r"no match", out["message"], re.I)',
      '    assert not looks_leaky(out)',
      '',
      '',
    )
    if (op.pageSizeParam) {
      out.push(
        'def test_page_size_is_clamped(upstream):',
        `    upstream["handler"] = lambda path, params: (200, json.dumps([make_row(i) for i in range(${max * 2})]))`,
        `    out = server.${list.name}(${kwargs(args, `page_size=${max * 5}`)})`,
        '    assert out["ok"] is True',
        `    assert out["page_size"] <= ${max}`,
        `    assert out["count"] <= ${max}`,
        `    assert all(int(params.get(${pyStr(op.pageSizeParam)}, 0)) <= ${max} for _, params in upstream["calls"])`,
        '',
        '',
      )
    }
    if (m.limits.resultCeiling !== undefined && op.pageParam) {
      out.push(
        'def test_deep_paging_returns_a_ceiling_warning(upstream):',
        `    out = server.${list.name}(${kwargs(args, `page=${pyNum(m.limits.resultCeiling + 1)}`)})`,
        '    assert out["ok"] is True',
        '    assert out["results"] == []',
        '    assert "warning" in out and "narrow" in out["warning"].lower()',
        '    assert upstream["calls"] == []',
        '    assert not looks_leaky(out)',
        '',
        '',
      )
    }
  }
  if (getT) {
    const args = requiredArgs(getT)
    out.push(
      'def test_lookup_not_found_is_honest(upstream):',
      '    upstream["handler"] = lambda path, params: (404, "{}")',
      `    out = server.${getT.name}(${kwargs(args)})`,
      '    assert out["ok"] is False and out["kind"] == "not_found"',
      '    assert re.search(r"not found|no .* found", out["message"], re.I)',
      '    assert set(out) == ERROR_KEYS',
      '    assert not looks_leaky(out)',
      '',
      '',
      'def test_lookup_empty_body_is_not_found(upstream):',
      '    upstream["handler"] = lambda path, params: (200, "[]")',
      `    out = server.${getT.name}(${kwargs(args)})`,
      '    assert out["ok"] is False and out["kind"] == "not_found"',
      '',
      '',
      'def test_lookup_projects_the_item(upstream):',
      '    upstream["handler"] = lambda path, params: (200, json.dumps(make_row(1)))',
      `    out = server.${getT.name}(${kwargs(args)})`,
      '    assert out["ok"] is True',
      '    assert 0 < len(out["result"]) <= 12',
      '',
      '',
    )
  }
  if (filter) {
    const op = opOf(plan, filter)!
    const args = requiredArgs(filter)
    const max = effectiveMaxPageSize(m, op)
    out.push(
      'def test_derived_filter_fetches_candidates_and_reports_coverage(upstream):',
      op.pageSizeParam
        ? `    upstream["handler"] = lambda path, params: (200, json.dumps([make_row(i) for i in range(${max})]))`
        : '    upstream["handler"] = lambda path, params: (200, json.dumps([make_row(1), make_row(2)]))',
      `    out = server.${filter.name}(${kwargs(args, 'key="KEY-1", max_pages=2')})`,
      '    assert out["ok"] is True',
      '    assert upstream["calls"], "the tool must fetch its own candidates"',
      '    assert out["count"] > 0',
      '    coverage = out["coverage"]',
      '    assert coverage["pages_scanned"] >= 1',
      op.pageParam || (op.offsetParam && op.pageSizeParam) ? '    assert coverage["truncated"] is True' : '    assert coverage["truncated"] is False',
      '    assert not looks_leaky(out)',
      '',
      '',
      'def test_derived_filter_with_no_match_says_so(upstream):',
      '    upstream["handler"] = lambda path, params: (200, json.dumps([make_row(1)]))',
      `    out = server.${filter.name}(${kwargs(args, 'key="NO-SUCH-KEY", max_pages=1')})`,
      '    assert out["ok"] is True and out["count"] == 0',
      '    assert re.search(r"no match", out["message"], re.I)',
      '',
      '',
    )
  }
  return out
}

function opOf(plan: ServerPlan, t: PlannedTool): Operation | undefined {
  return plan.model.operations.find((o) => o.id === t.operation)
}

function localTests(plan: ServerPlan): string[] {
  const m = plan.model
  const env = resolveEnv(m)
  const isSql = m.backend.kind === 'sql'
  const envName = (isSql ? env.dsn : env.dataFile)!
  const queryTools = plan.tools.filter((t) => toolKind(plan, t) === 'query')
  const describe = plan.tools.find((t) => toolKind(plan, t) === 'describe')!
  const max = effectiveMaxPageSize(m)
  const ceiling = m.limits.resultCeiling
  const ents = queryTools.map((t) => entityFieldsOf(plan, t.entity))
  const out: string[] = [...HEAD(m.name)]
  if (isSql) out.splice(out.indexOf('import json') + 1, 0, 'import sqlite3')
  else out.splice(out.indexOf('import json') + 1, 0, 'import csv')
  out.push(`ENV_NAME = ${pyStr(envName)}`, `MAX = ${max}`)
  out.push(`QUERY_TOOLS = ${pyLit(queryTools.map((t, i) => [t.name, t.entity, ents[i].fields.map((f) => f.name)]))}`, '', '')
  out.push('@pytest.fixture', 'def data(tmp_path, monkeypatch):')
  if (isSql) {
    out.push('    path = tmp_path / "data.db"', '    conn = sqlite3.connect(str(path))', '    for _tool, entity, fields in QUERY_TOOLS:')
    out.push(
      '        columns = ", ".join(\'"%s" TEXT\' % name for name in fields)',
      '        conn.execute(\'CREATE TABLE "%s" (%s)\' % (entity, columns))',
      '        marks = ", ".join("?" for _ in fields)',
      '        for i in range(1, 4):',
      '            conn.execute(\'INSERT INTO "%s" VALUES (%s)\' % (entity, marks), ["%s-%d" % (name, i) for name in fields])',
      '    conn.commit()',
      '    conn.close()',
    )
  } else {
    out.push(
      '    path = tmp_path / "data.csv"',
      '    fields = QUERY_TOOLS[0][2]',
      '    with open(path, "w", newline="", encoding="utf-8") as handle:',
      '        writer = csv.writer(handle, delimiter=server.DATA_DELIMITER)',
      '        writer.writerow(fields)',
      '        for i in range(1, 4):',
      '            writer.writerow(["%s-%d" % (name, i) for name in fields])',
      '    monkeypatch.setattr(server, "_ROWS", None)',
    )
  }
  out.push('    monkeypatch.setenv(ENV_NAME, str(path))', '    return path', '', '')
  out.push(...commonTests(plan.tools.map((t) => t.name), false, plan.tools.map((t) => [t.name, {}]), 'data'))
  const tools = '@pytest.mark.parametrize("tool,entity,fields", QUERY_TOOLS)'
  out.push(
    tools,
    'def test_projection_is_capped_at_12_fields(data, tool, entity, fields):',
    '    out = getattr(server, tool)()',
    '    assert out["ok"] is True and out["count"] > 0',
    '    assert all(0 < len(row) <= 12 for row in out["results"])',
    '    wide = getattr(server, tool)(fields=fields)',
    '    assert all(len(row) <= 12 for row in wide["results"])',
    '',
    '',
    tools,
    'def test_limit_is_clamped(data, tool, entity, fields):',
    '    out = getattr(server, tool)(limit=MAX * 5)',
    '    assert out["ok"] is True',
    '    assert out["limit"] <= MAX',
    '    assert out["count"] <= MAX',
    '',
    '',
    tools,
    'def test_filter_finds_rows_with_equals_and_contains(data, tool, entity, fields):',
    '    first = fields[0]',
    '    exact = getattr(server, tool)(field=first, value="%s-1" % first)',
    '    assert exact["ok"] is True and exact["count"] == 1',
    '    partial = getattr(server, tool)(field=first, value="-2", match="contains")',
    '    assert partial["ok"] is True and partial["count"] == 1',
    '    prefix = getattr(server, tool)(field=first, value=first, match="startsWith")',
    '    assert prefix["count"] == 3',
    '',
    '',
    tools,
    'def test_equals_ignores_case(data, tool, entity, fields):',
    '    first = fields[0]',
    '    out = getattr(server, tool)(field=first, value=("%s-1" % first).upper())',
    '    assert out["ok"] is True and out["count"] == 1',
    '',
    '',
    tools,
    'def test_empty_result_is_an_honest_message(data, tool, entity, fields):',
    '    out = getattr(server, tool)(field=fields[0], value="no-such-value")',
    '    assert out["ok"] is True and out["results"] == [] and out["count"] == 0',
    '    assert re.search(r"no match", out["message"], re.I)',
    '    assert not looks_leaky(out)',
    '',
    '',
    tools,
    'def test_bad_arguments_are_structured_errors(data, tool, entity, fields):',
    '    unknown = getattr(server, tool)(field="not_a_field", value="x")',
    '    assert unknown["ok"] is False and unknown["kind"] == "invalid_argument"',
    '    assert set(unknown) == ERROR_KEYS',
    '    assert "not_a_field" not in json.dumps(unknown)',
    '    half = getattr(server, tool)(field=fields[0])',
    '    assert half["ok"] is False and set(half) == ERROR_KEYS',
    '    mode = getattr(server, tool)(field=fields[0], value="x", match="regex")',
    '    assert mode["ok"] is False and set(mode) == ERROR_KEYS',
    '',
    '',
    tools,
    'def test_injection_text_is_only_ever_a_value(data, tool, entity, fields):',
    '    out = getattr(server, tool)(field=fields[0], value="x\' OR \'1\'=\'1")',
    '    assert out["ok"] is True and out["count"] == 0',
    '',
    '',
    tools,
    'def test_missing_configuration_is_a_clear_message(data, monkeypatch, tool, entity, fields):',
    '    monkeypatch.delenv(ENV_NAME)',
    '    out = getattr(server, tool)()',
    '    assert out["ok"] is False and out["kind"] == "config"',
    '    assert ENV_NAME in out["message"]',
    '    assert set(out) == ERROR_KEYS',
    '    assert not looks_leaky(out)',
    '',
    '',
    'def test_describe_lists_entities_without_row_values(data):',
    `    out = server.${describe.name}()`,
    '    assert out["ok"] is True',
    '    assert [e["name"] for e in out["entities"]] == [q[1] for q in QUERY_TOOLS]',
    '    assert "-1" not in json.dumps(out)',
    '',
    '',
  )
  if (ceiling !== undefined) {
    out.push(
      tools,
      'def test_deep_paging_returns_a_ceiling_warning(data, tool, entity, fields):',
      `    out = getattr(server, tool)(offset=${pyNum(ceiling)})`,
      '    assert out["ok"] is True and out["results"] == []',
      '    assert "warning" in out and "narrow" in out["warning"].lower()',
      '',
      '',
    )
  }
  return out
}

export function emitPytest(plan: ServerPlan): string {
  if (plan.proposals) return emitProposedPytest(plan)
  const lines = plan.model.backend.kind === 'http' ? (hasOdata(plan) ? odataTests(plan, HEAD(plan.model.name), (names) => commonTests(names, true, httpCases(plan), 'upstream')) : httpTests(plan)) : localTests(plan)
  // Trim the extra blank lines left at the end of the last test.
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  return joinLines(lines)
}
