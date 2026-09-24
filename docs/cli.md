# CLI reference

`foldrun` needs no account. `ANTHROPIC_API_KEY` — an API key from
console.anthropic.com — is enough to run agents; `init` and `check` need
nothing at all. A claude.ai subscription is not a credential here: Anthropic
does not allow products built on its Agent SDK to run on claude.ai logins,
so the key is the way, or any other model provider named with `provider:`
(see [Providers](providers)).

## Commands

| | |
|---|---|
| `foldrun init [dir]` | create an account folder with one workspace in it — `--workspace <name>` names it, `--flat` makes the older single-folder shape |
| `foldrun new <name>` | another workspace in this account |
| `foldrun agent new <name>` | one more agent inside a workspace, with the frontmatter the format requires — and every key explained beside it. Also `foldrun flow new <name>`, whose first step names an agent this workspace already has, and `foldrun tool new <name>`, which writes a `transport: script` folder with its program in a file beside the definition (`--transport script\|http\|mcp`, `--language javascript\|python\|bash`). In an account with more than one workspace, `--to <name>` says which; inside one, it is already known. The templates are the same ones the dashboard's New button writes, so what is scaffolded is what `foldrun check` accepts |
| `foldrun guide` | the coding-agent rules, copied from what Next.js does: a short managed block in the account's `AGENTS.md`, between `<!-- BEGIN:foldrun-agent-rules -->` markers, telling a coding agent (Claude Code, Cursor, Codex) to read `foldrun docs` before it writes an agent, flow or tool, and a `CLAUDE.md` that imports it with `@AGENTS.md`. `foldrun init` writes them, `foldrun pull` refreshes them, and `foldrun check` re-adds them when a coding agent runs it and they are missing or old — as `next dev` does. Only the block is rewritten, in place; text around it is kept. The runtime strips the block, so the agents that run in the account never see it; the rest of `AGENTS.md` stays their shared context. `--check` exits 1 when the block is missing or old (for CI), `--print` writes it to stdout |
| `foldrun docs [page]` | these docs, from the copy that ships inside the CLI — the way Next.js ships `node_modules/next/dist/docs` — so a coding agent reads the version it is driving, offline. No page lists them; `foldrun docs flows` prints one; `--path` prints the folder. Design records and the platform operator's routes are left out |
| `foldrun check [dir]` | validate agents, flows, tools, evals, knowledge — offline. At an account root: every workspace, then the shared library |
| `foldrun extract [dir]` | move each single-file script tool — a `tools/<name>.md` with its program in a fenced block — into a folder: `tools/<name>/tool.md` with `run:` pointing at `run.js`, `run.py` or `run.sh` beside it. Frontmatter is edited as text, never re-serialised, so the diff is only what moved. A tool that already has a folder is left for you; `--dry-run` lists what it would do |
| `foldrun check --to <ws>` | validate the copy that is DEPLOYED, rather than the folder in front of you — a workspace edited through the API, by an agent or by `foldrun source put`, has had no way to be checked short of spending a run. The files are fetched into a temporary folder and the ordinary check runs over them, so there is one copy of the rules; the output names the workspace and the platform it checked |
| `foldrun agent run <name>` | run one agent once on a platform, with no flow file: a flow of one step. `--task "…"` is the instruction and is required. Prints the run id and how to follow it; `--wait` holds on (in 25-second pieces, as `invoke` does) and then prints the same report `foldrun report` would; `--test` makes it a [test run](runs#test-runs) |
| `foldrun tool test <name>` | exercise one tool, alone — no model, no run, no flow. The real thing runs: the HTTP request against the declared `base:`, the script with the workspace's secrets in its environment, the MCP handshake. Prints the transport, whether it exited cleanly, how long it took, everything the tool printed, and any secret it needed by NAME and never by value. Its arguments are `key=value` pairs, one per argument the tool declares, and `--path` is an http tool's probe path. It waits five minutes by default, because a tool that crawls takes as long as it takes — `--timeout <seconds>` waits longer, and a test given up on says so rather than claiming the tool failed |
| `foldrun run <target>` | run an agent or a flow (`name`, or `flow:name`) — `--test` for a [test run](runs#test-runs) |
| `foldrun eval [name]` | one eval, or all of them |
| `foldrun probe <model>` | can this model hold a tool loop here? A live check |
| `foldrun logs [run-id]` | recent runs in one workspace, or one run's whole event trail |
| `foldrun runs` | what has run lately across the whole account: when, workspace, flow, status, steps done, how long, what it cost and the run's own one-line summary. A completed run shows its verdict beside the status — `GOOD`, `BAD`, `QUIET`, or `BLOCKED` in red with a ⛔ mark. `--status failed`, `--verdict blocked`, `--since 24h`, `--to <workspace>`, `--limit <n>`. `--local` still reads this machine's store, the way `logs` does |
| `foldrun report <run-id>` | one run, whole, without opening the dashboard: the header, then every step with its group, agent, attempts, cost, duration, whether its `verify:` held and the first line of what it said — and for a failed step, the error and the last events before it. Then what it wrote, what it published and what is still waiting on a person. `--json` prints the run record instead |
| `foldrun approvals` | every gate waiting on a person, anywhere in the account: which workspace, flow and run, which step and agent, the question, how long it has been waiting and which files under `storage/` the gate previews. `--to <workspace>` narrows it |
| `foldrun approve <run-id>` | release a waiting gate. Approving is outward — the step behind it publishes, sends or posts — so it prints what it is about to release and asks you to type the run id back, unless `--yes`. `--note "…"` is read by the agent as guidance, `--step <n>` decides one gate of several |
| `foldrun reject <run-id>` | refuse one, failing the step and the run with it. `--note` is the reason, and it goes on the trace |
| `foldrun stop <run-id>` | kill a run in flight: the queued job is dropped and the sandbox the current step is spending in is destroyed. It prints which step is running and what has been spent, then asks you to type the run id back unless `--yes`. Finished steps keep their results, and costs already incurred stay on the bill. A run that has already finished is said so, not stopped |
| `foldrun secrets set NAME` | store a secret — also `ls`, `rm`, and `status` (OAuth grant health) |
| `foldrun connect NAME` | OAuth sign-in from the terminal, stored as an auto-refreshing secret — `--provider google\|github\|microsoft\|linkedin`; reconnecting a secret whose client is saved asks for nothing (`--new-client` to enter one) |
| `foldrun deploy [dir]` | push this account into an installation — every workspace and the shared library. `foldrun deploy <workspace>` pushes one. Never removes a workspace the platform has and the folder does not |
| `foldrun pull [workspace]` | bring the platform's account down into this folder — refuses to overwrite a locally edited file, and names every one it would have taken (`--force` takes them) |
| `foldrun status [workspace]` | per workspace: what is added, changed and only-on-the-platform, plus which files moved there since your last deploy from here. Reads only |
| `foldrun workspaces` | what exists here, what exists on the platform, which are both — also `new <name>`, and `rm <name>` (locally; `--platform --yes` deletes it there) |
| `foldrun invoke <flow>` | start a flow on a running platform — `--watch` follows its trace here; `--test` makes it a [test run](runs#test-runs) `--once <key>` sends the key as the run's idempotency key, so a CI step that retries after a dropped response is answered with the run it already started instead of paying for a second. |
| `foldrun source <verb>` | one workspace file on a platform: `ls [dir]`, `cat <path>`, `put <path>` (from `--file`, else stdin; `--message` goes on the revision), `mv <from> <to>`, `rm <path>` — the editor's own door, so every write is a revision. For a whole tree, `deploy` |
| `foldrun open [page]` | the dashboard for this workspace, in the browser (`runs`, `agents`, `graph`, `repo`…) |
| `foldrun login` | sign this machine in from the browser — no key to copy |
| `foldrun login <site> --url <address>` | a browser window to sign in to a site by hand; the session is stored for an agent |
| `foldrun logout` | forget this machine's key, and revoke it if `login` made it |
| `foldrun whoami` | who you are on the platform: account, role, which workspaces |
| `foldrun doctor` | check the road to the platform, one line each: Node (22 or newer), the CLI and core versions, which of `FOLDRUN_URL`, `FOLDRUN_TOKEN`, `FOLDRUN_TIMEOUT`, `HTTPS_PROXY` are set (never their values), the account it would act as, DNS for the platform's host, and a timed `GET /api/healthz`. The first thing to run when a command cannot reach the platform |
| `foldrun storage <verb>` | what a workspace PRODUCED, as opposed to what you wrote — `source` is the other half. `ls [prefix]` lists every file with its size, when it was written, how long ago and which run wrote it (`run:<id>`, `user:<email>` for an upload, `api-key` for a key), newest first, plus what the store holds against its quota. `cat <path>` prints a text file and refuses one that is not text. `get <path>` downloads it beside you — `--file <path>` names somewhere else, `--force` overwrites. `put <file>` uploads a file into storage under its own name, or `--as <path>`; `rm <path>` removes one. `share <path>` mints a public link to one produced file (7 days; `--ttl <days>`, `--forever`) and prints the URL; `shares` lists the live links (`--all` includes expired and revoked); `unshare <token>` revokes one — the link answers 404 from then on and the token is never reused. `--to <workspace>` from anywhere; inside a workspace folder it is already known |
| `foldrun schedule` | every flow in the account whose `trigger:` is a clock: workspace, flow, the cron line, its timezone, how many steps, whether the scheduler can parse it, and the next three times it fires. The times are the point — `0 5 1-7 * 5` reads as "the first Friday" and fires eight times in twenty-eight days, because day-of-month and day-of-week are OR'd. Exits 1 if any line is unparseable, since an invalid schedule errors nowhere and simply never runs. `--to <workspace>` narrows it |
| `foldrun rerun <run-id>` | the same flow again, from a step: `--from <n>` as the flow file numbers them, or `--agent <name>` for the first step that agent runs. Earlier steps are recorded as skipped. This is the debug loop from the terminal: fix the file, `deploy`, `rerun --from` the step that failed. `--wait` follows the new run like `invoke --wait`; `--to <workspace>` from anywhere |
| `foldrun triggers` | why nothing ran. One row per flow that fired in the window: its trigger, how many fires became runs, when it last ran, and every reason for the difference with a count — a duplicate delivery, a throttled or debounced burst, a fire the platform slept through, an `overlap: skip`, a flow switched off by `disable_after:`. A switched-off flow is a non-zero exit; one successful run clears it. `--since <days>` (default 7), `--to <workspace>` |
| `foldrun billing` | the account's balance, whether billing is on at all, what the platform is currently waiving, and the recent ledger entries with what each was for — a run names its workspace, flow and run id; an adjustment carries its own note. `--limit <n>` shows more |
| `foldrun account` | the account's own defaults — the AGENTS.md frontmatter every workspace under it inherits: `timezone`, `notify`, `budget`, `concurrency`. `foldrun account set timezone Australia/Sydney`, `set notify email you@example.com` (`--events failed,awaiting-approval,completed`), `set notify url https://…`, `set budget 60/month`, `set concurrency 4`, and `clear <key>` to unset one. `set notify` merges against what is there, because the platform replaces the whole block. `providers` lists the model providers the account's files use and the last daily key check — `--check` asks now, and a dead key is a non-zero exit. Singular — `accounts` below is the list of logins on this machine |
| `foldrun accounts` | every account signed in on this machine, and which one a bare command acts as. `foldrun profiles` is the same command |
| `foldrun use <name>` | act as one of them from here on. `foldrun switch <name>` is the same command |
| `foldrun keys ls` | the account's API keys — also `create <label>`, `revoke <id>` |

## Options

| | |
|---|---|
| `--workspace <dir>` | the workspace folder (default `.`). On `init` it names the first workspace instead |
| `--flat` | `init`: the single-folder shape — `agents/` and `flows/` at the root, no account around them |
| `--from <template>` | start from a shipped template, e.g. `templates/hello` |
| `--transport <k>` | `tool new`: `script` (the default — a folder with its program beside it), `http` or `mcp` |
| `--language <l>` | `tool new`: the script's language — `javascript`, `python` or `bash` |
| `--task "<text>"` | the instruction for a manual run |
| `--test` | `run`, `invoke`, `agent run`: a test run — every step runs, nothing outward happens, `state/` and `storage/` are left alone, and the run page lists what would have happened. See [Test runs](runs#test-runs) |
| `--follow` | `logs`: keep tailing a live run — locally, or on the platform with `--url` |
| `--status <s>` | `runs`: only these statuses, comma-separated — `failed`, `completed`, `awaiting-approval`, `running`, `queued` |
| `--since <span>` | `runs`: only runs started within `24h`, `7d`, `90m`, `2w` |
| `--limit <n>` | `runs`, `billing`: how many rows, newest first (`runs` default 20, `billing` 15). Each workspace is asked for its own newest `n` before the merge, so one busy desk cannot crowd out a quiet one |
| `--step <n>` | `approve`, `reject`: decide one gate, numbered as `report` prints it. Without it, every step of that run which is waiting |
| `--note "<text>"` | `approve`: guidance the approved step reads in its prompt — "approve, but skip the Sydney batch". `reject`: the reason, recorded on the trace |
| `--yes` | `approve`, `stop`: skip the confirmation, deliberately. Required when there is no terminal to ask |
| `--json` | `report`: the raw run record instead of the report |
| `--events <a,b>` | `account set notify`: which events are notified on — `failed`, `awaiting-approval`, `completed` |
| `--watch` | `invoke`: follow the run's trace here as it happens; the exit code is the run's |
| `--print` | `open`: print the URL, do not open it |
| `--value "<text>"` | `secrets set`: skip the prompt — careful with shell history |
| `--account` | `secrets`: account scope rather than this workspace's — the workspace is the folder's name (`--workspace`), local or on the platform alike |
| `--wait` | `invoke`, `agent run`: hold on and print the result. Asked in 25-second pieces, so a flow that runs for many minutes is never cut by whatever sits in front of the platform; a run parked on a person prints its page and exits 2 |
| `--from <n>` | `invoke`: start at step n, skipping earlier ones |
| `--no-browser` | `login`, `connect`: print the address instead of opening it |
| `--provider <name>` | `connect`: fills the authorize and token URLs and an example scope string; `--authorize-url` / `--token-url` for a provider with no preset |
| `--scopes "<a b c>"` | `connect`: space-separated, as OAuth defines it |
| `--client-id` / `--client-secret` | `connect`: the OAuth app; prompted when omitted, the secret never echoed |
| `--port <n>` | `connect`: the loopback port (default 8642) |
| `--role <r>` | `keys create`: `viewer`, `editor` (default) or `admin` |
| `--for <workspace>` | `keys create`: a deploy key for one workspace; `--access read` or `write` |
| `--force` | `deploy`: deploy while runs are in flight. `pull`, `storage get`: overwrite local files |
| `--platform` / `--yes` | `workspaces rm`: delete it on the platform, said twice because it cannot be undone |
| `--path <p>` | `tool test`: the path an http tool should probe, appended to its `base:` — a path that escapes the base is refused, the same confinement the agent gets |
| `--timeout <s>` | how many seconds one request to the platform may take — or `FOLDRUN_TIMEOUT`. Default 30, and 300 for `tool test`, where the tool itself is the thing being waited on |
| `--local` | `deploy`, `secrets`, `logs`: the installation on this machine, even when signed in |
| `--quiet` | leave out the dim "acting as …" line a platform command prints on stderr |
| `--dry-run` | `extract`: list what would move, change nothing |

## The shape of a folder

`foldrun init` makes an **account folder** — the same shape the platform keeps,
so what you reason about on a laptop is what runs on a box:

```
my-account/
├── AGENTS.md              config and context every workspace here inherits
├── library/               skills, tools, scripts, knowledge shared by all of them
└── workspaces/
    └── main/              one workspace: agents/, flows/, knowledge/, memory/, evals/
```

Every command works from anywhere inside it. At the account root they act on
the whole account; inside a workspace, on that workspace.

The older shape — a single folder with `agents/` and `flows/` at its root — is
still read by every command, unchanged, and `foldrun init --flat` still makes
one. A folder shape is a file format: it does not break because a better one
arrived.

Inside an account folder, the workspace-scoped commands take the workspace as a
positional, or need nothing when there is exactly one:

```sh
foldrun secrets blog-desk set SLACK_TOKEN
foldrun runs blog-desk
foldrun deploy blog-desk
```

**One gap.** The platform has no endpoint that reads or writes an account's own
`AGENTS.md` — `/api/account` patches a handful of known frontmatter keys and
nothing serves the file. So `deploy` does not push it and `pull` does not fetch
it; both say so rather than dropping the scope in silence. Edit it in Settings,
or on the installation itself. The shared `library/` has a full per-file API
and is pushed and pulled normally.

## Signing in

```sh
foldrun login
```

The terminal shows a short code and opens the dashboard on a page that asks
whether this is your terminal. Say yes, and the terminal is signed in: every
command after that reaches the platform without `--url` or `--token`.

What happened underneath is ordinary. Approving minted an API key at your
role — labelled `cli · <machine>` on Settings → API keys, where it can be
revoked like any other — and the CLI stored it in `~/.foldrun/credentials.json`
(mode 0600; `FOLDRUN_HOME` moves the directory). An owner's terminal is an
admin's: a key is never an owner.

`foldrun login --url https://foldrun.example.com` signs in to your own
installation; the last one signed in to is the default afterwards, and
`--url` on any command picks another. `foldrun login --token <key>` stores a
key made in the dashboard instead of opening a browser — for a machine with
none, or to hold a deploy key for one workspace — after checking that it
works.

`foldrun whoami` says who the platform thinks you are and where the
credential came from. `foldrun logout` forgets the key and, when `login`
made it, revokes it.

**In CI, set `FOLDRUN_TOKEN`** rather than logging in: the environment beats
the file, so a job with a key in its variables never reads one from disk.
`foldrun keys create ci --for leads --access write` makes a key that can only
`git push` that one workspace.

## Signing in to a site, for an agent

Some sites have no API worth the name, so an agent drives the site itself,
wearing a session a person signed in for. Copying one by hand is five steps
in DevTools and it loses two things every time: the storage a cookie jar
cannot hold, and the browser identity the site checks the session against.

```sh
foldrun login medium --url https://medium.com
```

A real browser window opens. Sign in by hand — password, MFA, a link in your
email, whatever the site asks. **No password goes anywhere near foldrun**: the
page is the site's own. Then press Enter in the terminal, with the window
still open, and the session is read out and stored:

| Stored | What it is |
|---|---|
| `MEDIUM_COOKIES` | every cookie for that site, `HttpOnly` ones included — which a console cannot read, and which are usually the login |
| `MEDIUM_STORAGE` | localStorage, sessionStorage and IndexedDB, for the logins that are not cookies (Firebase writes IndexedDB; MSAL can use sessionStorage). Only written when the site keeps something there |

It then prints the block to paste into whichever agent should wear it, with
the **identity** the site saw — engine, user agent, locale, timezone — because
a Cloudflare clearance cookie is bound to the user agent that earned it, and a
session copied without its identity is a challenge waiting to happen:

```yaml
web_browse:
  engine: chrome
  user_agent: "Mozilla/5.0 (Macintosh; …) Chrome/152.0.0.0 Safari/537.36"
  cookies: MEDIUM_COOKIES
  cookie_domain: .medium.com
  storage: MEDIUM_STORAGE
  storage_origin: https://medium.com
  locale: en-US
  timezone: Australia/Sydney
```

It also says which cookie looks like the login and **when it dies**, so the
answer to "why did it stop working" exists before it stops working.

`--account` stores against the account rather than this workspace, `--to
<workspace>` picks another, `--local` keeps it in this machine's store, and
`--print` shows everything without storing a thing. `--engine firefox` or
`webkit` signs in through those instead.

The window it opens is Playwright's, which is not part of the CLI: install it
once with `npm i -g playwright && npx playwright install chromium`.

**A session is a snapshot.** Sites re-issue cookies as you browse (a Rails app
rewrites its session whenever the contents change), so the copy in the vault
drifts from the one in your browser. When an agent says it is not signed in,
run this command again rather than debugging the agent — and mint the agent's
session in a browser profile nobody else uses, so ordinary browsing stops
pulling it out from under them.

## More than one account

`foldrun login` stores one **profile** per signed-in account: a name, the
platform's URL, and the key. Several platforms, and **several accounts on
the same platform** — an agency looking after four customers keeps four,
and switches between them without pasting a key:

```sh
foldrun login --url https://app.foldrun.io        # as acme
foldrun login --url https://app.foldrun.io        # as beta, in a second browser
foldrun accounts                                  # both, ● on the active one
foldrun use acme                                  # from here on, acme
foldrun logs --profile beta --to leads            # just this once, beta
```

A profile is named after its account. Two accounts of the same name on
different platforms become `acme` and `acme@host`. Signing in again as an
account you already have replaces that profile rather than making a second.
`foldrun logout` signs out of one account, not the machine — the others
stay. `--token` and `FOLDRUN_TOKEN` still beat every stored profile, so a
CI job with a key in its environment never reads the file.

### Getting a credential for someone else's account

**A key is its account.** The platform reads the account off the key, so
your own key cannot be pointed at somebody else's workspaces however the
command is written — which is the property that makes keys safe to hand
out, and the reason a second account needs a second credential.

There are two honest ways to get one, and which is right depends on whether
the person whose account it is can reach a browser.

**They mint it and hand it over.** The polite one, and the only one that
disturbs nothing:

```sh
# on their machine, signed in as their account
foldrun keys create "alex's laptop" --role admin
```

The key is printed once. They send it to you; you store it as a profile:

```sh
foldrun login --url https://app.foldrun.io --token <the key> --profile acme
```

The key carries the role it was minted with, so an `editor` key cannot
write secrets however it is used. `foldrun keys ls` on their account shows
it, and `foldrun keys revoke <id>` ends it — which is the point of doing it
this way: they can take it back without changing a password.

**You reset it, as the platform.** Only the platform's own super admin can,
only on the hosted platform, and it ends every session that account had:
`/admin/<account>` → the member → **reset password**. The new password is
shown once. Sign in as them in a private window, then `foldrun login
--profile <name>` and approve the code in that window.

Reach for the second only when the first is impossible. It is the recovery
path for a lost password, not a way in — and the person will be signed out
without knowing why unless you tell them.

Joining a team is a different thing again: a member of ONE account, with a
role and a workspace scope. See [Team and access](team-and-access).

## Talking to a platform

`deploy`, `invoke`, `source`, `secrets`, `logs` and `keys` all reach a running
installation:

| | |
|---|---|
| `--url <url>` | the platform, or `FOLDRUN_URL`, or where you last signed in |
| `--token <key>` | an API key, or `FOLDRUN_TOKEN`, or the one `foldrun login` stored |
| `--profile <name>` | act as one stored account for this command alone |
| `--to <workspace>` | which workspace there (deploy defaults to the folder name) |
| `--tenant <name>` | account to deploy into (local installations only) |
| `--data <dir>` | the installation's data directory |
| `--commit <sha>` | record which commit a deploy is |
| `--dry-run` | check and report, change nothing |
| `--force` | deploy even while runs are in flight |

`check`, `run`, `eval` and `probe` are local — they read the workspace on disk
and the runs beside it. `logs` and `deploy` are local too, until a platform is
named — by `--url`, by `FOLDRUN_URL`, or by having signed in (`--local` puts a
deploy back on this machine): then it lists that workspace's runs there, prints one run's
trail, and `--follow` tails a live one. `open` always needs a platform.

## The loop, in order

```sh
foldrun check                      # after every edit. Free. Every workspace here.
foldrun tool test serp_check kw=x  # does the tool work, before a flow depends on it
foldrun run publish --task "..."   # locally, against real models
foldrun eval                       # did the change break an agent?
foldrun status --url $FOLDRUN_URL  # what differs from what is live
foldrun deploy --url $FOLDRUN_URL  # checked again server-side before it lives
foldrun invoke publish --watch     # run it there, trace streamed here
foldrun check --to publish-desk    # and is what is deployed still valid?
foldrun logs --to publish-desk     # what ran there lately
foldrun open runs                  # the same, in the browser
```

A push to any branch other than main previews it: the platform deploys the
branch's tree to `<workspace>-preview-<branch>` and runs its evals there.
Previews never fire on a schedule, read the source workspace's secrets, and
disappear when the branch does.
