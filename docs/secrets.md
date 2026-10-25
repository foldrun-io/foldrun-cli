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
foldrun secrets set STRIPE_KEY --site api.stripe.com   # bound: never in a sandbox (below)
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
| `client_cert` | a certificate and key for mutual TLS, presented by the egress proxy |
| `identity` | keyless cloud access: an audience, and tokens the platform signs (below) |

Reads return which secrets exist, never their values.

A **service account** is a key file that signs its own token request. It
acts as itself, or — with **Act as** (`subject`) — as a user the provider
lets it act for (RFC 7523's grant subject; for Google, domain-wide
delegation, which a Workspace admin grants in their own console). Each
subject gets its own token.

An **`api`** connection is a base URL and the headers that go with it. For
an old system that wants **HTTP Basic**, give a username and password
instead of an `Authorization` header: the platform builds the header (RFC
7617, UTF-8), refuses a colon in the username, needs an https base URL, and
masks the password and the encoded header in every trace — as it does every
header value of an `api` connection.

A **client certificate** (mutual TLS) is a PEM certificate, its key and an
optional passphrase; the key must belong to the certificate or it is
refused. Bind it to the **exact hosts** it is for (`foldrun secrets sites
NAME api.bank.example` — no wildcards): the egress proxy presents it on its
own connection to those hosts, and the sandbox never holds the key. Two
certificates bound to one host is refused, not guessed. A redirect to
another site never carries it. Unbound, it stays out of the sandbox; save it
with **export** only for a step that runs without the egress proxy, and it
arrives as files (`$NAME_CERT`, `$NAME_KEY`, `$NAME_PASSPHRASE_FILE`). This
is client authentication with a certificate — not OAuth's certificate-bound
tokens (RFC 8705), which foldrun does not do.

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

## Bound to sites

A secret can be **bound** to the sites it is for. A bound secret never
enters a sandbox, whatever the step grants — Bash, a script tool, a browser.
The sandbox holds `${NAME}`; the [egress proxy](network#how-it-is-held), which
every program's HTTPS goes through, fills it in requests to those sites and
no other. This is how Anthropic's cloud sandboxes attach a network secret,
and it closes the gap above: a step with Bash used to get every declared
secret's real value.

```sh
foldrun secrets sites DATAFORSEO_PASSWORD api.dataforseo.com
foldrun secrets sites DATAFORSEO_PASSWORD             # what it is bound to
foldrun secrets sites DATAFORSEO_PASSWORD --clear     # unbind it
```

Or **Bind to sites** under the secret in Settings → Secrets, or over the API:

```sh
PATCH /api/secrets   { "name": "DATAFORSEO_PASSWORD", "sites": ["api.dataforseo.com"] }
PUT   /api/secrets   { "name": "…", "value": "…", "sites": ["api.dataforseo.com"] }   # set and bind at once
```

What a program in the sandbox writes is unchanged; it sends the placeholder
where the value would go:

```sh
curl -H "Authorization: Bearer $HUBSPOT_TOKEN" https://api.hubapi.com/crm/v3/objects/contacts
curl -u "$DATAFORSEO_LOGIN:$DATAFORSEO_PASSWORD" https://api.dataforseo.com/v3/serp/...
```

The proxy fills `${NAME}` in the request's URL and headers, and inside a
`Basic` Authorization header (which `curl -u` sends base64'd). To do that
for a bound site it ends the TLS connection itself, with a certificate from
the install's **egress CA**, which the sandbox trusts: the pod's start puts
that CA in a bundle and points `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`,
`CURL_CA_BUNDLE`, `PIP_CERT`, `GIT_SSL_CAINFO` and `NODE_EXTRA_CA_CERTS` at
it. Only bound sites are intercepted; every other site is a tunnel the
proxy cannot read. The CA is derived from the install's key, so every
worker presents the same one, and rotating the key rotates it.

A bound site is always reachable, at every [network](network) level.

Leave a secret unbound when the program needs the value itself rather than
in a request: one that signs requests with it (an HMAC, AWS SigV4), puts it
in a request body, or uses it for something other than HTTP. A file, an ssh
key or an `api` header set cannot be bound — they are unpacked inside the
sandbox. The run trace says which way each secret went:

```
secrets: GA_KEY materialised in the sandbox for bash; DATAFORSEO_PASSWORD bound to sites — filled by the egress proxy, never in the sandbox; api tools and the model key go through the egress proxy
```

## Connected accounts

Some third parties are connected rather than pasted — Google, GitHub,
anything OAuth. Settings → Connections walks the consent flow once and stores
the result as an `oauth2` secret; the platform refreshes it. An agent names
it in `secrets:` like any other.

You bring the OAuth app: register it once with the provider (its client id
and secret, and the redirect URL the form shows), save it, and connect. The
form asks for the provider's own authorize and token URLs — foldrun keeps no
list of providers — and **Extra authorize parameters**, one `name=value` per
line, for whatever else the provider's docs say its authorize URL takes:
Google issues a refresh token only with `access_type=offline` and
`prompt=consent`, and without one the connection stops when the first access
token expires. The flow's own parameters (`client_id`, `redirect_uri`,
`state`, `scope`, PKCE) cannot be set there. Every
later connection can use the same saved app — choose it under **App** and
type the scopes this connection needs, as the provider spells them. Each
connection keeps its own scopes, so one app serves any number of APIs from
the same provider (an ads API in one secret, a search API in another), and
**Reconnect** asks for that connection's scopes again. The provider decides
what the app may ask for; foldrun only carries the words. From a terminal:
`foldrun connect NAME --client <saved app> --scopes "<scopes>" --to <workspace>`.

How a connection is kept safe, whatever the provider:

- **PKCE** (S256) is on for every connection: a code stolen on its way back
  is useless without the verifier only foldrun holds. An app with no client
  secret (a *public* app) is allowed — PKCE is then what protects it, and
  its refreshes send no secret. Turn PKCE off only for an app with a secret
  whose provider refuses the parameters.
- **The browser that starts a connection is the one it must come back to.**
  The consent link carries a cookie the callback checks; a link opened in
  someone else's browser connects nothing.
- **From a terminal**, `foldrun connect --client` opens a page in the
  dashboard where you, signed in, see the secret, the app, the scopes and
  where it will be stored, and accept before the provider is asked.
- **Issuer.** Give a saved app its provider's issuer and the `iss` the
  provider sends back (RFC 9207) must match it; without one, a returned
  `iss` must at least be the authorize URL's own site.
- The flow's own parameters (`client_id`, `redirect_uri`, `scope`, `state`,
  the PKCE pair) cannot be overridden by extra parameters or by a query
  string in the authorize URL.
- A provider that **rotates refresh tokens** sends a new one with each
  refresh; it replaces the old one in the vault, where that secret is kept.

## Keyless cloud identity

The safest credential is none at all. A cloud that supports workload
identity federation — AWS (`AssumeRoleWithWebIdentity`), Google Cloud
(Workload Identity Federation), Microsoft Entra (federated credentials) —
can trust **foldrun's signature** instead of a key you store: a step proves
which account, workspace and agent it is, and the cloud gives it a
short-lived credential of its own.

1. In your cloud, trust this install as an OIDC provider: its issuer is
   shown by `foldrun identity` (and in the Connections form). Pin the
   subject — `account:<account>:workspace:<workspace>:agent:<agent>` — at
   least to your account, and the audience you choose.
2. `foldrun secrets set AWS_ID --kind identity --audience sts.amazonaws.com`
   (or Connections → Identity). Nothing secret is stored: only the audience.
3. Name it in an agent's `secrets:`. The step gets **`$AWS_ID_FILE`**: a
   token signed RS256, valid ten minutes, renewed while the step runs. Point
   your cloud's SDK at it — for AWS, `AWS_ROLE_ARN` and
   `AWS_WEB_IDENTITY_TOKEN_FILE=$AWS_ID_FILE`; for Google, an
   `external_account` credential file whose `credential_source.file` is it;
   for Entra, the token as the client assertion.

What it is and is not:

- A **workload-federation issuer**, not a sign-in provider: discovery
  publishes what federation reads (issuer, JWKS, RS256, public subjects),
  and nothing more.
- The subject and claims come from the platform's own record of the run,
  never from the sandbox. A token is issued only to the step the identity
  was granted to, only while its driver checks in, and never after the step
  stops or ends.
- Stopping a step stops renewal; it cannot recall a token already issued,
  which expires within ten minutes on its own.
- Within an account, a workspace or agent recreated under the same name
  is the same subject: pin your trust policy to the account at least.
- Who may run or edit an agent that names the identity may use it — as
  with every secret.
- Not on a laptop: only a sandboxed step on a platform whose operator set
  `FOLDRUN_OIDC_ISSUER` gets a token.

## How they are kept

Every account has its own encryption key. Secrets are sealed under it, and
the account keys are wrapped by one root key the platform holds. A stolen
copy of one account's secrets file opens nothing without the root key, and
the root key is not in any backup — every backup file, the platform's own
configuration included, is encrypted to a key the platform does not hold. See
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
