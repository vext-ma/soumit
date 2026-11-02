# Soumit Public API & Developer Surface

**Programmatic Access to Moroccan Public Procurement (Marchés Publics Maroc — Décret n° 2-22-431)**

[![OpenAPI 3.1](https://img.shields.io/badge/OpenAPI-3.1-6BA539?logo=openapiinitiative&logoColor=white)](/soumit/openapi.json)
[![API status](https://img.shields.io/badge/API-live-brightgreen)](https://soumit.ma/api/v1)
[![SDK](https://img.shields.io/badge/SDK-@vext--ma/soumit--api-blue)](/packages/soumit-api-client)
[![MCP](https://img.shields.io/badge/MCP-@vext--ma/soumit--mcp-purple)](/packages/soumit-mcp)

Welcome to the developer documentation for [Soumit](https://soumit.ma), powered and maintained by [VEXT AI](https://vext.ma) in Casablanca.

The Soumit API provides programmatic access to Moroccan public calls for tenders (*appels d'offres*), attribution records (*procès-verbaux d'ouverture et de jugement*), AI-driven DCE extraction, Go/No-Go decision scorecards, and regulatory compliance checks under Moroccan Procurement Decree n° 2-22-431.

---

## Guides & Documentation

| Document | Description |
|---|---|
| [**Architecture & Philosophy**](architecture.md) | Platform principles, fail-closed multi-tenancy, honesty contract, and edge topology |
| [**Authentication & Scopes**](authentication.md) | Bearer tokens (`sk_live_...`), scopes vocabulary, and key lifecycle management |
| [**Data Model & Honesty Contract**](data-model.md) | Exhaustive resource models, `unavailable` reason codes, and provenance tiers |
| [**Decree 2-22-431 Reference**](decree-2-22-431.md) | Moroccan public procurement decree mathematical formulas, pricing corridors, and submission checklists |
| [**Cursor Pagination**](pagination.md) | Deterministic opaque cursor pagination mechanics and batch walking |
| [**Error Handling**](errors.md) | Machine-readable error codes table, HTTP status codes, and recovery playbook |
| [**Rate Limits & Budgets**](rate-limits.md) | Quotas, headers (`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`), and backoff |
| [**Webhooks & Signatures**](webhooks.md) | Real-time event subscription, HMAC-SHA256 signature verification, and replay defense |
| [**OpenAPI 3.1 Contract**](/soumit/openapi.json) | The complete, machine-readable OpenAPI 3.1 specification (24 endpoints) |

---

## SDKs & Toolkits

- **Node.js & TypeScript SDK**: [`@vext-ma/soumit-api`](/packages/soumit-api-client)
- **Python Client**: [`soumit`](/packages/soumit-api-client/python)
- **Model Context Protocol (MCP) Server**: [`@vext-ma/soumit-mcp`](/packages/soumit-mcp) (for Claude Desktop, Cursor, Claude Code, Windsurf)

---

## Quick Exploration

The service index is unauthenticated so you can inspect service health and discovery endpoints immediately:

```bash
curl https://soumit.ma/api/v1
```

```json
{
  "object": "service_index",
  "version": "1.0.0",
  "openapi_url": "/api/v1/openapi.json",
  "resources": [
    "/api/v1/tenders",
    "/api/v1/awards",
    "/api/v1/barometer",
    "/api/v1/boncommandes",
    "/api/v1/catalogue",
    "/api/v1/pursuits",
    "/api/v1/executive/briefings",
    "/api/v1/events",
    "/api/v1/webhooks",
    "/api/v1/usage"
  ],
  "scopes": [
    "tenders:read",
    "awards:read",
    "analyses:read",
    "verdicts:read",
    "documents:read",
    "catalogue:read",
    "catalogue:write",
    "pursuits:read",
    "pursuits:write",
    "boncommandes:read",
    "executive:read",
    "executive:write",
    "events:read",
    "webhooks:read",
    "webhooks:write"
  ],
  "rate_limits": {
    "read_per_hour": 1000,
    "write_per_hour": 300
  }
}
```

---

## Tenancy Guarantee & Data Privacy

1. **Strict Tenant Separation**: An API key is strictly scoped to your organization. Private data (verdicts, analyses, catalogues, pursuits, webhooks) is never reachable by third parties.
2. **Public Data Corpus**: Public data (tenders, awards, market barometer) is verified open government data published by Moroccan public entities in accordance with legal transparency statutes.
3. **Moroccan CNDP Law 09-08**: Personal and company data processed through Soumit adheres to sovereign data protection and encryption standards.
