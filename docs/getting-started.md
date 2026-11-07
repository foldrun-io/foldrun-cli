# Getting started

An agent is a folder. A flow is a numbered list. There is no build step — the
files are the program — so the loop is edit, check, run, deploy.

## Install and make something that runs

```sh
npm install -g foldrun
export ANTHROPIC_API_KEY=sk-ant-...     # an API key from console.anthropic.com
# or: export CLAUDE_CODE_OAUTH_TOKEN=...  from `claude setup-token` (see the CLI reference)

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
tools: [web, write]
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

## The checklist on the dashboard

The first time you open an account that has no workspace, the dashboard
starts you in the **welcome flow** (`/dashboard/welcome`): add your model key
(on a hosted platform, where the account brings its own — every run is
refused until it has one), choose what to start with — the demo pipeline, a
blank workspace, an imported .zip, the CLI, or connecting your AI app over
MCP — then run it once and watch each step live, ending on the run's page or,
if it stops, the reason and the Doctor. Every screen can be skipped, and the
flow picks up wherever the account really is, however you did the work.

After that the home page shows a **Getting started** card: add your model
key, create a workspace, write or deploy an agent, run a flow, get a run to
finish, add a secret, schedule a flow or give it a webhook, invite a
teammate, set up billing (where the plan asks for it) and install the CLI —
"4 of 8", with the next step opened up and a link to where to do it, and
**Resume setup** back into the welcome flow. Each step is worked out from the
account as it is (a run on record, a secret in the vault, a key minted for
the CLI), so it ticks itself whichever way you did the thing; there is
nothing to mark. While an account has no model key every dashboard page also
carries a banner saying so, with a link to Settings → Model provider
(`foldrun account model set anthropic --key …`, or on foldrun's own platform
`foldrun account model use foldrun --provider anthropic` to run on foldrun's
models, billed in credits). A step's **…** menu hides that step for you; the
card's hides the whole card, and the line at the foot of the page brings it
back. It goes away by itself once every step is done.

Each workspace's overview has a **Workspace checklist** of what a desk needs
before it can be left to run on its own: a flow that ran to the end, a
schedule or webhook, an owner, an eval, and `notify:` so someone is told
when a run fails — each ticked from the workspace itself (the owner and
`notify:` count when the account's AGENTS.md sets them), each a link to
where it is done. Hide an item, or the card, for yourself.

```sh
foldrun onboarding                       # the same steps, in the terminal
foldrun onboarding --to my-desk          # and that workspace's checklist
```

The API is `GET /api/me/onboarding` (`?workspace=` for the checklist);
hiding is a person's own setting, so it is done from the dashboard, not with
a key.

## Where to go next

- **The grammar** — every field an agent or flow can carry: Help
- **The API** — driving a deployed workspace over HTTP: the API reference
- **The CLI** — every command and flag: the CLI reference
