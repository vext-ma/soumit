# Rate limits & idempotency

## Budgets

Per API key, per rolling hour:

| Category | Default |
|---|---|
| Reads | **1,000 / hour** |
| Writes | **300 / hour** |

Budgets are per key, not per organisation — so a misbehaving batch job on one
key cannot starve your production integration on another. That is the main
argument for issuing one key per integration.

Need more? Say so when you request the key, with a sentence about the workload.
Limits are raised per key.

## Headers

Every response — success or failure — carries the budget state:

```http
RateLimit-Limit: 1000
RateLimit-Remaining: 987
RateLimit-Reset: 2841
RateLimit-Policy: 1000;w=3600
```

`RateLimit-Reset` is **seconds until the window resets**, not a timestamp.

Names follow the IETF `RateLimit-*` draft, which is where the ecosystem is
converging. `X-RateLimit-*` aliases are emitted alongside them, because a great
deal of existing client code reads those. Both carry identical values; prefer
the unprefixed ones in new code.

All of these are listed in `Access-Control-Expose-Headers`, so browser clients
can read them cross-origin.

## Being throttled

A 429 states the budget, when it returns, and how long to wait:

```json
{
  "error": {
    "type": "rate_limit_error",
    "code": "rate_limit_exceeded",
    "message": "Rate limit of 1000 read requests per hour exceeded for this API key.",
    "param": null,
    "request_id": "req_…"
  }
}
```

with `Retry-After` set, and `limit` / `remaining` / `reset_at` /
`retry_after_seconds` / `scope` repeated in the response `detail` so a client
that only parses JSON is not left guessing.

Throttled requests are metered separately — they count as refusals, never billed
as service, and they show up in `GET /api/v1/usage` under `rate_limited`, which
is how you notice a client has been quietly throttled for a week.

## Staying inside the budget

- **Filter server-side.** `published_after`, `deadline_before`, `region`,
  `status`, `buyer_key`, `awardee_key` cost one request; pulling the corpus and
  filtering locally costs 37.
- **Page at 100.** The default is 25; a full walk at the maximum is four times
  cheaper.
- **Sync incrementally.** Keep your last-run timestamp and pass
  `published_after`. Re-walking the whole corpus nightly is waste.
- **Poll `/api/v1/events`, or take webhooks.** For private resources, events
  tell you what changed. Polling every tender to see whether its analysis
  finished does not scale and will throttle you.
- **Read the headers before you hit the wall.** Back off at
  `RateLimit-Remaining` near zero rather than waiting for the 429.

## Idempotency

Send `Idempotency-Key` on any write — `POST /catalogue`, `POST /pursuits`,
`POST /webhooks`. Use a fresh UUID per logical operation.

```bash
curl -X POST https://soumit.ma/api/v1/pursuits \
  -H "Authorization: Bearer $SOUMIT_API_KEY" \
  -H "Idempotency-Key: 5c9e1f4a-2b3c-4d5e-8f70-1a2b3c4d5e6f" \
  -H "Content-Type: application/json" \
  -d '{"tender_id":"tnd_…","stage":"qualified","gono_decision":"go"}'
```

The contract:

| Situation | Result |
|---|---|
| Same key, **same** body | The first response is replayed, with `Idempotent-Replay: true` |
| Same key, **different** body | `409 idempotency_key_reuse` — nothing is written |
| Same key, original still running | `409 idempotency_request_in_progress` — wait and retry |

Three properties worth knowing, because the naive version of each is wrong:

**The body is fingerprinted.** Same key with a different payload is refused
rather than served the stored response. A retry loop that recycles one key
across different payloads would otherwise be handed *the other request's*
result and carry on believing its own write succeeded.

**Keys are scoped to the organisation, not to the API key.** Rotating
credentials in the middle of a retry sequence cannot produce a double-write.

**Failures are not pinned.** Only responses representing a decision — 2xx and
deterministic 4xx — are stored. A 500 or a 429 releases the record, because
caching *"the database was briefly unavailable"* under a key the client is about
to retry with would turn a five-second outage into a permanent failure for that
key.

A record left `in_progress` by a handler that died mid-flight blocks concurrent
duplicates for 60 seconds and is then reclaimable — never ignored, never
permanent.

This is what makes retrying a timed-out write safe: you did not learn whether it
committed, but resending the same key means you cannot commit it twice.
