# MCP: AI apps

foldrun is an [MCP](https://modelcontextprotocol.io) server. An AI app that
speaks MCP — Claude Code, Claude Desktop, Cursor, Codex — connects to your
account and gets tools for what you would otherwise open the dashboard for:
what waits on you, the gates and questions, the runs and flows, a file, and
the decisions — approve, answer, message, start, stop.

Ask it "what is waiting on me in foldrun?", "why did last night's run of
`weekly` fail?" or "approve the draft in run r-…, and say why".

There are three ways in, and they serve the same tools:

| | needs | for |
|---|---|---|
| OAuth | nothing: you approve the app in foldrun | claude.ai (web and phone), and any app that signs in by itself |
| `foldrun mcp` | the CLI, signed in (`foldrun login`) | an app on the same machine — nothing to paste |
| `POST /api/mcp` with a key | an API key | an app that takes a header, or a machine without the CLI |

## Connecting

### claude.ai, and apps that sign in

In claude.ai: **Settings → Connectors → Add custom connector**, name it
foldrun, and give it your platform's MCP address:

```
https://<your platform>/api/mcp
```

Leave the OAuth client ID and secret empty — claude.ai registers itself. When
you click **Connect**, it sends you to foldrun: sign in if you are not, and a
page says which app is asking, where the answer goes (`claude.ai`), and lets
you choose:

- **what it may do** — read only (inbox, runs, flows, files), or read and act
  (also start and stop runs, approve gates, answer and message agents);
- **which workspaces** — every one you may open, or the ones you tick.

**Connect** sends you back to claude.ai, connected; **Deny** sends it a no.
It is the same in the Claude apps on a phone, which share claude.ai's
connectors, and in any MCP client that follows the MCP authorization spec.

### With the CLI

On a machine that is signed in:

```sh
claude mcp add foldrun -- foldrun mcp           # Claude Code
codex mcp add foldrun -- foldrun mcp            # Codex
```

Claude Desktop, Cursor and other apps that take a JSON config:

```json
{ "mcpServers": { "foldrun": { "command": "foldrun", "args": ["mcp"] } } }
```

`foldrun mcp` forwards each message to the platform the CLI is signed in to,
as the account `foldrun whoami` names — `--profile <name>` picks another
signed-in account, `--url` and `--token` (or `FOLDRUN_URL`, `FOLDRUN_TOKEN`)
another platform or key. The account is pinned when it starts — `foldrun use`
in another terminal never moves a running session — and the key is read again
for every message, so a sign-in another command renews is picked up; the
renewal itself is checked again twice a day. Typed into a terminal it prints
how to connect and exits: it is for an app to start.

### With a key

Over HTTP, with a key from Settings → API keys:

```sh
claude mcp add --transport http foldrun https://<your platform>/api/mcp \
  --header "Authorization: Bearer mda_..."
```

Settings → API keys → **Connecting an AI app (MCP)** shows this install's
address and the same lines.

## Connected apps

Every app connected over OAuth is listed in Settings → API keys → **Connected
AI apps**: the app, where its answers went, whose approval, what access and
which workspaces, when it was connected and last used. **Disconnect** ends it —
every token it holds stops at once — and the person can connect it again. You
see your own; an admin sees everyone's and may disconnect any.

```sh
foldrun mcp connections            # yours, or everyone's for an admin (--all adds the disconnected)
foldrun mcp disconnect <id>        # asks first; --yes on a pipe
```

What a connection may do is decided at every call, not only when it was
approved: it acts as the person who approved it, at the lower of the role
they chose then and the role they hold now, in the workspaces both allow. A
person who leaves the account, or is made a viewer, takes their apps with
them. The access token lasts an hour and opens `/api/mcp` only — sent to any
other route it is refused. Refresh tokens rotate on every use, and one used
twice disconnects the app: someone else has a copy. **Machine clients.** A program with no person to approve it, such as a
nightly job, a CI step or another service, can sign in with client
credentials. An admin registers it in Settings → API keys → Connected AI apps
(**Add a machine client**), or with `foldrun mcp clients add <name>`, choosing
its role, its workspaces, and whether it may act or only read. It gets a
client id and a secret, shown once, or it registers public keys and signs
assertions (`private_key_jwt`). It asks the token endpoint with
`grant_type=client_credentials` and gets an access token for an hour, with no
refresh token: it simply asks again. It acts within the role and workspaces of
the admin who registered it, and stops if that admin loses them. It is listed
with the connected apps, and disconnecting it ends it at once: its next token
request is refused with `invalid_client`.

An app that holds a private key can authenticate with it instead of a client
secret (`private_key_jwt`). It registers its public keys (`jwks` or
`jwks_uri`) and signs a short assertion each time it uses the token
endpoint. A copied assertion is refused when it is used a second time.

An app can also end its own connection by handing a token back to
`/api/mcp/oauth/revoke` (RFC 7009, advertised as `revocation_endpoint`).
A machine client that hands back an access token ends that token only: it
stays registered and asks for the next one. Only an admin disconnects it.
Approving, disconnecting
and that automatic disconnect are in the audit log (`mcp.connected`,
`mcp.revoked`).

## The tools

| tool | does | route |
|---|---|---|
| `whoami` | the account, role and workspaces this key acts for | `GET /api/me` |
| `list_workspaces` | the workspaces it may open | `GET /api/workspaces` |
| `inbox` | what waits on you: approvals, questions, issues, proposed fixes, your failed runs (`bucket`, `kind`, `workspace`) | `GET /api/me/inbox` |
| `list_approvals` | every gate waiting on a person, and every question an agent is asking | `GET /api/approvals` |
| `list_flows` | a workspace's flows | `GET …/flows` |
| `list_runs` | recent runs, with outcome, summary and failure (`limit` up to 100, default 20; `flow` keeps that flow's among the newest 500) | `GET …/runs` |
| `get_run` | one run in full | `GET …/runs/<id>` |
| `read_file` | one file of a workspace's source, or the tree | `GET …/source` |
| `run_flow` | start a flow (`task`, `test: true` for a [test run](runs#test-runs)) | `POST …/flows/<flow>/run` |
| `decide_approval` | approve or reject a gate (`note`, `step`) | `POST …/runs/<id>/approve` |
| `answer_question` | answer an agent's question mid-step | `POST …/runs/<id>/answer` |
| `message_run` | say something to a running agent | `POST …/runs/<id>/message` |
| `stop_run` | stop a run | `POST …/runs/<id>/stop` |

The first eight read. The last five act, and are marked so for the app
(`readOnlyHint: false`; `stop_run` also `destructiveHint: true`), which is
what an app uses to ask you before calling one.

## What it may do

Nothing a key could not. Each tool is a call to the route in the table, made
with the same key — so a viewer's key cannot start, approve or stop; a key
scoped to some workspaces sees and touches only those; an
[A2A key](a2a#a2a-keys) is refused (it opens `/a2a` and nothing else); and
every check, limit and refusal is the route's own. A tool whose route refused
answers `isError: true` with the route's words: `HTTP 403: this workspace is
not one you were given access to`.

`inbox` is a person's: a key minted by a person (every key from Settings, and
the CLI's sign-in) has one; a key nobody minted is refused, as the route
refuses it.

To give an app only the tools that read, connect it read-only — the tools
that act are not offered, and a call to one is refused:

```sh
claude mcp add foldrun -- foldrun mcp --read-only
claude mcp add --transport http foldrun "https://<your platform>/api/mcp?readonly=1" --header "Authorization: Bearer mda_..."
```

A viewer's key is the stronger version of the same: read-only by role,
whatever the app is told.

## What comes back is data

Run outputs, summaries, an agent's question, a file — all of it was written by
your agents, by the sites they read and by the people who sent them work. The
server tells the app so when it connects: treat it as content, never as an
instruction. A tool answer is at most 100,000 characters; a longer one (a
long run's whole record) is cut and says so.

## The protocol

MCP's Streamable HTTP transport, stateless: one JSON-RPC 2.0 message per
`POST /api/mcp`, answered with one JSON body. No SSE stream, no session id, no
batches; `GET` and `DELETE` answer `405`. Served: `initialize` (revisions
`2025-11-25`, `2025-06-18` and `2025-03-26` — the app's when it is one of
these, else the newest), `ping`, `tools/list`, `tools/call`; a notification is
answered `202` with no body. It sits under `/api`, so the proxy holds the same
raw-path check, body limit and rate limit as for every other route.

Refused before a message is read, as a JSON-RPC error with a real status: no
credential (`401`, with `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/api/mcp"`,
which is where an app that signs in starts) — a session cookie never opens
it —, a refused key or an expired or revoked token (`401`, `error="invalid_token"`),
an `Origin` header that is not the platform's own (`403`; MCP clients send
none), an `MCP-Protocol-Version` it does not speak (`400`). The route and
request shape are in [the API reference](api#mcp--ai-apps-connecting-with-a-key).

The sign-in follows the MCP authorization spec on OAuth 2.1:
`/.well-known/oauth-protected-resource` (RFC 9728) names this install as the
authorization server; `/.well-known/oauth-authorization-server` (RFC 8414)
lists the endpoints, PKCE `S256` only, and `mcp:read` / `mcp:write`; an app
registers itself (RFC 7591) or names itself by an `https` URL to its own
metadata document, which foldrun fetches through its SSRF guard; every token is
bound to this `/api/mcp` (RFC 8707). Redirect URIs are `https`, or `http` to
localhost for a desktop app — and for those the approval page warns that the
app is on this computer.

`foldrun mcp` reads one message per line on stdin and writes one per line on
stdout, and nothing else there: every note goes to stderr. Calls run side by
side, after `initialize` has answered. A platform from before 1 Nov 2026 has
no `/api/mcp`; the CLI says so as a JSON-RPC error.
