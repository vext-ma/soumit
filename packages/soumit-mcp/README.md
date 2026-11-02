# @vext-ma/soumit-mcp

**Official Model Context Protocol (MCP) Server for Soumit (https://soumit.ma)**  
*Moroccan Public Procurement Intelligence for Claude Desktop, Cursor, Claude Code, Windsurf, and Autonomous AI Agents.*

[![MCP Protocol](https://img.shields.io/badge/MCP-2024--11--05-blueviolet)](https://modelcontextprotocol.io/)
[![Décret 2-22-431](https://img.shields.io/badge/Maroc-Décret_2--22--431-green)](https://soumit.ma)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Overview

`@vext-ma/soumit-mcp` connects Large Language Models (Claude 3.7 / Opus 3.5, GPT-4o, Gemini 2.0 / 3.8) directly to the **Soumit Intelligence Engine**.

It equips your agent with live tools to:
1. Search active Moroccan public tenders across all regions and sectors.
2. Inspect full consultation dossiers (CPS, RC, BPU), eliminatory criteria, and Go/No-Go scorecards.
3. Compute exact financial compliance under **Moroccan Procurement Decree n° 2-22-431** (checking abnormally low and excessive bid price thresholds under Articles 44 & 45).
4. Extract historical competitor awards, winning prices, discount rates, and buyer client relationships.
5. Retrieve weekly and quarterly public procurement barometer snapshots.
6. Audit administrative submission folders to eliminate instant disqualification risks (Articles 27 & 28).

---

## Quick Setup

### 1. Claude Desktop

Add `@vext-ma/soumit-mcp` to your `claude_desktop_config.json`:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "soumit-procurement": {
      "command": "npx",
      "args": ["-y", "@vext-ma/soumit-mcp"],
      "env": {
        "SOUMIT_API_KEY": "sk_live_your_api_key_here",
        "SOUMIT_API_URL": "https://soumit.ma"
      }
    }
  }
}
```

### 2. Cursor IDE

In your project root, configure `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "soumit": {
      "command": "npx",
      "args": ["-y", "@vext-ma/soumit-mcp"],
      "env": {
        "SOUMIT_API_KEY": "sk_live_your_api_key_here"
      }
    }
  }
}
```

### 3. Claude Code / CLI

```bash
claude mcp add soumit npx -y @vext-ma/soumit-mcp
```

---

## Exposed MCP Tools

### `search_tenders`
Search live tenders on `marchespublics.gov.ma` normalized with AI extraction.
- `query` *(string)*: Keywords (e.g. `'scanner IRM'`, `'fibre optique'`, `'travaux assainissement'`).
- `sector` *(string)*: `'travaux'`, `'fournitures'`, or `'services'`.
- `min_amount` *(number)*: Minimum budget in MAD.
- `limit` *(number)*: Maximum results (default: 10).

### `get_tender_details`
Retrieve structured tender specifications, DCE synthesis, deadlines, and Go/No-Go factor breakdown.
- `tender_id` *(string, required)*: Soumit tender identifier or official reference.

### `check_regulatory_compliance`
Instant mathematical compliance audit against Decree 2-22-431:
- `estimated_amount_ht` *(number, required)*: Administrative tender estimate in MAD HT.
- `proposed_amount_ht` *(number, required)*: Proposed offer price in MAD HT.
- `sector_type` *(string)*: `'travaux'` (-20% threshold) vs `'fournitures'` / `'services'` (-25% threshold).

### `search_competitor_awards`
Competitive intelligence on Moroccan suppliers and contractors.
- `competitor_name` *(string, required)*: Company name or keyword.
- `limit` *(number)*: Number of past awards.

### `get_market_barometer`
Macro procurement market trends, median discounts, and sector volume distribution.
- `period` *(string)*: `'current'` (weekly) or `'quarterly'`.

### `audit_submission_checklist`
Crash-test mandatory administrative documents (Articles 27 & 28).
- `tender_reference` *(string, required)*: Tender reference.
- `has_provisional_guarantee` *(boolean)*: Bank guarantee original ready.
- `has_declaration_on_honor` *(boolean)*: Conforming declaration model.
- `has_site_visit_certificate` *(boolean)*: Site visit certificate obtained.

---

## Programmatic Library Usage

You can also import the regulatory validator directly into your Node.js or TypeScript code:

```typescript
import { computeDecreeCompliance } from "@vext-ma/soumit-mcp";

const result = computeDecreeCompliance({
  estimatedAmountHt: 2_500_000,
  proposedAmountHt: 1_800_000,
  sectorType: "fournitures", // max allowed discount: 25% (min: 1,875,000 MAD)
});

console.log(result.status); 
// "OFFRE_ANORMALEMENT_BASSE"
console.log(result.advisory);
// "L'offre est inférieure de 28.0% à l'estimation administrative..."
```

---

## Tenancy & Data Sovereignty

- **No Data Egress**: Operates entirely within the sovereign boundaries of Moroccan law.
- **Fail-Closed Privacy**: Your prompts, API keys, and internal catalogues are never stored or logged by public discovery endpoints.

---

## License

MIT © [VEXT AI](https://vext.ma)  
Casablanca, Morocco
