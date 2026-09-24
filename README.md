# foldrun

[![ci](https://github.com/foldrun-io/foldrun-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/foldrun-io/foldrun-cli/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/foldrun)](https://www.npmjs.com/package/foldrun)
[![licence](https://img.shields.io/badge/licence-Apache--2.0-blue)](LICENSE)

**Agents are just folders.** An agent is a folder with a markdown file in it. A flow is
a numbered list naming agents. You write them, read them, diff them in a pull
request, and run them from this CLI.

Everything here works on a plain folder — no account, no server, no network
beyond the model call itself.

```sh
npm install -g foldrun
export ANTHROPIC_API_KEY=sk-ant-…

foldrun init competitor-watch
cd competitor-watch
foldrun check          # free — no model calls
foldrun run publish
```

Requires Node 22 or newer. `init` and `check` need no API key.

## What `init` gives you

An **account folder** — the same shape the platform keeps, so what you reason
about locally is what runs there:

```
competitor-watch/                 the account
├── AGENTS.md                     config and context every workspace inherits
├── library/                      skills, tools, scripts, knowledge shared by all of them
│   ├── skills/  tools/  scripts/
│   └── knowledge/  memory/
└── workspaces/
    └── main/                     the first workspace, ready to run
        ├── AGENTS.md             what every agent HERE shares
        ├── agents/
        │   ├── researcher/agent.md
        │   └── writer/agent.md
        ├── flows/publish.md      the steps, in order
        ├── knowledge/house-style.md  given to them; they may read, never write
        ├── memory/what-worked.md     what they learned; they write here
        └── evals/writer-quality.md   what "good" means, as a test
```

`--workspace <name>` names that first workspace (default `main`), and
`foldrun new <name>` adds another beside it. Every workspace in the account
resolves `skills:`, `tools:` and `scripts:` against the shared `library/`,
nearest-wins — its own file first, the library second.

`foldrun init --flat <dir>` makes the older single-folder shape instead: no
account around it, `agents/` and `flows/` at the root. **Every command still
reads that shape**, unchanged, so a folder made before today keeps working.

An agent is frontmatter for the machine and prose for the model:

```markdown
---
name: researcher
description: Finds one thing worth writing about, and says why.
model: fast
effort: high
tools:
  - web
  - read
---

Pick exactly one topic, in a short paragraph, and say who it helps and why now.
Do not write the article.
```

A flow is the numbers, not the order of the lines — same number runs at the
same time, different numbers run one after another:

```markdown
---
name: publish
trigger: manual
---

1. [[researcher]] — find one topic worth writing about
2. [[writer]] — draft it
```

`model:` takes a tier — `fast`, `default`, `max` — rather than a model id, so a
workspace doesn't rot when models are renamed. `effort:` is the other half: not
which brain, but how long it thinks.

## Giving an agent real capabilities

A **script tool** is a folder holding its definition and the program it runs:

```
tools/wordcount/
├── tool.md      transport: script · run: run.py · args: {text: …}
└── run.py       a real file — lint it, test it, run it by hand
```

The agent calls it by name with typed arguments and never composes a shell
command. Arguments arrive as `--flags`, stdout comes back, a non-zero exit is a
failure. An agent grants it with `tools: [wordcount]`.

An **HTTP tool** is one markdown file declaring a base URL, allowed methods and
headers, with `${SECRET}` placeholders the platform resolves at call time — so
the model gets the capability and never sees the key. An **MCP server** is
declared the same way.

## Commands

| | |
|---|---|
| `foldrun init [dir]` | create an account folder with one workspace in it (`--flat` for the old shape) |
| `foldrun new <name>` | another workspace in this account |
| `foldrun agent new <name>` | one more agent in this workspace — also `flow new <name>` and `tool new <name>` |
| `foldrun check [dir]` | validate every workspace here, and the shared library |
| `foldrun check --to <ws>` | validate the copy that is DEPLOYED — fetched from the platform, checked by the same rules |
| `foldrun agent run <name>` | run one agent once on a platform, no flow (`--task "…"`, `--wait`, `--test`) |
| `foldrun tool test <name>` | exercise one tool alone — no model, no run (`key=value` for its args) |
| `foldrun run <target>` | run an agent or a flow |
| `foldrun eval [name]` | run one eval, or all of them |
| `foldrun extract [dir]` | move single-file script tools into folders |
| `foldrun probe <model>` | live check: can this model hold a tool loop here? |
| `foldrun logs [run-id]` | recent runs, or one run's full event trail |
| `foldrun runs` | what has run lately, across the account — `--status`, `--since`, `--to`, `--limit` |
| `foldrun report <run-id>` | one run, whole: every step, what it cost, what it wrote, what is still waiting (`--json` for the record) |
| `foldrun approvals` | every gate waiting on a person, with its question and what it previews |
| `foldrun approve <run-id>` | release a waiting gate — it asks first, `--yes` means it, `--note "…"` steers the step |
| `foldrun reject <run-id>` | refuse one, `--note` being the reason |
| `foldrun stop <run-id>` | kill a run in flight — it says what it will destroy, then asks (`--yes` means it) |
| `foldrun schedule` | every flow in the account that fires on a clock, its cron line, and the next few times it fires |
| `foldrun triggers` | why nothing ran: per flow, how often its trigger fired, how often that became a run, and every reason for the difference (`--since <days>`, `--to`) |
| `foldrun storage <verb>` | what a workspace produced: `ls [prefix]`, `cat <path>`, `get <path>` — with when each file was written and which run wrote it |
| `foldrun storage share <path>` | a public link to one produced file (`--ttl <days>`, default 7; `--forever`) — also `shares` (`--all`) and `unshare <token>` |
| `foldrun billing` | the account's balance and its recent ledger entries, with what each was for |
| `foldrun account` | the account's defaults: timezone, notify, budget, concurrency — also `set <key> <value>` and `clear <key>` |
| `foldrun account providers` | which model providers the account's files use and whether each key still answers (`--check` asks now) |
| `foldrun secrets set NAME` | store a secret, prompted and never echoed |
| `foldrun deploy [dir]` | push the whole account — or `deploy <workspace>` for one of them |
| `foldrun pull [workspace]` | bring the platform's account down here (refuses to clobber local edits) |
| `foldrun status [workspace]` | per workspace: added, changed, and what moved on the platform since your last deploy |
| `foldrun workspaces` | what exists here and there — also `rm <name>` (`--platform --yes` to delete it there) |
| `foldrun invoke <flow>` | start a flow on a running platform (`--watch` streams its trace) |
| `foldrun open [page]` | the dashboard for this workspace, in the browser |
| `foldrun login` | sign this machine in from the browser — no key to copy |
| `foldrun whoami` | who you are on the platform: account, role, workspaces |
| `foldrun doctor` | check the path to the platform: node, CLI, account, DNS, a timed `/api/healthz` — exit 1 if any line fails |
| `foldrun keys ls` | the account's API keys — also `create <label>`, `revoke <id>` |

`foldrun --help` lists every flag.

`foldrun tool test <name> --to <workspace> key=value` is how you find out a
tool works before a flow depends on it. It runs the real thing — the HTTP
request, the script, the MCP handshake — and prints what the tool printed, how
long it took, and any secret it needed by NAME and never by value. It waits
five minutes by default, because a tool that scrapes or crawls takes as long as
it takes; `--timeout <seconds>` waits longer.

`foldrun agent run <name> --to <workspace> --task "…"` runs one agent once, as
a flow of one step with no flow file. It prints the run id and how to follow
it; `--wait` holds on and prints the same report `foldrun report` would.

**`check` is the one to run in CI.** It costs nothing and catches what
otherwise surfaces as a confidently wrong answer at 3am: a step naming an agent
that doesn't exist, a tool whose program isn't on disk, an eval pointing at a
flow that was renamed, a knowledge bundle whose index disagrees with its own
files.

## Secrets

Declared by name in an agent's frontmatter, never by value:

```yaml
secrets:
  - SLACK_WEBHOOK_TOKEN
```

`foldrun secrets set SLACK_WEBHOOK_TOKEN` prompts for it and stores it
encrypted. Declared secrets are injected as environment variables into the
agent's scripts and substituted into HTTP headers. They are never returned by
an API and never reach the model.

## Running it somewhere else

`foldrun deploy` pushes this account into an installation — your own, or a
hosted one — and `foldrun invoke <flow> --wait` starts a flow there and prints
the result. A deploy never touches run history, state, secrets, or memory an
agent wrote: those belong to the installation, not to your git repo. It never
removes a workspace either: one that exists on the platform and not in your
folder is left exactly as it is, and `foldrun workspaces rm <name> --platform
--yes` is the deliberate way to delete one.

Inside an account folder the workspace-scoped commands take the workspace as a
positional — `foldrun secrets blog-desk set TOKEN`, `foldrun runs blog-desk` —
or need nothing at all when there is only one.

One gap worth knowing: the platform has no account-file endpoint, so the
account's own `AGENTS.md` is not pushed or pulled. `deploy` and `pull` say so
rather than dropping it quietly; edit it in Settings on the platform.

```sh
foldrun login                    # approve it in the browser, once per machine
foldrun deploy
foldrun invoke publish --wait
```

`foldrun login --url https://your-platform` signs in to your own installation.
In CI, set `FOLDRUN_URL` and `FOLDRUN_TOKEN` instead — the environment always
wins over the credentials file, so a job never reads one from disk.

## License

Apache-2.0.
