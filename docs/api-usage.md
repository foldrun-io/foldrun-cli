# Using the API

What every route has in common: how to sign a request, which version answers
it, how fast you may call, how to retry safely, and what an error looks like.
The routes themselves are in [api](api.md); the machine-readable description
is `GET /api/openapi.json` (OpenAPI 3.1, no key needed), and the dashboard
renders it at **Docs → API reference**.

## Authentication

```sh
curl -H "Authorization: Bearer $FOLDRUN_TOKEN" "$FOLDRUN_URL/api/workspaces"
```

A key comes from **Settings → API keys** and carries a role (viewer, editor,
admin) and a workspace scope no wider than the person who minted it. The
dashboard uses the session cookie instead; both go through the same funnel. A
handful of routes are a person's alone and refuse a key — see
[api](api.md#authentication).

## Versions

The API is versioned by date, Stripe-style. Send the version your code was
written against:

```
Foldrun-Version: 2026-10-01
```

Every response says which version answered it, in `Foldrun-Version`.

- **No header**: your account's pin (**Settings → API**, or
  `PATCH /api/account/api {"version": "2026-10-01"}`), and with no pin, the
  current version.
- **An unknown version** — a typo, a date that was never released — is a
  `400`, not a silent fallback to current.
- **What moves the version**: only a change an existing caller would break
  on — a field removed or renamed, a type changed, a status code changed. A
  new route, a new optional field or a new value in a list does not; write
  clients that ignore fields they do not know.
- **Older pins keep their shape.** When a breaking change ships, a caller
  pinned before it gets the response transformed back to the shape its
  version promised.

The CLI sends the version it was built for on every call.

### Deprecation policy

- A version stays supported for **at least 12 months** after the version that
  replaces it is released. A pin to a retired version is answered as the
  current version, never refused.
- Every breaking change is announced in **What's new** (the dashboard's
  changelog, and `GET /api/changelog`) on the day it ships, with the date the
  previous shape stops being served.
- A route on its way out answers with
  [`Deprecation`](https://www.rfc-editor.org/rfc/rfc9745) (`@<unix time>` it
  was deprecated) and, once the date is fixed,
  [`Sunset`](https://www.rfc-editor.org/rfc/rfc8594) (the HTTP date it stops
  answering), plus `Link: <…>; rel="deprecation"` to where the replacement is
  described. The sunset is at least six months after the deprecation.

## Rate limits

Every authenticated request counts against two buckets, and both must have
room: one for **the key or person** making it, one for **the whole account**
(three times the first). Reads (`GET`, `HEAD`) and writes count separately,
per one-minute window:

| Plan | Reads / key | Writes / key | Reads / account | Writes / account |
|---|---|---|---|---|
| none (trial, self-hosted) | 300 | 60 | 900 | 180 |
| Starter | 600 | 120 | 1,800 | 360 |
| Creator | 1,200 | 240 | 3,600 | 720 |
| Pro | 3,000 | 600 | 9,000 | 1,800 |
| Scale | 6,000 | 1,200 | 18,000 | 3,600 |

Every response carries the bucket closest to its limit:

```
X-RateLimit-Limit: 600
X-RateLimit-Remaining: 597
X-RateLimit-Reset: 1790000000     # Unix seconds when the window resets
```

Over the limit the answer is `429`, with `Retry-After` in seconds and

```json
{ "error": "rate limit: this API key may make 120 writes a minute — retry in 41s", "retry_after": 41 }
```

Your account's limits are on **Settings → API** and at `GET /api/account/api`.
The counters are shared by every server in the deployment. A self-hosted
install can switch them off with `FOLDRUN_API_RATE_LIMIT=off` (for example
behind its own gateway).

## Retrying safely: Idempotency-Key

The `POST`s that start or change something — run a flow, agent or eval,
rerun, deploy, upload an asset, create a flow, set a secret, mint a key,
approve, answer or message a run, billing actions — accept

```
Idempotency-Key: 6f1c0f0e-8d1b-4c55-9f0e-2b0d7c1d2a10
```

- The **same key with the same body** within 24 hours answers with the first
  response — same status, same body — and `Idempotent-Replayed: true`. No
  second run, no second charge.
- The **same key with a different body** is a `422`: a key names one request.
- The same key while the first request is still being answered is a `409`
  with `Retry-After: 1`.
- A `5xx` is not remembered, so a retry after a server failure is a real
  second attempt.

Keys belong to your account and to the route: use a fresh UUID per
operation, and the same one when you retry it. The OpenAPI document marks
every operation that honours the header. The CLI sends one on every such
call and reuses it on its own retry.

## Errors

Every error is JSON with one field you can show a person:

```json
{ "error": "flow nightly not found" }
```

| Status | Means |
|---|---|
| 400 | the request is malformed, or names an unknown `Foldrun-Version` |
| 401 | no credential, or a revoked one |
| 402 | out of credit |
| 403 | your role or scope does not cover this |
| 404 | no such thing |
| 409 | conflict — a run already live (`overlap: skip`), a file changed under `ifMatch`, an idempotent request still in flight |
| 413 | body over 10 MB |
| 422 | a refusal to read: a deploy with issues, an Idempotency-Key reused with a different body |
| 429 | rate limited — wait `Retry-After` |
| 5xx | our fault; the detail is in our logs, not the response. Safe to retry with the same Idempotency-Key |

## Pagination

There is no cursor yet. The lists that can grow — runs — answer newest first
and take `limit` (`/api/workspaces/<ws>/runs?limit=`, default 50, at most
500). Everything else (flows, agents, keys,
secrets, workspaces) comes whole. A cursor, when one is added, will be a new
optional parameter and will not move the API version.
