# Authentication & scopes

Every data endpoint requires an API key. There is no anonymous access to tender
or award rows, and no query parameter that can change which organisation a key
acts for.

Two endpoints are deliberately unauthenticated, so an integrator can discover
the surface before asking for anything:

- `GET /api/v1` — the service index
- `GET /api/v1/openapi.json` — the contract

## Presenting a key

```http
Authorization: Bearer sk_live_a1b2c3d4e5f6g7h8_…
```

`X-API-Key` is accepted as an alternative for clients that cannot set
`Authorization` (some webhook platforms, some BI tools):

```http
X-API-Key: sk_live_a1b2c3d4e5f6g7h8_…
```

Present one or the other, not both.

## Key format

```
sk_live_<key id: 16 chars>_<secret: 40 chars>
```

The `sk_live_` prefix follows the convention popularised by Stripe, for a
practical reason: secret scanners in GitHub, GitLab and most CI systems already
recognise the shape, so a key pasted into a public repository is likely to be
flagged by tooling you already run.

Only the prefix and last four characters are stored in a form anyone can read
back. **The full token is shown once, at creation, and is not recoverable.** If
you lose it, revoke it and create another — revocation takes effect on the next
request presenting that key and does not affect the organisation's other keys.

## Scopes

A key carries only the scopes it was granted. Read and write are separate for
every resource that has both, so the common case — a reporting integration that
must never mutate anything — is expressible without trusting the integration to
behave.

| Scope | Grants |
|---|---|
| `tenders:read` | The shared tender corpus |
| `awards:read` | Published attribution records |
| `analyses:read` | Your organisation's analyses |
| `verdicts:read` | Go/No-Go verdicts and their factors |
| `documents:read` | Document listings for a tender |
| `catalogue:read` / `catalogue:write` | Your supply catalogue |
| `pursuits:read` / `pursuits:write` | Your bid pipeline |
| `boncommandes:read` | Simplified purchase orders and quotations |
| `executive:read` / `executive:write` | Executive intelligence briefings & radar |
| `events:read` | The event log |
| `webhooks:read` / `webhooks:write` | Endpoint management and delivery history |

Two wildcards are honoured: `*` grants everything, and `<resource>:*` grants
both actions on one resource. Prefer explicit scopes — a wildcard granted for
convenience during a spike tends to survive into production.

A request whose key lacks the required scope gets `403` with
`code: "insufficient_scope"`, and the body names both what was required and what
the key holds, so you can fix it without guessing:

```json
{
  "error": {
    "type": "permission_error",
    "code": "insufficient_scope",
    "message": "This API key does not hold the `pursuits:write` scope required by upsertPursuit.",
    "param": null,
    "request_id": "req_8f2c…"
  }
}
```

The required scope for each operation is declared in
[`openapi.json`](/soumit/openapi.json) under `security`, and the handlers read their
requirement from the same table the document is generated from — so the
documented scope and the enforced scope cannot diverge.

## Tenancy

A key belongs to exactly one organisation, fixed at creation.

- **Shared, identical for every key:** `tenders`, `awards`. This is public
  procurement data; there is nothing to partition.
- **Private to your organisation:** analyses, verdicts, pursuits, catalogue,
  documents, events, webhooks. Another organisation's analysis of the very same
  tender is not reachable through this API, by any parameter.

Key management (`/api/v1/api-keys`) is the one part of `v1` that does **not**
accept an API key. It requires a signed-in session in the application, because a
leaked read-only key that could mint a write-scoped one would make revocation
meaningless.

## Failure modes

| Code | Status | Meaning |
|---|---|---|
| `authentication_required` | 401 | No credential presented |
| `invalid_api_key` | 401 | Malformed, or not a known key |
| `api_key_revoked` | 401 | Revoked — create a new one |
| `api_key_expired` | 401 | Past its expiry |
| `insufficient_scope` | 403 | Valid key, missing scope |
| `organization_inactive` | 403 | The organisation is not active |

401 responses carry `WWW-Authenticate: Bearer realm="api"`.

## Handling keys

- Keep keys in environment variables or a secret manager; never in source.
- Use one key per integration, so revoking a compromised one does not take the
  others down with it.
- Grant the narrowest scope set that works, then widen if you hit a `403`.
- Rotate by creating the new key, deploying it, and revoking the old one — in
  that order. Keys are independent, so the overlap is safe.
