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


AUTH_ENV = "ACME_API_KEY"
FIELDS = [
    "product_id",
    "name",
    "category",
    "price",
    "in_stock",
    "features",
    "attr_01",
    "attr_02",
    "attr_03",
    "attr_04",
    "attr_05",
    "attr_06",
    "attr_07",
    "attr_08",
    "attr_09",
    "attr_10",
    "attr_11",
    "attr_12",
    "attr_13",
    "attr_14",
    "attr_15",
    "attr_16",
    "attr_17",
    "attr_18",
    "attr_19",
    "attr_20",
    "attr_21",
    "attr_22",
    "attr_23",
    "attr_24",
    "attr_25",
    "attr_26",
    "attr_27",
    "attr_28",
]


def make_row(i):
    row = {name: "%s-%d" % (name, i) for name in FIELDS}
    row["features"] = [{"feature_code": "KEY-1", "feature_value": "VAL-1", "unit": "VAL-1"}]
    return row


@pytest.fixture
def upstream(monkeypatch):
    """Replace the single upstream call. Handlers return (status code, body text) or an exception."""
    state = {"calls": [], "handler": lambda path, params: (200, "[]")}

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
    "filter_product_by_features",
    "list_products",
    "lookup_product_by_id",
    "search_product",
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
    [
        "filter_product_by_features",
        {
            "key": "KEY-1",
        },
    ],
    ["list_products", {}],
    [
        "lookup_product_by_id",
        {
            "product_id": "sample",
        },
    ],
    [
        "search_product",
        {
            "q": "sample",
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


TOOL_CALLS = [
    ("filter_product_by_features", {"key": "KEY-1"}),
    ("list_products", {}),
    ("lookup_product_by_id", {"product_id": "sample"}),
    ("search_product", {"q": "sample"}),
]


def call(name, kwargs):
    return getattr(server, name)(**kwargs)


@pytest.mark.parametrize("name,kwargs", TOOL_CALLS)
def test_upstream_failure_is_structured_and_not_leaked(upstream, name, kwargs):
    body = "Traceback (most recent call last) all shards failed httpx.ReadError timestamp status error path"
    upstream["handler"] = lambda path, params: (500, body)
    out = call(name, kwargs)
    assert out["ok"] is False
    assert set(out) == ERROR_KEYS
    assert out["kind"] == "upstream"
    assert not looks_leaky(out)
    assert "all shards" not in json.dumps(out)
    assert len(upstream["calls"]) == server.MAX_RETRIES + 1


@pytest.mark.parametrize("name,kwargs", TOOL_CALLS)
def test_exception_text_never_reaches_the_caller(upstream, name, kwargs):
    upstream["handler"] = lambda path, params: RuntimeError("secret internal detail in /srv/data")
    out = call(name, kwargs)
    assert out["ok"] is False
    assert "secret internal detail" not in json.dumps(out)
    assert not looks_leaky(out)


@pytest.mark.parametrize("name,kwargs", TOOL_CALLS)
def test_unreadable_response_is_an_honest_failure(upstream, name, kwargs):
    upstream["handler"] = lambda path, params: (200, "<html>not json</html>")
    out = call(name, kwargs)
    assert out["ok"] is False
    assert set(out) == ERROR_KEYS
    assert not looks_leaky(out)


@pytest.mark.parametrize("name,kwargs", TOOL_CALLS)
def test_auth_failure_names_the_env_var_not_the_value(upstream, name, kwargs):
    upstream["handler"] = lambda path, params: (401, "{}")
    out = call(name, kwargs)
    assert out["ok"] is False
    assert out["kind"] == "auth"
    assert re.search(r"auth|api key|unauthorized|forbidden", out["message"], re.I)
    assert "dummy-secret-value" not in json.dumps(out)
    assert AUTH_ENV in out["message"]
    assert not looks_leaky(out)


DOT_CASES = [
    ("lookup_product_by_id", "product_id", {"product_id": "sample"}),
]


@pytest.mark.parametrize("name,arg,kwargs", DOT_CASES)
def test_dot_segment_identifiers_are_rejected_before_any_call(upstream, name, arg, kwargs):
    for bad in (".", "..", " .. "):
        out = getattr(server, name)(**dict(kwargs, **{arg: bad}))
        assert out["ok"] is False and out["kind"] == "invalid_argument"
        assert set(out) == ERROR_KEYS
    assert upstream["calls"] == []


def test_projection_is_capped_at_12_fields(upstream):
    upstream["handler"] = lambda path, params: (200, json.dumps([make_row(1)]))
    out = server.list_products()
    assert out["ok"] is True
    assert 0 < len(out["results"][0]) <= 12
    wide = server.list_products(fields=FIELDS)
    assert all(len(row) <= 12 for row in wide["results"])


def test_empty_result_is_an_honest_message(upstream):
    upstream["handler"] = lambda path, params: (200, "[]")
    out = server.list_products()
    assert out["ok"] is True
    assert out["results"] == [] and out["count"] == 0
    assert re.search(r"no match", out["message"], re.I)
    assert not looks_leaky(out)


def test_page_size_is_clamped(upstream):
    upstream["handler"] = lambda path, params: (200, json.dumps([make_row(i) for i in range(100)]))
    out = server.list_products(page_size=250)
    assert out["ok"] is True
    assert out["page_size"] <= 50
    assert out["count"] <= 50
    assert all(int(params.get("size", 0)) <= 50 for _, params in upstream["calls"])


def test_deep_paging_returns_a_ceiling_warning(upstream):
    out = server.list_products(page=10001)
    assert out["ok"] is True
    assert out["results"] == []
    assert "warning" in out and "narrow" in out["warning"].lower()
    assert upstream["calls"] == []
    assert not looks_leaky(out)


def test_lookup_not_found_is_honest(upstream):
    upstream["handler"] = lambda path, params: (404, "{}")
    out = server.lookup_product_by_id(product_id="sample")
    assert out["ok"] is False and out["kind"] == "not_found"
    assert re.search(r"not found|no .* found", out["message"], re.I)
    assert set(out) == ERROR_KEYS
    assert not looks_leaky(out)


def test_lookup_empty_body_is_not_found(upstream):
    upstream["handler"] = lambda path, params: (200, "[]")
    out = server.lookup_product_by_id(product_id="sample")
    assert out["ok"] is False and out["kind"] == "not_found"


def test_lookup_projects_the_item(upstream):
    upstream["handler"] = lambda path, params: (200, json.dumps(make_row(1)))
    out = server.lookup_product_by_id(product_id="sample")
    assert out["ok"] is True
    assert 0 < len(out["result"]) <= 12


def test_derived_filter_fetches_candidates_and_reports_coverage(upstream):
    upstream["handler"] = lambda path, params: (200, json.dumps([make_row(i) for i in range(50)]))
    out = server.filter_product_by_features(key="KEY-1", max_pages=2)
    assert out["ok"] is True
    assert upstream["calls"], "the tool must fetch its own candidates"
    assert out["count"] > 0
    coverage = out["coverage"]
    assert coverage["pages_scanned"] >= 1
    assert coverage["truncated"] is True
    assert not looks_leaky(out)


def test_derived_filter_with_no_match_says_so(upstream):
    upstream["handler"] = lambda path, params: (200, json.dumps([make_row(1)]))
    out = server.filter_product_by_features(key="NO-SUCH-KEY", max_pages=1)
    assert out["ok"] is True and out["count"] == 0
    assert re.search(r"no match", out["message"], re.I)
