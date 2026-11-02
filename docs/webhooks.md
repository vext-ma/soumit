# Webhooks

Soumit POSTs an event to your endpoint when something happens. The body is
exactly the `Event` resource you would read from `GET /api/v1/events` — one
shape, two transports.

## Event types

| Type | Fires when |
|---|---|
| `analysis.completed` | Your analysis of a tender finished. **Fetch it and read `quality.tier` before acting** — completed is not the same as trustworthy. |
| `verdict.changed` | The recorded Go/No-Go on a pursuit changed. Carries the previous decision. |
| `tender.deadline_approaching` | A tender you are engaged with crosses 14, 7 or 1 day to deadline. One event per threshold per tender. |
| `award.published` | An award notice was published for a tender you analysed, pursued or watchlisted. |

## Registering an endpoint

```bash
curl -X POST https://soumit.ma/api/v1/webhooks \
  -H "Authorization: Bearer $SOUMIT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-app.example/hooks/soumit",
    "event_types": ["analysis.completed", "award.published"]
  }'
```

The response contains `signing_secret` **exactly once**. Store it before you
close the terminal: every later response omits it, and it is the only way to
verify a delivery came from us. Lost it? Delete the endpoint and create another.

## Delivery headers

```http
X-Soumit-Event-Id:    evt_9f3c2a1b…
X-Soumit-Event-Type:  analysis.completed
X-Soumit-Delivery-Id: whd_4e1a…
X-Soumit-Attempt:     2
X-Soumit-Signature:   t=1786000000,v1=6f4b2c…
```

## Verifying the signature

The MAC is **HMAC-SHA256 over `"<t>.<raw request body>"`**, keyed with your
endpoint's signing secret, hex-encoded.

Three rules, all load-bearing:

1. **Sign the raw bytes.** Compute the MAC over the body exactly as received —
   before any JSON parse. Re-serialising changes whitespace and key order, and
   the MAC will not match.
2. **Compare in constant time.** `hmac.compare_digest`, `crypto.timingSafeEqual`.
   A `==` on a hex string leaks the correct value one byte at a time.
3. **Check `t`.** Reject anything more than **300 seconds** from your clock.
   Without this, a valid signature is valid forever and a captured delivery can
   be replayed at will.

### Python

```python
import hashlib, hmac, time

def verify(secret: str, header: str, raw_body: bytes, tolerance: int = 300) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(",") if "=" in p)
    timestamp, signature = parts.get("t"), parts.get("v1")
    if not timestamp or not signature:
        return False
    if abs(time.time() - int(timestamp)) > tolerance:
        return False
    expected = hmac.new(
        secret.encode(),
        f"{timestamp}.".encode() + raw_body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)
```

### Node

```javascript
import { createHmac, timingSafeEqual } from "node:crypto";

export function verify(secret, header, rawBody, tolerance = 300) {
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.split("=", 2)),
  );
  const { t, v1 } = parts;
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > tolerance) return false;

  const expected = createHmac("sha256", secret)
    .update(`${t}.`)
    .update(rawBody)          // Buffer, not a parsed object
    .digest("hex");

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(v1, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
```

A complete, runnable receiver is in
[`examples/node/webhook-receiver.js`](../examples/node/webhook-receiver.js).

## Delivery semantics

**At-least-once.** You will occasionally receive the same event twice — a
delivery that succeeded on our side but whose response we never saw is retried.
**Deduplicate on `X-Soumit-Event-Id`**, which is stable across every attempt of
the same event. Make your handler idempotent and this costs you nothing.

**Ordering is not guaranteed.** Retries interleave with fresh deliveries.
Order by `occurred_at` if sequence matters; do not infer it from arrival.

Note that `occurred_at` and `recorded_at` are different instants for reconciled
events — when something is discovered after the fact, `occurred_at` is when it
happened and `recorded_at` is when we learned it.

## Retries

A delivery succeeds on any 2xx. Anything else is retried **six times**:

| Attempt | Delay after the previous |
|---|---|
| 2 | 60 s |
| 3 | 5 min |
| 4 | 30 min |
| 5 | 2 h |
| 6 | 6 h |
| 7 | 24 h |

After the last attempt the delivery is `exhausted`. An endpoint that keeps
failing is auto-disabled; re-enabling it with `PATCH /api/v1/webhooks/{id}`
resets the failure counter.

Every attempt is recorded with its HTTP result and next retry time, readable
from `GET /api/v1/webhook-deliveries`. This is the answer to *"did you actually
send it?"* — a delivery that never happened has a row saying so, which beats
both parties guessing.

```bash
curl -H "Authorization: Bearer $SOUMIT_API_KEY" \
  "https://soumit.ma/api/v1/webhook-deliveries?status=failed&endpoint_id=whe_…"
```

## Writing a good handler

- **Respond 2xx fast**, then work. Verify the signature, enqueue, return 200.
  Doing the work inline turns a slow downstream into a retry storm.
- **Treat the payload as a notification, not as truth.** It tells you *what*
  changed; fetch the resource for its current state — especially
  `analysis.completed`, where the quality tier is the whole point.
- **Be idempotent.** At-least-once means duplicates are normal, not an incident.
- **Return a non-2xx when you genuinely failed.** That is what buys you the
  retry schedule. Swallowing an error with a 200 discards the event.

## Behind a firewall?

You do not need an inbound endpoint. `GET /api/v1/events` serves the same
bodies, cursor-paginated — poll it on your own schedule and keep the last
cursor. Same data, no ingress.
