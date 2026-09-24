# Workspaces

A workspace is a folder, and the folder is the unit of everything: it is what
you edit, deploy, permission, budget and back up. An account holds several —
one per job, in practice — and they share nothing unless it is put in the
account's library on purpose.

## The layout

```
my-desk/
  AGENTS.md            context every agent here sees, and the workspace's defaults
  agents/<name>/       one folder per role
    agent.md           frontmatter, then the prompt
    knowledge/         given to this agent only
    memory/            what this agent learned
    outputs/           this step's scratch — archived with the run
    scripts/           code this agent's tools run
  flows/<name>.md      a numbered list of steps
  tools/<name>.md      what may be called — an API, a script, an MCP server
  skills/<name>/       a capability, in the open Agent Skills format
  evals/<name>.md      tests
  knowledge/           given to every agent in the workspace
  memory/              what they learned, shared
  state/               what the next run needs from this one
  storage/             files a person reads or downloads
  scripts/             code shared by this workspace's tools
```

Every one of those is optional except `AGENTS.md` and at least one agent.

## The account around it

On the platform a workspace never stands alone: it lives under an account,
beside the account's own `AGENTS.md` and the library every workspace there
shares.

```
my-account/
  AGENTS.md            config and context every workspace here inherits
  library/             tools, skills, scripts, knowledge, memory — shared
  workspaces/
    my-desk/           the tree above
    ads-desk/
```

`foldrun init` makes exactly that on a laptop, and `foldrun new <name>` adds
another workspace to it, so the folder you edit is the folder that runs. See
[the CLI reference](cli#the-shape-of-a-folder) for the commands that act on the
whole account — `check`, `deploy`, `pull`, `status`, `workspaces` — and for the
one scope that has no API: the account's own `AGENTS.md` is not pushed or
pulled, only edited in Settings.

A single folder with `agents/` and `flows/` at its root is still a workspace
and still works everywhere; `foldrun init --flat` makes one.

## `AGENTS.md` — context and defaults

The body is prose every agent in the workspace sees before its own prompt.
Put the things that are true of the whole desk there: the business, the
standing rules, what the reader is like.

The frontmatter is the workspace's defaults:

```yaml
---
timezone: Australia/Sydney
budget: 60                     # a cap in USD for this workspace — per month; or 60/day, 60/week; unset is no limit
notify:
  email: ops@example.com
  events: [failed, awaiting-approval, completed]
provider:                      # see Providers
  base_url: https://openrouter.ai/api/v1
  token: ${OPENROUTER_API_KEY}
---
```

There is an `AGENTS.md` one level up too — the account's — and the two
compose in a way worth learning once:

- **Prose accumulates.** The account's body is added to every workspace's,
  so a rule written at the account cannot be dropped below it.
- **A frontmatter key replaces whole.** A workspace that sets `notify:`
  replaces the account's `notify:` entirely — it does not merge into it. To
  inherit a key, say nothing about it.

The second rule is the one that surprises people: a workspace that declares
its own `notify:` block silently stops receiving the account's default.

### The clock, all the way down

`timezone:` is the one default with levels below the workspace as well as
above it, because a flow's schedule and an agent's own calendar are both real
things to set. Nearest wins, and every level inherits the one above it unless
it says otherwise:

```
agent frontmatter → flow frontmatter → workspace AGENTS.md →
account AGENTS.md → FOLDRUN_TIMEZONE → UTC
```

Whichever level wins sets `TZ`, the date in the agent's prompt, and
`$FOLDRUN_DATE` in its scripts and its `verify:` shell — so "today" means the
same thing to every part of a step. Each step's trace names the zone and the
level it came from.

The value is an IANA name (`Australia/Sydney`) or a plain fixed offset —
`UTC+10`, `GMT-5`, `+10:00`, `-05:30`, or a bare `UTC`. `foldrun check` and a
deploy both refuse anything else; a bad value that reaches a run falls through
to the next level with one line in the trace rather than failing the step.

## The account library

`<account>/library/` holds tools, skills, knowledge and memory shared by every
workspace. Resolution is nearest-wins: an agent's own file beats the
workspace's, which beats the library's. So a shared integration — the tool
that clones your website, the skill that explains how — is defined once, and
a workspace that needs a different version shadows it by defining the same
name locally.

From inside a run the library is read-only, reached as `account/…`
(`account/knowledge/prices.md`). The Library page in the dashboard lists,
for every shared file, which agents use it and where a nearer copy overrides
it — that list is the blast radius of changing it.

## Where a run's files go

Three directories look alike and are not:

| directory | who reads it next | survives a deploy | example |
|---|---|---|---|
| `outputs/` | this step, and the archive | no — it is the run's | a draft, a fetched page |
| `storage/` | a person | yes | the weekly report, a CSV, an image |
| `state/` | the next run | yes, and a deploy never overwrites it | a cursor, an append-only history |

The test is not "is it important", it is **who reads it next**. A value
regenerated every run is `storage/`; a value accumulated across runs is
`state/`. From an agent, `../../storage/x.md` and `workspace/storage/x.md`
are the same place. See [Storage and sharing](storage-and-sharing).

## What a deploy touches

A deploy — `foldrun deploy`, or a `git push` to the workspace's remote —
replaces the source tree: agents, flows, tools, skills, evals, knowledge,
`AGENTS.md`. It **never** touches `runs/`, `state/`, `secrets.json`, or any
memory an agent wrote that your push does not mention. Those belong to the
platform, not to git, and a deploy that reverted what an agent learned would
make every run a little dumber.

A push while a run is in flight is accepted and applied when the run
finishes; git tells you so at push time. A run parked at an approval gate
counts as in flight. See [Deploying](deploying).

## Previews

Push a branch instead of `main` and the platform deploys a copy of the
workspace named `<workspace>-preview-<branch>` from that branch's tree, runs
its evals there, and never fires its schedules. It reads the source
workspace's secrets. Deleting the branch deletes the preview. It is how a
change to a live desk gets tried without touching the live desk.
