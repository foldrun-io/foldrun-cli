# Getting started

An agent is a folder. A flow is a numbered list. There is no build step — the
files are the program — so the loop is edit, check, run, deploy.

## Install and make something that runs

```sh
npm install -g foldrun
export ANTHROPIC_API_KEY=sk-ant-...     # an API key from console.anthropic.com

foldrun init my-account
cd my-account
foldrun check                            # free: no model is called
foldrun run publish --task "write about rain"
```

`init` scaffolds an **account folder** with one workspace in it, and that
workspace already works: two agents, a flow that names them, an eval, and
knowledge they share. `check` validates all of it offline —
run it after edits the way you would run a typecheck. It is the cheapest
feedback in the system and it catches a broken flow before a schedule fires it
at 3am rather than after.

## What you just made

```
my-account/
  AGENTS.md                    context every workspace here inherits
  library/                     tools, skills, scripts shared by all of them
  workspaces/
    main/
      AGENTS.md                context every agent in THIS workspace sees
      agents/researcher/agent.md  one role: persona, model, tools
      agents/writer/agent.md
      flows/publish.md         the steps, in order
      knowledge/               what you tell the agents
      memory/                  what they worked out — they write here
      evals/                   tests for agents
      CLAUDE.md                conventions, for your editor
```

That is the shape the platform keeps, so the folder you edit is the folder that
runs. `--workspace <name>` names the first workspace (default `main`) and
`foldrun new <name>` adds another. `foldrun init --flat` makes the older
single-folder shape instead, and every command still reads it.

`CLAUDE.md` is the one file foldrun never reads. It is there so Claude Code and
its peers know the layout instead of guessing at it.

## Writing an agent

Frontmatter, then prose. **The prose is the system prompt**, so write it to be
read by a model: what the role is for, what it must not do, what good looks
like.

```markdown
---
name: researcher
description: Finds and summarises sources.
model: default
tools: [WebSearch, Read, Write]
---

You research a topic and report what you found. Prefer primary sources.
Say when you could not find something rather than inferring it.
```

Only `name` and the prose are required. Every other field widens or narrows
what the agent can reach, and the default is narrow.

A field that names files — `tools:`, `skills:`, `agents:` — takes the same
`[[link]]` the prose does, or a bare name; both mean the same thing. Use the
block form when you link:

```yaml
tools:
  - read              # a built-in group
  - [[site_repo]]     # your own tools/site_repo.md
```

## If you use Claude Code

A subagent at `.claude/agents/<name>.md` **deploys as a foldrun agent** — no
conversion, no second format. Write it however Claude Code taught you and it
becomes a role on the platform.

## Running it somewhere that is not your laptop

```sh
foldrun login                            # approve it in the browser, once
foldrun deploy                           # pushes this workspace
foldrun invoke publish --wait            # runs it there
```

`foldrun login` signs in to the hosted platform; `foldrun login --url
https://your-server` to your own. In CI, set `FOLDRUN_URL` and
`FOLDRUN_TOKEN` (Settings → API keys) instead — see [Deploying](/deploying/).

A deploy is checked before any of it goes live, and it refuses while a run is
in flight — swapping files under a running flow means step 3 reads agents that
step 1 never saw. `--force` overrides that when you mean to.

It never touches `runs/`, `state/`, `secrets.json`, or memory an agent wrote
that your push does not mention. Those belong to the platform, not to git: a
deploy that reverted what an agent learned would make every run a little
dumber.

## Secrets

```sh
foldrun secrets set STRIPE_KEY          # prompted, never echoed, never in a file
```

Agents name them in `secrets:` and receive the value at run time. They are never
written into the workspace, so a workspace is always safe to commit.

## Where to go next

- **The grammar** — every field an agent or flow can carry: Help
- **The API** — driving a deployed workspace over HTTP: the API reference
- **The CLI** — every command and flag: the CLI reference
