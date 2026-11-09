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
  list — and so is the spend `keys ls` shows. Spend is counted at the margin in force
  now, so if foldrun changes its margin, a key's past spend is counted at the
  new one.
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
| `400` | a request field that is not offered (named in the message) |

A spent limit is a `402`, not a `429`: Claude Code retries a `429` for minutes,
and no retry makes room under a limit. A `429` from Anthropic itself comes
back as it was.
