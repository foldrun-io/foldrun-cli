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
and the sites its [secrets are bound to](secrets#bound-to-sites). You never list
those twice.

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
password }` to `launch()` (the `web` tool's browsers already do). The proxy
holds the step's list and checks every connection against it:

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
network: example.com is not a site this step may reach (network: trusted). Add it to the agent's network: list — network: [example.com] — or set network: open. Refused.
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
