# Generated tests for Acme Catalog.
# They stub the data source: no network access and no real credentials are used.
# Run with: pytest test_server.py
import json
import re

import pytest

import server

LEAK_PATTERNS = [
    "traceback (most recent call last)",
    "httpx.",
    "all shards failed",
    "requests.exceptions",
    "connectionerror",
    "jsondecodeerror",
]
LEAK_WORDS = ("timestamp", "status", "error", "path")
ERROR_KEYS = {"ok", "kind", "message", "hint"}


def looks_leaky(output):
    """Same rule the study harness uses: leak patterns, or 3 of the 4 leak words."""
    text = json.dumps(output).lower()
    if any(pattern in text for pattern in LEAK_PATTERNS):
        return True
    return sum(1 for word in LEAK_WORDS if word in text) >= 3


AUTH_ENV = "ACME_CATALOG_ACCESS_TOKEN"
ENTITY = "OrderLine"


def make_row(i, entity=None):
    return {name: "%s-%d" % (name, i) for name in server._ALLOWED[entity or ENTITY]}


@pytest.fixture
def upstream(monkeypatch):
    """Replace the single upstream call. Handlers return (status code, body text) or an exception."""
    state = {"calls": [], "handler": lambda path, params: (200, json.dumps({"value": []}))}

    def fake_get(path, params):
        state["calls"].append((path, dict(params or {})))
        result = state["handler"](path, params)
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(server, "_raw_get", fake_get)
    monkeypatch.setattr(server.time, "sleep", lambda seconds: None)
    monkeypatch.setenv(AUTH_ENV, "dummy-secret-value")
    return state


EXPECTED_TOOLS = [
    "list_order_lines",
    "list_products",
    "list_suppliers",
    "lookup_order_line_by_order_id_and_line_number",
    "lookup_product_by_id",
    "lookup_supplier_by_supplier_code",
]


def test_tool_names_are_task_oriented():
    for name in EXPECTED_TOOLS:
        assert callable(getattr(server, name))
        assert re.match(r"^(list|search|lookup|filter|query|describe)_[a-z0-9_]+$", name)
        assert "using" not in name


def test_only_read_tools_exist():
    public = [n for n in dir(server) if callable(getattr(server, n)) and not n.startswith("_")]
    assert not [n for n in public if re.match(r"^(create|update|delete|post|put|patch|remove|write)_", n)]


OPEN_WORLD = True


def _hint(annotations, key):
    if isinstance(annotations, dict):
        return annotations.get(key)
    snake = re.sub(r"(?<!^)(?=[A-Z])", "_", key).lower()  # fastmcp 4 uses snake_case, fastmcp 3 camelCase
    value = getattr(annotations, snake, None)
    return value if value is not None else getattr(annotations, key, None)


def test_every_tool_declares_read_only_annotations():
    import asyncio

    from fastmcp import Client

    async def list_tools():
        async with Client(server.mcp) as client:
            return await client.list_tools()

    tools = asyncio.run(list_tools())
    assert sorted(t.name for t in tools) == sorted(EXPECTED_TOOLS)
    for tool in tools:
        assert _hint(tool.annotations, "readOnlyHint") is True, tool.name
        assert _hint(tool.annotations, "destructiveHint") is False, tool.name
        assert _hint(tool.annotations, "idempotentHint") is True, tool.name
        assert _hint(tool.annotations, "openWorldHint") is OPEN_WORLD, tool.name


def _output_schema(tool):
    schema = getattr(tool, "output_schema", None)
    if schema is None:
        schema = getattr(tool, "outputSchema", None)
    return schema


def test_every_tool_declares_an_object_output_schema():
    import asyncio

    from fastmcp import Client

    async def list_tools():
        async with Client(server.mcp) as client:
            return await client.list_tools()

    for tool in asyncio.run(list_tools()):
        schema = _output_schema(tool)
        assert isinstance(schema, dict), tool.name
        assert schema.get("type") == "object", tool.name
        assert "ok" in schema.get("properties", {}), tool.name
        assert "ok" in schema.get("required", []), tool.name


STRUCTURED_CASES = [
    ["list_order_lines", {}],
    ["list_products", {}],
    ["list_suppliers", {}],
    [
        "lookup_order_line_by_order_id_and_line_number",
        {
            "order_id": 1,
            "line_number": 1,
        },
    ],
    [
        "lookup_product_by_id",
        {
            "id": "sample",
        },
    ],
    [
        "lookup_supplier_by_supplier_code",
        {
            "supplier_code": "sample",
        },
    ],
]


@pytest.mark.parametrize("name,kwargs", STRUCTURED_CASES)
@pytest.mark.usefixtures("upstream")
def test_structured_content_matches_the_dict_result_and_schema(name, kwargs):
    import asyncio

    import jsonschema
    from fastmcp import Client

    async def call_and_list():
        async with Client(server.mcp) as client:
            tools = {t.name: t for t in await client.list_tools()}
            return tools[name], await client.call_tool(name, kwargs)

    tool, result = asyncio.run(call_and_list())
    expected = getattr(server, name)(**kwargs)
    assert result.structured_content == expected
    jsonschema.validate(expected, _output_schema(tool))


def test_list_sends_top_skip_and_select_and_never_expand(upstream):
    upstream["handler"] = lambda path, params: (200, json.dumps({"value": [make_row(1)]}))
    out = server.list_order_lines(page=3, page_size=5)
    assert out["ok"] is True and out["count"] == 1
    path, params = upstream["calls"][0]
    assert path == "/OrderLines"
    assert params["$top"] == 5 and params["$skip"] == 10
    assert 0 < len(params["$select"].split(",")) <= 12
    assert "$expand" not in params
    assert 0 < len(out["results"][0]) <= 12


def test_page_size_is_clamped(upstream):
    upstream["handler"] = lambda path, params: (200, json.dumps({"value": [make_row(i) for i in range(200)]}))
    out = server.list_order_lines(page_size=500)
    assert out["ok"] is True
    assert out["page_size"] <= 100 and out["count"] <= 100
    assert all(params["$top"] <= 100 for _, params in upstream["calls"])


def test_capped_response_with_next_link_warns(upstream):
    upstream["handler"] = lambda path, params: (200, json.dumps({"value": [make_row(1)], "@odata.nextLink": "next"}))
    out = server.list_order_lines(page_size=100)
    assert out["ok"] is True and out["count"] == 1
    assert "warning" in out and "page_size" in out["warning"] and "skipped" in out["warning"]
    upstream["handler"] = lambda path, params: (200, json.dumps({"value": [make_row(1)]}))
    assert "warning" not in server.list_order_lines(page_size=100)


def test_empty_result_is_an_honest_message(upstream):
    out = server.list_order_lines()
    assert out["ok"] is True and out["results"] == [] and out["count"] == 0
    assert re.search(r"no match", out["message"], re.I)
    assert not looks_leaky(out)


def test_unknown_or_half_given_filters_are_rejected_before_any_call(upstream):
    bad = server.list_order_lines(field="NoSuchField", value="x")
    assert bad["ok"] is False and bad["kind"] == "invalid_argument" and set(bad) == ERROR_KEYS
    assert "NoSuchField" not in json.dumps(bad)
    half = server.list_order_lines(field="OrderID")
    assert half["ok"] is False and half["kind"] == "invalid_argument"
    mode = server.list_order_lines(field="OrderID", value="x", match="regex")
    assert mode["ok"] is False and mode["kind"] == "invalid_argument"
    assert upstream["calls"] == []


def test_typed_filter_values_are_validated(upstream):
    bad = server.list_order_lines(field="OrderID", value="x' or 1 eq 1 or '")
    assert bad["ok"] is False and bad["kind"] == "invalid_argument"
    assert upstream["calls"] == []


def test_upstream_failure_is_structured_and_not_leaked(upstream):
    upstream["handler"] = lambda path, params: (500, "Traceback (most recent call last) all shards failed httpx.ReadError timestamp status error path")
    out = server.list_order_lines()
    assert out["ok"] is False and set(out) == ERROR_KEYS and out["kind"] == "upstream"
    assert not looks_leaky(out)
    assert len(upstream["calls"]) == server.MAX_RETRIES + 1


def test_unreadable_response_is_an_honest_failure(upstream):
    upstream["handler"] = lambda path, params: (200, "<html>not json</html>")
    out = server.list_order_lines()
    assert out["ok"] is False and set(out) == ERROR_KEYS


def test_lookup_builds_the_key_predicate(upstream):
    upstream["handler"] = lambda path, params: (200, json.dumps(make_row(1, "Supplier")))
    out = server.lookup_supplier_by_supplier_code(supplier_code="A/1")
    assert out["ok"] is True and 0 < len(out["result"]) <= 12
    assert upstream["calls"][0][0] == "/Suppliers('A%2F1')"
    assert "$expand" not in upstream["calls"][0][1]


def test_lookup_not_found_is_honest(upstream):
    upstream["handler"] = lambda path, params: (404, "{}")
    out = server.lookup_supplier_by_supplier_code(supplier_code="A/1")
    assert out["ok"] is False and out["kind"] == "not_found" and set(out) == ERROR_KEYS
    assert re.search(r"not found|no .* found", out["message"], re.I)


def test_key_text_cannot_escape_the_predicate(upstream):
    upstream["handler"] = lambda path, params: (200, json.dumps(make_row(1, "Supplier")))
    server.lookup_supplier_by_supplier_code(supplier_code="x') or ('1'='1/../")
    path = upstream["calls"][0][0]
    assert "/../" not in path and "?" not in path and "#" not in path
    assert "''" in path and "' or" not in path
