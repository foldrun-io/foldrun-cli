# CLI reference

`foldrun` needs no account, and `init` and `check` need no credential at
all. To run agents, set one model credential. The first one set is used:

| | |
|---|---|
| `ANTHROPIC_API_KEY` | an API key from console.anthropic.com |
| `ANTHROPIC_AUTH_TOKEN` | a bearer token for a gateway, with `ANTHROPIC_BASE_URL` |
| `CLAUDE_CODE_OAUTH_TOKEN` | a Claude login token: run `claude setup-token` and set what it prints |

An agent that names its own `provider:` needs none of these (see
[Providers](providers)). Every step says which credential it ran on, in the
run's trail and on the run page, and `foldrun doctor` says which one this
machine would use. Whatever login Claude Code has on the machine is never
picked up by itself: with nothing set, `run` stops and says so.

Anthropic does not allow products built on its Agent SDK to offer claude.ai
login unless Anthropic has approved them. A login token is supported here for
the account that runs foldrun; check that the terms cover your use before you
rely on it.

An agent's own shell can read an API key, as it can when you run Claude Code
with one in your shell; it cannot read a login token, which Claude Code keeps
to itself. Script tools and `verify:` commands see neither.

An agent gets the tools its files grant and nothing of the machine it runs
on: a local run does not load the MCP connectors of whoever is signed in to
claude.ai or Claude Code there, nor any MCP configuration on disk.

## Commands

| | |
|---|---|
| `foldrun init [dir]` | create an account folder with one workspace in it — `--workspace <name>` names it, `--flat` makes the older single-folder shape |
| `foldrun new <name>` | another workspace in this account — blank: an `AGENTS.md` and empty `agents/` and `flows/`. `--starter` adds the example researcher, writer and `publish` flow; `--from <template>` copies a template |
| `foldrun agent new <name>` | one more agent inside a workspace, with the frontmatter the format requires — and every key explained beside it. Also `foldrun flow new <name>`, whose first step names an agent this workspace already has, and `foldrun tool new <name>`, which writes a `transport: script` folder with its program in a file beside the definition (`--transport script\|http\|mcp`, `--language javascript\|python\|bash`). In an account with more than one workspace, `--to <name>` says which; inside one, it is already known. The templates are the same ones the dashboard's New button writes, so what is scaffolded is what `foldrun check` accepts |
| `foldrun agent new <name> --platform` | the dashboard's **New agent** on the DEPLOYED workspace (`POST …/agents { name, description, model }`): the platform writes its own template as a revision, and nothing is written in this folder. `--to <workspace>` (or the folder you stand in), `--description "…"`, `--model fast\|default\|max`. Without `--platform`, `--to` keeps naming a workspace of this account folder. Also `flow new <name> --platform` (`POST …/flows { name, pattern }`, `--pattern pipeline\|review-loop\|fan-out\|debate\|router`, default `pipeline`) and `tool new <name> --platform` (`POST …/assets { kind: "tools" }` — a `script` tool as here unless `--transport`/`--template` says otherwise; `--template` also takes a gallery entry, `--language`). `foldrun pull` brings them down |
| `foldrun agent ls` | the agents deployed in a workspace — name, model, description (`GET …/agents`); `flow ls` the flows and how each fires (`GET …/flows`). `--to <workspace>`, `--json` for the list as the platform returns it |
| `foldrun guide` | the coding-agent rules, copied from what Next.js does: a short managed block in the account's `AGENTS.md`, between `<!-- BEGIN:foldrun-agent-rules -->` markers, telling a coding agent (Claude Code, Cursor, Codex) to read `foldrun docs` before it writes an agent, flow or tool, and a `CLAUDE.md` that imports it with `@AGENTS.md`. `foldrun init` writes them, `foldrun pull` refreshes them, and `foldrun check` re-adds them when a coding agent runs it and they are missing or old — as `next dev` does. Only the block is rewritten, in place; text around it is kept. The runtime strips the block, so the agents that run in the account never see it; the rest of `AGENTS.md` stays their shared context. `--check` exits 1 when the block is missing or old (for CI), `--print` writes it to stdout |
| `foldrun docs [page]` | these docs, from the copy that ships inside the CLI — the way Next.js ships `node_modules/next/dist/docs` — so a coding agent reads the version it is driving, offline. No page lists them; `foldrun docs flows` prints one; `--path` prints the folder. Design records and the platform operator's routes are left out |
| `foldrun check [dir]` | validate agents, flows, tools, evals, knowledge — offline. At an account root: every workspace, then the shared library. Includes each agent's colleagues: an `agents:` or `subagents:` name that is not an agent, a sub-agent with no `description:`, a sub-agent that would hold none of its tools inside its parent's. Signed in, it also asks the platform's open `/api/version` which Chrome its runner image has, and warns when a pinned `web.browse.user_agent:` claims another major ([why](tools#how-this-agents-browser-presents-itself)); it warns about the old `web.browse.session:` key too (now `vendor_session:`) |
| `foldrun extract [dir]` | move each single-file script tool — a `tools/<name>.md` with its program in a fenced block — into a folder: `tools/<name>/tool.md` with `run:` pointing at `run.js`, `run.py` or `run.sh` beside it. Frontmatter is edited as text, never re-serialised, so the diff is only what moved. A tool that already has a folder is left for you; `--dry-run` lists what it would do |
| `foldrun check --to <ws>` | validate the copy that is DEPLOYED, rather than the folder in front of you — a workspace edited through the API, by an agent or by `foldrun source put`, has had no way to be checked short of spending a run. The files are fetched into a temporary folder and the ordinary check runs over them, so there is one copy of the rules; the output names the workspace and the platform it checked |
| `foldrun agent run <name>` | run one agent once on a platform, with no flow file: a flow of one step. `--task "…"` is the instruction and is required. Prints the run id and how to follow it; `--wait` holds on (in 25-second pieces, as `invoke` does) and then prints the same report `foldrun report` would; `--test` makes it a [test run](runs#test-runs) |
| `foldrun agent link <agent>` | add to an agent's team, in its own frontmatter — `--subagent <worker>` (`subagents:`, a worker it delegates to), `--consult <agent>` (`agents:`, a colleague it asks) or `--can-ask` (`ask` in `tools:`, so it may ask you mid-step). The edit is core's, the one the canvas's docks make: only the lines of that one list change, flow style stays flow style, comments and the prose stay byte for byte. A sub-agent without a `description:` needs one, because the model picks a sub-agent by it — asked for at a terminal, `--description "…"` otherwise, and written into the worker's file first. Says which flows use the agent ("used by 3 flows"), since the change reaches all of them. Prints the diff, and refuses an edit `foldrun check` would call an error; `--dry-run` writes nothing. In this folder by default (`--workspace <name>` in an account with several); `--to <workspace>` edits the deployed copy through `PATCH /api/workspaces/<ws>/agents/<name>`. In this folder it re-reads each file just before writing — after the description prompt, after `check` — and refuses, writing nothing to either file, when one changed since it was read |
| `foldrun agent import <workspace>/<agent>` | copy an agent you already have in another workspace into this one: its `agent.md` and own `skills/`, `scripts/`, `knowledge/` — never `memory/`, `outputs/` or `state/`. Into the workspace you stand in, or `--workspace <name>`; `--as <name>` imports it under another name (and rewrites `name:`), which a name clash requires. `--to <workspace>` does it on the platform (`POST /api/workspaces/<ws>/agents/import`) and lists the tools, skills, scripts and secrets the copy uses that the workspace lacks. See [Importing an agent](workspaces#importing-an-agent-you-already-have) |
| `foldrun agent import --list` | what could be imported into a deployed workspace: every other workspace this key may read, and each one's agents with their descriptions (`GET …/agents/import`). Imports nothing. `--to <workspace>`, `--json` |
| `foldrun agent unlink <agent>` | take one away: `--subagent <name>`, `--consult <name>` or `--can-ask`. An emptied list is written `key: []`, not deleted. In this folder, refused the same way, nothing written, when the file changed since it was read |
| `foldrun flow add <flow> <pattern>` | one palette block from the [flow canvas](flows#editing-on-the-canvas), as the same markdown edit the canvas writes (core's `flow-patterns`): `chain` (alias `step`: `--agent <name>`, `--instruction "…"`, `--after <n>` or `--before <n>`, default last), `parallel` (`--agent`, `--group <n>`), `router` (`--agent <triage>`, `--cases BUG=bugs,DOCS=docs`, `--else <agent>`, `--after`), `fan-out` (`--step`, `--each lines\|items\|"rows of <path>"`, `--max <n>`), `loop` (alias `evaluator`: `--step`, `--loop <n>` default 3, `--until <MARKER>` default APPROVED, `--judge "<claim>"` adds `verify: judge:`), `approval` (`--step`; the `!` marker, `approve: true` on a `?` step), `ask` (`--step`, `--question "…"`), `wait` (`--step`, `--wait 30m\|event`), `rescue` (`--step`, `--on-fail <agent>`), `subflow` (`--flow <other>`, `--after`). `--step` is the step's place in the file (1 = the first step line) or the agent it runs; `--off` takes a step pattern back off. Prints the diff, runs the rules `check` runs over the result and refuses — writing nothing — an edit that would add an error; one that was there before does not block it. `--dry-run` shows the diff and writes nothing. In this folder by default; `--to <workspace>` edits the deployed copy through the canvas's own route (`PATCH …/flows/<flow>` with `{ edit }`), and the sha256 of the file it read as `expect`: one edited meanwhile is refused (`409`), nothing written. In this folder it re-reads the file just before writing — after the y/N, after `check` — and refuses the same way, writing nothing, when it changed since it was read |
| `foldrun flow rm-step <flow> --step <n\|agent>` | delete one step, as the canvas's × does (core's `removeStep`): the step line and its indented options go, the groups after an emptied one renumber, prose and the agent's file are untouched. Says what else changes first (`case:`/`when:` steps that will route on the step before, the renumbering), prints the diff, refuses one `foldrun check` would call a new error, then asks — no terminal needs `--yes`. `--step` is the step's place in the file (1 = the first step line) or the agent it runs. `--dry-run` writes nothing; `--to <workspace>` sends the canvas's `PATCH …/flows/<flow>` with `{ edit: { op: "remove", step } }`, and the sha256 of the file it read as `expect`: one edited meanwhile is refused (`409`), nothing written. In this folder it re-reads the file just before writing — after the y/N, after `check` — and refuses the same way, writing nothing, when it changed since it was read |
| `foldrun flow dup-step <flow> --step <n\|agent>` | duplicate one step, as the canvas's Duplicate (Cmd/Ctrl+D) does (core's `duplicateStep`): a copy of the step line — its `?`/`!` marker and every indented option — goes directly under it with the same group number, so the copy runs in parallel with the original; nothing else moves. Prints the diff and refuses one `foldrun check` would call a new error; additive, so it does not ask. `--dry-run` writes nothing; `--to <workspace>` sends `PATCH …/flows/<flow>` with `{ edit: { op: "duplicate", step } }`, and the sha256 of the file it read as `expect`: one edited meanwhile is refused (`409`), nothing written. In this folder it re-reads the file just before writing — after the y/N, after `check` — and refuses the same way, writing nothing, when it changed since it was read |
| `foldrun flow show <flow>` | the flow as the canvas draws it, in a terminal: the trigger, then one block per group — parallel steps listed under their group number — each step with its chips (`approve`, `optional`, `when:`, `case:`/`else`, `each:` ×max, `loop … until`, `verify:`, `retry`, `wait`, `ask:`, `on-fail →`, `model`), and under it its agent's team: `↳ sub-agent`, `· consults`, `may ask you`. What `foldrun check` says about a step or its agent is printed on it, red for an error; exits 1 when there is one. Plain text, no colour, when the output is not a terminal. `--to <workspace>` shows the deployed copy |
| `foldrun flow run <flow>` | start a flow on the platform — the same command as `invoke`, spelled the way `agent run` is. `foldrun run` runs HERE; `flow run`/`invoke` run a flow on the platform; `agent run` runs one agent there |
| `foldrun flow rotate-hook <flow>` | a new webhook URL for the flow (`POST …/hooks/<flow>/rotate`). The old URL stops working the moment it returns, so it asks first — `--yes` with no terminal. Prints the new URL, which is itself a credential |
| `foldrun flow set <flow> --step <n\|agent> key=value …` | the step editor on the Flows page, from a terminal (core's `updateFlowStep`, and `updateFlowStepInstruction` for `instruction=`): `model`, `effort`, `retry`, `timeout`, `verify`, `when`, `case`, `else`, `loop`, `until`, `each`, `max`, `limits` — only the keys named are touched, `key=` clears one. `each=` takes `lines` only; the other fan-outs are `flow add … fan-out`. A value the rewriter would drop or clamp is refused, nothing written: `effort` one of low, medium, high, xhigh, max (or an alias core reads, e.g. `deep`); `timeout` a whole number of seconds (`timeout=900`, not `15m`); `retry` 0–5, `loop` 1–5, `max` 1–20, whole numbers. Shows the diff, refuses an edit `check` would call a new error, `--dry-run` writes nothing; `--to <workspace>` sends the editor's `PATCH …/flows/<flow> { step, options }` / `{ step, instruction }` with `expect` |
| `foldrun flow trigger <flow> manual\|webhook\|schedule` | the trigger picker on a flow card (core's `setFlowTrigger`): only the `trigger:`, `schedule:` and `timezone:` lines change. `--schedule "0 9 * * 1"` (5 fields, or `@daily`) and `--timezone <zone>` go with `schedule`. Diff, checked, `--dry-run`; `--to` sends `PATCH { trigger }` |
| `foldrun flow move-step <flow> --step <n\|agent>` | dragging a card on the board: `--group <g>` runs it beside group g, `--after <g>` gives it a group of its own after g (`0` = first). Only step numbers change (core's `reorderFlowSteps`). Diff, checked, `--dry-run`; `--to` sends `PATCH { groups }` |
| `foldrun flow copy-step <flow> --step <n\|agent>[,<n>…]` | the canvas's Copy: the steps' markdown — line, marker and every option (core's `stepSource`) — on stdout. Reads only |
| `foldrun flow paste <flow>` | the canvas's Paste: step markdown from stdin or `--file <path>` goes in as new groups after `--after <g>` (default last), or beside group `--group <g>`, renumbered to fit (core's `pasteSteps`) — `foldrun flow copy-step a --step 2 \| foldrun flow paste b`. Diff, checked, `--dry-run`; `--to` sends `PATCH { edit: { op: "paste" } }` |
| `foldrun flow draft "<what it should do>"` | **Draft with AI**, on the platform (`--to <workspace>`; `--flow <name>` redrafts an existing flow): `POST …/flows/draft` has a model write the flow and any agent files it needs, checks and repairs once, and the CLI prints the notes, every file as a diff and what the check still finds. Nothing is saved until you say yes — `--yes` on a pipe, `--dry-run` never; on a pipe without `--yes` it saves nothing and exits 1, though the draft call was made and charged; each file goes through `PUT …/source` with `ifMatch`, so one that changed meanwhile is refused. One model call, charged like a step |
| `foldrun tool test <name>` | exercise one tool, alone — no model, no run, no flow. The real thing runs: the HTTP request against the declared `base:`, the script with the workspace's secrets in its environment, the MCP handshake. Prints the transport, whether it exited cleanly, how long it took, everything the tool printed, and any secret it needed by NAME and never by value. Its arguments are `key=value` pairs, one per argument the tool declares, and `--path` is an http tool's probe path. It waits five minutes by default, because a tool that crawls takes as long as it takes — `--timeout <seconds>` waits longer, and a test given up on says so rather than claiming the tool failed |
| `foldrun run <target>` | run an agent or a flow HERE, on this machine (`name`, or `flow:name`) — `--test` for a [test run](runs#test-runs). On a platform: `flow run`/`invoke` for a flow, `agent run` for one agent |
| `foldrun eval [name]` | one eval, or all of them. `--to <workspace>` runs the DEPLOYED workspace's evals on the platform (`POST …/evals/<name>/run`), waiting for each verdict, and prints the same lines; exits 1 when a case fails |
| `foldrun eval new <name>` | the Evals page's New, on the deployed workspace (`POST …/evals { name }`): an eval whose `agent:` is the workspace's first agent and whose case is a placeholder — edit it (`source cat`/`put`), then `foldrun eval <name> --to <workspace>` runs it. `--to <workspace>` |
| `foldrun promote <run-id>` | keep a finished run as a regression case: its task and what the next run must still say go into `evals/<target>-regressions.md` (or `--eval <name>`), appended when the file exists. `--expect "contains: $34"` — repeatable, eval syntax — replaces the default judge line that holds the next run to the recorded conclusion; `--case <name>` names the case |
| `foldrun probe <model>` | can this model hold a tool loop here? A live check |
| `foldrun logs [run-id]` | recent runs in one workspace, or one run's whole event trail. `--local` reads this machine's store even when signed in; `foldrun runs --local` is the same command and prints the same thing |
| `foldrun runs` | what has run lately across the whole account: when, workspace, flow, status, steps done, how long, what it cost and the run's own one-line summary. A completed run shows its verdict beside the status — `GOOD`, `BAD`, `QUIET`, or `BLOCKED` in red with a ⛔ mark. `--status failed`, `--verdict blocked`, `--since 24h`, `--to <workspace>`, `--limit <n>`. `--local` prints exactly what `logs --local` prints — this machine's runs, one workspace |
| `foldrun runs rm <run-id>` | erase a run from history: its record and its archived outputs. A run still in flight is stopped first. The ledger line stays — money is not deleted because a trace was. Asks first; `--yes` with no terminal |
| `foldrun report <run-id>` | one run, whole, without opening the dashboard: the header, then every step with its group, agent, attempts, the runner image it ran on (`slim · browser pod` when it browsed through the account's pod from slim), cost, duration, what happened to the browser pod under it (reconnects, `browser pod lost; re-ran on full` with its tries — `slim · lost` then `full` — or why it was not re-run), whether its `verify:` held and the first line of what it said — and for a failed step, the error and the last events before it. Then what it wrote, what it published and what is still waiting on a person. `--json` prints the run record instead |
| `foldrun report <run-id> get <agent>/<path>` | download one file the run archived — whatever that agent left in `outputs/`, copied under the run when it ended. Writes it beside you under its own name; `--file <path>` names somewhere else (`-` for stdout), `--force` overwrites |
| `foldrun report <run-id> live` | the run page's live browser view: which agents' browsers have posted a frame, and when; `--agent <name>` saves the newest frame as a JPEG (`--file <path>`, `-` for stdout) and prints the page's address, the engine and whether the browser has closed (`GET …/runs/<id>/live`) |
| `foldrun approvals` | every gate waiting on a person, anywhere in the account: which workspace, flow and run, which step and agent, the question, how long it has been waiting and which files under `storage/` the gate previews — and, first, every question an agent is asking mid-step, with its choices. `--to <workspace>` narrows it |
| `foldrun approve <run-id>` | release a waiting gate. Approving is outward — the step behind it publishes, sends or posts — so it prints what it is about to release and asks you to type the run id back, unless `--yes`. `--note "…"` is read by the agent as guidance, `--step <n>` decides one gate of several. `--payload <json\|text\|@file>` releases a step parked on `wait: event` with that body instead, as its event URL would — the trace names you, not "an external event" |
| `foldrun reject <run-id>` | refuse one, failing the step and the run with it. `--note` is the reason, and it goes on the trace |
| `foldrun stop <run-id>` | kill a run in flight: the queued job is dropped and the sandbox the current step is spending in is destroyed. It prints which step is running and what has been spent, then asks you to type the run id back unless `--yes`. Finished steps keep their results, and costs already incurred stay on the bill. A run that has already finished is said so, not stopped. With no run id and a filter — `--status running,queued`, `--since 2h`, `--until 1h` (started before then: a span ago, or a date), `--flow <name>` — it stops every run that matches (`POST …/runs/bulk`), in `--to <workspace>` or across the account: it lists what matches first, asks, and then stops exactly the runs it listed, so one that starts in between is not swept up. `--dry-run` lists and touches nothing. The route refuses more than 100 at once |
| `foldrun answer <run-id> "…"` | answer the question an agent is asking mid-step (`tools: [ask]`). `--option <n>` picks one of the choices it offered; `--question <id>` one of several. The agent is waiting in its sandbox and carries on at once. `foldrun approvals` lists what is being asked |
| `foldrun message <run-id> "…"` | say something to a running agent. It reaches the model after its next tool call, as context — it changes none of the step's tools. `--step <n>` picks one when a parallel group has several running. Platform only |
| `foldrun secrets set NAME` | store a secret — also `ls`, `rm`, and `status` (OAuth grant health) |
| `foldrun secrets set NAME --kind <k>` | the other shapes the Connections form stores: `file` (`--file <path>`), `ssh` (`--host`, `--user`, `--port`, `--key-file <path>` or a prompted password), `api` (`--base-url`, `--header "Name: value"` repeatable), `service-account` (`--file <key.json>`, `--scopes`), `m2m` (a client-credentials app: `--token-url`, `--client-id`, `--scopes`, the secret prompted). On the platform, or this machine's vault with `--local` |
| `foldrun secrets clients` | the OAuth clients saved on the platform — what a consent runs from without typing the client again; the client secret is never shown. `clients add <name> --provider google\|github\|microsoft\|linkedin` (or `--authorize-url` / `--token-url`) `--client-id … --scopes …` saves one (secret prompted), `clients rm <name>` removes it |
| `foldrun connect NAME` | OAuth sign-in from the terminal, stored as an auto-refreshing secret — `--provider google\|github\|microsoft\|linkedin`; reconnecting a secret whose client is saved asks for nothing (`--new-client` to enter one) |
| `foldrun connect NAME --client <saved>` | the Connections page's **Connect**: a consent from a client saved on the platform, returning to the platform's own callback, which stores the grant as NAME (`--to <workspace>` for a workspace's). Opens the browser (`--no-browser` prints the address) and waits for it to land |
| `foldrun deploy [dir]` | push this account into an installation — every workspace and the shared library. `foldrun deploy <workspace>` pushes one. Never removes a workspace the platform has and the folder does not. It first prints where it is going and as whom (`deploying to <url> as <profile> (<email>)`); a deploy that would delete files the folder no longer has lists them and asks — what runs wrote (`storage/`, `state/`, the trigger log) is never deleted, so never listed. The confirmed list goes with the deploy; if the platform would now remove anything else it refuses and the CLI asks again. With no terminal (a script, a CI job, a coding agent) it refuses unless `--yes`. A deploy that only adds or changes files asks nothing |
| `foldrun help <command>` | that command's usage and options. `foldrun <command> --help` and `-h` print the same and never run the command |
| `foldrun pull [workspace]` | bring the platform's account down into this folder — refuses to overwrite a locally edited file, and names every one it would have taken (`--force` takes them) |
| `foldrun export [workspace]` | a deployed workspace as a `.zip` — agents, flows, tools, skills, scripts, evals, knowledge; never memory, state, storage or a secret's value. `--flow <name>` exports that flow with every flow and agent it runs and the tools, skills and scripts they grant; `--agent <name>` that agent and what it grants. Written under the name the platform gives it (`<ws>.zip`, `<ws>-flow-<name>.zip`); `--file <path>` (`-` for stdout), `--force` to replace (`GET …/export`) |
| `foldrun import <file.zip>` | take a package in: first shows what it adds, what is identical, what it would replace and what it still needs (secrets, tools, skills, scripts, agents, flows), then asks. Never deletes; replacing a file needs `--overwrite`. `--to <workspace>` (a name that does not exist makes it, from a workspace package), `--dry-run` previews only (`--json` for the plan), `--yes` with no terminal (`POST …/import`) |
| `foldrun status [workspace]` | per workspace: what is added, changed and only-on-the-platform, plus which files moved there since your last deploy from here. Reads only |
| `foldrun status --platform` | is the platform up: overall, each component (dashboard and API, run workers, scheduler, model providers, email, storage) and any incident or maintenance the operator posted, with its latest update. Reads the open `/api/status` — no key needed; the signed-in platform, `--url`, or app.foldrun.io. `--json` prints the answer as is. Exits 1, saying *status unavailable — the platform may be down*, when it does not answer. Plain `foldrun status` opens with the same one-line verdict |
| `foldrun status --platform --history` | what the status page draws as bars: each component's uptime over the window and a mark per day — up, degraded or maintenance, an outage, or no samples — then the incidents and maintenance in it, from the open `GET /api/status/history?days=<n>`. `--days 1-90` (default 90), `--json` |
| `foldrun workspaces` | what exists here, what exists on the platform, which are both — also `new <name>`, and `rm <name>` (locally; `--platform --yes` deletes it there). `--json`: `{ platform, workspaces: [{ name, here, platform }], error? }`, exit 1 when the platform could not be read |
| `foldrun workspaces show <name>` | what is deployed in one workspace (`GET /api/workspaces/<name>`): its agents with model and description, its flows and how each fires, and its files counted by top-level folder. `--json` for the document |
| `foldrun workspaces new <name> --platform` | the dashboard's **Create workspace**: blank — an `AGENTS.md` and nothing to delete (`POST /api/workspaces { name, template: true }`) — or `--starter` for the example researcher, writer and publish flow (`{ name, starter: true }`). The plan's workspace count applies. Without `--platform` it makes the folder here, as `foldrun new` does |
| `foldrun workspaces demo` | **Try the demo pipeline**: makes the `demo-pipeline` workspace on the platform — a four-step flow with a parallel pair, an approval gate and a pretend CRM tool (`POST /api/workspaces { demo: true }`) |
| `foldrun library` | the account's shared library on the platform, as the Library page shows it: `ls [skills\|tools\|scripts\|knowledge\|memory]`, `cat <kind>/<path>`, `put <kind>/<path>` (from `--file`, else stdin), `new <kind>/<name>` (the Library page's New, `POST /api/library/<kind> { name, template, language }`: the platform's template — `--template` a transport or a gallery entry, `--language` for a script tool), `rm <kind>/<path>` (asks). `deploy` still pushes the whole of it |
| `foldrun find <words>` | the dashboard's ⌘K search: workspaces, agents, flows, tools, skills, knowledge, memory and runs across the account, ranked the same way (`GET /api/search`; `--json`) |
| `foldrun invoke <flow>` | start a flow on a running platform — `--watch` follows its trace here; `--test` makes it a [test run](runs#test-runs) `--once <key>` sends the key as the run's idempotency key, so a CI step that retries after a dropped response is answered with the run it already started instead of paying for a second. `--tag <t>`, repeatable, labels the run (the API's `tags`). `--inputs <name>` sends a saved input set as the task — a case of `evals/<flow>-inputs.md` or of an eval that runs the flow, as the platform has it (see [Run with saved inputs](flows#run-with-saved-inputs)). `foldrun flow run <flow>` is the same command |
| `foldrun source <verb>` | one workspace file on a platform: `ls [dir]`, `cat <path>`, `put <path>` (from `--file`, else stdin; `--message` goes on the revision), `new <kind> <name>`, `mv <from> <to>`, `rm <path>` — the editor's own door, so every write is a revision. `new` is the dashboard's New button for any document (`POST …/assets { kind, name, agent?, template?, language? }`): `tools`, `knowledge`, `memory`, `skills`, `scripts` (and `agents`, `flows`, `evals`), the template written by the platform; `--agent <name>` puts a knowledge, memory, skill or script document inside that agent. For a whole tree, `deploy` |
| `foldrun open [page]` | the dashboard for this workspace, in the browser (`runs`, `agents`, `graph`, `repo`…) |
| `foldrun login` | sign this machine in from the browser — no key to copy |
| `foldrun login <site> --url <address>` | a browser window to sign in to a site by hand; the session is stored for an agent |
| `foldrun logout` | forget this machine's key, and revoke it if `login` made it |
| `foldrun whoami` | who you are on the platform: account, role, which workspaces |
| `foldrun team` | who is in the account (`GET /api/team`): each member's email, role (the owner marked), the workspaces they may open — a scoped key sees only the ones it shares — and when they joined. `--json`. Read-only on purpose: inviting, changing a role, removing someone and transferring the account are a signed-in person's, in Settings → Team, and the platform refuses them from a key |
| `foldrun onboarding` | the account's getting-started steps — workspace, agent, a run, a run that completes, a secret, a schedule or webhook, a teammate, billing where the plan asks for it, the CLI — each worked out from what is really there, with the next one first and where to do it (`--json`). The dashboard card is hidden per person from the dashboard |
| `foldrun preferences` | your own settings on the platform — today the theme (`system`, `light`, `dark`), kept with you on every browser; `preferences set theme dark` changes it (`/api/me/preferences`; a key acts for whoever minted it) |
| `foldrun api spec` | the platform's OpenAPI 3.1 document, from `GET /api/openapi.json` (no key needed) — to stdout, or `--out <file>`. Every other command sends `Foldrun-Version` (the API version this CLI was built for), an `Idempotency-Key` on each write (reused on its own retry), and waits out one `429` for `Retry-After` before saying so. See [Using the API](api-usage) |
| `foldrun api version` | Settings → API: the API version this account's requests get when they send no `Foldrun-Version`, whether it is pinned, every version still served and the rate limits. `api version pin <YYYY-MM-DD>` pins it, `unpin` goes back to current (`PATCH /api/account/api`; an admin's) |
| `foldrun changelog` | What's new: the platform's release notes, newest first — features, fixes, docs — and which release this install runs (`GET /api/changelog`; `--limit <n>` up to 50, `--json`) |
| `foldrun version` | this CLI's version, its `@foldrun/core`'s, and — when a platform is known (`--url`, `--profile`, `FOLDRUN_URL` or where you signed in) — that platform's: version, release time, API version, each component's commit and the browsers its runner image has (with versions where known: `chrome 154.0.8037.58`), from `GET /api/version` (no key needed). Warns when the platform was released with a newer CLI than this one. An unreachable platform is a dim line, not a failure. `--json` prints `{ cli, core, platform }`. `foldrun --version` (or `-v`) prints only the CLI's version, offline. See [Versions and releases](versions) |
| `foldrun doctor` | check the road to the platform, one line each: Node (22 or newer), the CLI and core versions, which of `FOLDRUN_URL`, `FOLDRUN_TOKEN`, `FOLDRUN_TIMEOUT`, `HTTPS_PROXY` are set (never their values), which model credential a local run would use (by its variable, never its value), the account it would act as, DNS for the platform's host, and a timed `GET /api/healthz`. The first thing to run when a command cannot reach the platform |
| `foldrun storage <verb>` | what a workspace PRODUCED, as opposed to what you wrote — `source` is the other half. `ls [prefix]` lists every file with its size, when it was written, how long ago and which run wrote it (`run:<id>`, `user:<email>` for an upload, `api-key` for a key), newest first, plus what the store holds against its quota. `cat <path>` prints a text file and refuses one that is not text; `cat <path> --preview` asks the platform to read it instead and prints what is in it — a PDF or Word document as paragraphs, a spreadsheet or CSV as a table, a deck as slides, an archive as its listing. `get <path>` downloads it beside you — `--file <path>` names somewhere else, `--force` overwrites. `put <file|folder>...` uploads any files, of any type, into storage under their own names, walking folders whole (`.git`, `node_modules` and `.DS_Store` are skipped); `--into <folder/>` puts them under a folder, `--as <path>` renames a single file, and large files go straight to the bucket by a presigned URL, so size is not capped by the platform's request limit; `rm <path>` removes one. `share <path>` mints a public link to one produced file (7 days; `--ttl <days>`, `--forever`) and prints the URL; `shares` lists the live links (`--all` includes expired and revoked); `unshare <token>` revokes one — the link answers 404 from then on and the token is never reused. `--to <workspace>` from anywhere; inside a workspace folder it is already known |
| `foldrun runtimes` | the environments a deployed workspace's agents need — each distinct `runtime:` (an agent's own merged with its tools'), the packages in it, which agents use it, and whether the platform has built it: ready, building, or failed with the installer's own error. `foldrun deploy` prints the same thing after a deploy and waits up to two minutes for builds in progress (`--no-runtimes` skips the wait); this asks again later, and `--wait` holds on while any is building. Exits 1 when one has failed. `--to <workspace>` from anywhere |
| `foldrun schedule` | every flow in the account whose `trigger:` is a clock: workspace, flow, the cron line, its timezone, how many steps, whether the scheduler can parse it, and the next three times it fires. The times are the point — `0 5 1-7 * 5` reads as "the first Friday" and fires eight times in twenty-eight days, because day-of-month and day-of-week are OR'd. Exits 1 if any line is unparseable, since an invalid schedule errors nowhere and simply never runs. `--to <workspace>` narrows it |
| `foldrun schedule tick` | Settings' **Run scheduler now**: fire whatever is due this minute and print which flows went (`POST /api/schedule`). They were due anyway; this only makes them go now |
| `foldrun rerun <run-id>` | the same flow again, from a step: `--from <n>` as the flow file numbers them, or `--agent <name>` for the first step that agent runs. Earlier steps are recorded as skipped. This is the debug loop from the terminal: fix the file, `deploy`, `rerun --from` the step that failed. `--wait` follows the new run like `invoke --wait`; `--to <workspace>` from anywhere. With no run id and a filter (`--status failed`, `--since 24h`, `--until 2h`, `--flow <name>`) it reruns every match from `--from <n>` (default 1), listing and asking first as a bulk `stop` does; `--dry-run` lists only |
| `foldrun triggers` | why nothing ran. One row per flow that fired in the window: its trigger, how many fires became runs, when it last ran, and every reason for the difference with a count — a duplicate delivery, a throttled or debounced burst, a fire the platform slept through, an `overlap: skip`, a flow switched off by `disable_after:`. A switched-off flow is a non-zero exit; one successful run clears it. `--since <days>` (default 7), `--to <workspace>` |
| `foldrun observe` | where the account fails, retries and spends: one row per workspace — runs, failed and what share, steps, cost — then the recent failures in their own words. `--to <workspace>` prints that workspace in full, as the Observe page does: per flow (runs, failed, p50/p95 duration, cost), per agent (failed, retried, skipped, p95), per tool (calls, errors, p95 latency, which agents use it). `--since <days>` (default 30), `--json` for the document |
| `foldrun usage` | what the account consumed — runs, steps, tokens, compute, storage, per workspace — and what it was charged over `--days <n>` (default 56) from the ledger, per workspace with the change against the period before. `--json` for both documents |
| `foldrun billing` | the account's balance, whether billing is on at all, what the platform is currently waiving, and the recent ledger entries with what each was for — a run names its workspace, flow and run id; an adjustment carries its own note. `--limit <n>` shows more. `statement [YYYY-MM]` is a month of the ledger (this month by default) — `--csv` for the file an accountant wants, to stdout or `--file <path>`. `wallet` is the burn, the runway and auto top-up; `wallet set auto-top-up --threshold <usd> --amount <usd>` turns it on (a refill of 5–500), `set auto-top-up off` turns it off, `set email <address>` is where receipts go. `details` is who invoices are made out to; `details set --name "…" --abn … --address "line1, city, state, postcode, AU" --email …` changes it, merged with what is there. `portal` prints a link to Stripe's billing portal. Changing the wallet, the details, and the portal are the account owner's; anyone else is told so |
| `foldrun billing plans` | the Plans page: every plan with its monthly fee, credits, runs at once and workspaces, which one the account is on and this cycle's credits left (`GET /api/billing/plans`). `billing plan <id>` chooses one — a first plan answers with Stripe's checkout page, a change on a live plan is prorated at Stripe at once (asks first; `--yes`); `plan cancel` stops it at the end of the cycle, `plan resume` undoes that until then (`POST`/`DELETE /api/billing/subscribe`) |
| `foldrun billing top-up <usd>` | the Payment page's top-up: Stripe's checkout page for that amount, opened in the browser (`--no-browser`, or no terminal, prints it). The credit lands when Stripe confirms the payment. `billing card` is the same for saving a card for auto top-up. Both need `billing:manage` |
| `foldrun billing credit <usd>` | put credit on the balance by hand (`POST /api/billing { usd, note }`, `--note "…"` on the ledger line) — only on an install without Stripe, a self-hosted or dev platform; once billing is live the platform refuses it and top-ups go through `billing top-up`. Needs `billing:manage` |
| `foldrun gallery` | the tools the platform ships to every account (`web`), and for each whether this account keeps its own copy and whether that copy still matches. `pull` lays the shelf down under `~/.foldrun/gallery/<host>/` for offline runs (`foldrun run` and `foldrun eval` refresh it themselves before each run); `upgrade <tool>` replaces the account's copy with the current gallery version, the old one a revision back |
| `foldrun account` | the account's own defaults — the AGENTS.md frontmatter every workspace under it inherits: `timezone`, `notify`, `budget`, `concurrency`. `foldrun account set timezone Australia/Sydney`, `set notify email you@example.com` (`--events failed,awaiting-approval,completed`), `set notify url https://…`, `set budget 60/month`, `set concurrency 4`, and `clear <key>` to unset one. `set notify` merges against what is there, because the platform replaces the whole block. `providers` lists the model providers the account's files use and the last daily key check — `--check` asks now, and a dead key is a non-zero exit. `model` is the account's own model key, what every step runs on unless a `provider:` block names another: `foldrun account model` shows it (never the key, only its last four; exit 1 when there is none and runs are refused), `model set <provider> --key <api key>` sets it — a preset name (anthropic, openrouter, openai, groq, …) or `custom --base-url https://… --format anthropic|openai`, `--key -` reads the key from stdin — and `model remove` removes it; a Claude login token is refused for any account not allowed the platform's own credential. `export` downloads everything the platform holds about the account — workspaces, runs, members and the whole ledger — as one JSON file (owner only; `--file <path>`, `--force`). Singular — `accounts` below is the list of logins on this machine |
| `foldrun workspace` | one deployed workspace's own settings (`--to <workspace>`): description, timezone, budget and notify, read from its `AGENTS.md` — unset means the account's. `set timezone <tz>`, `set budget 20/week`, `set notify email <address>` / `set notify url <https://…>` (`--events`; merged with what the file says), `set description "…"`, `set name <new>` — a rename changes every webhook URL, so it asks first and names the flows whose URLs changed — and `clear <key>`. Singular — `workspaces` is the list |
| `foldrun workspace vocabulary` | what the dashboard's editor completes as you type in a workspace (`--to`): agents, flows, skills, tools, secrets (names only), scripts, document types and linkable documents (`GET …/vocabulary`; `--json`) |
| `foldrun notify test` | send one test notification to whatever the workspace's `notify:` resolves to, and print what happened — the provider's own words when it failed ("domain not verified"). Exits 1 when it did not go. `--to <workspace>` |
| `foldrun webhooks deliveries` | the `notify:` webhooks a workspace sent, newest first: event, status (`delivered`, `retrying`, `failed`, `skipped`), attempts, the last answer and the delivery id — and a switched-off endpoint first, with the way back. `--failed` for the ones that gave up, `--status <s>`, `--event <e>`, `--limit`, `--offset`, `--json`. `--to <workspace>` |
| `foldrun webhooks redeliver <id>` | send one delivery again now, with the same `X-Foldrun-Delivery` id; prints the attempt and exits 1 when it was refused. `--to <workspace>` |
| `foldrun notifications` | what mail you get, category by category: `always` for the required ones (security, invites, billing, account), `on`/`off` for the rest, and the workspaces where run alerts or approvals differ. `--json` |
| `foldrun notifications set <category> on\|off` | turn one category off, or back on — account-wide, or for one workspace with `--to <workspace>` (`run-alerts`, `approvals`). A required category is refused with the reason |
| `foldrun flags` | the feature flags for this account: each one `on` or `off` and why — `account` (set for this account), `global` (set for every account), `rollout` (a share of accounts, with its percentage) or `default` — and what it does. Read-only: only the platform's super admin changes a flag, in the console. `--json` for the API's answer as it came. See [Feature flags](feature-flags.md) |
| `foldrun history [path]` | every change to a deployed workspace, newest first: revision id, when, who, the message and the files. A path narrows it to one file; `--id <revision>` prints that revision as diffs; `--limit <n>`; `--to <workspace>` |
| `foldrun history restore <path> --id <revision>` | the History drawer's **Restore this version**: the file is rewritten with that revision's text as a new revision, `restored <rev> from history`, so the restore is itself undone the same way. Shows the diff against the file now and asks (`--yes`, `--dry-run`); sent with `ifMatch`, so a file that changed since is refused (`--to`) |
| `foldrun repo ls` | a workspace's repository: main, its branches and tags with their last commit, and the mirror. `repo diff <branch>` is what a branch changes against main; `repo deploy <commit\|branch\|tag>` makes that tree live (a rollback is a new commit on main, itself undoable); `repo merge <branch>` merges into main and deploys. Deploy and merge ask first (`--yes` with no terminal) and print the check issues or the run in flight that refused them |
| `foldrun repo rm-branch <branch>` | delete a branch (asks; `--yes`). `repo mirror <git-url>` sends every push to main there too, with the workspace's `MIRROR_TOKEN` (`repo mirror off` stops it); `repo mirror-now` pushes main now and prints what the remote said (`--to`) |
| `foldrun restore <workspace> --to <commit\|time\|age>` | put a workspace's source back as it was then — `--to` is a commit or its prefix, a branch or tag, a date/time (the last commit at or before it) or an age (`90m`, `12h`, `3d`, `2w`). Always shows the change first (`--dry-run`: the full diff and nothing else); the restore asks for the workspace's name typed back (`--yes` with no terminal) and sends the removals it showed, so a file added in between refuses it. A new commit on main, so it prints the `foldrun restore … --to <from>` that undoes it. Runs, `state/`, storage and secrets are not touched. See [Backups and restore](backups-and-restore.md) |
| `foldrun backups` | how the account is backed up: the schedule, how many are kept, the last snapshot (verified? copied off the server? encrypted?), the snapshots that hold the account, each marked encrypted or not, each workspace's last change, and earlier restore requests (`--limit`, `--json`). `backups request --what runs\|state\|storage\|everything --at "<when>" [--to <workspace>] [--backup <id>] [--note "…"]` asks the platform team for a restore from a snapshot — recorded and emailed; nothing is restored until they do it. `backups requests` lists every request this account has made, and where each stands (`GET /api/account/backups/requests`, `--json`) |
| `foldrun accounts` | every account signed in on this machine, and which one a bare command acts as. `foldrun profiles` is the same command |
| `foldrun use <name>` | act as one of them from here on. `foldrun switch <name>` is the same command |
| `foldrun keys ls` | the account's API keys, each with its role and scope, when it was created, when it was last used and from where (a /24 or /48), and when it expires — also `create <label>` (`--expires 30d\|90d\|365d\|never`), `rotate <id>` and `revoke <id>` |
| `foldrun keys rotate <id>` | a new key with the old one's label, role, workspaces and deploy scope, printed once; the old key is revoked at once (asks first; `--yes` on a pipe), or keeps working for `--grace 1h` / `24h` while you swap the new one in. A key already rotated is refused (409) and the command names the key that replaced it — rotate that one, also if its secret was lost; `keys ls` shows `rotated → <id>`. The owner is emailed a week before any key expires |
| `foldrun audit` | the account's audit log, newest first — sign-ins and refusals, sessions, MFA, keys minted, rotated and revoked, invites and role changes, secrets set and deleted (by name), deploys, workspace deletes, plan and billing changes, and every time support viewed the account, with the reason. `--since 7d` (default) or a date, `--until`, `--action apikey` (a family or one action), `--actor <email\|key:label\|support:email>`, `--to <workspace>`, `--limit`, `--all` to follow every page, `--json`, `--csv [--file audit.csv]`. The owner's and unscoped admins'. There is no `audit` for support's view-as: that is a person's act in the browser, never a key's |

## Options

| | |
|---|---|
| `--workspace <dir>` | the workspace folder (default `.`). On `init` it names the first workspace instead |
| `--flat` | `init`: the single-folder shape — `agents/` and `flows/` at the root, no account around them |
| `--from <template>` | `init`: start from a shipped template, e.g. `templates/hello` |
| `--starter` | `new`, `workspaces new`: include the example researcher, writer and `publish` flow — a new workspace is otherwise blank |
| `--as <name>` | `agent import`: the name the copy gets in this workspace (rewrites its `name:`); `storage put`: the path one uploaded file lands at |
| `--transport <k>` | `tool new`: `script` (the default — a folder with its program beside it), `http` or `mcp` |
| `--language <l>` | `tool new`, `source new`, `library new`: the script's language — `javascript`, `python` or `bash` |
| `--task "<text>"` | the instruction for a manual run |
| `--test` | `run`, `invoke`, `agent run`: a test run — every step runs, nothing outward happens, `state/` and `storage/` are left alone, and the run page lists what would have happened. See [Test runs](runs#test-runs) |
| `--follow` | `logs`: keep tailing a live run — locally, or on the platform with `--url` |
| `--status <s>` | `runs`, and a bulk `stop` or `rerun`: only these statuses, comma-separated — `failed`, `completed`, `awaiting-approval`, `running`, `queued` |
| `--since <span>` | `runs`, and a bulk `stop` or `rerun`: only runs started within `24h`, `7d`, `90m`, `2w`. `observe` and `triggers` take a number of days instead (sent as `?days=`). `--until <span\|date>` on a bulk `stop` or `rerun`: only runs started before then |
| `--since <span>` (audit) | `audit`: entries from `24h`, `7d` (default), `30d` ago or a date; `--until <date>` ends the window |
| `--action <a>` | `audit`: one action (`apikey.created`) or a family (`apikey`, `secret`, `member`, `support`) |
| `--actor <who>` | `audit`: one person or key — an email, `key:<label>`, `support:<email>` |
| `--verdict <v>` | `runs`: only completed runs whose summary leads with it — `good`, `bad`, `quiet`, `blocked`, comma-separated |
| `--flow <name>` | a bulk `stop` or `rerun`: only that flow's runs. `flow add … subflow`: the other flow to run as a step |
| `--agent`, `--instruction`, `--after`/`--before`, `--group`, `--step`, `--cases`/`--else`, `--each`/`--max`, `--loop`/`--until`/`--judge`, `--question`, `--wait`, `--on-fail`, `--off` | `flow add`: see the patterns above. `--agent` on `rerun` is the first step that agent runs; `--question` on `answer` picks one of several questions; `--wait` alone stays the switch `invoke` and `agent run` read |
| `--schedule "<cron>"`, `--timezone <zone>` | `flow trigger schedule`: the cron line (5 fields, or `@daily`) and the zone it is read in |
| `--kind <k>` | `secrets set`: `file`, `ssh`, `api`, `service-account` or `m2m` — each with its own flags, in the `secrets set NAME --kind` row above |
| `--client <name>` | `connect`: run the consent from that OAuth client saved on the platform (`secrets clients` lists them) |
| `--subagent`, `--consult`, `--can-ask`, `--description` | `agent link`, `agent unlink`: which list to edit, and a worker's description when it has none |
| `--eval <name>`, `--expect "<line>"`, `--case <name>` | `promote`: the eval file, an assertion (repeatable), the case's name |
| `--tag <t>` | `invoke`, `flow run`: a label on the run — repeatable |
| `--inputs <name>` | `invoke`, `flow run`: the task is that saved input set; not with `--task` |
| `--preview` | `storage cat`: the platform reads the file and prints what is in it |
| `--csv` | `billing statement`: the CSV instead of the table |
| `--csv` (audit) | `audit`: the log as CSV, for an auditor — `--file <path>` saves it |
| `--threshold`, `--amount` | `billing wallet set auto-top-up`: refill `--amount` (5–500 USD) when the balance falls below `--threshold` |
| `--name`, `--abn`, `--address`, `--email` | `billing details set`: the legal name, the ABN, `"line1, city, state, postcode, AU"` (the last part is the two-letter country), the receipt email |
| `--days <n>` | `usage`: the window the charges cover (default 56). `status --platform --history`: 1–90 days (default 90) |
| `--id <revision>` | `history`: one revision, as diffs |
| `--engine <e>` | `login <site>`: the browser to sign in with — `chrome` (default; it signs in with Chromium, so `chromium` is the same), `firefox` or `safari` (`webkit`). Not `lightpanda` or `obscura`, which keep no profile to sign in with — the full list is [Engines](tools#engines) |
| `--new-client` | `connect`: enter a new OAuth client even when one is saved for the secret |
| `--limit <n>` | `runs`, `billing`, `history`: how many rows, newest first (`runs` default 20, `billing` 15). Each workspace is asked for its own newest `n` before the merge, so one busy desk cannot crowd out a quiet one |
| `--step <n>` | `approve`, `reject`: decide one gate, numbered as `report` prints it. Without it, every step of that run which is waiting |
| `--payload <json\|text\|@file>` | `approve`: release a step waiting on `wait: event` with this body (`POST …/approve` `{ payload }`). JSON is sent as JSON, anything else as text; `@file` reads a file |
| `--note "<text>"` | `approve`: guidance the approved step reads in its prompt — "approve, but skip the Sydney batch". `reject`: the reason, recorded on the trace. `billing credit`: the ledger line's note |
| `--yes` | skip the confirmation, deliberately: `approve`, `stop`, `deploy` (when it would delete files), and a bulk `stop` or `rerun`, `flow rotate-hook`, `flow draft`, `history restore`, `restore`, `billing plan`, `repo deploy`/`merge`, `workspace set name`, and every delete — `runs rm`, `storage rm`, `storage unshare`, `source rm`, `secrets rm`, `keys revoke`, `workspaces rm`. Required when there is no terminal to ask; without it nothing is deleted |
| `--json` | `report`: the raw run record instead of the report. `observe`, `usage`, `workspaces`, `workspaces show`, `agent ls`, `flow ls`, `agent import --list`, `backups requests`, `status --platform --history`, `team`: the raw document |
| `--events <a,b>` | `account set notify`: which events are notified on — `failed`, `awaiting-approval`, `completed` |
| `--watch` | `invoke`: follow the run's trace here as it happens; the exit code is the run's |
| `--print` | `open`: print the URL, do not open it |
| `--value "<text>"` | `secrets set`: skip the prompt — careful with shell history |
| `--account` | `secrets`: account scope rather than this workspace's — the workspace is the folder's name (`--workspace`), local or on the platform alike |
| `--wait` | `invoke`, `agent run`: hold on and print the result. Asked in 25-second pieces, so a flow that runs for many minutes is never cut by whatever sits in front of the platform; a run parked on a person prints its page and exits 2 |
| `--from <n>` | `invoke`, `flow run`, `rerun`: start at step n; earlier steps are recorded as skipped. A bulk `rerun` defaults to 1. (One flag, two meanings: a template on `init`, a step everywhere else) |
| `--no-browser` | `login`, `connect`: print the address instead of opening it |
| `--provider <name>` | `connect`: fills the authorize and token URLs and an example scope string; `--authorize-url` / `--token-url` for a provider with no preset |
| `--scopes "<a b c>"` | `connect`: space-separated, as OAuth defines it |
| `--client-id` / `--client-secret` | `connect`: the OAuth app; prompted when omitted, the secret never echoed |
| `--port <n>` | `connect`: the loopback port (default 8642) |
| `--role <r>` | `keys create`: `viewer`, `editor` (default) or `admin` |
| `--for <workspace>` | `keys create`: a deploy key for one workspace; `--access read` or `write` |
| `--expires <span>` | `keys create`: when it stops working — `30d`, `90d`, `365d` or `never` (default) |
| `--grace <span>` | `keys rotate`: keep the old key working for `1h` or `24h` (default `0`: revoked now) |
| `--force` | `deploy`: deploy while runs are in flight. `pull`, `storage get`: overwrite local files |
| `--no-runtimes` | `deploy`: do not wait for the workspace's environments to be built, or print them |
| `--platform` / `--yes` | `workspaces rm`: delete it on the platform, said twice because it cannot be undone |
| `--platform` | `workspaces new`, `agent new`, `flow new`, `tool new`: make it on the platform, not in this folder. `status`: the platform's own health (`--history` for the daily record) |
| `--description`, `--model`, `--pattern`, `--template` | `agent new --platform`: its description and model tier. `flow new --platform`: the shape to start from. `tool new --platform`, `source new`, `library new`: a transport or gallery entry to start from |
| `--list` | `agent import`: what could be imported, importing nothing |
| `--path <p>` | `tool test`: the path an http tool should probe, appended to its `base:` — a path that escapes the base is refused, the same confinement the agent gets |
| `--timeout <s>` | how many seconds one request to the platform may take — or `FOLDRUN_TIMEOUT`. Default 30, and 300 for `tool test`, where the tool itself is the thing being waited on |
| `--local` | `deploy`, `secrets`, `logs`: the installation on this machine, even when signed in |
| `--quiet` | leave out the dim "acting as …" line a platform command prints on stderr |
| `--dry-run` | `extract`: list what would move, change nothing. `flow add`, `flow rm-step`, `flow dup-step`, `flow set`, `flow trigger`, `flow move-step`, `flow paste`, `flow draft`, `history restore`, `agent link`/`unlink`: show the diff, write nothing. `restore`: the diff only, restore nothing. A bulk `stop`/`rerun`: list what matches, touch nothing |
| `--out <file>` | `api spec`: where to write the OpenAPI document (default stdout) |
| `--file <path>` | `source put`: the file to send. `storage get`, `report get`, `account export`, `billing statement --csv`: where to write — `-` for stdout |

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
# signed in with Google Chrome 154.0.8037.58
web:
  browse:
    engine: chrome
    user_agent: "Mozilla/5.0 (Macintosh; …) Chrome/154.0.0.0 Safari/537.36"
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

**The default, `--engine chrome`, signs in with real Google Chrome** when it is
installed on this machine — the browser an agent with `engine: chrome` runs.
That matters because a site ties a session to the browser that earned it: a
Cloudflare clearance to its user agent, a bot check to the browser's build. A
cookie minted in Chromium and replayed by Chrome is a different browser
showing up with it, and may be challenged. Without Chrome installed, it signs
in with Playwright's Chromium and says so. Either way the block's first line
records which browser and version minted the session, and the `user_agent:`
line is the one that browser sent (`--engine chromium` asks for Chromium on
purpose).

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
and the runs beside it — until `check --to` or `eval --to` names a deployed
workspace. `flow add`, `flow show` and `agent link`/`unlink` edit and read this
folder, and the deployed copy only when `--to`, `--url`, `--profile` or
`--token` is given: being signed in is not enough to send an edit there. `logs` and `deploy` are local too, until a platform is
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
