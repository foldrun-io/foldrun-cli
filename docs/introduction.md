# Introduction

Agents are just folders. foldrun is the platform that runs them: an agent is
a folder with an `agent.md` in it; a flow is a numbered
list of steps; a tool is a file that says what may be called. There is no
build step and no SDK to import — the files are the program — so the same
folder runs on your laptop with the CLI or on the hosted platform,
unchanged.

## What it is for

Work that a person used to do on a schedule, and that a model can now do with
supervision: the weekly report, the nightly import, the morning scan of what
changed, the draft that a human approves before it goes out. Each of those is
a flow. Each role in it is an agent. The person who used to do the work
becomes the person who reads the headline and clicks approve.

The design bets on three things:

- **Files are the right unit.** An agent's prompt, its tools, its knowledge
  and what it has learned are all files you can open, diff, review and put in
  git. Nothing is hidden in a database that only the platform can read.
- **The file decides, the model works.** A flow says who runs and in what
  order; a model decides only what to do inside its step. There is no
  free-form handoff between agents, because that is where systems loop.
- **Capability is a grant, not an instruction.** An agent can call a tool
  because its file names it. An agent that cannot write to your website has
  no tool that writes, rather than a paragraph asking it not to.

## Two ways to run it

| | you need | what runs where |
|---|---|---|
| **Locally** | `npm install -g foldrun` and a model key | everything on your machine; no account, no server |
| **Hosted** | an account | ours: schedules, sandboxes, a vault, a team |

The same workspace moves between them with `foldrun deploy` or a `git push`.
Start locally; that is where every workspace should be born. The CLI and
runtime are open source (Apache-2.0); the platform is not distributed — see
[Running it yourself](self-hosting).

## Where to go

- [Getting started](getting-started) — install, make a workspace, run it.
- [How it works](how-it-works) — the eight nouns and the flow grammar, in one read.
- [Workspaces](workspaces), [Agents](agents), [Flows](flows), [Tools](tools) — the format, field by field.
- [Runs](runs), [Budgets and billing](budgets-and-billing), [Security](security) — what happens when it runs.
