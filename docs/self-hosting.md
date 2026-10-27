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

One machine with Docker — Linux or macOS, Intel/AMD (amd64) or ARM (arm64);
on Windows, inside WSL2 with Docker Desktop's WSL integration. One command:

```sh
curl -fsSL https://foldrun.io/install.sh | sh
```

It checks Docker, puts `docker-compose.yml` in `~/foldrun`, writes `.env`
there once (a fresh secret key, the address, the version), pulls the
ready-made images for your machine's chip and starts foldrun on port 3900.

**No Docker yet?** The installer offers to set it up, and asks before each
step (`[y/N]`):

| on | Docker missing | Docker stopped | Docker not reachable by you |
|---|---|---|---|
| **macOS** | installs Colima (a small Linux VM), `docker` and `docker-compose` with [Homebrew](https://brew.sh), then starts Colima with up to 4 CPUs and 8 GiB — enough for a `heavy` step | starts Colima, or opens Docker Desktop | — |
| **Linux** | runs Docker's official script ([get.docker.com](https://get.docker.com): the engine and the Compose plugin) as root, through `sudo` | `sudo systemctl start docker` | adds you to the `docker` group (root-equivalent), and uses `sudo` for the rest of that run; the group applies from your next login |

Answer after each question appears: anything typed ahead is lost while
Docker installs.

**What it checks first.** The install folder and every file Compose reads
there (`.env`, `docker-compose.yml`, `docker-compose.override.yml`) must be
yours alone — owned by you, writable by nobody else, no access control list,
no symlinks — because Docker runs what they say with root's reach. The
override must stand alone: no `include` or `extends`, and no `env_file` —
put settings in `.env` or in the override's own `environment:`. Anything
else it names, such as a secret's file, is your own configuration to
protect, as is a key written to slip past these checks.

`FOLDRUN_DATA_DIR` (a host folder instead of the data volume) holds the
accounts and the vault, so it must be private: the installer makes it
owner-only when it does not exist, refuses one that others can read or
write, and keeps its real path (symlinks resolved) in `.env`.

The installer sets foldrun up on the machine it runs on, and refuses a
remote Docker (`DOCKER_HOST` or a context pointing at another machine): run
it on the Docker host itself.
Compose is always given these files by name, so a `compose.yaml` beside them
or a `COMPOSE_FILE` in `.env` cannot stand in. Before starting, it checks
that the Docker the platform will be given (`FOLDRUN_DOCKER_SOCK`) is the
same daemon it installed into. With no terminal (a provisioning script), nothing is
installed unless you say so in advance with `FOLDRUN_INSTALL_DOCKER=yes`;
`FOLDRUN_INSTALL_DOCKER=no` never asks. Without Homebrew on a Mac, install
it or [Docker Desktop](https://docs.docker.com/desktop/setup/install/mac-install/)
first. Then open the signup link it prints —
`http://127.0.0.1:3900/signup?setup=…` (127.0.0.1, not `localhost`, which a browser may send to IPv6 where another user could be listening) — in a browser. The first account
becomes the owner, and only that link can create it: anyone else using the
same machine can reach `localhost` too, so the installer ties the owner to
whoever ran it (the token is `FOLDRUN_SETUP_TOKEN` in `~/foldrun/.env`, and
does nothing once the owner exists). With `FOLDRUN_BIND` set to one address
the link uses that address; from another machine, open it through the
tunnel the installer prints (`ssh -o ExitOnForwardFailure=yes -L …`), never
over plain http. Then sign the CLI in and deploy:

```sh
npm install -g foldrun
foldrun login --url http://localhost:3900
foldrun deploy                           # from your account folder
```

To read the script before it runs (anything piped into a shell deserves it):
`curl -fsSL https://foldrun.io/install.sh -o install.sh`, read it, then
`sh install.sh`. Its source is `self-hosting/install.sh` in
[foldrun-web](https://github.com/foldrun-io/foldrun-web/tree/main/self-hosting).

The platform runs in one container — the dashboard, the API, the scheduler
and the queue — and every agent step runs in a throwaway container beside
it, started through the Docker socket. The images are
`ghcr.io/foldrun-io/platform` and `ghcr.io/foldrun-io/runner`, public, built
from these repositories.

### Settings

Give them to the installer as environment variables
(`curl -fsSL https://foldrun.io/install.sh | FOLDRUN_BIND=0.0.0.0 sh`) or
edit `~/foldrun/.env` and run `docker compose up -d` there.

| variable | default | what |
|---|---|---|
| `FOLDRUN_PUBLIC_URL` | `http://localhost:3900` | the address people open. CLI sign-in, approve links, password resets and shares are made with it |
| `FOLDRUN_BIND` | `127.0.0.1` | where the dashboard listens. The default is this machine only — reach it over an SSH tunnel or a reverse proxy. `0.0.0.0` opens it to the network: sign up straight away, because the first account becomes the owner |
| `FOLDRUN_VERSION` | the current `stable` | a version to pin, `vYYYY.MM.DD.N`; `stable` unpins. Give it to the installer: in `.env` by hand it holds only with `FOLDRUN_PINNED=yes` beside it, or the next installer run moves it to `stable` |
| `ANTHROPIC_API_KEY` | none | the install's model key. Without one, each account adds its own in Settings → Model; a step with neither is refused with what to set |
| `FOLDRUN_DIR` | `~/foldrun` | where the install lives (installer only) |
| `FOLDRUN_DOCKER_SOCK` | `/var/run/docker.sock` | the Docker socket; rootless Docker is found by the installer |
| `FOLDRUN_SETUP_TOKEN` | made once | the first account (the owner) is created only with this, through the printed `/signup?setup=…` link |
| `FOLDRUN_INSTALL_DOCKER` | ask | `yes` installs or starts Docker without asking (for a script with no terminal); `no` never offers to |
| `FOLDRUN_EGRESS_BIND` | `0.0.0.0` | the egress proxy's port 8090, which steps reach through `host.docker.internal`. On a server that faces a network, bind it to the Docker bridge (`172.17.0.1`); Docker-published ports skip host firewalls such as ufw |
| `FOLDRUN_DATA_DIR` | a named volume | a host path for the data instead |

`docker-compose.yml` lists the rest (concurrency, retention, gVisor, other
model endpoints). Put your own changes in `docker-compose.override.yml`
beside it, which Compose reads too: the installer replaces
`docker-compose.yml` on an update and keeps a copy of one you edited.

### Updating, versions, both kinds of chip

Run the installer again. It keeps `.env` (the secret key, your settings),
moves `FOLDRUN_VERSION` to the newest `stable`, pulls and restarts; your
data stays in its volume. With a version pinned, a re-run keeps it.

`stable` is the newest version built for both amd64 and arm64, so the same
command works on an Intel server and an Apple Silicon Mac. It moves forward
once a day at most; each version is tested on foldrun's own servers first.

### Backups

`~/foldrun/.env` (the secret key: losing it signs everyone out and voids
every webhook URL) and the data volume (`foldrun_foldrun-data`, or your
`FOLDRUN_DATA_DIR`) are the whole install. Stop with `docker compose stop`;
`docker compose down -v` deletes the data volume.

### By hand, or from source

The installer is a convenience. The same by hand:

```sh
mkdir ~/foldrun && cd ~/foldrun
curl -fsSLO https://raw.githubusercontent.com/foldrun-io/foldrun-web/main/self-hosting/docker-compose.yml
echo "FOLDRUN_SECRET_KEY=$(openssl rand -hex 32)" > .env
echo "FOLDRUN_PUBLIC_URL=http://localhost:3900" >> .env
echo "FOLDRUN_BIND=127.0.0.1" >> .env      # this machine only, as the installer does
docker compose up -d
```

From source instead of images — the four repositories side by side, built
here (a few minutes and some gigabytes the first time):

```sh
for r in foldrun-core foldrun-platform foldrun-web foldrun-docs; do
  git clone https://github.com/foldrun-io/$r
done
cd foldrun-web/self-hosting
echo "FOLDRUN_SECRET_KEY=$(openssl rand -hex 32)" > .env
echo "FOLDRUN_PUBLIC_URL=http://localhost:3900" >> .env
echo "FOLDRUN_BIND=127.0.0.1" >> .env
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

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
  Without one, a step's file tools may not write the workspace's configuration
  or code (`AGENTS.md`, agents, flows, tools, skills, evals, scripts), but its
  shell is not confined: only a sandbox keeps those files out of a step's reach.
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
