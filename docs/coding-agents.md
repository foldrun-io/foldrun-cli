# Working with a coding agent

The page a coding agent (Claude Code, Cursor, Codex) should read first in a
foldrun account, and the one `foldrun init` points it to. A foldrun account
is agents, flows and knowledge as markdown. There is no build — the files ARE
the program — so the loop is edit, check, run, deploy.

`foldrun init` writes a short block into the account's `AGENTS.md`, between
`<!-- BEGIN:foldrun-agent-rules -->` markers, telling the coding agent to
read these docs before it writes anything, and a `CLAUDE.md` that imports it.
The block is for the tool editing the folder: the runtime strips it before
the rest of `AGENTS.md` reaches your agents. `foldrun guide` re-adds or
refreshes it; `foldrun docs <page>` prints any page of these docs, from the
copy that ships with your CLI, so a coding agent always reads the version it
is working against.

## The loop

```sh
foldrun check              # validate everything, offline, no model calls
foldrun run <flow>         # run it locally against real models
foldrun eval               # run the evals
foldrun deploy             # push the account (or `deploy <workspace>`) to the platform
```

`check` is cheap and catches a broken flow before a schedule fires it at
3am. Run it after every edit, the way you would run a typecheck.

## Where things go

| Path | What |
|---|---|
| `AGENTS.md` | the account's shared context and defaults — every agent in every workspace reads it (except the managed coding-agent block, which the runtime strips) |
| `workspaces/<name>/` | one workspace: a desk, a pipeline, a product |
| `workspaces/<name>/AGENTS.md` | that workspace's context and settings |
| `workspaces/<name>/agents/<name>/agent.md` | one role: its persona, model, tools |
| `workspaces/<name>/flows/<name>.md` | steps, in order, naming the agents that run them |
| `workspaces/<name>/knowledge/` | reference material agents read |
| `workspaces/<name>/memory/` | what past runs learned — agents write here themselves |
| `workspaces/<name>/evals/` | tests for agents, same idea as unit tests |
| `workspaces/<name>/skills/` | a procedure an agent can follow, named in `skills:` |
| `workspaces/<name>/tools/` | a folder tool: its definition and its code together |
| `workspaces/<name>/scripts/` | code the agents call, referenced by `scripts:` |
| `workspaces/<name>/state/` | what runs accumulate. Yours to read, never deployed over |
| `library/` | skills, tools, scripts and knowledge shared by every workspace here |
| `.claude/agents/<name>.md` | a Claude Code subagent — deploys AS an agent |

`knowledge/` is what you tell the agents; `memory/` is what they worked out.
Regenerated every run means a file; accumulated across runs means `state/`.

A subagent you write in Claude Code is imported as `agents/<name>/agent.md`
at deploy, no conversion. Write it either way.

## What a deploy does NOT touch

`runs/`, `state/`, `secrets.json`, and any memory an agent wrote that your
push does not mention. Those belong to the platform, not to git — a deploy
that reverted what an agent learned would make every run a little dumber.

Secrets never go in these files. `foldrun secrets set NAME` puts them in the
vault, and agents reference them by name.

## Talking to the platform

The CLI is local except for `deploy`, `pull`, `runs`, `logs`, `invoke` and
friends, which talk to the platform you signed in to (`foldrun login`, or
`FOLDRUN_URL` + `FOLDRUN_TOKEN`). Everything the CLI does, the HTTP API does
too, with the same key:

```sh
api() { p=$1; shift; curl -sS -H "authorization: Bearer $FOLDRUN_TOKEN" "$FOLDRUN_URL/api/$p" "$@"; }

api workspaces/$WS/runs                       # recent runs, newest first
api workspaces/$WS/runs/<id>                  # the full trail of one
api workspaces/$WS/runs/<id>/stream           # follow a live one (SSE)
api workspaces/$WS/flows/<flow>/run -X POST   # start one
```

| Route (`/api/workspaces/<ws>` unless noted) | Methods | For |
|---|---|---|
| `/` | GET DELETE PATCH | the workspace itself |
| `/deploy` | POST | what `foldrun deploy` calls |
| `/source` | GET PUT PATCH DELETE | read and write single files |
| `/runs` · `/runs/<id>` | GET · GET DELETE | list runs; one run, every step |
| `/runs/<id>/stream` | GET | live events, server-sent |
| `/runs/<id>/stop` · `/rerun` · `/approve` | POST | kill it; again from a step; release a gate |
| `/flows` · `/flows/<f>` · `/flows/<f>/run` | GET POST · POST DELETE PATCH · POST | list, create, edit, start |
| `/agents` · `/agents/<a>/run` | GET POST · POST | list agents, run one |
| `/evals` · `/evals/<e>/run` | GET POST · POST | list evals, run one |
| `/tools/<t>/test` | POST | exercise one tool alone |
| `/storage` · `/storage/download` · `/shares` | GET POST PUT DELETE · GET · POST GET DELETE | files agents produced; public links to them |
| `/triggers?since=` | GET | why nothing ran: fired vs started per flow, with reasons |
| `/hooks/<f>/rotate` | POST | new webhook token for a flow |
| `/api/secrets` · `/api/schedule` · `/api/account` · `/api/keys` | account-level | the vault, the clock, defaults, API keys |

A key carries a role (viewer, editor, admin) and a workspace scope no wider
than the person who minted it. Team, profile and MFA routes are a person's
alone and refuse a key. The full reference with request and response shapes
is the platform's `docs/api.md`.

Debugging a failed run is usually: `foldrun runs --status failed`, `foldrun
report <id>` to read which step failed and what it cost, fix the markdown,
`foldrun deploy`, then `foldrun rerun <id> --from <step>`. `foldrun triggers`
answers "why did nothing run".

## Writing a flow

A numbered list of steps. The number is the GROUP: same number means those
steps run in parallel, and the flow waits for all of them before the next.

```markdown
---
trigger: manual          # manual | schedule | webhook
schedule: "0 9 * * 1"    # cron, when trigger: schedule
timezone: Australia/Sydney
model: default           # a default for every step here
effort: low
overlap: skip            # skip | queue — what a second run does while one is live
priority: normal         # high | normal | low — where its runs stand in the queue
---

1. [[researcher]] — Find three sources on {{topic}}.
2. [[writer]] — Draft from what the researcher found.
   model: max
   verify: judge: the draft cites every source
3?. [[editor]] — Tighten it.
4!. [[publisher]] — Publish it.
```

`3?.` is optional — it may be skipped. `4!.` needs a human to approve before
it runs. `[[flow:other-flow]]` in place of an agent runs another flow as a
step.

Indented under a step, any of:

| | |
|---|---|
| `approve: true` | stop for a human (`!` is shorthand for this) |
| `when: <condition>` | run only if it holds |
| `case: <value>` / `else: true` | branch on the previous step's result |
| `retry: 2` | re-run on failure, up to 5 |
| `timeout: 900` | seconds before the step is cut off |
| `verify: <shell>` | the step fails unless the command exits 0 |
| `verify: judge: <claim>` | a model grades the claim against the output |
| `verify: contains:` / `not-contains:` / `matches:` / `file:` | the cheap checks, no shell |
| `model:` / `effort:` | override the flow's default for this step |
| `loop: 3` / `until: <condition>` | repeat until it holds, at most 5 |
| `each: lines` · `each: rows of <path>` · `each: items` | run once per line / CSV row / JSON element of the previous result |
| `max: 10` | cap how many iterations `each:` produces |
| `on-fail: [[agent]]` | who handles it when this step fails |
| `wait: 30m` · `wait: event` | pause; or hold until something POSTs the run's event URL |
| `ask: <question>` | ask a human, use the answer |
| `preview: draft/*.mdx` | what the approval box shows — paths under `storage/`, globs allowed |
| `delegate: [[a]], [[b]]` | hand the step to whichever fits, up to 5 |
| `output: json` | the reply ends with one JSON value; the next step gets it as data |

A `verify:` with no assertion prefix is a **shell command**, not a sentence.
`verify: the reply names the file it wrote` runs a program called `the` and
fails every run with `command not found`. The prefixes are `contains:`,
`not-contains:`, `matches:`, `file:` and `judge:` — put `judge: ` in front of
a claim in English. `foldrun check` errors on this.

`matches:` and `contains:` test the step's **last turn**, so they grade the
agent's prose. Where the step writes the artefact, verify the artefact
instead — the stronger check, and the one that does not depend on how the
model phrased itself.

## Writing an agent

Frontmatter then prose. The prose IS the system prompt, so write it to be
read by a model: what this role is for, what it must not do, what good looks
like.

```markdown
---
name: researcher
description: Finds and summarises sources.
model: default              # fast | default | max
effort: low                 # how hard to think about it
size: large                 # small | large | heavy — the sandbox it rents
tools: [WebSearch, Read, my-folder-tool]  # built-ins and your own tools/, one list
disallowedTools: [Bash]     # subtract from what it would otherwise have
skills: [house-style]       # from skills/
scripts: [summarise.py]     # from scripts/, each becomes a callable tool
apis: [{ name: crm }]       # an HTTP API, as a tool
mcpServers: {}              # an MCP server, as a tool
agents: [writer]            # colleagues this one may consult
secrets: [CRM_TOKEN]        # from the vault — never written in these files
provider: {}                # BYOK: your own model credential
permissionMode: plan        # plan first, act once approved
runtime:                    # only if scripts need packages
  packages: [requests]
---

You research a topic and report what you found...
```

Only `name` and the prose are required. Every other field widens or narrows
what the agent can reach, and the default is narrow.

`runtime:` installs pip/npm packages in the sandbox each agent runs in. Pin
versions the normal way (`pandas>=2`, `lodash@^4`). Python and Node are
supported; anything else should ship as a committed binary.

Link documents to each other with `[[wikilinks]]` — the name, not the path.

## The CLI, in one screen

```
foldrun init [dir] · new <name> · agent new · flow new · tool new
foldrun check [--to <ws>] · run <target> · eval [name] · probe <model>
foldrun deploy [dir|ws] · pull [ws] · status [ws] · workspaces · source <verb>
foldrun runs · logs [id] · report <id> · triggers · schedule · approvals
foldrun invoke <flow> [--wait|--watch|--once <key>] · rerun <id> --from <n> · stop <id>
foldrun approve <id> · reject <id> · storage ls|cat|get|put|rm|share|shares|unshare
foldrun secrets set|ls|rm|status · connect NAME · account [providers] · billing
foldrun login · logout · whoami · keys ls|create|revoke · doctor
```

`foldrun <command> --help` explains any of them, and `foldrun docs cli` is the
whole reference.
