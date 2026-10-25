# The agent file

`agents/<name>/agent.md` is the only required file an agent has. Frontmatter
for the machine, body for the model — and the body is the prompt, so write it
as instructions to a colleague rather than as documentation about one.

```markdown
---
name: competitor-watcher
description: Watches competitor sites and drafts a weekly digest.
model: default
effort: high
tools:
  - web
  - write
  - [[price-tracker]]
secrets: [SLACK_WEBHOOK_TOKEN]
---

You watch our competitors and produce a weekly digest.

Check each site listed in [[competitors]]. Note pricing changes, new features
and new posts. Write the digest to outputs/digest.md.
```

## Identity

| field | |
|---|---|
| `name` | kebab-case, unique in the account. The agent's identity — the folder must match |
| `description` | what it does *and when to use it*. Other agents read this when consulting; people read it in the dashboard |
| `owner` | the person who answers for it — an email or a name. Unset, it is the workspace `AGENTS.md`'s `owner:`, then the account's. Shown on the agent list, the agent's page and `foldrun agent ls` |

### Who owns it, and whether anyone still uses it

`owner:` names the person who answers for the agent. The agent list shows it
beside **last run** — when its latest step started — so an agent nobody has
used in months is visible, and `alerts: stale_days` in `AGENTS.md` tells
`notify:` about one ([Notifications](notifications#thresholds-alerts)).
An idle agent still holds every tool and secret it was granted: retire it
by deleting its folder and redeploying.

Only `name` and the body are required. Every other field widens or narrows
what the agent can reach, and the default is narrow.

### Grouped by job

The fields that govern an agent or guard it may be grouped under the job
they do. `governance:` holds `owner` and `budget`; `guardrail:` holds
`limits`, `network`, `hooks`, `disallowedTools`, `permissionMode` and
`secrets`:

```yaml
---
name: researcher
tools: [web, read]
governance:
  owner: ana@acme.io
guardrail:
  network: [api.example.com]
  limits: {web.search: 40, repeat: 5}
---
```

It reads exactly as the same fields at the top. A field written both ways is
refused. See [The four jobs](four-jobs).

## Which model, and how hard it thinks

| field | values | |
|---|---|---|
| `model` | `fast` \| `default` \| `max`, an alias (`opus`), or a full id | a **tier**, so agents don't rot when models are renamed. Synonyms land on their tier: `small`/`cheap` → fast, `large`/`best` → max |
| `effort` | `low` \| `medium` \| `high` \| `xhigh` \| `max` | how long it thinks before answering. Unset leaves the model's own default |
| `budget` | a number in USD | the most this agent may spend in **one run**, across every step it takes in it. Its step stops mid-turn at what is left; a later step of its own in the same run is refused before it starts. Unset is no limit. Per run only — a cap over a day, week or month belongs in `AGENTS.md` |

The two are orthogonal — the model is which brain, effort is how long it
thinks — and `fast` + `max` is a real pairing: the cheap model, told to take
its time. The same word means different things on each key: `model: max` is
the most capable model, `effort: max` is think-hardest.

Match the tier to the work, not to the importance of the desk. A step that
orders findings other steps produced is a `fast` step even when its output is
the point of the week; a step that weighs two arguments and picks one is not.

## What it may do

| field | |
|---|---|
| `tools` | the one grant list — built-in groups, exact SDK names, and your own tools |
| `disallowedTools` | subtract from what it would otherwise have |
| `skills` | an allowlist. **Absent inherits every skill in scope**; `[]` withholds all of them |
| `agents` | colleagues it may consult mid-run — an answer, no tools |
| `subagents` | colleagues it may delegate a whole job to — own context, own tools, never more than its own ([below](#delegating-to-a-sub-agent)) |
| `sandbox` | `own` \| `parent` (default) — delegated to as a sub-agent, run each job in a sandbox of its own, with its own tools, secrets and network ([below](#isolated-sub-agents-sandbox-own)) |
| `scripts` | programs in `scripts/`, each becoming a callable tool |
| `hooks` | your own code at every tool call, step start and step end — refuse, rewrite, add context — the same on every model ([Hooks](hooks)). Also in a workspace's or the account's `AGENTS.md` for every agent under it |
| `apis` | an HTTP API declared inline, as one tool |
| `mcpServers` | an MCP server declared inline |
| `secrets` | vault entries its tools may use — names only, never values. The names the step's own model call uses (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_CUSTOM_HEADERS`, the `ANTHROPIC_*_MODEL` tiers, `CLAUDE_CODE_OAUTH_TOKEN`, `FOLDRUN_MODEL_KEY`) never replace the model's own settings, and `foldrun check` warns: script and API tools and `verify:` get the declared value under that name, but the agent's own shell sees the model's — give it another name (`MY_ANTHROPIC_KEY`), or run the model on it with `provider:` |
| `limits` | the most calls one step may make — per tool, per web action, or in all: `limits: {web.search: 40, crm: 20, calls: 300, repeat: 5}` (`repeat`: the same call with the same input). A call past a limit is refused, never run ([Tools](tools#limits--how-many-calls-a-step-may-make)) |
| `network` | which sites its sandbox may reach: `open`, `trusted` or `none`, or a list of sites added to the trusted list — `network: [api.hubapi.com]`. Unset, an agent that may fetch or browse the web is `open` and every other `trusted`. Also in a workspace's or the account's `AGENTS.md` ([Network](network)) |
| `permissionMode` | `plan` makes the run read-only, whatever else was granted |
| `web` | the `web` tool's settings: `actions:` — which of its eight it may use (all when absent) — and who does each, `web: {search: brave, fetch: jina, browse: browserbase, crawl: firecrawl}`, with the key named in the vault. Unset is foldrun's own. `search:` also takes a block of the own engine's settings — engines, categories, safesearch, plugins ([Tools](tools#tuning-the-accounts-own-engine)); `browse:` a block of the browser's ([below](#webbrowse--which-browser-and-how-it-presents-itself)), and `browse:` alone cascades from `AGENTS.md`. The providers and their keys: [Tools](tools#reaching-the-web). A per-action key outside the block is not read — `check` errors on it |

The built-ins, by what they reach. Only **Web** talks to an outside vendor, so
only Web takes a provider:

| category | grant | gives | provider |
|---|---|---|---|
| **Web** | `web` | eight actions — search, fetch, browse, crawl, map, extract, answer, monitor | one per action under `web:` — unset is ours |
| **Files** | `read` | Read, Glob, Grep — inspect but never modify | — |
| | `write` | Read, Write, Edit, Glob, Grep | — |
| **Code** | `code` | Bash — runs anything in the sandbox: Python and Node (packages via `runtime:`), Debian programs (`runtime: system:`), or a binary you ship | — |
| **Memory** | `search` | `search_files(query)` over knowledge, memory, state and storage at every scope | — |
| | `history` | `recall_runs()` and `read_run(id)` — the workspace's last thirty finished runs | — |
| | `desks` | `recall_desk_runs()` and `read_desk_run(id)` — the same, across the account's *other* workspaces: ten recent runs each, named per line, up to 100 runs in all. Run records, not files: the way a digest agent reads what every desk concluded this week | — |
| **People** | `ask` | `ask_person(question, options?)` — asks the person running the desk mid-step and waits for the answer ([below](#asking-a-person-mid-step)) | — |
| | `peers` | `peers_list()` and `peers_message(to, text)` — the other steps running beside it in its parallel group, and a message to one of them (or all), which reaches that agent after its next tool call ([below](#asking-a-colleague-beside-you)) | — |
| **Installing** | `install` — every agent has it | `install(manager, packages)` — installs a missing program or library mid-step: Debian packages (`apt`), Python (`pip`), Node (`npm`) ([below](#installing-what-a-step-needs)) | `disallowedTools: [install]` removes it |
| **Colleagues** | `agents:` · `subagents:` | not in `tools:` — their own fields: consult a colleague for an answer, or delegate a job to one that works with its own tools ([consult](#consulting-colleagues), [delegate](#delegating-to-a-sub-agent)) | — |

### Asking a person mid-step

`tools: [ask]` gives the agent `ask_person`. It posts a question — with up to
ten `options` when the answer is one of a few — and waits. The question shows
on the run page, in the dashboard's banner, in `foldrun approvals`, and goes
wherever the workspace's `notify:` sends approvals. A person answers with a
click, a sentence, `foldrun answer <run-id> "…"` or `POST
…/runs/<id>/answer`; the agent gets the answer within a second or two and
carries on in the same step. Nobody answering in time is an answer too: the
agent is told to decide if that is safe, or stop and reply BLOCKED.

```yaml
tools: [read, write, ask]
ask:
  timeout: 2h        # how long it may wait — default 30m, at most 24h
```

**It costs while it waits.** The step's sandbox stays up, so the wait is
charged as the step's seconds like any other. An approval gate (`!`) parks
the run and costs nothing while parked — use `ask` for a question that only
comes up halfway through, a gate for one you know about before the step.

**Messages into a running step.** On the platform, a person can also say
something to any running agent — the run page's box, `foldrun message
<run-id> "…"`, or `POST …/runs/<id>/message`. It reaches the model after its
next tool call, as context; it never changes the step's tools or what it may
do. A model writing without calling tools hears it at the next call it makes.
Every question, answer and delivered message is on the step's trace and its
record. A local `foldrun run` has no inbox; there `ask_person` asks on the
terminal when there is one.

### Asking a colleague beside you

`tools: [peers]` gives the agent `peers_list` and `peers_message`. Steps that
share a number in a flow run in parallel, and until this they ran blind to
each other: a writer that needed the image-maker's file name guessed it, and
an image-maker that found the plan's subject unusable had no one to tell.
Now a step can ask the colleague beside it for what it has, in the moment,
instead of guessing, failing, or stopping for a person.

```yaml
tools: [read, write, peers]
```

`peers_list()` names the other steps of the group — each agent, its step
number and the first line of its instruction — as they were when the group
launched. `peers_message(to, text)` leaves a message in that colleague's own
inbox, the same inbox a person's message uses, signed with the sender's
agent name; `to: all` reaches every sibling. It reaches the colleague after
its next tool call, as context, and the colleague answers the same way, so
nothing waits: the sender keeps working and reads what arrives after its own
next call. A message is a request or a fact, never a hand-over — the
receiving step's tools and instruction do not change. A model writing
without calling tools hears a message at the next call it makes; a sibling
that has already finished reads nothing, and the sender is told nobody
received it.

The prompt tells the agent who runs beside it this run, so a step that
happens to run alone knows not to wait for anyone. Each colleague has an
address, `agent#step` (the step as the flow numbers it), and a message is
signed with the sender's; a fan-out's instances share one agent name, so the
bare name reaches every instance and the address reaches one. A sibling
without `peers` of its own still receives: the inbox is every step's, only
the sending is the tool's.

Every message, sent or received, is on the step's trace and on its record
(`messages`, with `from` or `to`), and the run page shows the conversation
under the step beside the person's own. A local `foldrun run` has the same
line between siblings, in process; only a person cannot write in there.

**Retired**, still granted so a deployed agent keeps running, and each an
error in `foldrun check` naming what to write instead: `files` and `bash`
(now `write` and `code`). The web is `web` alone; Anthropic's `WebSearch` and
`WebFetch` are not names to grant — a model provider's own search is chosen
under `web:` (`web: {search: zai}`), and anything else is an unknown tool.

Anything in `tools:` that no built-in claims is one of your own tools,
resolved against the workspace's `tools/` and then the account library. A
`[[link]]` makes that explicit and is the only way to grant a tool whose name
a built-in would otherwise shadow:

```yaml
tools:
  - read              # the built-in group
  - [[search]]        # your tools/search.md, not the platform's search group
```

`{bash: ask}` is accepted for per-call approval in Claude Code; platform runs
disable ask-mode and log that they did.

## Consulting colleagues

```yaml
agents:
  - [[fact-checker]]
```

Each name becomes a `consult_<name>(question)` tool. The colleague's persona
answers one self-contained question as a **toolless** call, inline, with the
spend landing on the consulting step. Depth is one — consultants cannot
consult further. It is deliberately weak: a consult asks a specialist what
they think; it does not hand over the task.

## Delegating to a sub-agent

```yaml
subagents:
  - [[researcher]]
```

A sub-agent takes a whole job — read these forty pages, check these links,
work through this folder — in **its own context, with its own tools**, and
hands back what it found. The delegating agent's context stays on its own
work. It is the Agent SDK's own sub-agent (the model gets an `Agent` tool,
the way Claude Code delegates), fed from the named agents' files.

| | `agents:` — consult | `subagents:` — delegate |
|---|---|---|
| context | its own | its own |
| tools | none | its own `tools:`, cut to the delegating agent's |
| gives back | one answer to one question | the result of a job, in its reply |
| cost | on the consulting step | on the delegating step |

What keeps it inside the step:

- **Never more than its parent.** A sub-agent's tools are its own `tools:`,
  resolved as its own step's would be, then **cut to what the delegating
  agent holds** — a sub-agent with `tools: [read, code]` under a parent with
  `tools: [read]` gets `read` only. Its `disallowedTools:` apply too.
- **Same sandbox.** Same files, same secrets and leases, the same path
  confinement and the same approval gates: the SDK runs a sub-agent's tool
  calls through the step's own checks, and foldrun also refuses anything
  outside the sub-agent's list there.
- **One level deep.** A sub-agent never gets the `Agent` tool, so it cannot
  delegate again.
- **Its `description:` is required.** The model picks a sub-agent by it; a
  sub-agent without one is not delegated to, and `foldrun check` says so.
- **Its `model:`** is its own (remapped by the step's provider like the
  step's); absent, it uses the step's model.
- **One step.** Flows still decide what runs next — a sub-agent is a helper
  inside the step that called it, never a step of its own. Its spend lands on
  that step; the run trace shows its tool calls marked with its name, and a
  `delegating to <name>` line for each job it was given.

It works where the step works: `foldrun run` on your machine and a run on the
platform alike. `foldrun check` errors on a name that is not an agent and on a
sub-agent with no description, and warns when a sub-agent would hold none of
its tools inside the delegating agent's.

### Isolated sub-agents: `sandbox: own`

A sub-agent shares its parent's sandbox: whatever it reads, it reads where the
parent's secrets are. For a sub-agent that reads untrusted content — web
pages, mail, uploads — put it in a sandbox of its own instead. The sub-agent
says so in its own file:

```yaml
---
name: reader
description: Reads the pages it is given and summarises them.
tools: [web]
sandbox: own
---
```

The parent is unchanged (`subagents: [reader]`). Its model gets a
`delegate_reader(job)` tool in place of the SDK's `Agent` tool for this one.

| | `subagents:` | `subagents:` + `sandbox: own` |
|---|---|---|
| where it runs | inside the parent's sandbox | a sandbox of its own, started for the job |
| tools | its own, cut to the parent's | its own — the parent may hold less |
| secrets, network, size, runtime | the parent's | its own file's |
| gives back | its reply | its reply, and the files it changed, copied into the parent's sandbox |
| on the run | lines in the parent's trace | a step of its own after the parent's, marked `subagentOf` |
| cost | on the parent's step | on its own step, in the run's total |

What holds:

- **Its file decides what it holds.** Its `tools:`, `secrets:`, `network:`,
  `limits:`, `hooks:`, `runtime:`, `size:` and `model:` are read exactly as
  for a step of its own. So a reader with `tools: [web]` and no secrets can
  serve a writer with secrets and no web: a page that tells the reader to
  send something finds nothing to send, and the writer never read the page.
  `foldrun check` names what it holds that the parent does not
  ([`security/subagent-own-sandbox`](checks#securitysubagent-own-sandbox)).
- **Only the reply comes back.** The reply is still text the parent reads —
  it can carry an instruction — but it reaches a model whose sandbox never
  held the page.
- **Files.** What it writes reaches the workspace when its job ends, and is
  copied into the parent's sandbox at the same paths before the reply comes
  back — so the parent's model, its `verify: file:` and the next step all see
  it. The reply lists the paths. Up to 4 MiB and 100 files a job are copied
  back; what is larger is listed as not in the parent's sandbox and reaches
  the workspace for the next step only. A file the parent had already
  changed in its own sandbox is not overwritten: the job's version is put
  beside it as `<name>.from-<agent><ext>`, and the reply says so. If both
  write one path, the parent, finishing later, wins — as between two steps of
  a parallel group.
- **One level deep.** Its own `subagents:` are not offered to it.
- **Bounded by its parent.** A job runs within the parent step's `timeout:`
  and under two budgets. The sub-agent's own `budget:`: a job holds what is
  left of it while it runs, so a second job for the same agent at the same
  moment, or one after the budget is spent, is not started and comes back as
  failed. The flow's `budget:`: a job gets only what is neither spent nor held
  by the steps and jobs running now — and a running step holds its whole
  share, so in a flow with a `budget:` a job usually finds nothing left and is
  not started. Give the sub-agent its own `budget:` and leave the flow's off,
  or expect the job to be refused. The parent's step ends only when its jobs have. A stopped run
  stops them.
- **Needs a run.** On the platform each job starts a sandbox of its own.
  With `foldrun run` on your machine no step has a sandbox, so a job runs in
  the same process: its own context, tools and secrets, but the same files
  and network as the step that asked — the step's trace says so. Where
  nothing can start a job from inside a step (an install without the egress
  proxy), or nothing can stop one job's sandbox on its own (the local docker
  executor), the tool is not offered and the step says so: a job whose parent
  stopped waiting must not run on.

`foldrun agent link <parent> --subagent <reader> --isolated` writes
`sandbox: own` on the reader along with the link.

## Where it runs

| field | |
|---|---|
| `size` | `small` \| `large` (default) \| `heavy` — the sandbox reservation |
| `runtime` | language runtimes, packages and Debian system packages the agent's own scripts need |

`size` is a price, not just a limit. Memory is a **hard ceiling** because it is
not compressible: a step over it is killed, which on a single-node host
protects every other tenant. CPU is not capped — a step bursts to whatever is
free and bills at its class rate. Reference figures: 1Gi, 2Gi, 8Gi. Pick
`small` for an agent that mostly waits on an API, `heavy` for one that renders
a browser or holds real data.

```yaml
runtime:
  python: "3.12"            # optional pin — fetched when the image lacks it
  packages: [pandas]        # pip, installed with uv
  node: true
  npm: [cheerio]
  system: [ffmpeg, libcairo2-dev]   # Debian packages, installed with apt
```

`system:` takes Debian (trixie) package names — a program (`ffmpeg`), a
library's headers for a pip package that compiles (`libcairo2-dev`,
`python3-dev`), a compiler (`build-essential`), `pkg-config`. They are
installed by the run container's start-up, as root, **before** anything the
model directs runs, and the step then runs as the unprivileged agent user as
always. A name is checked against Debian's own naming rule, so it can never
become an apt option. The first step that needs a set installs it with apt and
saves the result as a snapshot in the account's runtime cache; every later
step restores the snapshot instead, in about a second (154 packages, 432 MB:
30 s through apt, under 1 s from the snapshot). A new runner image gets new
snapshots of its own, never the old one's files. The run log says
`system packages ready: … (snapshot, 1s)` or `(apt, 30s)`, or fails the step
with apt's own reason. On a laptop (`foldrun run` with no container) there is nothing to
install into: the list is reported as assumed present.

Manim, for one, needs all four of its kinds at once:

```yaml
runtime:
  system: [build-essential, pkg-config, python3-dev, libcairo2-dev, libpango1.0-dev]
  packages: [manim]
```

A package that fails to install says why on the first line of the run log —
`` `pycairo` has to be compiled and this runner has no C compiler — add
`system: [build-essential]` … `` — with the installer's last lines under it.

An agent's own runtime and the runtimes of the tools it grants merge into one
environment per step, so a tool carries its own dependencies and the agent
does not repeat them.

The image a step runs in is small on purpose: an interpreter, `uv`, `npm`,
and none of the world's packages — no compiler, no media tools. What a step needs arrives through
`runtime:` — built once per distinct declaration, kept in the account's
cache, and reused by every later step and every agent that declares the same
thing. The environment comes first on `PATH`, so a tool file that says
`interpreter: python3`, a `#!/usr/bin/env python3` shebang and a bare
`python3` in Bash all find the packages. A cached environment is checked
before it is used, and rebuilt when it no longer holds what it promised (an
interrupted build, an image whose python changed). One nobody has used for
30 days is pruned.

Steps that need the same environment at once build it once: the others
wait. A build that fails leaves a `.failed` marker with its error for 60
seconds, and a step waiting on it stops at once with that error instead of
waiting out the clock. `python: false` and `node: false` mean the step wants
none — no environment is built for them.

On a platform, a deploy builds the environments its agents need before any
step does: `foldrun deploy` waits for them and prints each one, ready or
failed with the installer's own error, and `foldrun runtimes` asks again
later — as does the **Runtimes** panel on the workspace's overview page. A package that will not install is heard at deploy, not from the
first scheduled run.

## Installing what a step needs

An agent does not have to know in advance what it will need. Every agent has
`install`, and when a command says `ffmpeg: command not found` or a script
says `No module named manim`, the agent installs it and carries on:

```
install(manager: "apt", packages: ["ffmpeg"])         # Debian programs and libraries
install(manager: "pip", packages: ["manim>=0.19"])    # Python packages
install(manager: "npm", packages: ["sharp"])          # Node packages
```

What it installs is usable by its next command — on `PATH`, importable — and
lasts for the step: the step's container, and everything installed in it, is
destroyed when the step ends.

The agent is never root. A Debian package is installed by a small helper the
container's root start-up leaves running before it drops to the agent user;
the agent can only ask it, by name, and each name is checked against Debian's
naming rule, so nothing but a package name reaches apt. It uses the same cache
and snapshots as `runtime: system:`, so a package anyone in the account
installed before is back in about a second. pip and npm packages need no root
and are installed as the agent, into a directory of the step's own.

Each install is in the run log with the line that would have it ready before
the step starts — `install: apt ffmpeg — ready (snapshot, 1s). To have it
before the step starts: runtime: system: [ffmpeg]`. Moving it into `runtime:`
is a speed-up, never a requirement. `disallowedTools: [install]` takes the
tool away; `permissionMode: plan` has no `install`, being read-only. On a
laptop (`foldrun run`, no container) pip and npm work and apt says it can't.

## Its own model credential

```yaml
provider:
  name: groq
  token: ${GROQ_API_KEY}
  models: { fast: llama-3.3-70b-versatile }
```

A name resolves to the endpoint, its wire format and where the key goes;
`base_url:`, `format:` (`anthropic` | `openai` | `responses`) and `auth:` (`bearer` |
`x-api-key`) spell the same thing out for an endpoint no preset covers.
`params:` passes anything else the provider accepts — `temperature`, `seed`,
`response_format` — merged into the request verbatim, with a `null` value
*removing* a field rather than setting it. See [Providers](providers).

## Running on a clock

An agent has no clock of its own — only a **flow** runs on a schedule. Put
`schedule:` (5-field cron, or `@hourly`/`@daily`/`@weekly`/`@monthly`) on the
flow that runs this agent; a single-agent job is a one-step flow. A `schedule:`
written in an `agent.md` fires nothing, so `check` and `deploy` refuse it
rather than let it deploy dead. See [Writing a flow](flows).

### `timezone:` — the calendar this agent works to

`timezone:` is also what "today" means to the agent while it works: its `TZ`
and the date it is told in its prompt, the same date its scripts and its
`verify:` shell see as `$FOLDRUN_DATE`.

It resolves nearest-wins, and each level inherits the one above it unless it
says otherwise:

```
agent frontmatter → the flow's timezone: → workspace AGENTS.md →
account AGENTS.md → FOLDRUN_TIMEZONE → UTC
```

So an agent that must file against a US business day says so on its own file
even when its flow runs on Sydney time. Every step's trace names the zone it
worked to and the level that set it.

Either an IANA name (`Australia/Sydney`) or a plain fixed offset —
`UTC+10`, `GMT-5`, `+10:00`, `-05:30`, or a bare `UTC` — is accepted at
every level:

```yaml
timezone: UTC+10
```

A value that is neither is refused by `foldrun check` and by a deploy. If one
reaches a run anyway it never fails the step: the step falls through to the
next level and says, once, what it could not read and what it used instead.

## Everything beside the file

```
agents/reporter/
├── agent.md          # required
├── skills/           # one capability per folder
├── knowledge/        # given to it; it may read, never write
├── memory/           # what it learned; it writes here
└── scripts/          # code it can call as a tool
```

`memory/` writes are the only writes an agent may make outside `outputs/`
without an explicit `write` grant. `knowledge/` is denied outright — through
the file tools and through bash.

### Where files live, from the agent's point of view

An agent's working directory is its own folder, `agents/<name>/`, and every
path is relative to it. The workspace root is `workspace/` — write that,
everywhere: in the agent's prose, in a flow's options, in a script's
arguments and in a shell command.

| place | write it as |
|---|---|
| a deliverable for a person | `workspace/storage/report.md` |
| what the next run needs | `workspace/state/history.md` |
| this step's scratch | `outputs/draft.md` |
| the account library (read-only) | `account/knowledge/prices.md` |

`workspace/` resolves the same in the file tools (Read, Write, Edit, Glob,
Grep), in Bash and the scripts it runs, in `scripts:` and folder tools, and
in a shell `verify:` — for the length of a step the agent's folder holds a
`workspace` link to the workspace root, removed when the step ends. The older
`../../storage/…` reaches the same place and keeps working; `foldrun check`
points it out as a hint, never an error.

A program started through the link is its own main module, as it would be
anywhere else. `node workspace/tools/check/run.mjs` loads the file by its
real path while `process.argv[1]` holds the path as typed, so the usual
`import.meta.url === pathToFileURL(process.argv[1]).href` check was false
and the program exited 0 having done nothing — a `verify:` that ran it
passed on every input. Every child a step starts (Bash, a shell `verify:`,
`scripts:` and folder tools, the Test button) now has `process.argv[1]`
set to the real path when it goes through the link, by a preload in
`NODE_OPTIONS`; nothing else about module resolution changes, and a
`node_modules/.bin` command runs as before. Python needs nothing:
`python3 workspace/x.py` is `__main__` either way. The Test button stands in
an agent's folder with the same link, so a tool that reads
`workspace/state/…` tests as it runs.

There is no `/tmp` for an agent, and no absolute path is inside its
workspace. A directory a tool made outside the workspace — a repository it
cloned, say — is reached only through that tool's own read or find action.
A path outside the workspace is refused with a message naming the path the
agent probably meant; the run page and the agent's Activity page count those
refusals per step, because each one is a wasted turn and a prompt that names
the exact path brings the count to zero.

### Handing work to a later step

A step is handed the replies of every earlier group. When the reply is a
report a person should also read, or a list a later step must get exactly,
write it to `workspace/storage/` as well — a tool that takes an `out=` path
and tees its own output there is the reliable way, because a model asked to
copy a long report by hand shortens it. Reply with one line saying what you
concluded; the file is the record.

## AGENTS.md — context above the agent

Two scopes, both optional, both inherited: `<account>/AGENTS.md` for everyone,
`<workspace>/AGENTS.md` for one workspace. Frontmatter there sets defaults —
### `language:` — the language this agent works in

```yaml
language: fa-IR        # a BCP-47 tag: en, en-AU, fa, pt-BR
```

Prose in AGENTS.md reaches the model and nothing else. A search engine
asked in English answers in English whatever the agent was told; a browser
reports `en-US` to every page; a fetch sends no `Accept-Language`.
`language:` is what those read. Set it and three things happen: the prompt
gains one sentence naming the language, `web action=search` asks the engine in it
(and for its region, when the tag has one), `web action=browse` reports it as the
page's locale, and `web action=fetch` requests it. A `language=` argument on
`web action=search`, or `locale=` on `web action=browse`, overrides it for one call.

It cascades like the clock: agent frontmatter → workspace `AGENTS.md` →
account `AGENTS.md` → `FOLDRUN_LANGUAGE` → English. Leave it out to
inherit. A value that is not a tag — `Persian` where `fa` was meant — is
refused by `check` and by the deploy, in one sentence, rather than being
read as English by every tool.

### `web.browse:` — which browser, and how it presents itself

The browser's identity is part of the agent, not of each call:

```yaml
web:
  browse:
    engine: firefox
    user_agent: "Mozilla/5.0 (Macintosh; …) Chrome/153.0.0.0 Safari/537.36"
```

`engine` is one of six: `chromium` (the default), `chrome`, `firefox`, `safari`, `lightpanda` or `obscura` — what each can do, and what `check` refuses to pair with it, is the table under [Engines](tools#engines) (a call names the same setting `browser=`); `version` picks a build (`stable`/`beta`/`dev` for Chrome, or a binary installed in the image); `live: true` keeps the page open between calls so a multi-step form can be driven one step per call; `user_agent`,
`cookies` (a vault name, never the cookies), `cookie_domain`, `storage` and
`storage_origin` (the same, for a login kept in localStorage or IndexedDB
rather than a cookie), `device`, `locale` and `timezone` complete the picture. `headless: false`
runs the same browser with a window (on a virtual screen where the machine
has none); unset is the usual no-window browser. The same key still
takes a vendor name on its own (`web: {browse: browserbase}`), and inside a
block that is `via:`. It cascades like the clock — agent, workspace, account
— and a call argument overrides it for one call. Full table and the reasons:
[Tools](tools#how-this-agents-browser-presents-itself).

The same block says what the agent may do with its browser, and those keys
are locks, not defaults: `allowed_domains:` (the only hosts it can reach — a
call may narrow the list, never widen it) and `deny:` (actions it may never
take, like `eval` or `download`; a misspelt one is refused by `check`).
Beside them: `boundaries: true` marks the page's words in every reply,
`init:` runs workspace scripts before each page's own, `extensions:` loads
unpacked Chrome extensions, `webgpu: true`, `ignore_https_errors: true`, and
`state_key:` names a secret that encrypts saved logins; `state:` names a saved login every call uses (beside `cookies:` it needs `state_key:`, and the secret then seeds it once — see tools.md); `video: true`
records every call for the run page to play, and `live_view: false` stops
the page being shown live there. See
[What this agent's browser may do](tools#what-this-agents-browser-may-do).

What a call reads is not in the block: `mode`, `interactive`, `within`,
`delta`, and the numbered elements an action names as `"@e4"` are per call.
The numbers come from the last `mode=aria` (or annotated screenshot) in the
same `session` and are kept in the run's
`outputs/.browser/refs.json`, not in any file you write — see
[Numbered elements](tools#the-browser-in-full).

### `region:` — the country this agent works for

```yaml
region: au             # ISO 3166: au, ir, de, us
```

A language is not a country. `pt` says nothing about whether the customer
pays in reais or euros, `ar` nothing about whether the weekend is Friday
or Saturday, `en` nothing about miles. `region:` is the one key that says
which country, and the runtime derives the rest rather than asking for it:

| derived | from | example for `region: ir` + `language: fa` |
|---|---|---|
| currency | a table by country | `IRR` |
| units | metric, or imperial for the US | `metric` |
| calendar, and today's date in it | the locale's first calendar | `persian — today is ۲۶ شهریور ۱۴۰۵` |
| week start and weekend | the locale's week rules | starts Saturday; weekend Friday |
| date order, 12/24-hour | the locale's formats | `۲۶ شهریور ۱۴۰۵`, 24-hour |
| text direction | the script | right to left — `dir="rtl"` on anything rendered |

Set it and the prompt gains a `# Locale` block stating exactly those facts,
`web action=search` asks the engine for that country, and the sandbox carries
`FOLDRUN_REGION`, `FOLDRUN_CURRENCY`, `FOLDRUN_UNITS`, `FOLDRUN_CALENDAR`,
`FOLDRUN_DATE_LOCAL` (only when the calendar is not Gregorian) and
`FOLDRUN_RTL` for scripts. Three overrides exist for the cases where a
derivation is wrong for a business — `currency: usd` for an Iranian firm
that invoices in dollars, `calendar: gregory` for one that files to a
Gregorian regulator, `units: imperial` — and nothing else is a key.

It cascades like `language:`: agent → workspace `AGENTS.md` → account
`AGENTS.md` → `FOLDRUN_REGION` → the region in the language tag (`en-AU`
says AU) → none. With none, nothing is invented: no currency, metric,
Gregorian. `region: Australia`, `currency: dollars`, `units: both` and a
calendar the runtime does not know are refused by `check` and the deploy.

`provider:`, `runtime:`, `timezone:` (see above — the clock cascades down
from here), `notify:`, `budget:` (a cap in USD over
a month — `60` — or a day or week — `60/day`, `60/week`; unset is no limit),
`concurrency:` (in the account's file: how many of its runs go at once — the
next one waits its turn; see [Budgets and billing](budgets-and-billing)),
`deploy_block:` (`none`, the default, `secrets` or `security` — what the
scanner's findings do to a deploy; see [Checks](checks#blocking-a-deploy)),
`limits:` (per-step call limits, as defaults — the one key that merges: an
agent's `limits: {web.search: 40}` overrides that key and keeps the rest),
`web.browse:` (see above),
`foldrun_version:` — and the body is context every agent works under.

Nearest wins, but a **key** replaces the whole value rather than merging into
it: an agent's `notify:` replaces the account's, it does not add to it.

## Checking it

`foldrun check` validates all of this offline, before any model is called —
a tool, skill or colleague that names nothing, a step that names a missing
agent, a broken script path. Run it the way you would run a typecheck.
