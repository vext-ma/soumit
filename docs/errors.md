# Errors

Every failure returns the same envelope, whatever went wrong:

```json
{
  "error": {
    "type": "invalid_request_error",
    "code": "invalid_parameter",
    "message": "`limit` must not exceed 100.",
    "param": "limit",
    "request_id": "req_8f2c4b1e9a7d4c3fb0e1"
  }
}
```

| Field | Contract |
|---|---|
| `type` | Coarse family. Useful for a catch-all branch. |
| `code` | **Switch on this.** Stable, enumerated, never reworded. |
| `message` | English prose for a human reading a log. Will change. Do not parse. |
| `param` | The offending input, when there is one. `null` otherwise. |
| `request_id` | Present on **every** response, success or failure. Quote it. |

`message` is written for a developer debugging at 2am, which means it is
allowed to be improved. Any client that branches on message text will break
when it is. Branch on `code`.

## Complete code table

### 400 — `invalid_request_error`

| Code | Meaning |
|---|---|
| `invalid_request` | Malformed in a way the others do not cover |
| `invalid_parameter` | A query parameter is out of range or the wrong type |
| `invalid_cursor` | The `cursor` is not decodable, or was issued by an incompatible version |
| `invalid_json_body` | Body is absent, is not JSON, or is not a JSON object |
| `missing_parameter` | A required field was not supplied |

`invalid_cursor` is separate from `invalid_parameter` on purpose: a caller who
mistyped `limit=5000` should not be told their cursor is corrupt and sent
looking in the wrong place.

### 401 — `authentication_error`

| Code | Meaning |
|---|---|
| `authentication_required` | No credential presented |
| `invalid_api_key` | Not a well-formed key, or not a known one |
| `api_key_revoked` | Revoked. Create a new one. |
| `api_key_expired` | Past its expiry. Create a new one. |

All four carry `WWW-Authenticate: Bearer realm="api"`. None are retryable —
retrying a revoked key just burns budget.

### 403 — `permission_error`

| Code | Meaning |
|---|---|
| `insufficient_scope` | Valid key, missing scope. `detail` names the required scope and what the key holds. |
| `organization_inactive` | The organisation this key belongs to is not active. |

### 404 — `not_found_error`

`resource_not_found`. For private resources this also covers *exists, but not
yours*: an id belonging to another organisation is reported as not found rather
than as forbidden, because "forbidden" confirms the row exists and turns id
enumeration into a membership oracle.

### 409 — `conflict_error`

| Code | Meaning |
|---|---|
| `idempotency_key_reuse` | Same `Idempotency-Key`, **different** body |
| `idempotency_request_in_progress` | The original request with this key is still running |
| `resource_conflict` | The write conflicts with current state |

`idempotency_request_in_progress` is the one 409 worth retrying — wait a moment
and try again with the same key. See [rate-limits.md](rate-limits.md) for the
full idempotency contract.

### 413 / 415 — `invalid_request_error`

`payload_too_large`, `unsupported_media_type`. Send `Content-Type:
application/json`.

### 429 — `rate_limit_error`

`rate_limit_exceeded`. The body states the limit, the reset instant and
`retry_after_seconds`. Always retryable — after waiting.

### 500 / 503 — `api_error`

| Code | Status | Meaning |
|---|---|---|
| `internal_error` | 500 | A bug on our side. Quote the `request_id`. |
| `service_unavailable` | 503 | A dependency is unavailable — including the credential store. |

`service_unavailable` on the credential store means the API cannot verify *any*
key, so it serves nobody. There is no degraded mode in which an unauthenticated
caller is let through, which is why an outage here reads as 503 for everyone
rather than as a silent widening of access.

## What to retry

| | Retry? | How |
|---|---|---|
| 400, 401, 403, 404, 413, 415 | **No** | Fix the request. Retrying cannot help. |
| 409 `idempotency_request_in_progress` | Yes | Short wait, same key |
| 409 (others) | No | Reconcile state first |
| 429 | Yes | Wait `retry_after_seconds` |
| 500 | Yes, carefully | Exponential backoff, cap the attempts |
| 503 | Yes | Exponential backoff |

Retry idempotently. On a write, resend the **same** `Idempotency-Key` — that is
what makes a retry after a timeout safe rather than a double-write.

```python
import time, httpx

RETRYABLE = {429, 500, 502, 503, 504}

def call(request_fn, attempts=5):
    for attempt in range(attempts):
        response = request_fn()
        if response.status_code not in RETRYABLE:
            return response
        if attempt == attempts - 1:
            return response
        wait = response.headers.get("Retry-After")
        time.sleep(float(wait) if wait else min(2 ** attempt, 60))
    return response
```

## request_id

Every response carries `request_id`, in the body on errors and in the
`X-Request-Id` header throughout. It is in our logs. Log it on your side too —
a bug report that quotes one is answerable in minutes; one that says "it
returned 500 sometimes yesterday" is not.
