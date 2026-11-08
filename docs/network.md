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
  in on the way out ([Secrets](secrets#bound-to-sites)). That holds for a
  WebSocket too: a `wss://` to such a site has its opening request filled
  like any other (URL, headers, Basic auth), and once the site agrees the
  messages pass both ways unread. The platform's own model keys are never
  sent over one, and a [test run](runs#test-runs) may open one only to a site it
  could not write to.

On a cluster the pod's network policy backs this up. A step whose level is
`trusted` or `none` runs in a pod that may reach the proxy and nothing else,
so a program that ignores the proxy variables finds no route instead of
going round the list; it cannot reach the account's browser or search pods
either, which are the world fetched on a run's behalf. Its web search goes
through the proxy instead ([Search](#search), below).

### DNS

A name is a message too: looking up `<anything>.example.net` reaches
example.net's nameserver, whatever the list says. So on a cluster that walls
it (`FOLDRUN_RUN_DNS_WALL=1`, on with foldrun's own manifests), a pod held to
its list has **no DNS of its own**: no resolver to ask, and the cluster's
resolver is not reachable from it. It does not need one. Every program sends
the proxy the name of the site it wants (`CONNECT api.example.com:443`), the
proxy looks up only a site the list allows, and the proxy's own address is
written into the pod. curl, Python's requests and httpx, Node, Go, git, apt,
pip, npm, the Claude CLI and the browser all work this way. The trace says
so:

```
dns: this sandbox has no resolver of its own — every site is reached through the egress proxy by name, and the proxy looks up only sites on the list; a program that looks a name up itself (dig, an MX check, a client that resolves before it connects) fails here
```

What fails there is what asks DNS directly: `dig`, `nslookup`, `ping` by
name, a mail-address check that looks up MX records, a library that resolves
a name before it connects. Give such an agent the site of a DNS-over-HTTPS
service in its list (`dns.google`, `cloudflare-dns.com`) and ask that over
HTTPS, or give it `network: open`. What the wall cannot hold is what the
list itself allows: the proxy looks up a name under an allowed wildcard
site (`*.example.com`), and a tunnel to an allowed host may use any port.

The trace opens with the step's network:

```
network: trusted (default) — the trusted list (207 sites); added: api.hubapi.com
egress: CONNECT pypi.org:443 × 3 (840ms total)
network: example.com is not a site this step may reach (network: trusted). To allow it, add just this site to the agent's network: list — network: [example.com] — which keeps network: trusted for everything else. Refused.
```

### Search

A step walled to its list (on a cluster, with the list restricted and
enforced) cannot reach the account's search engine — it is a pod with the
world, and the wall lets the step reach only the egress proxy. So the proxy
asks it on the step's behalf: the web tool's `search`, `answer` and
`monitor` (a query) go to the proxy's **search door**, which only a step
the runner gave it may use. The engine is a platform service, not a site on
the list, and nothing about it widens the list. The trace says so:

```
search: through the egress proxy — the account's search engine answers this step's queries from a fixed set of engines; a query's words leave for those engines, and each query is a line in this trace; a result is data, and fetching it is held to network: like any other site
search: a query (37 characters, 5 words) sent to yandex, naver, brave, wikipedia through the account's engine — its words may reach those public search engines
```

What that means, plainly:

- **A query is a message out.** Its words reach public search engines, and
  nothing can stop words carrying what the step knows. The door bounds
  *where* they go — a fixed set of engines (`yandex`, `naver`, `brave`,
  `wikipedia`; `arxiv`, `pubmed` for `categories: science`; `github`,
  `stackoverflow` for `it`), each asking its own provider with the text —
  and records *that* each one went. No engine that fetches a URL named in
  the query, none that reaches a server the query picks; no engine, bang or
  timeout chosen inside the query (`!name`, `!!bang`, `<5` are refused), no
  URL and no `${NAME}` in it, no plugin or DOI resolver chosen by the step.
  Any program in the step can use the door, not only the web tool, and each
  is held the same.
- **Results are data.** Titles and snippets of any site may come back,
  including sites off the list — that is what a search is. Opening one is a
  fetch, held to the list like any other: `answer` reads each result page
  through the proxy, so a page off the list is refused (its snippet may
  still be quoted, marked as one). Held results open with a line saying they
  are outside content, not instructions.
- **On the record.** The proxy's trace line gives the engines and the
  query's length, not its words; a query the web tool made is on the step's
  record with the tool call, as every call is (secret values redacted). At most 500 searches per step go
  through the door (fewer when `limits:` caps `web` or every searching
  action), four at a time.
- **Named on purpose where the list is narrow on purpose.** At `none`, or
  with `defaults: false`, a bare `tools: [web]` is not given the door: write
  the action out — `web: {actions: [search, fetch]}` — to accept that its
  queries leave. At `trusted` with the trusted list, the web tool's searching
  actions are offered as they are.

A search provider named in `web:` (`web: {search: brave}`) is unchanged: its
host is a site the step declares, and its key is filled at the proxy. A
step that is not walled — an open list, one only reported, `foldrun run` on
your machine, the single-container tier — searches the engine directly, as
it always has. The dashboard's Network card and `foldrun agent network`
say which applies to an agent.

### Report-only, then refuse

The list is refused when any one of three says so:

- `network_enforce: true` in the account's `AGENTS.md` — every workspace;
- `network_enforce: true` in a workspace's `AGENTS.md` — that workspace;
- `FOLDRUN_NETWORK_ENFORCE=1` on the install's worker — every account.

Each only switches it on. A workspace cannot turn off what its account
turned on, and nothing in an account turns off the install's. Settings →
Policies → Guardrail, on the account's and a workspace's Settings, has the switch, and so does
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
world: the network policy gives it the proxy only (and DNS, on a cluster
that does not wall it).

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
other, its pod is walled to the egress proxy (and, where the cluster walls
it, has no [DNS](#dns) of its own), and the browser runs inside that pod — the step's own, shared with no other step. Whatever the
browser is told — another proxy, a new context with a proxy of its own, a
page's script — the only way out is the egress proxy, which holds the list
per connection, over IPv4 and IPv6, TCP and UDP alike. The trace says so —

```
network: trusted (agent) — the trusted list (207 sites); added: example.com — enforced — hosted: the browser runs inside this step's sandbox, whose network reaches only the egress proxy (which holds the list), so a page, a script or a changed proxy setting reaches no site off the list.
```

followed by the `dns:` line above, or, on a cluster that does not wall DNS,
one saying the sandbox can still look any name up.

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
  yet). A vendor step is refused before it connects — unless the install
  holds that vendor through its vendor door (below); to accept browsing that
  no list holds for one agent, give that agent `network: open`.
- **Secrets bound to sites** stay out of the sandbox: a `headers=` value can
  carry the `${NAME}`, which the proxy fills; `auth=`, `cookies=` and
  `storage=` need the value in the browser and are refused for a bound
  secret — unbind it to use it there.
- **Sites a secret is granted to** are where the proxy ends TLS to fill the
  secret. Chromium is told to trust the egress CA for them by its key;
  Firefox browses in a profile whose certificate database holds it (the
  session's profile, or one made for the call), and the trace says
  `browser: firefox trusts the egress proxy's certificate`. WebKit trusts
  only the system store, so the platform puts the CA there for any step that
  gets it: an init container builds the store from a platform-owned
  ConfigMap and the sandbox mounts it at `/etc/ssl/certs`, root's and not
  the agent's to change (the
  trace says `egress CA: in this sandbox's system trust store too`), and
  every other program that reads only the system store trusts it as well.
- **Web search** goes through the egress proxy's search door, as for any
  walled step ([Search](#search)).

Not covered: DNS lookups on a cluster that does not wall them (see
[DNS](#dns)), and — as for every tunnel — which origins a page loads inside
a connection to an allowed site.

Everywhere else — `foldrun run` on your machine, the single-container tier,
an install without the switch, a report-only list, `network: open` — a
browsing step is **not** held: it gets no proxy, and the browser and every
other program in the step reach sites directly (unless the install runs the
[browse service](#the-browse-service), below, which takes the browser out of
the step). The trace says that too:

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

### A vendor's browser, through foldrun's vendor door

A rented browser — Browserbase, Steel, Hyperbrowser or Browserless, the four
that take a customer's proxy — runs on the vendor's machines, so the egress
proxy never sees its pages. On an install that holds a vendor through its
**vendor door** (`FOLDRUN_VENDOR_EGRESS`, below; FOL-145), a held step may
use that vendor instead of being refused:

- the vendor's key is bound to the vendor's API, so it is only a name in the
  sandbox and the egress proxy fills it;
- every call to the vendor goes through the proxy, under that vendor's
  session rules: the call that **starts** a browser is rewritten so its only
  proxy is foldrun's vendor door, with a credential made for that session
  (fifteen minutes at most, ended with the step); reading or ending a
  session passes; anything else is refused, and the trace says why;
- the vendor's remote-control connection goes through the proxy's `/e/`
  door as well — the walled sandbox reaches nothing else;
- the door holds every page to the step's list, refuses private addresses,
  caps connections and bytes per step, and closes the step's connections
  within a second of the step ending;
- **no site a secret is bound to**: a vendor's browser cannot trust foldrun's
  certificate, so the proxy cannot fill a secret there — such a page is
  refused (`unsupported capability: vendor secret filling`); use foldrun's
  own browser for those steps;
- for such a step there is no way round: plain `http://` to a vendor, a
  tunnel to a vendor whose key is not bound, and a tunnel to a bare address
  are refused.

Bright Data, ZenRows and a raw DevTools address always browse through their
own network and are never held this way. A vendor is listed on an install
only once it has passed foldrun's qualification for it (FOL-151); until then
it is refused under a held list, as before.

### The browse service

On a cluster whose operator has switched it on (`FOLDRUN_BROWSE_SERVICE=1`,
off by default), a step that browses but is **not** held to its list — an
open list, a report-only one, an install that does not confine browsing —
runs its browse calls outside its sandbox. Each such step gets a pod of its
own beside its run pod, on the same runner image, running foldrun's own
browse program; the pod goes when the step does. The step's `web` tool sends
each call there through the egress proxy and gets back what the call wrote:

- **The same calls, the same answers.** Every mode and action works as it
  does in the step — clicks, fills, frames, `js=` and `eval` (which run in
  the page, as always), screenshots, PDFs, video, HAR, downloads (they come
  back to the path the call names), uploads (the file is sent from the
  workspace), `session=` (kept as the browser's storage state in
  `outputs/.browser/<name>/`, as on the account's browser pod), saved logins
  (`state:` and `state_key:`, read from and written to `state/browser/`),
  aria numbers, `mode=diff` and `mode=crawl`. The live view streams as before.
- **Its browser goes through the egress proxy** under the step's own lease:
  a site off the list is refused where the list is enforced, and named in
  the trace where it is only reported. The pod's network reaches the proxy
  and DNS, nothing else. The other programs in the step are not held by this
  — only the browser is.
- **What stays in the step**, exactly as before, saying so on the call: a
  `live:` session, engines other than Chromium and Chrome (Firefox, WebKit,
  Lightpanda, Obscura), `extensions:`, `proxy=`, a vendor's browser, a page
  on the sandbox's own machine or a private address, and a workspace whose
  copy of the `web` tool was edited (the service runs foldrun's own program,
  never an edited one). A call the service could not start runs in the step;
  a call that started there and was cut off is **not** run again — it may
  have clicked — and fails saying so.
- **A step held to its list** never uses it: its browser stays in its own
  walled pod ([above](#browsing)). Nor does a [test run](runs#test-runs).

The trace says which way a step went:

```
browser: foldrun's browse service — this step's browse calls run outside its sandbox, in a pod of the step's own, and every page goes through the egress proxy under this step's network: list (…)
egress: browse service × 4 (21.3s total)
```

The pod's time is on the account's bill like the account's browser pod's.
