# Soumit API — Runnable Examples

Worked, runnable examples demonstrating the public developer surface of [Soumit](https://soumit.ma).

Every example uses live API conventions:
- Bearer key authentication (`sk_live_...`)
- Transparent cursor pagination via `autoPaginate` / `auto_paginate`
- Cryptographic webhook HMAC-SHA256 signature verification with replay protection
- Error handling adhering to the API honesty contract

---

## Prerequisites

Get an API key by signing in to your Soumit organization account, or requesting pilot access at `contact@vext.ma`.

Export your key in your terminal session:
```bash
export SOUMIT_API_KEY="sk_live_your_actual_key_here"
```

---

## Examples Catalog

### Python (`examples/soumit-api/python/`)

| Script | Purpose |
|---|---|
| `deadline_watcher.py` | Polls tenders closing in the next 7 days, checks Go/No-Go verdict status, and prints urgent action items |
| `award_market_share.py` | Walks attribution records (*procès-verbaux*), aggregates competitor win rates, and plots discount distributions |
| `barometer_tracker.py` | Queries the weekly Moroccan public procurement barometer (`/api/v1/barometer`) and prints macro market indicators |

To run:
```bash
cd python
pip install -r ../../../packages/soumit-api-client/python/pyproject.toml  # or pip install httpx
python deadline_watcher.py
python barometer_tracker.py
```

---

### Node.js / TypeScript (`examples/soumit-api/node/`)

| Script | Purpose |
|---|---|
| `webhook-receiver.js` | Production-grade Express/Node HTTP server verifying inbound `X-Soumit-Signature` headers using Web Crypto HMAC-SHA256 |
| `tender-matcher.js` | Uses `@vext-ma/soumit-api` to search open regional tenders, inspect DCE specifications, and check qualifications |

To run:
```bash
cd node
node tender-matcher.js
```

---

### Raw cURL (`examples/soumit-api/curl.sh`)

Contains cURL invocations for:
- Discovering endpoints via `GET /api/v1`
- Fetching OpenAPI 3.1 specification via `GET /api/v1/openapi.json`
- Listing tenders with cursor pagination parameters
- Retrieving single tender details and Go/No-Go verdicts
- Inspecting the weekly macro barometer
- Testing safe mutations with `Idempotency-Key` headers

Run directly:
```bash
./curl.sh
```
