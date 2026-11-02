# Soumit (soumit.ma) — Moroccan Public Procurement Intelligence Engine

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![OpenAPI 3.1](https://img.shields.io/badge/OpenAPI-3.1-6BA539?logo=openapiinitiative&logoColor=white)](openapi.json)
[![Moroccan Décret](https://img.shields.io/badge/Décret-2--22--431-emerald)](docs/decree-2-22-431.md)
[![TypeScript SDK](https://img.shields.io/badge/TypeScript-%40vext--ma%2Fsoumit--api-3178C6?logo=typescript&logoColor=white)](packages/soumit-api)
[![Python SDK](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)](packages/soumit-api/python)
[![MCP Server](https://img.shields.io/badge/MCP-%40vext--ma%2Fsoumit--mcp-purple)](packages/soumit-mcp)

**Soumit** ([soumit.ma](https://soumit.ma)) is Morocco's flagship public procurement intelligence engine, built and operated by **[Vext](https://vext.ma)**.

Every day, Moroccan public contracting authorities (*acheteurs publics*) publish hundreds of tender notices, consultation dossiers (DCE), and scanned award minutes (*procès-verbaux d'attribution*) on `marchespublics.gov.ma`. Soumit ingests the entire corpus, reads scanned PDF award minutes page-by-page using multimodal vision models, audits regulatory compliance under Moroccan Procurement **Décret n° 2-22-431**, and gives suppliers unambiguous **Go / No-Go verdicts** with verified justification.

This repository is the official public project monorepo under the **[@vext-ma](https://github.com/vext-ma)** organization, containing the public OpenAPI 3.1 contract, official TypeScript/Node.js SDK, Python SDK, Model Context Protocol (MCP) server, architecture specifications, and integration examples.

---

## Live Key Metrics in Production

- **9,954** Tender notices ingested and continuously indexed across all 12 Moroccan regions.
- **2,885** Scanned award notices (PVs) extracted page-by-page with line-by-line competitor pricing.
- **5,613** Competing bids on record across 1,139 lots and 316 contracting authorities.
- **28%** of public lots historically awarded to single bidders — telemetry not surfaced on the government portal.
- **24 Public API Endpoints** for tenders, awards, market barometers, supplier pursuits, and briefings.

---

## Repository Layout

```text
.
├── openapi.json                    # Full OpenAPI 3.1 machine-readable contract (24 endpoints)
├── docs/                           # Architecture, authentication, data model, and legal guides
│   ├── architecture.md             # Ingestion pipelines, vision extraction, vector telemetry
│   ├── authentication.md           # API keys, scopes, headers, rate limits
│   ├── data-model.md               # Tenders, awards, lots, competitors, barometers
│   ├── decree-2-22-431.md          # Legal formulas for Moroccan procurement compliance
│   ├── errors.md                   # RFC 7807 problem details
│   ├── pagination.md               # Cursor pagination (limit & starting_after)
│   ├── rate-limits.md              # 1,000 read/hr, 300 write/hr, Retry-After headers
│   └── webhooks.md                 # HMAC-SHA256 signature verification & retries
├── packages/
│   ├── soumit-api/                 # Official @vext-ma/soumit-api client SDK
│   │   ├── src/index.ts            # Zero-dependency TypeScript/Node.js client
│   │   └── python/                 # Python 3.10+ client (httpx-based)
│   └── soumit-mcp/                 # Official @vext-ma/soumit-mcp Model Context Protocol server
│       ├── bin/soumit-mcp.js       # Executable CLI runner
│       └── src/index.ts            # MCP tools (search_tenders, check_regulatory_compliance, etc.)
└── examples/                       # Runnable partner & supplier integrations
    ├── curl.sh                     # Direct cURL requests with Bearer tokens
    ├── node/                       # Node.js tender matcher & webhook receiver
    └── python/                     # Deadline watcher, market share analyzer, barometer tracker
```

---

## Quickstart: TypeScript / Node.js SDK

Install the official zero-dependency client from npm:

```bash
npm install @vext-ma/soumit-api
```

```typescript
import { Soumit } from '@vext-ma/soumit-api';

const client = new Soumit({
  apiKey: process.env.SOUMIT_API_KEY!,
});

// Search active tenders matching medical equipment in Casablanca
const { data: tenders } = await client.tenders.list({
  query: 'défibrillateur',
  region: 'Casablanca-Settat',
  status: 'OPEN',
});

// Fetch detailed AI verdict and regulatory scorecard
const verdict = await client.tenders.getVerdict(tenders[0].id);
console.log(`Verdict: ${verdict.recommendation} (Confidence: ${verdict.confidence})`);
console.log(`Abnormally low offer threshold: ${verdict.decree_compliance.abnormally_low_threshold_mad} MAD`);
```

---

## Quickstart: Python SDK

```bash
pip install httpx
```

```python
from packages.soumit_api.python.soumit import Soumit

client = Soumit(api_key="your_api_key")

# List competitor awards and discount percentages
awards = client.awards.list(buyer="Centre Hospitalier Universitaire Ibn Sina")
for award in awards["data"]:
    print(f"Lot: {award['lot_title']} -> Winner: {award['winner_name']} for {award['amount_mad']:,} MAD")
```

---

## Quickstart: Model Context Protocol (MCP) Server

Connect your local AI assistant (Claude Desktop, Cursor, Cline) to live Moroccan tender telemetry:

```bash
npx @vext-ma/soumit-mcp
```

### Claude Desktop Configuration (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "soumit": {
      "command": "npx",
      "args": ["-y", "@vext-ma/soumit-mcp"],
      "env": {
        "SOUMIT_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

### Supported MCP Tools

1. `search_tenders`: Search notices by sector, region, and buyer.
2. `get_tender_details`: Retrieve full CPS specifications, estimated budget, and deadline.
3. `check_regulatory_compliance`: Compute abnormally low (-20% / -25%) and excessive (+20%) thresholds under Décret 2-22-431.
4. `search_competitor_awards`: Look up competitor win rates and elimination reasons from scanned PVs.
5. `get_market_barometer`: Access regional price indexes and cancellation telemetry.
6. `audit_submission_checklist`: Validate mandatory documents, temporary bank bond (*caution provisoire*), and signature deadlines.

---

## Moroccan Procurement Décret n° 2-22-431 Compliance

Soumit enforces the statutory rules enacted by the Moroccan Ministry of Economy & Finance:

| Rule | Article | Formula / Criteria |
| :--- | :--- | :--- |
| **Abnormally Low (Works)** | Art. 41 § 1 | Proposed price $< 0.80 \times \text{Buyer Estimation}$ |
| **Abnormally Low (Supplies & Services)** | Art. 41 § 2 | Proposed price $< 0.75 \times \text{Buyer Estimation}$ |
| **Excessive Bid Ceiling** | Art. 41 § 4 | Proposed price $> 1.20 \times \text{Buyer Estimation}$ |
| **Standard Publication Period** | Art. 23 § 1 | $\ge 21\text{ calendar days}$ between notice and bid opening |
| **Major Works Threshold** | Art. 23 § 2 | $\ge 40\text{ days}$ for works $\ge 65,000,000\text{ MAD HT}$ |
| **Urgent Procurement Procedure** | Art. 23 § 3 | $\ge 10\text{ calendar days}$ strictly under administrative emergency |

---

## Data Residency & Sovereignty

In strict compliance with Moroccan Law n° 09-08 (CNDP) and national digital sovereignty principles:
- **Zero Raw Document Egress**: Third-party tender dossiers (DCE) are processed entirely inside Moroccan and sovereign edge boundaries.
- **Public Data Integrity**: Sourced exclusively from lawful administrative gazettes and public procurement disclosures.
- **HMAC Signatures**: Webhook payloads are hashed with `HMAC-SHA256` keys to guarantee authentic transmission.

---

## Company & Resources

- **Official Website**: [https://soumit.ma](https://soumit.ma)
- **Vext Company Projects**: [https://vext.ma/projects](https://vext.ma/projects)
- **In-Depth Case Study**: [https://vext.ma/work/soumit-tender-intelligence](https://vext.ma/work/soumit-tender-intelligence)
- **Live OpenAPI 3.1 Spec**: [https://vext.ma/soumit/openapi.json](https://vext.ma/soumit/openapi.json)
- **Security Disclosures**: `security@vext.ma`

## License

This monorepo, SDKs, and examples are licensed under the **[MIT License](LICENSE)**.
Copyright © 2026 VEXT AI.
