# How Soumit is built

This document is for people evaluating the platform rather than integrating with
it. It describes the system behind the API and, more usefully, the decisions
that shaped it — including the ones that were wrong first.

---

## The problem, stated precisely

Moroccan public buyers publish thousands of consultations a year. Each is a
*dossier de consultation des entreprises*: a ZIP containing a CPS that can run
to a hundred pages, an administrative règlement, price schedules, often scanned
rather than born-digital, occasionally a plan set.

The supplier's real question is not *what does this say*. It is **"is this worth
three days of my technical team's time?"** — and answering it requires reading
the whole package.

Large firms staff a bid desk for this. Everyone else guesses, or does not bid.
The measurable consequence is thin competition on tenders that deserve more:
suppliers who could have won never opened the file.

Soumit answers that question from the documents themselves, and shows its
working.

---

## Shape of the system

```
                    marchespublics.gov.ma
                             │
        ┌────────────────────▼────────────────────┐
        │  INGEST          Python, scheduled       │
        │  notice → DCE archive → PDF → OCR        │
        └────────────────────┬────────────────────┘
                             │  R2: raw documents
        ┌────────────────────▼────────────────────┐
        │  EXTRACT         LLM + deterministic     │
        │  object, lots, budget, deadlines,        │
        │  required documents, qualifications,     │
        │  penalties, delivery terms               │
        │  every field: exact/derived/inferred/    │
        │               missing + confidence       │
        └────────────────────┬────────────────────┘
                             │  D1: system of record
        ┌────────────────────▼────────────────────┐
        │  ASSESS          factor scoring          │
        │  requirements × catalogue × registrations│
        │  × recorded outcomes → GO / WATCH / NO_GO│
        └────────────────────┬────────────────────┘
                             │
        ┌────────────────────▼────────────────────┐
        │  SERVE           Cloudflare edge         │
        │  Next.js 15 app  ·  /api/v1  ·  webhooks │
        └─────────────────────────────────────────┘
```

| Layer | Technology | Why |
|---|---|---|
| API & app | Cloudflare Workers, Next.js 15 App Router on Pages | Edge-resident; no region to be far from |
| System of record | Cloudflare D1 (serverless SQLite), 18 forward migrations | Colocated with compute; the read pattern is small and indexed |
| Documents | Cloudflare R2 | No egress fees, which matters for a document-heavy corpus |
| Heavy extraction | Modal | OCR and long document jobs do not belong in a request-scoped Worker |
| Language models | Provider-neutral OpenAI-compatible client | Models are configuration, not architecture — see below |
| Pipeline | Python 3.11, ~1,400 tests | |
| Frontend | React 19, TypeScript, Tailwind | |

---

## Six decisions

### 1. Never invent a number

The rule is absolute: **no fallback fabricates a plausible amount, count, score
or date.** A missing fact stays missing and says so.

It sounds like a style preference until you follow the failure through. The
whole product is a supplier deciding whether to commit real money. A fabricated
budget does not read as an error — it reads as an answer, and it is acted upon.
A blank one gets checked.

This is enforced structurally rather than by review. A procurement field with no
corroborating source keeps status `missing` in the extraction layer; the API
serialises it as `null` and records why in the `unavailable` map; the scorecard
drops an unknown factor's weight out of the denominator rather than scoring it
zero — because zero is a claim, and "I do not know" is not.

### 2. Quality is a payload field, not an assumption

Every analysis carries a tier — `decision_ready`, `review_required`, `degraded`
— and per-field provenance saying whether each value was read verbatim,
computed, inferred, or not found.

The alternative is asking consumers to treat every response as equally
trustworthy when they demonstrably are not: a born-digital CPS and a photocopied
scan produce very different extractions, and the difference should be legible
downstream instead of averaged into a single confident-looking answer.

### 3. Tenancy fails closed, structurally

The design constraint: a query against a private table that forgets
`organization_id` must be **impossible**, not merely discouraged.

So the database binding a handler receives is a scoped proxy. A query naming
neither `organization_id` nor going through the scoped helper throws. There is
no fail-open fallback and no override flag — an earlier draft had a strictness
flag, which is exactly the kind of thing that gets turned off during an incident
and never turned back on.

Tenancy is resolved once, at the gate, from the credential. Handlers never
derive an organisation, because a handler that can derive one can derive the
wrong one. The shared corpus (tenders, awards) is a separate, explicitly
unscoped handle, so serving public data and private analysis from the same
endpoint does not require either to be a special case.

Paths that legitimately have no session must declare it at the call site with a
written reason, and the declaration is itself refused once a second organisation
exists — so a single-tenant shortcut cannot quietly become a leak when the
second customer arrives.

### 4. One source of truth for the contract

`GET /api/v1/openapi.json` is generated per request from the same operation
registry the handlers read their required scopes from.

A checked-in spec is a second source of truth. It drifts the first time someone
adds a query parameter and forgets the YAML, and then the documentation is
confidently wrong — worse than absent, because it is trusted. Generating it from
the operation table makes the drift impossible rather than merely detectable:
there is nowhere else to write a scope down.

The consequence for consumers is that the spec you download from a deployment
describes *that* deployment, and its `servers` URL points at the host you
fetched it from rather than at production.

### 5. Models are configuration

The LLM sits behind a provider-neutral OpenAI-compatible client. Switching
providers is an environment change, not a refactor.

This is not vendor neutrality for its own sake. The extraction workload is
price-sensitive and quality-sensitive in ways that change month to month, and a
pipeline welded to one vendor's SDK cannot follow that. Keeping the boundary
thin has already paid for itself more than once.

### 6. Identifiers are industry-neutral

The pilot tenant is a medical-equipment distributor. It is the first customer,
not the domain model. Nothing in the schema or the API names a sector: no
`medical` field, no hardcoded specialty. Regulatory registrations carry a
`scheme` identifier (`MA_AMMPS` is one scheme among many) rather than a bespoke
column.

The same engine serves construction or IT procurement with configuration, not a
fork. Choosing this early cost a few days of naming discipline; choosing it
later would have cost a rewrite.

---

## Things that went wrong, and what changed

An honest engineering document includes these. Each of these cost real time.

**A refactor that also "improved" logic.** Working code was replaced by
early-return no-ops inside a large commit whose message described something
else. The diff was unreviewable because it both moved and edited. The rule now:
**a refactor is a pure move, bodies byte-identical.** A bug spotted while moving
gets reported and left; it gets its own change.

**Tests that could not fail.** A guard asserted on a value it had itself
computed; a whole file of cases was never collected by the runner because of how
it was named. Both were counted as passing. Reading the source proved nothing —
the assertions were plausible and the suite was green. The rule now: **verify
behaviour in the configuration production uses**, and a guard that cannot fail
is a bug in the guard. Two vacuous assertions and twenty-one never-executed
cases were found and fixed by auditing what the runner actually ran, rather than
what the files appeared to contain.

**Config that failed silently.** An `account_id` key added to a Pages config —
with entirely the right intention — is not supported there and aborts
validation, so deploys died and production sat weeks behind the branch. The
account assertion moved into the deploy script, where it overrides the ambient
value rather than deferring to it. Nothing about "correct-looking configuration"
is self-verifying.

**Three contradicting timeouts.** An escalation profile allowed 7,470s, the
container 900s, the queue lease 600s. A container death is hard, so no state was
written and the failure looked like nothing had happened at all. The bounds are
now reconciled and locked by a test that fails if they contradict.

**A cron that reported success while producing nothing.** A dispatcher looked up
a task under one name; the task registered itself under another. It had been
green and idle for weeks. Scheduled work is now watched from outside the
scheduler — a component that reports on itself cannot report its own absence.

The thread through all five: **green is not the same as working.** Most of the
structural rules in this codebase exist because something was green and dead.

---

## Testing and release

- ~1,400 Python tests, ~560 web tests, TypeScript strict, lint held at a ratchet
  that may fall but never rise.
- **Structure guards as tests.** Module-size, layering and dead-code guards run
  in CI. Allowlist entries may be removed, never added to buy silence.
- **A red test is information.** Nothing is stubbed, skipped or deleted to make
  a build pass. If a test is genuinely wrong, the assertion is fixed for a
  stated reason, in writing.
- The release gate is read-only by construction: applying migrations is behind
  an explicit flag, held there by a test, after an earlier version could reach
  production D1 as a side effect of a *check*.

---

## What is not here

Deliberate omissions, stated rather than implied:

- **No self-serve signup yet.** Keys are issued on request during the pilot.
- **Calibrated scores need outcomes.** A GO verdict backed by
  `calibrated_score` requires enough recorded bid results to calibrate against.
  Until an organisation has that history, the engine withholds the score and
  says so, rather than publishing an uncalibrated number in a confident format.
- **Third-party document text is not redistributed.** Analyses report whether an
  excerpt supports a field, never the excerpt.
- **Coverage is Morocco.** The schema is country-neutral; the ingestion is not,
  yet.

---

*Questions about any of this: [abdel@envoisms.ma](mailto:abdel@envoisms.ma).*
