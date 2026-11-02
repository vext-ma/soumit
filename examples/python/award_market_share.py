"""Who wins what, from published award history.

    export SOUMIT_API_KEY=sk_live_…
    python examples/python/award_market_share.py --since 2026-01-01

Scopes: awards:read

The point of this example is the two traps in award data, both of which produce
a confident wrong answer if ignored:

1. `amount_basis` — TTC and HT amounts differ by roughly the VAT rate. Summing
   them together produces a market-share table that looks precise and is not.
   This script segments by basis and reports each separately.

2. `canonical_key` — the same company appears under several spellings across
   notices. Grouping by display name splits one supplier into four.

It also never invents a total: awards with no amount are counted separately
rather than being treated as zero, which would silently deflate every share.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import defaultdict

from soumit import Soumit, SoumitError


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--since", help="Only awards on or after this date (YYYY-MM-DD)")
    parser.add_argument("--top", type=int, default=15, help="Rows to show (default 15)")
    args = parser.parse_args()

    api_key = os.environ.get("SOUMIT_API_KEY")
    if not api_key:
        print("Set SOUMIT_API_KEY.", file=sys.stderr)
        return 1

    # basis -> canonical_key -> {name, total, wins}
    by_basis: dict[str, dict[str, dict]] = defaultdict(lambda: defaultdict(
        lambda: {"name": None, "total": 0.0, "wins": 0}
    ))
    wins_without_amount = 0
    unsuccessful = 0
    total_awards = 0

    with Soumit(api_key=api_key) as soumit:
        for award in soumit.awards.auto_paginate(awarded_after=args.since):
            total_awards += 1

            if award.get("is_unsuccessful"):
                # Declared unsuccessful: no awardee, no amount. Not a win for
                # anyone, and counting it as one distorts the denominator.
                unsuccessful += 1
                continue

            awardee = award.get("awardee") or {}
            key = awardee.get("canonical_key") or awardee.get("name")
            if not key:
                continue

            amount = award.get("awarded_amount")
            if amount is None:
                wins_without_amount += 1
                # Still a win — just not a measurable one.
                basis = "unknown"
            else:
                basis = award.get("amount_basis") or "unknown"

            row = by_basis[basis][key]
            row["name"] = row["name"] or awardee.get("name") or key
            row["wins"] += 1
            if amount is not None:
                row["total"] += amount

    print(f"{total_awards} award record(s)")
    print(f"  {unsuccessful} declared unsuccessful (excluded)")
    print(f"  {wins_without_amount} with no published amount (counted as wins, not value)\n")

    for basis in sorted(by_basis):
        rows = sorted(by_basis[basis].values(), key=lambda r: r["total"], reverse=True)
        pool = sum(r["total"] for r in rows)

        label = {"ttc": "TTC (tax included)", "ht": "HT (before tax)"}.get(
            basis, "basis not stated"
        )
        print(f"── {label} — {len(rows)} supplier(s), {pool:,.0f} total")
        if basis == "unknown":
            print("   Not comparable with the segments above: the basis was not published.")

        for row in rows[: args.top]:
            share = f"{row['total'] / pool:6.1%}" if pool else "     —"
            print(f"   {share}  {row['total']:>14,.0f}  {row['wins']:>3} win(s)  {row['name']}")
        print()

    print("Amounts are never summed across bases: the gap is roughly the VAT")
    print("rate and would read as a competitive insight it is not.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SoumitError as exc:
        print(f"API error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
