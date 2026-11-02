#!/usr/bin/env python3
"""Public Procurement Market Barometer Tracker.

Demonstrates consuming Soumit's macro intelligence endpoints:
- GET /api/v1/barometer (weekly snapshots, sector breakdown, median discounts)
- GET /api/v1/barometer/quarterly (quarterly market trends)

Usage:
    export SOUMIT_API_KEY="sk_live_..."
    python barometer_tracker.py
"""

from __future__ import annotations

import os
import sys

from soumit import Soumit


def main() -> int:
    api_key = os.environ.get("SOUMIT_API_KEY")
    if not api_key:
        print("Set SOUMIT_API_KEY to run this example.", file=sys.stderr)
        return 1

    with Soumit(api_key=api_key) as client:
        print("📡 Fetching weekly Moroccan public procurement barometer...")
        barometer = client.barometer.current()

        edition = barometer.get("edition_date", "Current")
        total_tenders = barometer.get("total_new_tenders", 0)
        total_budget = barometer.get("total_budget_mad", 0)
        avg_budget = barometer.get("average_budget_mad", 0)
        discount = barometer.get("median_discount_pct")

        print(f"\n=======================================================")
        print(f"🇲🇦 SOUMIT MARKET BAROMETER — ÉDITION {edition}")
        print(f"=======================================================")
        print(f"Total New Tenders    : {total_tenders:,}")
        print(f"Total Budget Volume  : {total_budget:,.2f} MAD")
        print(f"Average Budget / AO  : {avg_budget:,.2f} MAD")
        print(f"Median Discount Rate : {f'{discount:.1f}%' if discount is not None else 'N/A'}")

        sectors = barometer.get("sectors", [])
        if sectors:
            print(f"\n🏭 Top Activity Sectors:")
            for s in sectors[:5]:
                print(f"  • {s['name']:<25} : {s['count']:>4} tenders | {s['volume']:>14,.2f} MAD ({s['share_pct']}%)")

        regulatory = barometer.get("regulatory_insight")
        if regulatory:
            print(f"\n⚖️ Regulatory Highlight ({regulatory.get('legal_ref', 'Décret 2-22-431')}):")
            print(f"  {regulatory.get('title')}")
            print(f"  {regulatory.get('takeaway')}")

        print(f"\n=======================================================")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
