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
  - files
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

Only `name` and the body are required. Every other field widens or narrows
what the agent can reach, and the default is narrow.

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
| `agents` | colleagues it may consult mid-run |
| `scripts` | programs in `scripts/`, each becoming a callable tool |
| `apis` | an HTTP API declared inline, as one tool |
| `mcpServers` | an MCP server declared inline |
| `secrets` | vault entries its tools may use — names only, never values |
| `permissionMode` | `plan` makes the run read-only, whatever else was granted |
| `web_search`, `web_fetch`, `web_browse` | whose search index, page reader and browser those three tools use — `web_search: brave`, `web_fetch: jina`, `web_browse: browserbase` — with the key named in the vault. Unset is the platform's own. `web_search` and `web_fetch` are set per agent; `web_browse` also cascades from `AGENTS.md`. The providers and their keys: [Tools](tools#searching-somewhere-else); the browser block: [below](#web_browse--which-browser-and-how-it-presents-itself) |

The built-in groups are one word each, so you can hold them in your head:

| group | |
|---|---|
| `read` | Read, Glob, Grep — inspect but never modify |
| `files` | Read, Write, Edit, Glob, Grep |
| `bash` | Bash |
| `web` | WebSearch (server-side, billed per call) + WebFetch |
| `fetch` | WebFetch only — the local half |
| `search` | `search_files(query)` over knowledge, memory, state and storage at every scope |
| `history` | `recall_runs()` and `read_run(id)` — the workspace's last thirty finished runs |
| `desks` | `recall_desk_runs()` and `read_desk_run(id)` — the same, across the account's *other* workspaces: ten recent runs each, named per line. Run records, not files: the way a digest agent reads what every desk concluded this week |

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

## Where it runs

| field | |
|---|---|
| `size` | `small` \| `large` (default) \| `heavy` — the sandbox reservation |
| `runtime` | language runtimes and packages the agent's own scripts need |

`size` is a price, not just a limit. Memory is a **hard ceiling** because it is
not compressible: a step over it is killed, which on a single-node host
protects every other tenant. CPU is not capped — a step bursts to whatever is
free and bills at its class rate. Reference figures: 1Gi, 2Gi, 8Gi. Pick
`small` for an agent that mostly waits on an API, `heavy` for one that renders
a browser or holds real data.

```yaml
runtime:
  python: "3.12"            # optional pin
  packages: [pandas]        # pip
  node: true
  npm: [cheerio]
```

An agent's own runtime and the runtimes of the tools it grants merge into one
environment per step, so a tool carries its own dependencies and the agent
does not repeat them.

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

`schedule` (5-field cron, or `@hourly`/`@daily`/`@weekly`/`@monthly`) with an
optional IANA `timezone` runs the agent on its own. Absent, it runs on demand
— the dashboard, `foldrun run`, or an API call. For anything involving more
than one agent, put the schedule on a flow instead.

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
without an explicit `files` grant. `knowledge/` is denied outright — through
the file tools and through bash.

### Where files live, from the agent's point of view

An agent's working directory is its own folder, and every path is relative
to it. Two spellings reach the workspace root and both are fine:

| place | relative | with the prefix |
|---|---|---|
| a deliverable for a person | `../../storage/report.md` | `workspace/storage/report.md` |
| what the next run needs | `../../state/history.md` | `workspace/state/history.md` |
| this step's scratch | `outputs/draft.md` | — |
| the account library (read-only) | — | `account/knowledge/prices.md` |

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
gains one sentence naming the language, `web_search` asks the engine in it
(and for its region, when the tag has one), `web_browse` reports it as the
page's locale, and `web_fetch` requests it. A `language=` argument on
`web_search`, or `locale=` on `web_browse`, overrides it for one call.

It cascades like the clock: agent frontmatter → workspace `AGENTS.md` →
account `AGENTS.md` → `FOLDRUN_LANGUAGE` → English. Leave it out to
inherit. A value that is not a tag — `Persian` where `fa` was meant — is
refused by `check` and by the deploy, in one sentence, rather than being
read as English by every tool.

### `web_browse:` — which browser, and how it presents itself

The browser's identity is part of the agent, not of each call:

```yaml
web_browse:
  engine: firefox
  user_agent: "Mozilla/5.0 (Macintosh; …) Chrome/153.0.0.0 Safari/537.36"
```

`engine` is `chrome` (the default), `firefox` or `safari` — the engine names `chromium` and `webkit` still work; `user_agent`,
`cookies` (a vault name, never the cookies), `cookie_domain`, `storage` and
`storage_origin` (the same, for a login kept in localStorage or IndexedDB
rather than a cookie), `device`, `locale` and `timezone` complete the picture. The same key still
takes a vendor name on its own (`web_browse: browserbase`), and inside a
block that is `via:`. It cascades like the clock — agent, workspace, account
— and a call argument overrides it for one call. Full table and the reasons:
[Tools](tools#how-this-agents-browser-presents-itself).

What a call reads is not in the block: `mode`, `interactive`, and the
numbered elements an action names as `"@e4"` are per call. The numbers come
from the last `mode=aria` in the same `session` and are kept in the run's
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
`web_search` asks the engine for that country, and the sandbox carries
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
`web_browse:` (see above),
`foldrun_version:` — and the body is context every agent works under.

Nearest wins, but a **key** replaces the whole value rather than merging into
it: an agent's `notify:` replaces the account's, it does not add to it.

## Checking it

`foldrun check` validates all of this offline, before any model is called —
a tool, skill or colleague that names nothing, a step that names a missing
agent, a broken script path. Run it the way you would run a typecheck.
