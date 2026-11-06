// Embedded Python runtime helpers. These are fixed text, reviewed in one place; the emitter only
// adds data tables and tool bodies around them. Rules they enforce (design doc section 5):
//  - every failure is a fixed, caller-safe message: never str(exception), never a traceback,
//    never an upstream body (rows 7 and 8);
//  - error shape keys are ok/kind/message/hint (at most one of the four leak-detector words);
//  - responses are projected to at most 12 fields (row 2); page sizes are clamped (row 3).

export const RUNTIME_COMMON = `PROJECTION_MAX_FIELDS = 12
_INTERNAL_MESSAGE = "The tool could not complete the request."
_MATCH_MODES = ("equals", "contains", "startsWith")


class _Fail(Exception):
    """A failure with a fixed, caller-safe message. Never built from exception text."""

    def __init__(self, kind, message, hint=None):
        super().__init__(kind)
        self.kind = kind
        self.message = message
        self.hint = hint


def _err(kind, message, hint=None):
    return {"ok": False, "kind": kind, "message": message, "hint": hint}


def _fail(failure):
    return _err(failure.kind, failure.message, failure.hint)


def _no_results(entity, hint=None):
    return {
        "ok": True,
        "results": [],
        "count": 0,
        "message": "No matches found for the requested " + entity + " filter.",
        "hint": hint,
    }


def _not_found(entity, identifier):
    text = "".join(ch for ch in str(identifier) if ch.isprintable())[:80]
    return _err("not_found", "No " + entity + " found for " + text + ".")


def _clamp(n, lo, hi):
    try:
        n = int(n)
    except (TypeError, ValueError, OverflowError):
        n = lo
    return max(lo, min(hi, n))


def _bound(v, lo=None, hi=None):
    try:
        v = float(v)
    except (TypeError, ValueError, OverflowError):
        v = lo if lo is not None else 0.0
    if v != v:
        v = lo if lo is not None else 0.0
    if lo is not None:
        v = max(lo, v)
    if hi is not None:
        v = min(hi, v)
    return v


def _qv(value):
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _project(obj, fields):
    """Keep only the listed fields (at most 12). Unlisted fields are never forwarded."""
    if not isinstance(obj, dict):
        return {}
    return {name: obj[name] for name in list(fields)[:PROJECTION_MAX_FIELDS] if name in obj}


def _select_fields(requested, allowed, default):
    if isinstance(requested, (list, tuple)):
        picked = []
        for name in requested:
            if isinstance(name, str) and name in allowed and name not in picked:
                picked.append(name)
        if picked:
            return picked[:PROJECTION_MAX_FIELDS]
    return list(default)[:PROJECTION_MAX_FIELDS]


def _num(value):
    try:
        number = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _match(cell, mode, value):
    """Case-insensitive match; equals compares numerically when both sides are numbers."""
    text = "" if cell is None else str(cell).strip()
    wanted = str(value).strip()
    if mode == "equals":
        a, b = _num(text), _num(wanted)
        if a is not None and b is not None:
            return a == b
        return text.casefold() == wanted.casefold()
    if mode == "contains":
        return wanted.casefold() in text.casefold()
    if mode == "startsWith":
        return text.casefold().startswith(wanted.casefold())
    return False
`

export const RUNTIME_QUERY = `

def _query_problem(allowed, describe_tool, field, value, match):
    if match not in _MATCH_MODES:
        return _err("invalid_argument", "match must be one of: equals, contains, startsWith.")
    if (field is None) != (value is None):
        return _err("invalid_argument", "Give both field and value to filter, or neither to list rows.")
    if field is not None and field not in allowed:
        return _err("invalid_argument", "Unknown field. Call " + describe_tool + " to list the available fields.")
    if value is not None and len(str(value)) > 256:
        return _err("invalid_argument", "value is too long (at most 256 characters).")
    return None
`

/** HTTP runtime. The auth branch is emitted only for the scheme the source declares. */
export function runtimeHttp(scheme: 'none' | 'apiKeyHeader' | 'apiKeyQuery' | 'bearer', odata = false): string {
  const authLines: Record<string, string[]> = {
    none: [],
    apiKeyHeader: ['    headers[AUTH_NAME] = key'],
    apiKeyQuery: ['    query[AUTH_NAME] = key'],
    bearer: ['    headers["Authorization"] = "Bearer " + key'],
  }
  const authBlock =
    scheme === 'none'
      ? ''
      : [
          '    key = os.environ.get(AUTH_ENV, "")',
          '    if not key:',
          '        raise _Fail("auth", _AUTH_MESSAGE)',
          ...authLines[scheme],
        ].join('\n') + '\n'
  // OData: the query string is built here with percent-encoding that keeps the `$` of system query options and
  // writes spaces as %20 (an HTTP client's form encoding writes `+`, which not every OData service reads as a space).
  const headersLine = odata ? '    headers = {"Accept": "application/json", "OData-MaxVersion": "4.0"}' : '    headers = {"Accept": "application/json"}'
  const getCall = odata
    ? [
        '    pairs = [urllib.parse.quote(str(name), safe="$") + "=" + urllib.parse.quote(str(item), safe="") for name, item in query.items()]',
        '    url = base.rstrip("/") + path + ("?" + "&".join(pairs) if pairs else "")',
        '    response = httpx.get(',
        '        url,',
        '        headers=headers,',
        '        timeout=10.0,',
        '        follow_redirects=False,',
        '    )',
      ].join('\n')
    : [
        '    response = httpx.get(',
        '        base.rstrip("/") + path,',
        '        params=query,',
        '        headers=headers,',
        '        timeout=10.0,',
        '        follow_redirects=False,',
        '    )',
      ].join('\n')
  return `

_ENVELOPE_KEYS = ("items", "results", "data", "content", "records", "rows", "entries", "values")


def _raw_get(path, params):
    """One upstream GET. Returns (status code, body text). Tests replace this function."""
    base = os.environ.get(BASE_URL_ENV, "")
    if not base:
        raise _Fail("config", "The server is not configured: set " + BASE_URL_ENV + ".")
${headersLine}
    query = dict(params or {})
${authBlock}${getCall}
    return response.status_code, response.text


def _map_http_failure(code):
    """Map an upstream status code to a fixed failure, or None when the call succeeded."""
    if code in (401, 403):
        return _Fail("auth", _AUTH_MESSAGE)
    if code == 404:
        return _Fail("not_found", "The requested item was not found.")
    if code == 429 or code >= 500:
        return _Fail("upstream", _UPSTREAM_MESSAGE)
    if code < 200 or code >= 300:
        return _Fail("invalid_request", "The upstream service rejected the request; check the arguments.")
    return None


def _http_json(path, params=None):
    attempt = 0
    while True:
        try:
            code, text = _raw_get(path, params)
        except _Fail:
            raise
        except Exception:
            code, text = None, ""
        transient = code is None or code == 429 or code >= 500
        if transient and attempt < MAX_RETRIES:
            attempt += 1
            time.sleep(0.5 * attempt)
            continue
        if code is None:
            raise _Fail("upstream", _UPSTREAM_MESSAGE)
        failure = _map_http_failure(code)
        if failure is not None:
            raise failure
        if len(text) > MAX_RESPONSE_CHARS:
            raise _Fail("upstream", "The upstream service returned more data than this server accepts; narrow the request.")
        try:
            return json.loads(text)
        except ValueError:
            raise _Fail("upstream", "The upstream service returned an unreadable response.")


def _seg(value):
    text = str(value).strip()
    # quote() leaves dots alone, and an HTTP client folds /a/.. into /: dot segments never pass.
    if not text or len(text) > 128 or text in (".", ".."):
        raise _Fail("invalid_argument", "The identifier must be between 1 and 128 characters and not a dot segment.")
    return urllib.parse.quote(text, safe="")


def _dicts(values):
    return [entry for entry in values if isinstance(entry, dict)]


def _rows(data):
    """Rows from a list response or from a common envelope. Anything else is an honest failure."""
    if isinstance(data, list):
        return _dicts(data)
    if isinstance(data, dict):
        for name in _ENVELOPE_KEYS:
            if isinstance(data.get(name), list):
                return _dicts(data[name])
        lists = [value for value in data.values() if isinstance(value, list)]
        if len(lists) == 1:
            return _dicts(lists[0])
    raise _Fail("upstream", "The upstream service returned an unexpected response shape.")


def _item(data):
    if isinstance(data, list):
        rows = _dicts(data)
        return rows[0] if rows else None
    if isinstance(data, dict):
        for name in _ENVELOPE_KEYS:
            if isinstance(data.get(name), list):
                rows = _dicts(data[name])
                return rows[0] if rows else None
        return data or None
    return None


def _nested_hits(entries, key_fields, value_fields, needle, value):
    """Entries of a nested array that match the key (and the value when given)."""
    hits = []
    if not isinstance(entries, list):
        return hits
    targets = list(key_fields) or list(value_fields)
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        if not any(_match(entry.get(name), "equals", needle) for name in targets):
            continue
        if value is not None and key_fields and value_fields:
            if not any(_match(entry.get(name), "equals", value) for name in value_fields):
                continue
        hits.append({name: entry.get(name) for name in list(key_fields) + list(value_fields) if name in entry})
        if len(hits) >= 20:
            break
    return hits
`
}

export const RUNTIME_DATASET = `

_ROWS = None


def _load_rows():
    """Load the whole file first, then assign module state (never half-loaded)."""
    global _ROWS
    if _ROWS is None:
        path = os.environ.get(DATA_FILE_ENV, "")
        if not path:
            raise _Fail("config", "The server is not configured: set " + DATA_FILE_ENV + ".")
        try:
            with open(path, newline="", encoding="utf-8-sig") as handle:
                loaded = [dict(row) for row in csv.DictReader(handle, delimiter=DATA_DELIMITER)]
        except (OSError, csv.Error, UnicodeDecodeError):
            raise _Fail("config", "The data file could not be read; check " + DATA_FILE_ENV + ".")
        _ROWS = loaded
    return _ROWS
`

export const RUNTIME_SQL = `

def _like(value):
    return str(value).replace("!", "!!").replace("%", "!%").replace("_", "!_")


def _connect():
    """Read-only SQLite connection (the DSN variable holds a database file location)."""
    location = os.environ.get(DSN_ENV, "")
    if not location:
        raise _Fail("config", "The server is not configured: set " + DSN_ENV + ".")
    try:
        conn = sqlite3.connect(pathlib.Path(location).resolve().as_uri() + "?mode=ro", uri=True)
        conn.execute("PRAGMA query_only = ON")
        return conn
    except (sqlite3.Error, OSError, ValueError):
        raise _Fail("config", "The database could not be opened; check " + DSN_ENV + ".")


def _sql_query(entity, selected, field, match, value, limit, offset):
    """Parameterised query. Table and column names come only from the generated allow-list."""
    spec = _TABLES[entity]
    columns = spec["columns"]
    sql = "SELECT " + ", ".join(columns[name] for name in selected) + " FROM " + spec["table"]
    args = []
    if field is not None:
        column = columns[field]
        if match == "equals":
            sql += " WHERE " + column + " = ? COLLATE NOCASE"
            args.append(str(value))
        elif match == "contains":
            sql += " WHERE " + column + " LIKE ? ESCAPE '!'"
            args.append("%" + _like(value) + "%")
        else:
            sql += " WHERE " + column + " LIKE ? ESCAPE '!'"
            args.append(_like(value) + "%")
    if spec["order"]:
        sql += " ORDER BY " + spec["order"]
    sql += " LIMIT ? OFFSET ?"
    args.extend([limit, offset])
    conn = _connect()
    try:
        cursor = conn.execute(sql, args)
        return [dict(zip(selected, record)) for record in cursor.fetchall()]
    except sqlite3.Error:
        raise _Fail("upstream", "The database could not answer the query.")
    finally:
        conn.close()
`

/** OData helpers (D-563): literal compilation for `$filter` and key predicates. Values are validated against the declared type and only then written. */
export const RUNTIME_ODATA = `

_ODATA_GUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_ODATA_DATE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
_ODATA_STAMP = re.compile(
    r"^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\\.[0-9]{1,12})?)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$"
)
_ODATA_TIME = re.compile(r"^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\\.[0-9]{1,12})?)?$")
_ODATA_NUMBER = re.compile(r"^-?[0-9]{1,38}(\\.[0-9]{1,38})?([eE][+-]?[0-9]{1,3})?$")


def _odata_bad(message):
    return _Fail("invalid_argument", message)


def _odata_literal(spec, value):
    """The OData URL literal for a value, checked against the declared type first. Nothing is concatenated unchecked."""
    kind = spec["kind"]
    if kind == "string":
        text = str(value)
        if len(text) > 256 or any(ord(ch) < 32 or ord(ch) == 127 for ch in text):
            raise _odata_bad("A text value of at most 256 printable characters is required.")
        return "'" + text.replace("'", "''") + "'"
    text = ("true" if value else "false") if isinstance(value, bool) else str(value).strip()
    if len(text) > 80:
        raise _odata_bad("The value is too long.")
    if kind == "enum":
        if text not in spec["enum"]:
            raise _odata_bad("Invalid value; allowed values: " + ", ".join(spec["enum"][:20]) + ".")
        return spec["enumType"] + "'" + text + "'"
    if kind == "boolean":
        if text.lower() not in ("true", "false"):
            raise _odata_bad("A boolean value (true or false) is required.")
        return text.lower()
    if kind == "guid":
        if not _ODATA_GUID.match(text):
            raise _odata_bad("A GUID such as 01234567-89ab-cdef-0123-456789abcdef is required.")
        return text
    if kind == "date":
        try:
            datetime.date.fromisoformat(text)
        except ValueError:
            raise _odata_bad("A date such as 2026-01-31 is required.")
        if not _ODATA_DATE.match(text):
            raise _odata_bad("A date such as 2026-01-31 is required.")
        return text
    if kind == "datetimeoffset":
        if not _ODATA_STAMP.match(text):
            raise _odata_bad("A date and time with offset such as 2026-01-31T12:00:00Z is required.")
        return text
    if kind == "timeofday":
        if not _ODATA_TIME.match(text):
            raise _odata_bad("A time of day such as 12:30:00 is required.")
        return text
    if kind == "number":
        if not _ODATA_NUMBER.match(text):
            raise _odata_bad("A number is required.")
        return text
    raise _odata_bad("This field cannot be used in a filter.")


def _odata_filter(entity, field, match, value):
    """The $filter text for one field/value/match triple, or None when no filter was asked for."""
    if field is None and value is None:
        return None
    if field is None or value is None:
        raise _odata_bad("Give both field and value to filter, or neither.")
    if match not in _MATCH_MODES:
        raise _odata_bad("match must be one of: equals, contains, startsWith.")
    specs = _ODATA[entity]["fields"]
    if not isinstance(field, str) or field not in specs or not specs[field]["filter"]:
        raise _odata_bad("Unknown or unfilterable field. Fields that can be filtered: " + ", ".join(sorted(n for n, f in specs.items() if f["filter"]))[:300] + ".")
    spec = specs[field]
    literal = _odata_literal(spec, value)
    if match == "equals":
        return field + " eq " + literal
    if spec["kind"] != "string":
        raise _odata_bad("contains and startsWith only work on text fields.")
    return ("contains(" if match == "contains" else "startswith(") + field + "," + literal + ")"


def _odata_path(entity, values):
    """Entity set path with the key predicate: Set(value) for one key property, Set(A=value,B=value) for several."""
    spec = _ODATA[entity]
    keys = spec["key"]
    parts = []
    for name, value in zip(keys, values):
        parts.append(urllib.parse.quote(_odata_literal(spec["fields"][name], value), safe="'"))
    if len(keys) == 1:
        return spec["set"] + "(" + parts[0] + ")"
    return spec["set"] + "(" + ",".join(name + "=" + part for name, part in zip(keys, parts)) + ")"


def _odata_rows(data):
    """Rows of an entity set response: the value array. Anything else is an honest failure."""
    if isinstance(data, dict) and isinstance(data.get("value"), list):
        return _dicts(data["value"])
    raise _Fail("upstream", "The upstream service returned an unexpected response shape.")


def _odata_more(data):
    """True when the service continues with a server-driven paging link."""
    return isinstance(data, dict) and bool(data.get("@odata.nextLink"))


def _odata_capped_warning(returned, requested):
    return (
        "The service returned %d of the %d requested rows and has more; it limits each response. "
        "Use page_size=%d or smaller, otherwise the rows between pages are skipped." % (returned, requested, returned)
    )


def _odata_item(data):
    return data if isinstance(data, dict) and data else None
`
