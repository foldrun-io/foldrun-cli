# Running it yourself

There are two places a workspace runs, and the same folder moves between
them unchanged.

| shape | for | what is yours |
|---|---|---|
| **your machine** | one person, no server — the open-source CLI and runtime | everything: the files, the runs, the model bill |
| **the hosted platform** | a team; schedules, sandboxes, gates, a vault, a dashboard | your workspaces and their records; we run the machines |

The framework — the format, the runner, the checks, the CLI — is Apache-2.0
on [GitHub](https://github.com/foldrun-io) and npm. The platform that runs it
for other people (the queue and its worker, per-step sandboxes on a cluster,
metering, tenancy) is ours and is not distributed: there is no self-hosted
platform. If you need it inside your own network, that is a conversation —
write to hello@foldrun.io.

## Your machine

```sh
npm install -g foldrun
export ANTHROPIC_API_KEY=...            # an API key; or any provider via provider:
foldrun init my-desk
cd my-desk && foldrun check && foldrun run publish
```

Everything the format defines works here: agents, flows with groups and
gates, tools in any language, skills, knowledge bundles, evals, `verify:`,
`each:`, `budget:`. Runs are recorded under `.foldrun/` beside the workspace;
secrets set with `foldrun secrets set` are encrypted there under a key the
CLI makes on first use.

What is different from the platform, and why:

- **No schedules.** Nothing is running when your laptop is closed. `foldrun
  run` is the trigger; cron on your own machine works if you want one.
- **No sandbox by default.** Steps run as your user, in your workspace. Set
  `FOLDRUN_RUN_ISOLATION=container` with Docker installed to get one hardened
  container per step, the same executor the platform's single-box shape uses.
- **Gates wait in the terminal.** A `!` step parks the run; `foldrun run`
  shows the approval and waits for your answer.
- **Budgets cap, and nothing meters.** `budget:` stops a run at its cap; the
  cost of each step is on the record. No invoice, because the model bill is
  yours.

## Moving to the platform

```sh
foldrun login
foldrun deploy                           # this folder → a workspace with the same name
```

Or push it: every workspace on the platform is a git remote. Nothing about
the folder changes. What the platform adds is the operating around it —
[Scheduling](scheduling), [Runs](runs) in gVisor sandboxes,
[Secrets](secrets) in a vault, [Notifications](notifications),
[Budgets and billing](budgets-and-billing), [Team and access](team-and-access).

## Where the data is

On your machine: in the folder. On the platform: your workspace's files and
every run's record, on our data volume and in the file store, readable
through the dashboard and the API, exportable as a git clone. A deploy never
touches what an agent learned or a run recorded. See [Storage and
sharing](storage-and-sharing) and [Security](security).
