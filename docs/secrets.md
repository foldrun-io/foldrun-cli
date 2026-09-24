# Secrets

A secret is a value an agent may use and must never see written down. It is
stored in the platform's vault, named in an agent's `secrets:` list, and
handed to that agent's scripts as an environment variable at run time. It is
never written into the workspace, never printed into a prompt, and never in
git — which is what makes a workspace safe to commit.


## Setting one

```sh
foldrun secrets set STRIPE_KEY               # this workspace's; prompted, never echoed
foldrun secrets set STRIPE_KEY --account     # the account's, shared by every workspace
foldrun secrets ls
```

Or in the dashboard under Settings → Secrets, or over the API:

```sh
PUT /api/secrets   { "name": "STRIPE_KEY", "value": "sk_live_…" }
```

`PUT` takes a name plus exactly one shape:

| shape | for |
|---|---|
| `value` | a string — an API key, a password |
| `file` | a PEM, a certificate, a service-account JSON |
| `oauth2` | a connected third-party account (see below) |
| `service_account`, `ssh`, `api` | structured credentials the platform knows how to present |

Reads return which secrets exist, never their values.

## Scopes

A secret lives at the **account** or in one **workspace**. An agent looks in
its workspace first, then the account; a workspace secret shadows an account
one of the same name. The run trace says which scope each secret came from
(`secret DATAFORSEO_LOGIN ← workspace scope`), so a workspace quietly falling
back to a shared credential is visible rather than silent.

Put a credential at the account when every workspace should use the same one
— your model provider, your email sender. Put it in a workspace when it is
that job's — a customer's Search Console, a CRM key.

## How an agent gets it

```yaml
---
name: enricher
tools: [crm_lookup]
secrets: [OI_CRM_API_KEY]
---
```

The agent's scripts see `OI_CRM_API_KEY` in their environment and nothing
else. The model never sees the value: it sees that a tool exists, calls it,
and the script reads the variable. The assembled prompt names which secrets
are available and says, in as many words, never to print or write them.

A `verify:` command on a step runs with the same environment, so a check can
call the same API the step did.

A value with a line break in it — a PEM key, a service-account JSON — cannot
travel as an environment variable. It arrives as a file instead: a
private file in the step's copy of the workspace, with the variable holding
its path, and the run log names the secret that was handed over that way.

## Where the value actually is

On a cluster, the value is usually not in the sandbox at all. The worker
holds it and hands the step a per-step address — the **egress proxy** —
and every `http` tool and the model call itself send their requests through
it with `${NAME}` still in the header. The proxy fills the placeholder on
the way out, for the one host that secret was granted to, and forwards.
The value exists in the worker's memory and on the wire to the provider; a
program in the sandbox that reads its environment finds `RESEND_API_KEY`
set to the literal text `${RESEND_API_KEY}`. An oauth2 or service-account
secret is exchanged for a live token at the proxy too, so the recipe never
crosses either.

Script tools are the exception, because a script may need the value in
process — the browser seeding a site's cookies, an ssh key. A step that
grants such a script gets its declared secrets **materialised** into the
sandbox as real values, and the run trace says so:

```
secrets: MEDIUM_COOKIES, RESEND_API_KEY materialised in the sandbox for browser; api tools and the model key go through the egress proxy
```

A script that sends through the proxy itself declares it, and then gets the
placeholders like everything else:

```yaml
---
transport: script
name: crm_sync
run: sync.py
secrets: proxied      # reads FOLDRUN_EGRESS, sends ${NAME} in its headers
---
```

The proxy is an allowlist, not a door: a step may send only to the hosts
its declared tools and provider name, and `${STRIPE_API_KEY}` in a request
to api.resend.com stays literal. Every request through it is one line in
the trace — `egress: POST api.resend.com/emails → 200 (312ms)
[RESEND_API_KEY]` — and the model's own calls are grouped, `× 34`. Leases
live in the worker's memory, or in Redis when the install has one — as
ciphertext under the account's key, six-hour expiry — so a request may
land on any worker behind the Service and still find its lease. Without
a proxy configured (the CLI, a compose install without
`FOLDRUN_EGRESS_URL`) a step materialises everything, as it always did.

## Connected accounts

Some third parties are connected rather than pasted — Google, GitHub,
anything OAuth. Settings → Connections walks the consent flow once and stores
the result as an `oauth2` secret; the platform refreshes it. An agent names
it in `secrets:` like any other.

## How they are kept

Every account has its own encryption key. Secrets are sealed under it, and
the account keys are wrapped by one root key the platform holds. A stolen
copy of one account's secrets file opens nothing without the root key, and
the root key is not in any backup — the sealed backup of the platform's own
configuration is encrypted to a key the platform does not hold. See
[Security](security) and, for the CLI on your machine, [Running it yourself](self-hosting).

Rotating a secret is setting it again. The next run reads the new value; runs
in flight keep the one they started with.

## Whether a credential still works

The vault knows a secret's name, its scope and its shape. Whether the thing
on the other end still accepts it is a different question, and until it is
answered a dead key, an untouched key and a working key all render the same
way.

Two facts are recorded, at the places that already know them and nowhere
else. The egress proxy sees every http tool call and every model call,
because filling the credential is its job; notifications and the provider
check report their own. Nothing is instrumented for this.

| shown | means |
|---|---|
| accepted by *host* on *date* | the far end took it, that recently |
| refused by *host* on *date* | 401, 402 or 403 — the credential itself was rejected, with the date it last worked |
| *host* failed | a 5xx at their end, which says nothing about the key |
| not used yet | nothing has tried it, which is not the same as working |

Only 401, 402 and 403 count against a key. A provider failing at its own end
is not a reason to rotate anything, and counting it would send people to fix
the wrong thing.

A secret materialised into a sandbox reports nothing: the call happens inside
the pod, where the platform cannot see the answer. The page says so rather
than guessing.

Rotating or deleting a secret forgets what the old one did. A fresh key
showing its predecessor's refusals is the moment someone stops believing the
indicator.
