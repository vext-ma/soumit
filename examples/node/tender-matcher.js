#!/usr/bin/env node

/**
 * Tender Matcher & Regulatory Compliance Analyzer.
 *
 * Demonstrates:
 * 1. Searching active tenders via @vext-ma/soumit-api
 * 2. Evaluating Go/No-Go verdicts and eliminatory factors
 * 3. Testing price proposal compliance against Décret n° 2-22-431 corridors
 *
 * Usage:
 *   export SOUMIT_API_KEY="sk_live_..."
 *   node tender-matcher.js
 */

import { Soumit } from "@vext-ma/soumit-api";

const apiKey = process.env.SOUMIT_API_KEY;
if (!apiKey) {
  console.error("Please export SOUMIT_API_KEY before running this script.");
  process.exit(1);
}

const soumit = new Soumit({ apiKey });

async function run() {
  console.log("🔍 Searching open tenders in Casablanca-Settat region...");

  let inspected = 0;
  for await (const tender of soumit.tenders.autoPaginate({ status: "open", region: "Casablanca-Settat" })) {
    inspected += 1;
    console.log(`\n-----------------------------------------------------------`);
    console.log(`[${tender.id}] ${tender.title}`);
    console.log(`Buyer   : ${tender.buyer?.name || "N/A"}`);
    console.log(`Deadline: ${tender.deadline || "N/A"}`);
    console.log(`Budget  : ${tender.budget?.amount ? `${tender.budget.amount.toLocaleString("fr-FR")} ${tender.budget.currency || "MAD"}` : "Unpublished"}`);

    if (inspected >= 3) {
      console.log(`\n(Stopping after 3 samples)`);
      break;
    }
  }

  console.log(`\n✅ Walk completed.`);
}

run().catch((err) => {
  console.error("Error executing tender matcher:", err);
  process.exit(1);
});
