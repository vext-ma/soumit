# @vext-ma/soumit-api

**Official TypeScript, Node.js & Python SDK for Soumit (https://soumit.ma)**  
*Programmatic intelligence for Moroccan Public Procurement (Marchés Publics Maroc — Décret n° 2-22-431).*

[![OpenAPI 3.1](https://img.shields.io/badge/OpenAPI-3.1-6BA539?logo=openapiinitiative&logoColor=white)](https://vext.ma/soumit/openapi.json)
[![API status](https://img.shields.io/badge/API-live-brightgreen)](https://soumit.ma/api/v1)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Overview

Moroccan public buyers publish thousands of calls for tender every year on the national procurement portal (`marchespublics.gov.ma`). Each tender arrives as an electronic consultation dossier (*Dossier de Consultation des Entreprises* - DCE) comprising compressed scans, lengthy CPS specifications, règlement de consultation (RC), price schedules (BPU), and complex qualification criteria.

Soumit monitors the portal continuously, ingests tender notices and DCE archives, extracts structured parameters via OCR and vision models, performs regulatory audits under **Décret n° 2-22-431**, computes competitor award trends, and provides definitive **Go/Watch/No-Go** verdict scorecards.

`@vext-ma/soumit-api` is the official developer client for both **TypeScript/JavaScript** and **Python**.

---

## Key Features

- **Zero-Dependency TypeScript**: Built on standard `fetch` and `crypto.subtle`. Works seamlessly in Node.js 18+, Cloudflare Workers, Cloudflare Pages, Bun, Deno, and modern browsers.
- **Python Client**: Fully typed modern Python 3.10+ client powered by `httpx`.
- **Honesty Contract**: A field that cannot be verified is strictly `null` (never a fabricated guess or synthetic average). Every resource carries an `unavailable` reason dictionary.
- **Transparent Pagination**: `autoPaginate()` (JS) and `auto_paginate()` (Python) handle opaque cursor traversal automatically.
- **Edge Resiliency**: Automatic exponential backoff with jitter on `429` (Rate Limited) and `5xx` responses, respecting `Retry-After`.
- **Safe Idempotency**: Automatically sends `Idempotency-Key` headers on mutating requests to prevent duplicate transactions.
- **Cryptographic Webhook Verification**: Constant-time HMAC-SHA256 signature validation with timestamp drift defense against replay attacks.

---

## Installation

### Node.js / TypeScript
```bash
npm install @vext-ma/soumit-api
# or
pnpm add @vext-ma/soumit-api
# or
yarn add @vext-ma/soumit-api
```

### Python
```bash
pip install ./packages/soumit-api-client/python
# or
pip install soumit
```

---

## Quickstart

### TypeScript / JavaScript

```typescript
import { Soumit } from "@vext-ma/soumit-api";

const soumit = new Soumit({
  apiKey: process.env.SOUMIT_API_KEY!, // sk_live_...
});

// 1. Walk open tenders closing in the next 30 days
for await (const tender of soumit.tenders.autoPaginate({ status: "open", region: "Casablanca-Settat" })) {
  console.log(`[${tender.id}] ${tender.title}`);
  console.log(`Buyer: ${tender.buyer.name} | Budget: ${tender.budget.amount} ${tender.budget.currency}`);
}

// 2. Inspect AI consultation analysis and Go/No-Go verdict
const verdict = await soumit.tenders.verdict("tnd_49210_2026");
console.log(`Verdict: ${verdict.scorecard.verdict} (Score: ${verdict.scorecard.total_score}/100)`);
for (const factor of verdict.scorecard.factors) {
  console.log(` - ${factor.label}: ${factor.status} (${factor.reason})`);
}

// 3. Weekly Public Procurement Barometer
const barometer = await soumit.barometer.current();
console.log(`Active Volume: ${barometer.total_budget_mad.toLocaleString()} MAD across ${barometer.total_new_tenders} tenders`);
```

### Python

```python
import os
from soumit import Soumit

soumit = Soumit(api_key=os.environ["SOUMIT_API_KEY"])

# Auto-paginate through published awards
for award in soumit.awards.auto_paginate(is_unsuccessful=False):
    print(f"Awardee: {award['awardee']['name']} | Amount: {award['awarded_amount']} MAD")

# Fetch market barometer
snapshot = soumit.barometer.current()
print(f"Top Sectors: {[s['name'] for s in snapshot['sectors']]}")
```

---

## Webhook Signature Verification

Soumit signs all outbound webhook deliveries using HMAC-SHA256 in the `X-Soumit-Signature` header:

```
X-Soumit-Signature: t=1730000000,v1=9b2e4f8a1c3d5e7a9b2e4f8a...
```

Verify signatures in your webhook route before parsing JSON:

```typescript
import { verifyWebhookSignature } from "@vext-ma/soumit-api";

app.post("/webhooks/soumit", async (req, res) => {
  const secret = process.env.SOUMIT_WEBHOOK_SECRET!;
  const signature = req.headers["x-soumit-signature"] as string;
  const rawBody = req.rawBody; // must be raw unparsed string or Buffer

  const isValid = await verifyWebhookSignature(secret, signature, rawBody, 300);
  if (!isValid) {
    return res.status(401).send("Invalid webhook signature or expired timestamp");
  }

  const event = JSON.parse(rawBody);
  console.log(`Received event ${event.type}:`, event.data);
  return res.status(200).send({ received: true });
});
```

---

## Complete API Surface (24 Endpoints)

| Resource | Endpoints | Capabilities |
|---|---|---|
| **Tenders** | `GET /api/v1/tenders`<br>`GET /api/v1/tenders/{id}`<br>`GET /api/v1/tenders/{id}/analysis`<br>`GET /api/v1/tenders/{id}/verdict`<br>`GET /api/v1/tenders/{id}/documents`<br>`GET /api/v1/tenders/{id}/catalogue-match`<br>`GET /api/v1/tenders/{id}/submission-package` | Query active tenders, search by region/sector/budget, extract DCE parameters, check Go/No-Go scorecards, audit catalogue matching, and review generated submission packages. |
| **Awards** | `GET /api/v1/awards` | Attribution records (*procès-verbaux*), winning bidder ICE, discount percentages, and eviction reasons. |
| **Barometer** | `GET /api/v1/barometer`<br>`GET /api/v1/barometer/quarterly` | Macro indicators: total weekly/monthly volume, sector distribution, median discount rates, and buyer payment records. |
| **Bon de Commande** | `GET /api/v1/boncommandes` | Simplified purchase orders and quotation requests under Decree thresholds. |
| **Catalogue** | `GET /api/v1/catalogue`<br>`POST /api/v1/catalogue`<br>`GET /api/v1/catalogue/{ref}` | Manage your organization's product SKU catalogue, reference costs, certifications, and delivery lead times. |
| **Pursuits** | `GET /api/v1/pursuits`<br>`POST /api/v1/pursuits` | Bid pipeline management: stages (prospecting, review, drafting, submitted, won, lost) and team assignees. |
| **Executive** | `GET /api/v1/executive/briefings`<br>`POST /api/v1/executive/briefings` | Executive radar briefings, competitor intelligence digests, and macro market analyses. |
| **Events & Webhooks** | `GET /api/v1/events`<br>`GET /api/v1/webhooks`<br>`POST /api/v1/webhooks`<br>`GET /api/v1/webhooks/{id}`<br>`PATCH /api/v1/webhooks/{id}`<br>`DELETE /api/v1/webhooks/{id}`<br>`GET /api/v1/webhook-deliveries` | Real-time event streaming (`analysis.completed`, `verdict.changed`, `tender.deadline_approaching`, `award.published`), delivery logs and retry tracing. |
| **Usage & Keys** | `GET /api/v1/usage`<br>`GET /api/v1/api-keys`<br>`POST /api/v1/api-keys`<br>`DELETE /api/v1/api-keys/{id}` | Metered request quotas, hourly budgets, and API key lifecycle management. |

---

## Tenancy & Data Privacy (CNDP Law 09-08)

- **Fail-Closed Tenancy**: Database sessions enforce strict organization isolation. Shared public procurement data (tenders, awards, barometer) is strictly separated from private organization data (analyses, catalogues, pursuits, webhooks).
- **Zero Foreign Data Egress**: All Soumit edge APIs run on sovereign Casablanca infrastructure or regional Cloudflare edge nodes compliant with Moroccan CNDP Law 09-08.
- **Zero Secret Leakage**: No internal database credentials, administrative keys, or private tokens are reachable through this SDK.

---

## License

MIT © [VEXT AI](https://vext.ma)
Casablanca, Morocco
