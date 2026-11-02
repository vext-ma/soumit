# Pagination

Every list endpoint returns the same envelope:

```json
{
  "object": "list",
  "data": [ … ],
  "has_more": true,
  "next_cursor": "eyJwIjoiMjAyNi0wOC0xM…"
}
```

To continue, pass `next_cursor` back unmodified as `cursor`. When `has_more` is
`false`, `next_cursor` is `null` and you are done.

```bash
curl -H "Authorization: Bearer $SOUMIT_API_KEY" \
     "https://soumit.ma/api/v1/tenders?limit=100"

curl -H "Authorization: Bearer $SOUMIT_API_KEY" \
     "https://soumit.ma/api/v1/tenders?limit=100&cursor=eyJwIjoiMjAyNi0wOC0xM…"
```

## Page size

`limit` defaults to **25** and caps at **100**. A larger value is an error, not
a silent clamp:

```json
{ "error": { "code": "invalid_parameter", "param": "limit",
             "message": "`limit` must not exceed 100." } }
```

Silently clamping would mean a client asking for 5,000 rows gets 100 and never
learns it is missing 4,900 — the sort of bug that surfaces months later as
"the report is wrong".

## Cursors are opaque

A cursor is a token. Its encoding is not part of the contract and will change.
Do not decode, parse, construct or store one as a permanent bookmark; treat it
as a string you received and hand back.

Cursors belong to the query that produced them. Changing the filters mid-walk
and reusing an old cursor is undefined — start a fresh walk instead.

An unparseable cursor is `invalid_cursor`, distinct from `invalid_parameter`, so
a client that typed `limit=5000` is not told its cursor is corrupt and sent
looking in the wrong place.

## Why cursors rather than `offset`

Offsets are wrong on a moving corpus. Tenders arrive continuously and lists are
ordered newest first, so between page 1 and page 2 new rows push everything down
— and `?offset=25` silently re-serves rows you already saw while skipping others
entirely. A nightly sync would lose tenders and never know.

These cursors are **keyset** cursors: the anchor is a specific row — its sort
value plus its id as a tiebreak — not a count of rows preceding it. "Give me
what sorts after this exact row" cannot skip, whatever arrives above it. The id
tiebreak is load-bearing rather than decorative: `published_at` has day
granularity on many notices and is frequently identical across a whole scraped
batch, and a keyset over a non-unique key drops every row sharing the boundary
value.

## Walking a full list

The official clients do this for you:

```python
for tender in soumit.tenders.auto_paginate(status="open"):
    ...
```

```typescript
for await (const tender of soumit.tenders.autoPaginate({ status: "open" })) {
  ...
}
```

By hand:

```python
cursor, out = None, []
while True:
    page = get("/api/v1/tenders", params={"limit": 100, "cursor": cursor})
    out.extend(page["data"])
    if not page["has_more"]:
        break
    cursor = page["next_cursor"]
```

A full walk of the corpus at `limit=100` is ~37 requests — comfortably inside
the 1,000/hour read budget. Filter server-side where you can (`published_after`,
`deadline_after`, `region`, `status`) rather than pulling everything and
filtering locally; it is faster and cheaper for both sides.

## Incremental sync

For a job that runs periodically, do not re-walk the corpus. Keep the timestamp
of your last successful run and pass it as `published_after`:

```python
page = get("/api/v1/tenders", params={
    "published_after": last_run_iso,   # ISO 8601
    "limit": 100,
})
```

For private resources, `/api/v1/events` is the better spine: it is append-only,
so polling it with a cursor gives you exactly what changed since you last
looked — the same bodies your webhook endpoints receive, if you would rather
poll than accept inbound requests. See [webhooks.md](webhooks.md).
