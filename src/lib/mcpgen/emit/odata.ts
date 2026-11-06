// OData tool templates (D-562, D-563). Fixed text around data tables: the entity set path, the key property
// names and the per-field literal kinds come from the model and reach Python only through pyStr/pyLit, and
// arguments reach the request only through the runtime helpers (_odata_filter, _odata_path) that validate them
// against the declared type. `$expand` is never written; `$select` carries the projection (12 fields at most).
import type { PlannedTool, ServerPlan } from '../types.js'
import { effectiveMaxPageSize, resolveEnv, snake } from '../plan.js'
import {
  FAIL_TAIL,
  FIELDS_DOC,
  ceilingOf,
  ceilingWarning,
  doc,
  entityOf,
  ind,
  opOf,
  paramArgs,
  sigParam,
} from './python.js'
import { pyIdent, pyNum, pyStr } from './pyutil.js'

export function isOdataTool(plan: ServerPlan, tool: PlannedTool): boolean {
  return opOf(plan, tool)?.protocol === 'odata'
}

export function hasOdata(plan: ServerPlan): boolean {
  return plan.model.backend.kind === 'http' && plan.tools.some((t) => isOdataTool(plan, t))
}

interface OdataFieldSpec {
  kind: string
  filter: boolean
  enum?: string[]
  enumType?: string
}

/** Per entity: the entity set path, the key property names (wire names, in order) and the literal kind of each typed field. */
export function odataTable(plan: ServerPlan): Record<string, { set: string; key: string[]; fields: Record<string, OdataFieldSpec> }> {
  // Null-prototype maps: entity and property names come from the source document and may be __proto__ or constructor (CR-18).
  const table: Record<string, { set: string; key: string[]; fields: Record<string, OdataFieldSpec> }> = Object.create(null)
  for (const tool of plan.tools) {
    const op = opOf(plan, tool)
    if (op?.protocol !== 'odata') continue
    const entity = entityOf(plan, tool.entity)
    const fields: Record<string, OdataFieldSpec> = Object.create(null)
    for (const f of entity.fields) {
      if (!f.odata) continue
      const spec: OdataFieldSpec = { kind: f.odata.kind, filter: f.odata.filterable }
      if (f.odata.kind === 'enum') {
        spec.enum = [...(f.enum ?? [])]
        spec.enumType = f.odata.enumType ?? ''
      }
      fields[f.name] = spec
    }
    const entry = (table[entity.id] ??= { set: op.path ?? '', key: [], fields })
    if (op.kind === 'get') entry.key = tool.params.filter((p) => p.in === 'path').map((p) => p.wireName ?? p.name)
  }
  return table
}

export function odataListTool(plan: ServerPlan, tool: PlannedTool): string[] {
  const op = opOf(plan, tool)!
  const m = plan.model
  const max = effectiveMaxPageSize(m, op)
  const ceiling = ceilingOf(m)
  const ent = pyStr(tool.entity)
  const filtered = tool.params.some((p) => p.name === 'field')
  const sig = ['page: int = 1', `page_size: int = ${Math.min(20, max)}`]
  if (filtered) sig.push('field: Optional[str] = None', 'value: Optional[str] = None', 'match: str = "equals"')
  sig.push('fields: Optional[list[str]] = None')
  const args: [string, string][] = [
    ['page', 'Page number, starting at 1 (sent as $skip).'],
    ['page_size', `Rows per page (1 to ${max}; sent as $top).`],
  ]
  if (filtered) {
    args.push(
      ['field', 'Field to filter on (only typed fields the service allows).'],
      ['value', 'Value to match; it is checked against the field type and written as a typed OData literal.'],
      ['match', 'equals, contains or startsWith (contains and startsWith need a text field; matching is case-sensitive).'],
    )
  }
  args.push(['fields', FIELDS_DOC])
  const notes = [`page_size is clamped to the range 1 to ${max}; larger values are reduced, not rejected.`]
  if (ceiling !== undefined) notes.push(`Results beyond position ${ceiling} are not available; a warning with advice is returned instead.`)
  const body: string[] = [ind(2, 'page = _clamp(page, 1, 1000000)'), ind(2, `page_size = _clamp(page_size, 1, ${max})`)]
  if (ceiling !== undefined) {
    body.push(ind(2, `if page * page_size > ${pyNum(ceiling)}:`))
    body.push(ind(3, `return {"ok": True, "results": [], "count": 0, "warning": ${pyStr(ceilingWarning(ceiling, 'a field filter'))}, "page": page, "page_size": page_size}`))
  }
  body.push(ind(2, `sel = _select_fields(fields, _ALLOWED[${ent}], _DEFAULT[${ent}])`))
  body.push(ind(2, 'query = {"$top": page_size, "$skip": (page - 1) * page_size, "$select": ",".join(sel)}'))
  if (filtered) {
    body.push(ind(2, `condition = _odata_filter(${ent}, field, match, value)`))
    body.push(ind(2, 'if condition is not None:'))
    body.push(ind(3, 'query["$filter"] = condition'))
  }
  body.push(ind(2, `data = _http_json(_ODATA[${ent}]["set"], query)`))
  body.push(ind(2, 'all_rows = _odata_rows(data)'))
  body.push(ind(2, 'rows = all_rows[: min(page_size, MAX_RESPONSE_ITEMS)]'))
  body.push(ind(2, 'if not rows:'))
  body.push(ind(3, `return _no_results(${pyStr(snake(tool.entity))}, "Try fewer filters or a broader search term.")`))
  body.push(ind(2, 'results = [_project(row, sel) for row in rows]'))
  body.push(ind(2, 'out = {"ok": True, "results": results, "count": len(results), "page": page, "page_size": page_size}'))
  // A service that caps its responses below $top continues with @odata.nextLink; $skip paging would then skip rows (CR-19).
  body.push(ind(2, 'if _odata_more(data) and len(all_rows) < page_size:'))
  body.push(ind(3, 'out["warning"] = _odata_capped_warning(len(all_rows), page_size)'))
  body.push(ind(2, 'return out'))
  return [`def ${pyIdent(tool.name)}(${sig.join(', ')}) -> dict:`, ...doc(tool.description, args, notes), ind(1, 'try:'), ...body, ...FAIL_TAIL]
}

export function odataGetTool(plan: ServerPlan, tool: PlannedTool): string[] {
  const keys = tool.params.filter((p) => p.in === 'path')
  const sig = [...keys.map(sigParam), 'fields: Optional[list[str]] = None']
  const args: [string, string][] = [...paramArgs(keys), ['fields', FIELDS_DOC]]
  const ent = pyStr(tool.entity)
  const entName = pyStr(snake(tool.entity))
  const notFound = `_not_found(${entName}, ${keys[0].name})`
  const body: string[] = [
    ind(2, `sel = _select_fields(fields, _ALLOWED[${ent}], _DEFAULT[${ent}])`),
    ind(2, `data = _http_json(_odata_path(${ent}, [${keys.map((k) => k.name).join(', ')}]), {"$select": ",".join(sel)})`),
    ind(2, 'item = _odata_item(data)'),
    ind(2, 'if not item:'),
    ind(3, `return ${notFound}`),
    ind(2, 'return {"ok": True, "result": _project(item, sel)}'),
  ]
  return [
    `def ${pyIdent(tool.name)}(${sig.join(', ')}) -> dict:`,
    ...doc(tool.description, args),
    ind(1, 'try:'),
    ...body,
    ind(1, 'except _Fail as exc:'),
    ind(2, 'if exc.kind == "not_found":'),
    ind(3, `return ${notFound}`),
    ind(2, 'return _fail(exc)'),
    ind(1, 'except Exception:'),
    ind(2, 'return _err("internal", _INTERNAL_MESSAGE)'),
  ]
}

/** Generated pytest for an OData server: the stub replaces `_raw_get` and the tests assert the exact parameters built. */
export function odataTests(plan: ServerPlan, head: string[], common: (names: string[]) => string[]): string[] {
  const m = plan.model
  const lists = plan.tools.filter((t) => isOdataTool(plan, t) && opOf(plan, t)!.kind === 'list')
  const gets = plan.tools.filter((t) => isOdataTool(plan, t) && opOf(plan, t)!.kind === 'get')
  const table = odataTable(plan)
  const env = resolveEnv(m)
  const out: string[] = [...head]
  // The entity of the first list tool is the subject of the paging and filter tests.
  const first = lists[0] ?? gets[0]
  const entity = first.entity
  const spec = table[entity]
  const max = lists[0] ? effectiveMaxPageSize(m, opOf(plan, lists[0])) : 100
  const filterable = Object.entries(spec.fields).filter(([, f]) => f.filter)
  const strField = filterable.find(([, f]) => f.kind === 'string')?.[0]
  const typed = filterable.find(([, f]) => f.kind !== 'string' && f.kind !== 'enum')
  if (env.auth) out.push(`AUTH_ENV = ${pyStr(env.auth)}`)
  out.push(
    `ENTITY = ${pyStr(entity)}`,
    '',
    '',
    'def make_row(i, entity=None):',
    '    return {name: "%s-%d" % (name, i) for name in server._ALLOWED[entity or ENTITY]}',
    '',
    '',
    '@pytest.fixture',
    'def upstream(monkeypatch):',
    '    """Replace the single upstream call. Handlers return (status code, body text) or an exception."""',
    '    state = {"calls": [], "handler": lambda path, params: (200, json.dumps({"value": []}))}',
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
  out.push(...common(plan.tools.map((t) => t.name)))
  if (lists[0]) {
    const list = lists[0].name
    out.push(
      'def test_list_sends_top_skip_and_select_and_never_expand(upstream):',
      '    upstream["handler"] = lambda path, params: (200, json.dumps({"value": [make_row(1)]}))',
      `    out = server.${list}(page=3, page_size=5)`,
      '    assert out["ok"] is True and out["count"] == 1',
      '    path, params = upstream["calls"][0]',
      `    assert path == ${pyStr(spec.set)}`,
      '    assert params["$top"] == 5 and params["$skip"] == 10',
      '    assert 0 < len(params["$select"].split(",")) <= 12',
      '    assert "$expand" not in params',
      '    assert 0 < len(out["results"][0]) <= 12',
      '',
      '',
      'def test_page_size_is_clamped(upstream):',
      `    upstream["handler"] = lambda path, params: (200, json.dumps({"value": [make_row(i) for i in range(${max * 2})]}))`,
      `    out = server.${list}(page_size=${max * 5})`,
      '    assert out["ok"] is True',
      `    assert out["page_size"] <= ${max} and out["count"] <= ${max}`,
      `    assert all(params["$top"] <= ${max} for _, params in upstream["calls"])`,
      '',
      '',
      ...(max >= 2
        ? [
            'def test_capped_response_with_next_link_warns(upstream):',
            '    upstream["handler"] = lambda path, params: (200, json.dumps({"value": [make_row(1)], "@odata.nextLink": "next"}))',
            `    out = server.${list}(page_size=${max})`,
            '    assert out["ok"] is True and out["count"] == 1',
            '    assert "warning" in out and "page_size" in out["warning"] and "skipped" in out["warning"]',
            '    upstream["handler"] = lambda path, params: (200, json.dumps({"value": [make_row(1)]}))',
            `    assert "warning" not in server.${list}(page_size=${max})`,
            '',
            '',
          ]
        : []),
      'def test_empty_result_is_an_honest_message(upstream):',
      `    out = server.${list}()`,
      '    assert out["ok"] is True and out["results"] == [] and out["count"] == 0',
      '    assert re.search(r"no match", out["message"], re.I)',
      '    assert not looks_leaky(out)',
      '',
      '',
    )
    if (m.limits.resultCeiling !== undefined) {
      out.push(
        'def test_deep_paging_returns_a_ceiling_warning(upstream):',
        `    out = server.${list}(page=${pyNum(m.limits.resultCeiling + 1)}, page_size=1)`,
        '    assert out["ok"] is True and out["results"] == []',
        '    assert "warning" in out and "narrow" in out["warning"].lower()',
        '    assert upstream["calls"] == []',
        '',
        '',
      )
    }
    if (strField) {
      out.push(
        'def test_text_filters_are_quoted_and_escaped(upstream):',
        `    server.${list}(field=${pyStr(strField)}, value="O'Neil")`,
        `    assert upstream["calls"][-1][1]["$filter"] == ${pyStr(`${strField} eq 'O''Neil'`)}`,
        `    server.${list}(field=${pyStr(strField)}, value="ab", match="contains")`,
        `    assert upstream["calls"][-1][1]["$filter"] == ${pyStr(`contains(${strField},'ab')`)}`,
        `    server.${list}(field=${pyStr(strField)}, value="ab", match="startsWith")`,
        `    assert upstream["calls"][-1][1]["$filter"] == ${pyStr(`startswith(${strField},'ab')`)}`,
        '',
        '',
      )
    }
    if (filterable.length > 0) {
      out.push(
        'def test_unknown_or_half_given_filters_are_rejected_before_any_call(upstream):',
        `    bad = server.${list}(field="NoSuchField", value="x")`,
        '    assert bad["ok"] is False and bad["kind"] == "invalid_argument" and set(bad) == ERROR_KEYS',
        '    assert "NoSuchField" not in json.dumps(bad)',
        `    half = server.${list}(field=${pyStr(filterable[0][0])})`,
        '    assert half["ok"] is False and half["kind"] == "invalid_argument"',
        `    mode = server.${list}(field=${pyStr(filterable[0][0])}, value="x", match="regex")`,
        '    assert mode["ok"] is False and mode["kind"] == "invalid_argument"',
        '    assert upstream["calls"] == []',
        '',
        '',
      )
    }
    if (typed) {
      out.push(
        'def test_typed_filter_values_are_validated(upstream):',
        `    bad = server.${list}(field=${pyStr(typed[0])}, value="x' or 1 eq 1 or '")`,
        '    assert bad["ok"] is False and bad["kind"] == "invalid_argument"',
        '    assert upstream["calls"] == []',
        '',
        '',
      )
    }
    out.push(
      'def test_upstream_failure_is_structured_and_not_leaked(upstream):',
      '    upstream["handler"] = lambda path, params: (500, "Traceback (most recent call last) all shards failed httpx.ReadError timestamp status error path")',
      `    out = server.${list}()`,
      '    assert out["ok"] is False and set(out) == ERROR_KEYS and out["kind"] == "upstream"',
      '    assert not looks_leaky(out)',
      '    assert len(upstream["calls"]) == server.MAX_RETRIES + 1',
      '',
      '',
      'def test_unreadable_response_is_an_honest_failure(upstream):',
      '    upstream["handler"] = lambda path, params: (200, "<html>not json</html>")',
      `    out = server.${list}()`,
      '    assert out["ok"] is False and set(out) == ERROR_KEYS',
      '',
      '',
    )
  }
  // Prefer a lookup with a text key: it also gets the test that key text cannot escape the predicate.
  const textKey = (t: PlannedTool) => table[t.entity].key.some((n) => table[t.entity].fields[n].kind === 'string')
  const get = gets.find(textKey) ?? gets[0]
  if (get) {
    const keyArgs = get.params.filter((p) => p.in === 'path')
    const gspec = table[get.entity]
    const sampleFor = (kind: string, enums?: string[]): [string, string] => {
      switch (kind) {
        case 'guid':
          return ['"01234567-89ab-cdef-0123-456789abcdef"', '01234567-89ab-cdef-0123-456789abcdef']
        case 'number':
          return ['7', '7']
        case 'boolean':
          return ['True', 'true']
        case 'date':
          return ['"2026-01-31"', '2026-01-31']
        case 'datetimeoffset':
          return ['"2026-01-31T12:00:00Z"', '2026-01-31T12:00:00Z']
        case 'timeofday':
          return ['"12:30:00"', '12:30:00']
        case 'enum':
          return [pyStr(enums?.[0] ?? 'x'), enums?.[0] ?? 'x']
        default:
          return ['"A/1"', "'A%2F1'"]
      }
    }
    const parts = gspec.key.map((name, i) => {
      const f = gspec.fields[name]
      const [py, lit] = sampleFor(f.kind, f.enum)
      const quoted = f.kind === 'enum' ? `${f.enumType}'${lit}'` : lit
      return { arg: keyArgs[i].name, py, wire: name, quoted }
    })
    const expectedPath =
      gspec.key.length === 1
        ? `${gspec.set}(${parts[0].quoted})`
        : `${gspec.set}(${parts.map((p) => `${p.wire}=${p.quoted}`).join(',')})`
    const call = parts.map((p) => `${p.arg}=${p.py}`).join(', ')
    out.push(
      'def test_lookup_builds_the_key_predicate(upstream):',
      `    upstream["handler"] = lambda path, params: (200, json.dumps(make_row(1, ${pyStr(get.entity)})))`,
      `    out = server.${get.name}(${call})`,
      '    assert out["ok"] is True and 0 < len(out["result"]) <= 12',
      `    assert upstream["calls"][0][0] == ${pyStr(expectedPath)}`,
      '    assert "$expand" not in upstream["calls"][0][1]',
      '',
      '',
      'def test_lookup_not_found_is_honest(upstream):',
      '    upstream["handler"] = lambda path, params: (404, "{}")',
      `    out = server.${get.name}(${call})`,
      '    assert out["ok"] is False and out["kind"] == "not_found" and set(out) == ERROR_KEYS',
      '    assert re.search(r"not found|no .* found", out["message"], re.I)',
      '',
      '',
    )
    const stringKey = gspec.key.findIndex((n) => gspec.fields[n].kind === 'string')
    if (stringKey >= 0) {
      const arg = keyArgs[stringKey].name
      out.push(
        'def test_key_text_cannot_escape_the_predicate(upstream):',
        `    upstream["handler"] = lambda path, params: (200, json.dumps(make_row(1, ${pyStr(get.entity)})))`,
        `    server.${get.name}(${parts.map((p) => (p.arg === arg ? `${p.arg}="x') or ('1'='1/../"` : `${p.arg}=${p.py}`)).join(', ')})`,
        '    path = upstream["calls"][0][0]',
        '    assert "/../" not in path and "?" not in path and "#" not in path',
        `    assert ${pyStr("''")} in path and ${pyStr("' or")} not in path`,
        '',
        '',
      )
    }
  }
  return out
}
