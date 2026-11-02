# Data model

Seven resources. Two are shared public data; five are private to your
organisation. All of them obey the same honesty contract, so read that first.

---

## The honesty contract

**A field the API cannot establish is `null`, and never a substitute.**

This is the single most important thing to know about consuming this API,
because it is where it differs from most. A tender whose notice published no
budget has `budget.amount: null` — not a sector average, not a zero. A catalogue
item with no recorded cost has `margin_percent: null` — not a default rate. A
Go/No-Go factor with no input has `status: "unknown"` and `value: null`, and its
weight **leaves the denominator**, so it neither rewards nor punishes.

The product exists so somebody can decide whether to spend three days answering
a tender. A fabricated budget is worse than a blank one, because a blank one
gets checked.

### `unavailable`

Every resource carries an `unavailable` map: field name → stable reason code.

```json
{
  "budget": { "amount": null, "currency": null, "raw": "Voir règlement de consultation" },
  "unavailable": {
    "budget_amount": "not_parseable",
    "deadline": "not_published"
  }
}
```

Common codes: `not_published`, `not_extracted`, `not_parseable`,
`no_cost_recorded`. Codes are stable strings — switch on them.

**A field that is null and *absent* from the map is genuinely valueless**, as
opposed to unknown. The distinction matters: *the buyer published no budget*,
*the buyer published one we would not commit to reading as a number*, and *we
have not looked yet* are three different situations, and a bidder acts
differently in each.

Where a value was published but not parseable, the published text is preserved
verbatim — `budget.raw` above — so you can make your own call rather than
inheriting ours.

---

## Tender — *shared*

The published consultation. Identical rows for every organisation; only
`relevance` is yours.

| Field | Notes |
|---|---|
| `id`, `title`, `summary` | |
| `status` | Published status, verbatim |
| `procurement_procedure` | Open, restricted, negotiated… as published |
| `region`, `country`, `language` | |
| `buyer` | `{ id, name }` |
| `budget` | `{ amount, currency, raw }` — see the contract above |
| `published_at`, `detected_at`, `deadline` | ISO 8601. `detected_at` is when *we* saw it. |
| `source_url` | The notice on the origin portal |
| `analysis` | `{ status, completed_at }` — your analysis, if any |
| `relevance` | `{ engaged, has_analysis, has_pursuit, watchlisted }` |

`relevance` is computed from your private overlay only. It is the one part of a
shared row that differs between organisations, and it is how `?relevance=engaged`
narrows a list to tenders you are actually working.

**Filters:** `relevance`, `status`, `region`, `deadline_after`,
`deadline_before`, `published_after`.

---

## Award — *shared*

Attribution records (*procès-verbaux*): who won what, for how much. Shared
ground truth — the cross-customer history is the point.

| Field | Notes |
|---|---|
| `tender_id`, `tender_reference` | `tender_id` is null when the award has not been matched to a corpus tender |
| `buyer`, `awardee` | Each `{ name, canonical_key }` |
| `object_label`, `lot` | `lot` is `{ number, label }` |
| `awarded_amount`, `estimated_amount`, `currency` | |
| `amount_basis` | `ttc` or `ht`, or null |
| `award_date`, `publication_date` | |
| `is_unsuccessful` | The consultation was declared unsuccessful: no awardee, no amount |
| `source` | `{ url, document_url, extraction_method, extraction_model, extraction_confidence }` |

**Two traps.**

`amount_basis` — **do not compare amounts across bases.** The difference is
roughly the VAT rate, and comparing a TTC award against an HT estimate reads as
a competitive insight when it is an accounting artefact. Filter to one basis, or
carry the basis through your analysis.

`source.extraction_confidence` is 0..1, and **null means the extractor reported
none — not full confidence.** Treating null as 1.0 silently promotes your
weakest rows to your strongest.

`canonical_key` is the normalised form of a party's name — use it to group, not
the display name, since the same buyer appears under several spellings across
notices.

**Filters:** `tender_id`, `buyer_key`, `awardee_key`, `awarded_after`.

---

## Analysis — *private*

Your organisation's structured reading of a consultation. Another organisation's
analysis of the same tender is not reachable through this API, by any parameter.

The two fields that matter most:

**`quality.tier`**

| Tier | Meaning |
|---|---|
| `decision_ready` | Passed every readiness gate |
| `review_required` | Did not — a human should look before this drives a decision |
| `degraded` | Produced from impaired source material, e.g. a scan that would not OCR |

`quality` itself can be `null`, which means no assessment was recorded — itself
a reason to treat the analysis as unverified rather than as fine.

Alongside the tier: `score`, `degraded_mode`, `procurement_completeness`,
`extraction_confidence`, `analysis_confidence`, plus `missing_fields`,
`warnings` and `reasons` as arrays you can surface directly.

**`provenance.fields[]`** — per field: `exact` (read verbatim from the
consultation), `derived` (computed from something that was), `inferred`,
`missing` (looked for, not found), `unknown`. With `source`, `confidence`, and
`has_evidence_excerpt`.

`has_evidence_excerpt` is a boolean, deliberately. The excerpt itself is not
republished: it is a fragment of a third party's document. You learn *whether*
something in the consultation supports the field, not the text.

An LLM in the pipeline will occasionally be confidently wrong. Rather than
pretend otherwise, the API reports how much of each answer rests on something
checkable, and lets you set your own bar.

---

## Verdict — *private*

Go/No-Go, factor by factor.

```json
{
  "scorecard": {
    "verdict": "WATCH",
    "verdict_basis": "calibrated_score",
    "total_score": 61.4,
    "score_available": true,
    "score_withheld_reason": null,
    "raw_score": 61.4,
    "grounded_weight_ratio": 0.72,
    "thresholds": { "go": 70, "watch": 45 },
    "factors": [ … ],
    "blocking_factors": [ … ]
  }
}
```

**`verdict`** is `GO`, `WATCH` or `NO_GO`. **`verdict_basis`** says how it was
reached, and it is the field to read before trusting the verdict:

| Basis | Meaning |
|---|---|
| `hard_gate` | A proven blocker. No score needed — something disqualifies the bid outright. |
| `calibrated_score` | Thresholds applied to a score checked against recorded outcomes |
| `human_review_required` | No blocker and no publishable score |

**`total_score` can be null even when a verdict exists.** When the engine has no
blocker and no defensible score, it publishes `score_available: false` and a
`score_withheld_reason` instead of a number. `raw_score` — the weighted average
over known factors — is still there, and `grounded_weight_ratio` tells you what
share of the total factor weight was actually known. A 0.3 ratio means 70% of
the weighting had nothing behind it, which is why the score is withheld.

Each **factor** carries `key`, `label`, `weight`, `status` (`pass` / `fail` /
`unknown`), `value`, `score_label`, `reason` (a machine-readable code when
unknown or failing), `blocking`, and `provenance` with a `grounded` flag —
`false` for anything a model asserted rather than a record established.

`recorded_decision` is separate from the scorecard: what a **human** recorded on
the pursuit, distinct from what the engine computes. The two disagreeing is
useful information, not a bug.

---

## Catalogue — *private, read + write*

What your organisation can supply: `reference` (the key, unique within your
organisation), `name`, `description`, `categories`, `price`, `cost`,
`margin_percent`, `manufacturer`, `supplier`, `lead_time_days`,
`regulatory_registrations`.

`margin_percent` is computed only when a cost and a positive price both exist —
otherwise null, with the reason in `unavailable`.

`regulatory_registrations[]` carries `scheme` (e.g. `MA_AMMPS` — one scheme
among many, not a special case), `authority`, `country`, `number`, `status`
(`registered` / `in_progress` / `not_filed` / `expired` / `unknown`) and
`valid_until`. An item with no registration data carries an **empty array** —
never a fabricated `not_filed`, which would read as "we checked and they have
not filed".

`POST /api/v1/catalogue` upserts on `reference`. Omitted fields are left
untouched. Two organisations may hold the same reference; they are different
rows.

---

## Pursuit — *private, read + write*

Your bid pipeline for a tender: `stage`, `owner`, `priority`, `next_step`,
`gono_decision` (`go` / `go_conditional` / `no_go`), `gono_reason`,
`gono_conditions`, `submitted_at`, `outcome`, `bid_price`,
`result_awarded_price`, `result_winner`, `result_rank`, `notes`.

**`no_bid` is a first-class outcome and is excluded from win-rate denominators.**
Deciding not to bid is not a loss, and counting it as one makes a disciplined
qualification process look like a failing one.

`POST /api/v1/pursuits` upserts on `tender_id`. Changing `gono_decision` emits a
`verdict.changed` event to your webhook endpoints and the event log.

---

## Document — *private*

The consultation's own package (DCE) plus documents your organisation produced
for it: `kind`, `file_name`, `content_type`, `size_bytes`, `created_at`,
`source_confidence`, `action_key`, `document_key`.

Listing is metadata only. Third-party consultation documents are not
redistributed through this API.

---

## Event — *private*

`id`, `type`, `resource` (`{ type, id }`), `occurred_at`, `recorded_at`, `data`.

This exact body is what a webhook delivery POSTs. `occurred_at` and
`recorded_at` differ for reconciled events — when something is discovered after
the fact, one is when it happened and the other when we learned it.

See [webhooks.md](webhooks.md).

---

## Conventions

- **Timestamps** are ISO 8601. Date-only fields are `YYYY-MM-DD`.
- **Money** is a number plus an explicit `currency`. Never assume MAD.
- **`object`** on every resource names its type — useful when they are mixed.
- **Unknown fields must be ignored.** New ones ship without a version bump.
- **Ids are opaque strings.** Do not parse them or infer meaning from a prefix.
