# Network

Every step runs in a sandbox of its own, and `network:` says which sites that
sandbox may reach. An agent that reads the open web may reach any public
site; every other agent reaches a list of trusted sites plus whatever it
declares. Least access by default, widened on purpose — the same default
Anthropic's own cloud sandboxes start from.

```yaml
---
name: crm-sync
tools: [crm_sync]
network: [api.hubapi.com]        # the trusted list, plus this
---
```

## The three levels

| level | the sandbox may reach |
|---|---|
| `open` | any public site |
| `trusted` | the trusted list, the sites you add, and what the step declares |
| `none` | only the sites you add and what the step declares |

**What the step declares** is always allowed, at every level: the hosts of
its `apis:`, its remote MCP servers, its web providers (`web: {search: brave}`),
the card of each outside agent in its `remotes:` (that card's own site — never
one the card names), and the sites its [secrets are bound to](secrets#bound-to-sites).
You never list those twice.

No level is ever a way into private space: the cluster, the LAN and the
cloud metadata endpoint are refused whatever `network:` says.

## The default

Unset, the level follows what the agent does:

- an agent with the `web` tool that may **fetch or browse** is `open` — a search
  result can name any site, and a list would break it;
- every other agent is `trusted`.

An agent whose `web:` allows only `search` (`web: {actions: [search]}`) is
`trusted`: it reads results, not pages.

## The trusted list

Package registries, source hosts and cloud SDKs — the domains Anthropic's
Claude Code cloud environments allow at their default *Trusted* level, plus
the Debian mirrors the runner image installs `runtime: system:` packages
from. Among them:

| | |
|---|---|
| Anthropic | api.anthropic.com, claude.ai, docs.claude.com, … |
| Source | github.com, raw.githubusercontent.com, gitlab.com, bitbucket.org, … |
| Packages | registry.npmjs.org, pypi.org, files.pythonhosted.org, crates.io, rubygems.org, proxy.golang.org, Maven, NuGet, … |
| Containers | registry-1.docker.io, ghcr.io, gcr.io, public.ecr.aws, … |
| Cloud | \*.googleapis.com, \*.amazonaws.com, \*.microsoftonline.com, … |
| Linux | deb.debian.org, security.debian.org, archive.ubuntu.com, … |

The whole list is `TRUSTED_SITES` in `@foldrun/core/network`; `foldrun agent
network <agent>` says how many sites it holds. It includes wide wildcards
such as `*.amazonaws.com` because SDKs need them — which means a bucket
anyone can create is reachable too. An agent handling something sensitive
can drop the list: `defaults: false`.

## Writing it

```yaml
network: trusted                                  # a level
network: [api.example.com, "*.example.org"]       # add sites; the level stays
network:
  level: none
  allow: [api.example.com]
  defaults: false                                 # trusted without the trusted list
```

A site is a domain or `*.domain` — no scheme, no path, no port; every port
of the host is covered. `*.example.com` covers `api.example.com`,
`a.b.example.com` and `example.com` itself. Quote a wildcard in YAML.

It is read on the agent, in the workspace's `AGENTS.md` and in the account's
`AGENTS.md`. The level and `defaults` are nearest-wins — the agent's, else the
workspace's, else the account's. The `allow` lists add up across all three,
so a site every agent needs is written once, in the account's `AGENTS.md`.

`foldrun check` and every deploy refuse a value they cannot read — a level
that is not one, a site with `https://` or a path — because it would leave
the agent on the level above it, wider or narrower than you wrote.

## Changing it

On the agent's page in the dashboard, the **Network** card shows the level a
run resolves, where it came from, and the sites on it; **Change** sets the
level and the sites to add. From the terminal:

```sh
foldrun agent network crm-sync                        # what a run resolves
foldrun agent network crm-sync --add api.hubapi.com   # add a site
foldrun agent network crm-sync none --remove a.com    # a level, and take one off
foldrun agent network crm-sync inherit                # back to the workspace's or the default
```

Both write the one `network:` line of `agent.md` and nothing else. Over the
API it is `PATCH /api/workspaces/<ws>/agents/<agent>` with `{ "network": … }`
(`null` inherits).

## How it is held

Every program in the sandbox reaches the internet through the **egress
proxy**: the pod's `HTTPS_PROXY` and `HTTP_PROXY` name it, with the step's
own lease as the password, and `NODE_USE_ENV_PROXY=1` turns that on for Node.
curl, Python's `requests` and `httpx`, pip, npm, git, apt and the Agent SDK
all read those variables. A browser your own script launches does not:
Chromium ignores a password written in the proxy variable, so every page
fails `ERR_INVALID_AUTH_CREDENTIALS`. Hand Playwright the proxy yourself —
read `HTTPS_PROXY` with `new URL()` and pass `proxy: { server, username,
password }` to `launch()`. (A step that may browse with the `web` tool gets
no proxy at all yet — see [Browsing](#browsing) below.) The proxy holds the
step's list and checks every connection against it:

- a site **off the list** is refused — `403`, saying which site and what to
  add — and the refusal is a line in the run trace;
- a site **on the list** is a tunnel: the bytes pass through and the proxy
  never reads them;
- a site a **secret is bound to** is intercepted, so the secret can be filled
  in on the way out ([Secrets](secrets#bound-to-sites)).

On a cluster the pod's network policy backs this up. A step whose level is
`trusted` or `none` runs in a pod that may reach the proxy and DNS and
nothing else, so a program that ignores the proxy variables finds no route
instead of going round the list; it cannot reach the account's browser or
search pods either, which are the world fetched on a run's behalf.

The trace opens with the step's network:

```
network: trusted (default) — the trusted list (207 sites); added: api.hubapi.com
egress: CONNECT pypi.org:443 × 3 (840ms total)
network: example.com is not a site this step may reach (network: trusted). To allow it, add just this site to the agent's network: list — network: [example.com] — which keeps network: trusted for everything else. Refused.
```

### Report-only, then refuse

The list is refused when any one of three says so:

- `network_enforce: true` in the account's `AGENTS.md` — every workspace;
- `network_enforce: true` in a workspace's `AGENTS.md` — that workspace;
- `FOLDRUN_NETWORK_ENFORCE=1` on the install's worker — every account.

Each only switches it on. A workspace cannot turn off what its account
turned on, and nothing in an account turns off the install's. Settings →
Guardrail, on the account's and a workspace's Settings, has the switch, and so does
`foldrun account set network_enforce on` / `foldrun workspace set
network_enforce on --to <workspace>`.

Until one of them says so, the proxy only **reports**: a site off the list
is allowed, and the trace names it once per step —

```
network: api.example.com would be refused (network: trusted) — allowed, because nothing here asks to refuse yet. Add it to the agent's network: list to keep it reachable; network_enforce: true in AGENTS.md refuses it.
```

— so the sites your agents really use can be added before anything is
refused. Read a week of traces for `would be refused`, add what belongs,
then switch it on. The trace line `network: … — report only` says which
mode a step ran in.

On a cluster, a refused step's pod also loses its direct route to the
world: the network policy gives it the proxy and DNS only.

### Where it is not held

`foldrun run` on your own machine has no sandbox, and a compose install with
no egress proxy (no `FOLDRUN_EGRESS_URL`) has no forward door: there,
`network:` is checked and resolved but not enforced, and the trace says
`not enforced here`. On the single-container tier the proxy variables are
set and the proxy holds the list, but the container's network is not walled
in, so a program that ignores the variables still goes direct.

### Browsing

A step that may **browse** with the `web` tool is held to its list where the
platform can wall the step in: on a cluster whose operator has switched it
on (`FOLDRUN_BROWSE_ENFORCE=1`), for a step whose list is restricted
(`trusted` or `none`) and enforced. Such a step gets the proxy like any
other, its pod is walled to the egress proxy and DNS, and the browser runs
inside that pod — the step's own, shared with no other step. Whatever the
browser is told — another proxy, a new context with a proxy of its own, a
page's script — the only way out is the egress proxy, which holds the list
per connection, over IPv4 and IPv6, TCP and UDP alike. The trace says so —

```
network: trusted (agent) — the trusted list (207 sites); added: example.com — enforced — hosted: the browser runs inside this step's sandbox, whose network reaches only the egress proxy (which holds the list) and DNS, so a page, a script or a changed proxy setting reaches no site off the list; DNS lookups themselves are not restricted.
```

A site off the list fails in the browser as a failed tunnel
(`ERR_TUNNEL_CONNECTION_FAILED`), and the trace names it with the usual
advice: add just that site.

What a held step does differently:

- **foldrun's own browser, in the step.** The account's browser pod is not
  used (it reaches the world, and a walled pod cannot reach it), so the step
  runs on the image with browsers. Chromium and Chrome take the proxy and its
  password as launch options (checked through an authenticating proxy);
  Firefox and WebKit are given the same.
- **Refused, saying why:** a vendor's browser (`web: {browse: browserbase}`
  and every other — they browse from their own network, which no list here
  holds), `proxy=` (a proxy of your own is not reachable), `live:` sessions,
  and the Lightpanda and Obscura engines (no way through the proxy verified
  yet). A vendor step is refused before it connects; to accept browsing that
  no list holds for one agent, give that agent `network: open`.
- **Secrets bound to sites** stay out of the sandbox: a `headers=` value can
  carry the `${NAME}`, which the proxy fills; `auth=`, `cookies=` and
  `storage=` need the value in the browser and are refused for a bound
  secret — unbind it to use it there.
- **Sites a secret is granted to** are where the proxy ends TLS to fill the
  secret. Chromium is told to trust the egress CA for them; Firefox and
  WebKit are not, and a page there fails its certificate check.
- **Web search** through the account's search pod is not reachable from a
  walled pod either; the trace says so. Name a search provider in `web:`
  (it goes through the proxy) or leave search out of that step.

Not covered: DNS lookups through the cluster's resolver (the wall admits
DNS, and nothing restricts the names asked), WebSocket upgrades to a host a
secret is granted to (they fail), and — as for every tunnel — which origins
a page loads inside a connection to an allowed site.

Everywhere else — `foldrun run` on your machine, the single-container tier,
an install without the switch, a report-only list, `network: open` — a
browsing step is **not** held: it gets no proxy, and the browser and every
other program in the step reach sites directly. The trace says that too:

```
network: trusted (agent) — the trusted list (207 sites); added: example.com — not enforced in this step: it may browse, and browsing does not go through the egress proxy here, so the browser and every other program in this step reach sites directly. Its browser is foldrun's own browser: it is held to network: on an install that confines browsing, with the list enforced (FOL-110).
```

The trace names which of three tiers the step's browser falls in:

| tier | browsers | under `network:` |
|---|---|---|
| hosted | foldrun's own browser | held, where the platform confines browsing and the list is enforced |
| vendor | Browserbase, Steel, Hyperbrowser, Browserless — they take a customer proxy | not yet: each comes under the list through the egress proxy once it passes our own tests; until then a held list refuses it |
| none | Bright Data, ZenRows, any DevTools address — they browse through their own network | never; a held list refuses them |

The dashboard's Network card and `foldrun agent network <agent>` say which
applies to an agent. An agent that must stay inside its list where browsing
is not held should not browse: give it `web: {actions: [search, fetch]}`,
which goes through the proxy like any other program.
