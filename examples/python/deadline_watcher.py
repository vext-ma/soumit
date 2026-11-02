"""Tenders closing soon, with the honest verdict for each.

    export SOUMIT_API_KEY=sk_live_…
    python examples/python/deadline_watcher.py --days 14

Scopes: tenders:read, verdicts:read

Demonstrates the two things most worth getting right when consuming this API:
filtering server-side rather than pulling the corpus, and reading a verdict
without pretending a withheld score is a zero.
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import date, timedelta

from soumit import NotFoundError, Soumit, SoumitError


def money(budget: dict) -> str:
    """Format a budget without inventing one."""
    if budget.get("amount") is not None:
        return f"{budget['amount']:,.0f} {budget.get('currency') or ''}".strip()
    # Published but unparseable: show what the buyer actually wrote.
    if budget.get("raw"):
        return f"as published: {budget['raw']}"
    return "not published"


def verdict_line(soumit: Soumit, tender_id: str) -> str:
    try:
        card = soumit.tenders.verdict(tender_id)["scorecard"]
    except NotFoundError:
        return "no verdict yet"

    if card.get("verdict_basis") == "hard_gate":
        blockers = ", ".join(f["label"] for f in card.get("blocking_factors", [])) or "unstated"
        return f"{card['verdict']} — blocked by {blockers}"

    if card.get("score_available"):
        return f"{card['verdict']} — {card['total_score']:.0f}/100"

    # A null score is a refusal to publish one. Reporting it as 0 would invert
    # the meaning: "we cannot say" is not "we say it is bad".
    known = card.get("grounded_weight_ratio")
    known_text = f", {known:.0%} of factor weight known" if known is not None else ""
    return f"{card['verdict']} — score withheld ({card.get('score_withheld_reason')}{known_text})"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--days", type=int, default=14, help="Horizon in days (default 14)")
    parser.add_argument("--region", help="Filter to one region")
    args = parser.parse_args()

    api_key = os.environ.get("SOUMIT_API_KEY")
    if not api_key:
        print("Set SOUMIT_API_KEY.", file=sys.stderr)
        return 1

    horizon = date.today() + timedelta(days=args.days)

    with Soumit(api_key=api_key) as soumit:
        # Filter server-side: one request beats walking 3,700 rows and
        # discarding most of them.
        tenders = list(
            soumit.tenders.auto_paginate(
                status="open",
                deadline_after=date.today().isoformat(),
                deadline_before=horizon.isoformat(),
                region=args.region,
            )
        )

        if not tenders:
            print(f"Nothing closing in the next {args.days} days.")
            return 0

        print(f"{len(tenders)} tender(s) closing before {horizon}\n")
        for tender in sorted(tenders, key=lambda t: t.get("deadline") or "9999"):
            print(f"  {tender.get('deadline') or 'no deadline'}  {tender.get('title')}")
            print(f"    buyer   {(tender.get('buyer') or {}).get('name') or 'unknown'}")
            print(f"    budget  {money(tender.get('budget') or {})}")
            if tender.get("relevance", {}).get("engaged"):
                print(f"    verdict {verdict_line(soumit, tender['id'])}")
            print()

        print(f"Rate limit: {soumit.rate_limit}")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SoumitError as exc:
        print(f"API error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
