# Claude Code on foldrun's models

Claude Code — and any tool that takes an Anthropic base URL and key — can run
on your foldrun account's credits instead of an Anthropic account of your
own. You mint a **gateway key**, point the tool at foldrun's gateway, and
every call is billed to the account at foldrun's price list, up to the key's
own limits.

```sh
export ANTHROPIC_BASE_URL=https://<the gateway URL>   # Settings → API keys shows it
export ANTHROPIC_API_KEY=mda_…                        # the gateway key
claude
```

`ANTHROPIC_AUTH_TOKEN` works in place of `ANTHROPIC_API_KEY` (it is sent as
`Authorization: Bearer`). This is on the hosted platform only; a self-hosted
install has no gateway.

## Minting a gateway key

On **Settings → API keys**, pick **Gateway key — Claude Code** as the kind,
or from a terminal:

```sh
foldrun keys create laptop --gateway --cap 20 --daily 5
```

- **A limit of its own is required:** `--cap` (USD, in all) or `--daily`
  (USD, per UTC day), or both — from $0.01 to $100,000.
  Limits are in dollars charged — what the account pays at foldrun's price
  list — and so is the spend `keys ls` shows. Each call is kept at the
  margin it was charged at, so a margin changed later re-prices nothing.
- **Who may mint one:** an admin of every workspace. The key spends the
  whole account's balance, so a workspace-scoped admin cannot.
- **What it opens:** the gateway only. Every `/api` route refuses it (403),
  so it cannot read a workspace, start a run or mint a key. An account API
  key is refused by the gateway the same way.
- **Shown once**, like every key. `foldrun keys ls` (and the Settings list)
  shows what it has spent against each limit; `rotate` keeps its limits, and
  the new key's spend starts afresh; `revoke` ends it at once.

The API is `POST /api/keys { purpose: "gateway", capUsd?, dailyUsd?, label?, expires? }`
([API](api.md)).

## On the operator's Claude login

An account the operator allows its own model credential — the one its desks
run on — may mint a gateway key on the operator's Claude login instead:

```sh
foldrun keys create mine --gateway --login
```

or **Runs on → The operator's Claude login** on Settings → API keys (shown
only on such an account). Such a key:

- sends the operator's Claude login to Anthropic, read fresh on every call,
  so the platform's token refresh reaches it with no restart;
- is **not metered or billed** and takes no `--cap` or `--daily` — the
  login is a flat-rate subscription, so there is no dollar figure to hold;
- shares that subscription's weekly cap with the account's desks: a long
  coding session can leave the desks out of their window until it resets;
- opens nothing once the account is no longer allowed the credential: the
  gateway asks on every call.

It is for the operator's own use. A subscription's terms are its owner's to
keep; foldrun's models (the rest of this page) are what to give anyone else.

## Other providers' models

The same key reaches DeepSeek's and Kimi's models: name one, and the gateway
sends it to that provider on foldrun's models (billed at its price, under the
same limits).

```sh
claude --model deepseek/deepseek-v4      # or /model deepseek/deepseek-v4 in a session
claude --model kimi/kimi-k3
```

- **Choosing a provider.** `provider/model` always works (`anthropic/`,
  `deepseek/`, `kimi/`). A bare name with a known prefix works too:
  `deepseek-…`, `kimi-…`, or `claude-…` for Anthropic. Anything else goes to
  Anthropic.
- **What Claude Code sends.** It sends the name you give it unchanged.
  Claude Code's own `/model` list shows Claude models only, so type the name.
  Each provider gets only the request fields its API takes; the rest are
  dropped.
- **Token counts.** A provider with no token-count route gets an estimate
  (marked `x-foldrun-estimate: 1`).
- **What Claude Code can't know.** For non-Claude models it shows the wrong
  cost and context size. The charge is foldrun's.
- **What isn't offered.**
  - OpenAI's and Gemini's models are refused for now (they need translation;
    planned).
  - A login gateway key stays Claude-only.

## What the gateway serves

| Route | |
|---|---|
| `POST /v1/messages` | metered, streamed or not |
| `POST /v1/messages/count_tokens` | free |
| `GET /v1/models` | free |

Anything else is a 404; a query string (`/v1/models?after_id=…`) goes on as
it came. Anthropic's models only. Your key never reaches
Anthropic: the gateway sends the call with the platform's own key, and only
the headers Anthropic's API reads (`anthropic-version`, `anthropic-beta`,
`content-type`, `accept`).

## Limits and refusals

Each call is checked the way a run's call on foldrun's models is
([budgets and billing](budgets-and-billing.md)):

- the account must have credit, and foldrun's models must be on for it;
- the model must be on the price list;
- the call is held at the most it could cost (its input, and every output
  token it may ask for) against the account's daily limit **and** the key's
  own limits, before it is sent — so calls at once cannot pass a limit
  together, and a call that would pass one is refused, not cut off midway;
- it is charged what Anthropic reports it used, or its hold if no usage
  came back (a reply cut short).

Because a call is held at its most, a key's limit needs room for the
calls Claude Code makes at once — a few dollars, not cents.

Request fields billed outside tokens are refused until they have a price:
server tools (web search, code execution), a one-hour prompt cache, a
priority tier.

A refusal comes back in Anthropic's own error shape, so Claude Code prints
the reason:

| Status | Why |
|---|---|
| `401` | no key, an unknown, revoked or expired key |
| `403` | not a gateway key; foldrun's models off for the account |
| `402` | out of credits; the key's limit or the account's daily limit has no room; a model with no price |
| `429` | the key's request rate (300 a minute) or its open calls (32 at once) — with `Retry-After`; waiting helps. Every route and every kind of key counts |
| `400` | a request field that is not offered (named in the message) |

A key that is revoked can still answer for up to 10 seconds: each gateway pod
caches a key for that long. A spent limit is a `402`, not a `429`: Claude Code retries a `429` for minutes,
and no retry makes room under a limit. A `429` from Anthropic itself comes
back as it was.
