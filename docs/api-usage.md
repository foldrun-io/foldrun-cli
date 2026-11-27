# Using the API

What every route has in common: how to sign a request, which version answers
it, how fast you may call, how to retry safely, and what an error looks like.
The routes themselves are in [api](api.md); the machine-readable description
is `GET /v1/openapi.json` (OpenAPI 3.1, no key needed), and the dashboard
renders it at **Docs → API reference**.

## Authentication

```sh
curl -H "Authorization: Bearer $FOLDRUN_TOKEN" "$FOLDRUN_URL/v1/workspaces"
```

A key comes from **Settings → API keys** and carries a role (viewer, editor,
admin) and a project scope no wider than the person who minted it. The
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

- **No header**: for an API key, your account's pin (**Settings → API keys → API**, or
  `PATCH /v1/account/api {"version": "2026-10-01"}`), and with no pin, the
  current version. The dashboard always uses the current version: it ships
  with the platform, so a pin never applies to it.
- **An unknown version** — a typo, a date that was never released, one
  retired after its support window — is a `400`, not a silent fallback to
  current. The body says why in a form code can act on:
  `{ "error": "…", "code": "unknown_api_version", "known": ["2026-10-01", "2026-10-26"] }`
  (`code` is `bad_api_version` when the header is not a `YYYY-MM-DD` date).
- **What moves the version**: only a change an existing caller would break
  on — a field removed or renamed, a type changed, a status code changed. A
  new route, a new optional field or a new value in a list does not; write
  clients that ignore fields they do not know.
- **Older pins keep their shape.** When a breaking change ships, a caller
  pinned before it gets the response transformed back to the shape its
  version promised.

The versions so far:

| Version | What changed |
|---|---|
| `2026-11-22` | One API, as Anthropic's: every refusal is Anthropic's error body, `{ "type": "error", "error": { "type", "message" } }`, with a `code` and figures inside `error` — the body `/v1` answers with. The key may be sent as `x-api-key` as well as `Authorization: Bearer` (that part breaks nothing). A caller pinned earlier, and a browser, keep `{ "error": "..." }`. |
| `2026-10-26` | `GET /v1/account/usage`: `ledger.providerCostUsd` and `ledger.marginUsd` are withdrawn. They were the platform's own accounting of your lines, not part of your account. A caller pinned to `2026-10-01` still gets both keys, as `null`: the values are withheld, not reproduced. |
| `2026-10-01` | The first dated version. Every CLI released so far sends it. |

The CLI sends the version it was built for on every call. When a platform
refuses it, every command stops with exit 1 and says which side is older:
a platform older than the CLI names the CLI released with it
(`npm i -g foldrun@<that version>`); a platform that has retired the CLI's
version says to update (`npm i -g foldrun@latest`). `foldrun version` still
shows the platform, and warns when its commands would be refused.

### Deprecation policy

- A version stays supported for **at least 12 months** after the version that
  replaces it is released. A pin to a retired version is answered as the
  current version, never refused.
- Every breaking change is announced in **What's new** (the dashboard's
  changelog, `GET /v1/changelog` and `foldrun changelog`) on the day it
  ships: the version that brought it and what changed, and every deprecated
  route with the date it stops answering.
- **Checked before it ships.** Every change to the platform is compared with
  the version that is deployed. A route or documented field taken away, a
  type changed, or a request field made required cannot ship unless it comes
  as a new dated version, with the old shape kept for older pins. A route
  can only be removed once its deprecation has passed its sunset date.
- **You are told if it affects you.** Every request is counted by the
  version that answered it, and a call to a deprecated route by the key or
  person that made it. **Settings → API keys → API** and `foldrun api version` show the
  last 30 days. An account that called a deprecated route in the last 30
  days is emailed when it is first seen doing so, and again 90, 30 and 7
  days before the sunset — one email per step, naming the keys that still
  call it. This is required mail: it cannot be switched off, because it is
  the only warning before something you rely on stops.
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
per one-minute window. Health, status and version reads
(`/v1/healthz`, `/v1/status`, `/v1/version`), signing out and ending a
support view are never counted or refused; neither is the public `GET /v1/pricing`:

| Plan | Reads / key | Writes / key | Reads / account | Writes / account |
|---|---|---|---|---|
| Free, none (self-hosted) | 300 | 60 | 900 | 180 |
| Starter | 600 | 120 | 1,800 | 360 |
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

Your account's limits are on **Settings → API keys → API** and at `GET /v1/account/api`.
The counters are shared by every server in the deployment. A self-hosted
install can switch them off with `FOLDRUN_API_RATE_LIMIT=off` (for example
behind its own gateway).

## Retrying safely: Idempotency-Key

The `POST`s that start or change something — run a flow, agent or eval,
rerun, stop, deploy, upload an asset, create, draft or append to a flow,
set a secret, mint a key, rotate a webhook, send a test notify, connect an
OAuth client, approve, answer or message a run, billing actions — accept

```
Idempotency-Key: <a UUID you generate, one per operation>
```

- The **same key with the same body** within 24 hours answers with the first
  response — same status, same body — and `Idempotent-Replayed: true`. No
  second run, no second charge.
- The **same key with a different body** is a `422`: a key names one request.
  `?wait` and `?timeout` do not count: a start retried with or without
  `?wait=true`, or with another timeout, is the same request and gets the
  first answer back (the run's id is in it, waited or not).
- The same key while the first request is still being answered is a `409`
  with `Retry-After: 1`.
- A `5xx` is not remembered, so a retry after a server failure is a real
  second attempt.
- A `503` with `Retry-After: 2` means the store that keeps keys is not
  answering: nothing ran, and the same key is safe to send again.
- A request that never finished (the server restarted mid-answer) holds its
  key for at most two minutes, then the key is free for a real retry.
- Minting or rotating a key: a replay says what was done but its `key` is
  `null` — the secret is shown once and never stored. Revoke that key and
  mint another. Rotating a webhook is the same: a replay's `path` is `null`.

Keys belong to the caller — your account and the API key or person sending
them; another key of the same account never gets your stored answer — and to
the route: use a fresh UUID per
operation, and the same one when you retry it. The OpenAPI document marks
every operation that honours the header. The CLI sends one on every such
call and reuses it on its own retry.

## Errors

Every error is Anthropic's error body — the same one `/v1/messages` answers
with — so one client reads both halves of the API (version `2026-11-22`):

```json
{ "type": "error", "error": { "type": "not_found_error", "message": "flow nightly not found" } }
```

`error.message` is the sentence to show a person; `error.type` follows the
status (the table below). Some carry a `code` a program can branch on —
`unknown_api_version`, `mail_not_configured`, `waiting_cap` — and the
figures that go with it, inside `error`.

Pinned before `2026-11-22` — and in a browser — an error is the older body,
the same fields beside one string:

```json
{ "error": "flow nightly not found" }
```

On the API host a few refusals come before the platform reads your
account — an unknown path, a dashboard-only route, a body over the host's
limit — and those follow the `Foldrun-Version` header alone: send it to keep
the older body there too. The model routes (`/v1/…`) answer in Anthropic's
body whatever version is sent.

| Status | `error.type` | Means |
|---|---|---|
| 400 | `invalid_request_error` | the request is malformed, or names an unknown `Foldrun-Version` |
| 401 | `authentication_error` | no credential, or a revoked one |
| 402 | `billing_error` | out of credit |
| 403 | `permission_error` | your role or scope does not cover this |
| 404 | `not_found_error` | no such thing |
| 409 | `invalid_request_error` | conflict — a run already live (`overlap: skip`), a file changed under `ifMatch`, an idempotent request still in flight, or the account already has its most runs waiting for their turn (`code: "waiting_cap"`, with `limit` and `waiting` — [how many runs may wait](budgets-and-billing#how-many-runs-may-wait); a webhook or inbound email gets this as a `503` with `Retry-After`) |
| 413 | `request_too_large` | body over 10 MB |
| 422 | `invalid_request_error` | a refusal to read: a deploy with issues, an Idempotency-Key reused with a different body |
| 429 | `rate_limit_error` | rate limited — wait `Retry-After` |
| 5xx | `api_error` | our fault; the detail is in our logs, not the response. Safe to retry with the same Idempotency-Key |

## One address

foldrun answers programs at one address, everything under `/v1`: the model
routes (`/v1/messages`, `/v1/models`) and the platform routes
(`/v1/workspaces`, `/v1/keys`, `/v1/account/…`) together, for API keys, the
CLI and Claude Code alike — with one key, sent as `x-api-key` or
`Authorization: Bearer` on either half, and one error body.

```sh
curl -H "x-api-key: $FOLDRUN_TOKEN" https://api.foldrun.dev/v1/workspaces
curl -H "x-api-key: $FOLDRUN_TOKEN" https://api.foldrun.dev/v1/workspaces/my-desk/runs
```

The path carries the API's generation, `v1`; the `Foldrun-Version` header
([Versions](#versions)) carries every dated change inside it, as Stripe's and
Anthropic's do. Every platform route is named as in the
[reference](api.md); the account's usage is `/v1/account/usage/…`, because
`/v1/usage` is a key's own spend. There is no other spelling: `/api` is gone
(23 Nov 2026), and a self-hosted install with no API address of its own
serves the same `/v1` paths on its one address. Dev is `https://api.foldrun.dev`;
production gets `https://api.foldrun.io`. Settings → API keys → API shows it, and `GET /v1/version`
names it as `urls.api` (with the dashboard's own address as `urls.app`).
`foldrun login` moves a machine's calls there by itself. Signing in,
invitations, approvals and the other pages a person opens stay on the
dashboard's address; the API host answers those routes with a 404 that
says so.

## Calling models

The models are called on the gateway, in Anthropic's Messages format, with a
**gateway key** (made on Settings → API keys as the *Gateway* kind, or
`foldrun keys create <label> --gateway`). It opens the model routes alone,
never a platform route. The gateway's address is shown when the key is made
(`gatewayUrl` on `GET /v1/keys`).

| Route | For |
|---|---|
| `POST /v1/messages` | a model call, whole or streamed |
| `POST /v1/messages/count_tokens` | what a request would count |
| `GET /v1/models` | the models the key can call: on foldrun's models, only those on foldrun's price list (a model the list does not price is refused, so it is not shown); a key signed in to a Claude plan sees the whole list |
| `GET /v1/usage` | the key's spend (`?format=line` for one line) |

Any Anthropic SDK or client works: `ANTHROPIC_BASE_URL=<gateway>`,
`ANTHROPIC_AUTH_TOKEN=<key>`. The format is the same whatever runs the call:
a model of another provider is named `provider/model` (`openai/gpt-5`,
`deepseek/deepseek-v4`; [providers](providers.md)), and the gateway
translates the request for it and its reply back, so the caller sees
Anthropic's shape every time. Each call is checked, held to the key's limits
and charged the same way.

```sh
curl "$GATEWAY/v1/messages" -H "x-api-key: $KEY" -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model": "openai/gpt-5", "max_tokens": 200, "messages": [{"role": "user", "content": "hi"}]}'
```

### Headers: what goes on to the provider

Every header the provider sees is the gateway's own: the key it chose, its
user agent, `anthropic-version: 2023-06-01` for a provider that speaks the
Anthropic format, and its own content type and accept. Nothing a caller sends
is copied. A caller's `anthropic-beta` is read as a request: a beta that
changes how the model answers one call (thinking, context size and editing,
caching, tool search and streaming, effort, structured output, Claude Code's
own) goes on; one that would run, store or bill something on the provider's
side (files, MCP servers, the provider's web search, managed agents, fast
mode, the advisor tool), or that names the caller, is left out, and the call
goes on without it. A call on a Claude plan key may not ask for fast mode, a
service tier other than `standard_only`, or an inference region other than
`global`: they are priced above the standard rate, and the gateway answers
`400`.

### Claude Code on the gateway

| Set | |
|---|---|
| `ANTHROPIC_BASE_URL=<gateway>`, `ANTHROPIC_AUTH_TOKEN=<key>` | the whole setup |
| `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1` | `/model` lists the models the key can call |
| `ANTHROPIC_CUSTOM_HEADERS="x-foldrun-customer: <id>"` | only for a key that requires an end customer; the gateway reads it and sends it nowhere |

Not needed: `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` — the gateway already
leaves out the betas it does not send, and this would also turn off the ones
it does. Everything else on Claude Code's [environment variables
page](https://code.claude.com/docs/en/env-vars) is your own machine's
choice.

### Server tools: web search and fetch

Anthropic's web tools work on the gateway as written for Anthropic, with any
model: name `web_search_20250305` (`web_search`) or `web_fetch_20250910`
(`web_fetch`) in `tools`. **foldrun runs them, never the model's provider:**
the provider is given a plain tool, foldrun runs each search or fetch itself,
and the reply comes back in Anthropic's shape: `server_tool_use` and
`web_search_tool_result` / `web_fetch_tool_result` blocks, `pause_turn` for a
long turn (send the conversation back to go on), `usage.server_tool_use` for
the counts. Streaming works too, with the text arriving as it is written.

```sh
curl "$GATEWAY/v1/messages" -H "x-api-key: $KEY" -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model": "claude-sonnet-4-5", "max_tokens": 1000,
       "tools": [{"type": "web_search_20250305", "name": "web_search", "max_uses": 3}],
       "messages": [{"role": "user", "content": "What changed in Node 24?"}]}'
```

The options are Anthropic's: `max_uses`, `allowed_domains` or
`blocked_domains` (a path narrows search; fetch matches the domain only),
`user_location` (search), `max_content_tokens` (fetch). Fetch reads only a
URL that is already in the conversation (from the user, a tool result, or an
earlier search or fetch), never one the model made up, and a URL carrying a
credential only when a person wrote that credential. Search, fetch and the
model all run on foldrun's own accounts; to use your own search or scraping
service, give an agent its API (`apis:`, `mcpServers:`, `tools/`).

The same search asked again by your account within ten minutes (same words,
domain lists and location) may be answered from foldrun's short cache rather
than run again. It is never shared with another account, and an answer that
looks like it carries a credential is never kept. A fetch is always run
fresh.

Searches and fetches that actually run (a cached answer does not count) are
limited in how many run at once: per account, across all its keys, and on
each of foldrun's servers. A call over the limit waits its turn for a few
seconds, then comes back as the tool's own `too_many_requests` error, as
Anthropic's does, and the model can try again. It is a limit on load, not on
spend.

### Server tool: a page in a cloud browser

`foldrun_web_browse_20251125` (`web_browse`) is foldrun's own: it opens a page
in a real browser (JavaScript runs), takes up to five `steps` on it first, and
reads it back as `markdown` (the default) or `text`, or as a `screenshot` (a
PNG, at most 1 MiB, which the model looks at).

```sh
curl "$GATEWAY/v1/messages" -H "x-api-key: $KEY" -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model": "claude-sonnet-4-5", "max_tokens": 1000,
       "tools": [{"type": "foldrun_web_browse_20251125", "name": "web_browse", "max_uses": 2}],
       "messages": [{"role": "user", "content": "What is on page 2 of https://example.com/list ?"}]}'
```

A step is one object from a fixed list: `click`, `dblclick`, `hover`, `fill`
(with `text`), `type`, `press` (with `key`), `select`, `check`, `uncheck`,
`wait` (milliseconds, or a selector), `scroll`, `goto`, `back`, `forward`,
`reload`, `focus`, `clear`. Nothing that runs code, reads or writes files, or
branches. The page opened is held to the same rule as fetch (a URL already in
the conversation), and `allowed_domains` / `blocked_domains` (a domain covers
its sub-domains) hold on every connection the browser makes, redirects and a
page's own requests included, on ports 80 and 443 only. One call takes at
most 45 seconds.

The result block is `foldrun_web_browse_tool_result`, with content
`{type: "foldrun_web_browse_result", url, text}` (or `screenshot: {media_type,
data}`), or `{type: "foldrun_web_browse_tool_result_error", error_code}`; the
stock Anthropic SDKs keep it and send it back as it is. `usage.server_tool_use`
adds `foldrun_web_browse_requests`. **`outcome_unknown`** means the browser
may already have acted (a step ran, then something failed or was cut off):
the call is never repeated for you, and should not be repeated without
looking at the page first. A resent request runs the model again, so its
browses are new calls. One browse runs at a time per key and two per
account (`too_many_requests` past that). It is charged per call, and only
when the page came back.

The same browser call without a model: `POST $GATEWAY/v1/foldrun/browse` with
`{url, steps?, mode?, allowed_domains?, blocked_domains?}` answers `{url,
text}` or `{url, screenshot}` (what `foldrun code`'s cloud browser uses).
Errors are the same codes, as `400` (`invalid_tool_input`), `429`, `502`
(`outcome_unknown`, `url_not_accessible`), `504` (`timeout`). Send an
`Idempotency-Key` header to make a retry safe: the same key (from the same
API key and end customer) answers the first call's result with
`idempotent-replayed: true`, never a second browser and never a second
charge; the same key with a different input is a `400`.

Any other server tool (`code_execution`, an MCP toolset, `mcp_servers`, a
tool added mid-conversation) is refused with a `400`
(`server_tool_not_offered`): it is never passed on to the provider.

### Server tool: a second opinion from another provider's model

`foldrun_debate_20261127` (`foldrun_debate`) is foldrun's own. The model you
call can ask a model from a **different provider** to argue against its
position, inside the same reply: it says what is wrong, missing or risky and
what it would do instead, and the first model reads that and goes on.

```sh
curl "$GATEWAY/v1/messages" -H "x-api-key: $KEY" -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model": "claude-sonnet-4-5", "max_tokens": 2000,
       "tools": [{"type": "foldrun_debate_20261127", "name": "foldrun_debate",
                  "model": "deepseek/deepseek-chat", "max_uses": 2}],
       "messages": [{"role": "user", "content": "SQLite or Postgres for 200 writes a second? Debate it with another model first."}]}'
```

| Option | |
|---|---|
| `model` | The second model, written `provider/model`. It must be another provider than the model the request calls; the same one is refused (`model_not_allowed`), and nothing falls back to it. Left out: the platform's own choice for your model's provider, where it has set one (`unavailable` where it has not). |
| `max_tokens` | The longest answer the second model may give, 1024 to 16000 (default 4096). |
| `max_uses` | Calls in one turn (default 5). It holds across a turn resumed after `pause_turn`. |

**What the second model sees.** Only what the first model puts in the call:
`topic`, and optionally `position` and `context`, 60,000 characters together.
It is not given the conversation, the system prompt, your request's headers
or any tools. To carry a debate on, the first model calls the tool again
with the last objection and its reply in `context`. Naming the tool in a
request is what sends that text to the second model's provider, so name it
only where that is acceptable.

**What it costs.** The second model's tokens, at that model's own listed
price, paid the way the rest of the call is (your plan's allowance, then the
wallet). There is no fee per call. A call that fails costs nothing:
`unavailable` (no key or no price for that model here, or it did not answer),
`payment_required`, `too_many_requests`, `input_too_long`,
`invalid_tool_input`, `max_uses_exceeded`. It always runs on foldrun's API
key for that provider, never on a Claude subscription login.

The result block is `foldrun_debate_tool_result`, with content `{type:
"foldrun_debate_result", model, text, usage: {input_tokens, output_tokens}}`
or `{type: "foldrun_debate_tool_result_error", error_code}`; the stock
Anthropic SDKs keep it and send it back as it is. `usage.server_tool_use`
adds `foldrun_debate_requests`. The request's top-level `usage` counts the
first model's tokens only; the second model's are in its result block and on
your usage page under its own model. Not offered to a run's own model calls
yet (an agent's step): from an app, a script or the API.

## Pagination

There is no cursor yet. The lists that can grow — runs — answer newest first
and take `limit` (`/v1/workspaces/<ws>/runs?limit=`, default 50, at most
500). Everything else (flows, agents, keys,
secrets, projects) comes whole. A cursor, when one is added, will be a new
optional parameter and will not move the API version.
