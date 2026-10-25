# Running it yourself

There are three places a workspace runs, and the same folder moves between
them unchanged.

| shape | for | what is yours |
|---|---|---|
| **your machine** | one person, no server — the foldrun CLI and runtime, free from npm | everything: the files, the runs, the model bill |
| **your own server** | you or your organisation on one machine: the dashboard, schedules, sandboxes, gates, a vault and a team, with Docker Compose | everything, and the machine |
| **the hosted platform** | a team that would rather not run anything | your workspaces and their records; we run the machines |

foldrun is **source-available** under the Functional Source License 1.1
(FSL-1.1-ALv2): the format, the runner, the checks, the CLI, the engine and
the dashboard are free to use, change and run for yourself and inside your
own organisation, at any size. What needs a commercial licence is offering
foldrun to others as a product or service that competes with it. Each
release becomes Apache 2.0 two years after it ships. The licence and a
plain-English summary are in each repository (`LICENSE`, `LICENSING.md`);
for a commercial licence, write to hello@foldrun.io.

A self-hosted server has no billing: nothing is charged, and spend budgets
(`budget:`) still hold.

## Your own server

One machine with Docker. The platform runs in one container — the dashboard,
the API, the scheduler and the queue — and every agent step runs in a
throwaway container beside it, started through the Docker socket.

```sh
mkdir foldrun && cd foldrun
for r in foldrun-core foldrun-platform foldrun-web foldrun-docs; do
  git clone https://github.com/foldrun-io/$r
done
cd foldrun-web/self-hosting
echo "FOLDRUN_SECRET_KEY=$(openssl rand -hex 32)" > .env
echo "FOLDRUN_PUBLIC_URL=http://<host>:3900" >> .env   # the address people open
docker compose up -d --build
```

Then open `http://<host>:3900/signup` (the first account needs no flag),
sign the CLI in to it, and deploy an account folder:

```sh
npm install -g foldrun
foldrun login --url http://<host>:3900   # approve in the browser; or --token <a key from Settings>
foldrun deploy                           # from the account folder
```

`docker-compose.yml` beside the Dockerfile lists every setting with what it
does: the install's model key (or none, and each account brings its own),
open sign-up (off), retention. `FOLDRUN_PUBLIC_URL` is required: CLI sign-in,
approve links, password resets and shares are made with it, so it must be
the address people actually open. Back up the `foldrun-data` volume and `FOLDRUN_SECRET_KEY` and
you have backed the install up.

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

Nothing about the folder changes. What the platform adds is the operating around it —
[Scheduling](scheduling), [Runs](runs) in gVisor sandboxes,
[Secrets](secrets) in a vault, [Notifications](notifications),
[Budgets and billing](budgets-and-billing), [Team and access](team-and-access).

## Where the data is

On your machine: in the folder. On the platform: your workspace's files and
every run's record, on our data volume and in the file store, readable
through the dashboard and the API, exportable as a .zip (`foldrun export`). A deploy never
touches what an agent learned or a run recorded. See [Storage and
sharing](storage-and-sharing) and [Security](security).
