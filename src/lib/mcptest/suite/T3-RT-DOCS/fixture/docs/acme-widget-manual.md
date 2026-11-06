# Acme Widget Service Manual (invented)

The Acme widget service lists small demonstration items called widgets. It is read only.
Every widget has an identifier, a display name and a size class (S, M or L).

## Documented operations

The service offers exactly two operations. Nothing else is available, and requests to any other path are
answered with 404.

1. **listWidgets**: `GET /widgets`. Returns the whole collection as `{ items, total }`. No parameters.
2. **getWidget**: `GET /widgets/{id}`. Returns one widget. An unknown identifier answers 404 with a
   short message.

## Notes

- Identifiers look like three capital letters, a dash and three digits.
- The service has no search, no update and no delete operation.
- Responses are JSON.
