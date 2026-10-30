# Runs

A run is the record of a flow being driven from its first step to its last:
every step's reply, every tool call, every cost, and one line at the top that
says what happened. It is the unit of the debug loop and the thing a person
reads when they were not there.

## The record

Each run holds its steps in group order. A step carries:

| field | what it is |
|---|---|
| `status` | `pending`, `running`, `awaiting-approval`, `completed`, `failed`, `skipped` |
| `result` | everything the agent wrote, every turn joined |
| `conclusion` | the final turn alone — what it concluded |
| `data` | the parsed value, for a step with `output: json` |
| `events` | tool calls, script runs with their timing, verify verdicts, refusals. A tool call is a pair of events, the call and its completion; the completion carries `ms` and, from 18 Oct 2026, `bytes` — the result's length in characters, which every later turn sends again |
| `turns`, `systemPromptChars`, `stopReason` | model turns, summed across attempts; the system prompt's length in characters (it rides on every turn); why the last turn ended. With the events' `bytes`, these say where a step's input tokens went. From 18 Oct 2026 |
| `promptLayers` | the system prompt's layers, stable ones first: `name` (`persona`, `agents.md`, `skills`, `knowledge`, `rules`, … then `memory`, `state`, `clock`), `chars`, `hash` (12 hex characters of its SHA-256) and `stable: false` on the ones that change between runs. Two steps of one agent compared layer by layer say why the [prompt cache](budgets-and-billing#prompt-caching) missed; the run page and `foldrun report` do the comparison. From 20 Oct 2026 |
| `costUsd`, `tokens`, `computeSecs`, `startupSecs` | what it cost and how long the sandbox lived — **summed across its attempts**. `tokens` is `{ input, output, cacheRead, cacheWrite }`: `input` is all input, and `cacheRead` and `cacheWrite` the part of it the [prompt cache](budgets-and-billing#prompt-caching) served and stored. Steps recorded before 18 Oct 2026 have only `input` and `output` |
| `startup` | where the step's first seconds went: when each start-up phase ended, in seconds since the step started — `services` (the account's search/browser pods up), `room` (room on the cluster to start — see [Budgets and billing](budgets-and-billing)), `applied` (sandbox created), `ready`, `files` (workspace copied in), `go` (step released), `shim`, `system` (system packages restored), `driver`, `imports`, `tools` (runtime and tools built) and `model` (the model's first text or tool call). Only the phases the step went through; `null` for a step that ran in-process, absent before 17 Oct 2026. The last attempt's |
| `image` | which runner image the step's sandbox ran (isolated runs on a cluster): `variant` `full` or `slim`, `why`, and `pod: true` when a browsing step ran slim and browsed through the account's browser pod ([slim steps and a lost pod](tools#slim-steps-and-a-lost-pod)) |
| `browserPod` | on a step that browsed through the pod from slim: `reconnects` (tries), `reconnected` (how many got through: the call went on after it) and `closedAgain` (how many reached the pod only for the call to drop again at once, when any did); when the pod was lost, `lost` (`cause` `lost` or `needs-full`, and `detail`) and `writes` (what the step had written by then, worded); then `fallback: "browser pod lost; re-ran on full"` when it had only read and ran again on the full image, or `failure` — `browser pod died after the step had written <what>` — when it had written and was not re-run |
| `tries` | one row per attempt, oldest first (and a `status: "lost"` row, `image: "slim"`, before the full re-run when the browser pod was lost under a slim step that had only read — see [tools](tools#slim-steps-and-a-lost-pod)): `n` (the try, numbered in the order they ran), `attempt` (the step's attempt it belongs to, only when that is not `n` — the full re-run after a lost slim try 1 is `n: 2, attempt: 1`), `status`, `costUsd`, `tokens`, `turns`, `computeSecs`, `startedAt`, `finishedAt`, the attempt's `image` and its `browserPod` line when it had one, and the attempt's last `error` when it failed. A `retry: 2` step that failed twice and then passed has three rows, and its `costUsd` is all three — the run's spend, the flow's `budget:` and the bill read the step's figure, so the figure is the total. A retry is handed what is left of the budget after the failed attempt spent, and nothing left means no retry, said on the record |
| `item` | for a fan-out instance, which item this one handled |

The run's `summary` is the **first meaningful line of the last step's
conclusion** — heading marks and bullets stripped. It is the row in the runs
list, the subject of the notification, and what a later run sees through
`recall_runs()`. Nothing declares it; the runtime asks every agent to open its
reply with one sentence saying what it concluded, and reads the line it wrote.
An agent that opens with "I'll start by…" makes all three useless.

## The run page

Every run has a page of its own, `/dashboard/<workspace>/runs/<run>`, and
every list, card, alert and search result that names a run opens it; the
old `?run=` links still land there. It opens on the answer: how the run
ended — status and the agent's verdict read together, so a run that
completed and reported BLOCKED shows **blocked**, not green — what it was,
its headline, when it started, how long it took, its steps and cost. If a
step failed, its reason sits right under that, one click from the step
(`#step-3` in the address opens and shows any step). A strip of the same
flow's recent runs, this one ringed, says whether this was a one-off. **←**
and **→** move to the older and newer run, **u** back to the list.

Below that, the step list, the trace and a timeline —
one bar per step with its tool calls marked in milliseconds, so a slow run
says which step was slow. Every step shows its instruction, what it was
handed from earlier groups, what it returned, its cost, and how many times it
reached for a path it was not allowed and was refused (see [Security](security)).
A **start-up** chip in a step's header says how long it took the step to
reach the model's first word; hover it for each phase's share.

The page follows the run as it moves, gates included, without a reload: a
**live** dot beside the status says the stream is connected (amber while it
reconnects), and the browser tab reads the state and the step — `● running ·
step 3/7` — so you can switch away and still see where it is. Only the step
that is happening is open; a finished step folds to one line with its
headline, duration, tokens (and the share the prompt cache served) and cost, and the next step opens as it starts.
Click a step to pin it open or shut, or use **expand all** / **collapse
all** above the column. A **json** link opens the run record exactly as the
runner wrote it.

A step's trace marks each line for what it is — the agent's words, a tool
call (its name, then what it was called with, a click from whole), a verify
result as **verified** or **verify failed**, an error, or the runner's own
plumbing (egress, timings, resources), which is dimmed. Chips above it show
only one kind, errors included; **full height** shows all of it at once. A
step that drove a browser shows it live, then plays its recordings — see
[Tools](tools#watching-it-live-and-the-recording).

The account's home opens on **mission control**: what is **running now**
(each run's step and agent, and anything running over an hour flagged), what
**needs attention** (every open [issue](#issues), anything waiting for an
approval or an answer, and anything stuck), and every
desk's **last 24 runs** as a strip of cells beside how many of them
completed and what went wrong (`20/22 · 2 failed`), runs today and the
credits charged this week. Every row and every cell opens its run.

Money on the overviews — Home, the desks list, a workspace's flows and
agents, Observe, the runs list and a run's own page — is **credits charged**:
the ledger's line for the run, one credit to a cent. A run the ledger has not
settled yet shows its list price, marked estimated (`~` in the runs list,
"est. charge" on its page). The provider's token cost is not the bill; it is
on a run's page under the figure, and in Usage.

Every page counts runs the same way. **Completed** is a run that ran to the
end without failing, whatever it found; the rate is completed out of
completed plus failed, and a run a person stopped is left out. What the
completed runs found is counted beside it: **blocked** (BLOCKED), **problem
found** (BAD), and **nothing to do** (QUIET).

## What a run records

Every step keeps, beside its events:

- **each model call**: when it came back, how long until its response
  began arriving (from the request going out), the model, why it
  stopped (`tool_use`, `end_turn`, `max_tokens` …), its tokens with how many
  the cache served, and how many tools it called. A step's **model calls** row
  on the run page lists them; `foldrun report <run-id> --calls` prints them.
- **each tool call's input and output** — what the agent gave the tool and
  what came back. Open **input / output** on a tool line in the trace, or
  `foldrun report <run-id> call <call-id>`. Each part is kept up to 65,536
  characters (the length of the whole is shown when it was cut), and a step
  keeps at most about 4 million characters in all — past that its calls keep
  only their names, sizes and times, and the trace says so. Secrets are
  masked before anything is written, then the text is cut: the step's own
  secrets by value (`[redacted:NAME]`) — a file secret such as a key by its
  content, line by line — then anything shaped like a key, and any private
  key block. The input is what the agent asked for; a [hook](hooks) that
  rewrote it before it ran is in the trace beside it. The content is kept
  beside the run, not in it, counts toward the workspace's storage, and goes
  when the run is deleted or ages out.

And the run itself says **which files it ran** — the workspace's latest
revision when a worker first picked it up ("ran on abc1234"; a deploy's is
its commit) — and **how long it queued** before that. A step that runs after
an approval, or after a deploy mid-run, may run newer files than that.

A workspace that should keep no content writes `capture: metadata` in its
`AGENTS.md` (or the account's): model calls, tool names, sizes and timings
are still recorded, inputs and outputs are not.

## The trace tree

A run's page opens with its **trace**: the run as one tree, each step, each
model call it made, and each tool call under the model call that asked for
it, every line with a bar on the run's own clock. A model call shows its
model, tokens (and how many the cache served) and why it stopped; a tool call
shows how long it took and, where it was recorded, its **input / output**.
Errors are lines of their own. The tree opens on the first thing that went
wrong — a failed tool call before the step's error line, before the failed
step — and highlights it; **expand all** shows every call.

`foldrun report <run-id> --tree` prints the same tree in the terminal, with
`← what went wrong` on that line, and `GET /api/workspaces/<ws>/runs/<id>/trace`
answers it as JSON. Runs from before 19 Oct 2026 have no model calls on
record; their tool calls sit under the step.

### Sending the trace to your own tracing

The same tree can go to the OpenTelemetry collector you already run —
Grafana Tempo, Honeycomb, Datadog, Jaeger, Langfuse, anything that takes
OTLP — so agent runs sit beside the services they act on:

```yaml
telemetry:
  otlp: https://otel.example.com/v1/traces   # the collector's OTLP/HTTP traces URL
  headers:
    authorization: ${OTEL_TOKEN}             # a vault secret, by name
```

In the account's `AGENTS.md` (Settings → Observability → *Send runs to your
tracing*, or `foldrun account telemetry set <url> --header
authorization='${OTEL_TOKEN}'`), or a workspace's, which replaces the
account's whole. Every run that finishes is sent as one trace: a span for
the run, each step (with `foldrun.agent` and `foldrun.owner`), each model
call (`gen_ai.request.model`, token counts, finish reason) and each tool call
(`gen_ai.tool.name`), failures as error spans. Resource attributes name the
account, workspace, flow and run. Ids come from the run's, so a run sent
twice is one trace. Test runs are not sent.

*Send a test trace* (`foldrun account telemetry test`) sends one made-up run
and says what the collector answered. A header whose secret is not in the
vault stops the send and says which; a token written into the file is
refused by `foldrun check` and the deploy. The collector is reached like a
`notify:` webhook — never a private address — and a slow or failing one
never holds a run up: a failed send is logged on the platform, not retried.

## Searching runs

The runs pages search by what happened inside a run, not only its status:
**tool** (a step called a tool whose name contains it — `web`, `crm`), **a
tool errored**, **agent**, **model** (contains — `haiku`), **≥ tokens** (input
read by all its steps, `50k`) and **≥ secs**. A search can be kept as a named
**view** (save view), yours on every browser; the views sit beside the search.
`foldrun runs --tool web --tool-error`, `--agent`, `--model`, `--min-tokens`,
`--min-secs` and `--view <name>` do the same (`foldrun runs views` lists
yours), and `GET …/runs` takes `tool`, `tool_error`, `agent`, `model`,
`min_tokens`, `min_secs`. Tools and models are searchable on runs from
19 Oct 2026; tokens and time on every run.

## Insights

The account's **Observe** page opens with **Insights**: the problems that keep
costing without failing anything, found in the last week of runs with nothing
to set up. Each says what it is, why it happens, what to do, about how many
credits it cost, and links the runs it was seen in:

- **mostly uncached** — an agent sends a big prompt the model's cache rarely
  serves, step after step (something near its start changes every call);
- **a big tool result sent again** — a tool hands back more than 20,000
  characters and every later model call in the step pays for it again;
- **a retry loop** — a tool errors three or more times in one step and the
  agent keeps trying;
- **near its timeout** — steps that use 80% or more of their `timeout:`.

`foldrun insights` prints them; `GET /api/insights` answers them.

## Compare with the last good run

On a finished run, **compare with the last good run** lays it beside the
newest earlier run of the same flow that finished well (or, failing that, the
run it re-ran). It says whether the two ran the same files and which files
changed between them, then, step by step, what differs: status, a new error,
the instruction, the model, tool calls and tool errors, how long it took, the
tokens it read, the model calls it made, and the first line it said. Steps that
did not change are left out. `foldrun report <run-id> --compare [<other-run>]`
prints the same, and `GET …/runs/<id>/compare?with=` answers it.

## Issues

What went wrong is an **issue**, and it stays open until a person resolves
it. One issue is the same thing going wrong again:

- one desk's flow **failing** at the same agent;
- one desk's flow ending **BLOCKED**, or finding a problem (**BAD**);
- one desk's scheduled flow **not starting** when it was due (see below);
- one **platform** cause across every desk it hit — sandboxes that cannot
  start, a model sign-in refused, the usage cap, the provider overloaded, a lost
  worker — with what
  to fix, none of it in the desks.

Each issue says when it was first and last seen, how many times, which runs,
the newest reason and what to do. A later good run does not close it: the
issue says "fine since …" and waits for someone to resolve it, so a failure
at 3am is still there at 9 whatever ran in between. **Acknowledge** says you
have seen it (it stays open), **Snooze** hides it for a while (it comes back
on its own), **Resolve** closes it, **Reopen** undoes that. Each act is kept
in the issue's history with who did it. The same thing going wrong after a
resolve opens the issue again, counting from there.

An issue that was resolved and happens again is marked **regressed**, with
the revision its new run ran ("regressed since abc1234"). Besides **Snooze
1d**, **Ignore next 5** hides it until it happens five more times — for a
known flake (`snooze` with `times` on the API, `--times` in the CLI).

**Doctor** on an issue opens the [run doctor](assistant#the-run-doctor) on
its newest run, in the workspace that run is in, wherever the card is shown
(Home, a workspace's home, the Issues page): the assistant says why and
proposes the fix as files to save. Nothing changes until you save it; then
resolve the issue, or rerun and let it show "fine since". A missed schedule
has no run, so it has no Doctor. From a terminal: `foldrun issues doctor <id>`.

A **missed schedule** is an issue too: a scheduled fire in the last week that
started no run — none began from two minutes before it to thirty after, and
none of that flow was already going. It says when it was due ("due Mon 09:00
(Australia/Sydney), no run started") and opens the flow. Fires from before
the flow file last changed are not counted.

A flow can choose to have its issues close themselves: `issues: auto-close`
in its frontmatter, and a run of it that goes fine resolves its open
failures, BLOCKED and BAD (marked "auto"); one going wrong after that opens a
new episode. Unset (`stay-open`) a person resolves them. Platform causes and
missed schedules never close on their own.

The **Issues** page lists them (Open, Snoozed, Resolved, All; a workspace's
own from its home), Home lists the open ones under Needs attention, and
`foldrun issues` and `GET /api/issues` are the same list. A platform issue
belongs to the account: closing it needs access to every workspace.

Each agent also has an **Activity** page: every step it has ever run, across
flows and direct runs, with that step's own headline. It is where "how has
this agent been going" is answered without opening runs one at a time.

## Your inbox

**Inbox**, top right and under View in the account's sidebar, is what waits
on *you*, across every workspace you may see, in one list: gates to approve,
questions agents are asking, open [issues](#issues), [proposed
fixes](evals#proposed-fixes) to review, and your own runs that went wrong.

Three tabs that never mix:

| tab | what is in it |
|---|---|
| **For me** | assigned to you: you are named in the flow's `approvers:`, you own the flow or agent (`owner:`, down to the workspace's and the account's), or you asked for the proposal |
| **Started by me** | runs you started: one that failed or ended BLOCKED or BAD in the last week, a gate on one (someone else must decide it — your own approval is refused), a question one is asking |
| **Team** | everything else waiting in your workspaces, for whoever picks it up — a gate anyone may decide, an issue nobody owns |

Nothing is kept in it: each item is read from where it lives and leaves on
its own when it is done there — the gate decided, the issue resolved, the
fix applied. A gate you may not decide (`approvers:` names others) is not in
yours at all. What *is* kept is what you did to your own view: an item you
opened is read, and **Set aside** hides one from you — it is still waiting
for everyone else, and the gate is not decided. An item names its occurrence,
so an issue that happens again after you set it aside comes back. The count
on the top bar is what is unread in For me and Started by me.

`foldrun inbox` prints the same (`--team`, `--all`, `--kind approval`); a key
reads the inbox of the person who minted it, within the key's own workspaces.
The API is `GET /api/me/inbox`.

## Gates

A step marked `2!` or carrying `approve: true` / `ask: <question>` parks the
run until a person decides. Three doors open it, and the trace says which:

- **the dashboard** — Approve or Reject on the run page, with a note that is
  kept on the record;
- **the emailed link** — the notification carries approve and reject links
  when the install has a public URL;
- **an external event** — a `wait: event` step is released by a POST to the
  event URL printed in its trace, and what was posted reaches the next step.
  The URL is that step's, for that one wait: it does not release a later
  `wait: event` of the same run, and once used it answers `409`. A person can
  release it the same way from the run page (or `approve` with a `payload`):
  the payload reaches the step just the same, and the trace names them, not
  "an external event". The approvers and self-approval rules below are for
  gates that ask a person; a `wait: event` release asks for `run:start`.

The answer typed at an `ask:` gate reaches the next step's prompt, so "GO,
but skip the third one" is an instruction the publisher reads.

**Who may answer.** A flow's `approvers:` names the addresses that may decide
its gates, or `admins` for anyone at admin or above; unset, anyone who can
run the workspace can answer. On top of that, and whatever the list says,
**nobody approves a run they started themselves** — a gate exists so a second
person looks. Rejecting your own run is always allowed. An API key carries a
role but no address, so a key is not caught by the self-approval rule and
only an `approvers:` list constrains it.

**How long it waits.** By default, forever — which also means the run holds
its place in the account's concurrency for as long as nobody looks. A flow's
`approve_within:` stamps a deadline when the gate opens; past it the gate is
**rejected**, the run fails, and the destination hears why. Rejection is the
only safe way for a clock to answer a question a person was asked.

## Test runs

A test run is a real run of the flow that changes nothing outside it. Every
step runs — the same agents, the same files, the same read APIs, the same
gates — and the platform, not the desk's own script, makes sure nothing goes
out and nothing real is written. It exists because every desk that sends had
grown its own test switch inside its own code, and a switch a script can
reach is a switch a script can move: on one occasion a send step edited its
own gate file to get past its guard. The guard now lives where the step
cannot reach it.

Start one with the **Test run** checkbox on the Run button, `foldrun run
<flow> --test` locally, `foldrun invoke <flow> --test` on a platform, or
`POST .../flows/<flow>/run` with `{ "test": true }`. An eval's runs are test
runs unless the eval or the flow says `live: true` in its frontmatter — the
safe default is opted out of, never into. A re-run of a test run, or a run started
from one of its steps, stays a test.

What the platform does on a test run, in the order a step meets it:

| where | what |
|---|---|
| the egress proxy | any `POST`, `PUT`, `PATCH` or `DELETE` to a host that is not a model provider or a read-only service is **refused** with `403` and a JSON body `{ "test_mode": true, "would_have": { method, host, path, to, body } }`. A Resend `POST /emails` is instead **redirected**: the recipients become `delivered@resend.dev` (Resend's sink), the subject is prefixed `[TEST] `, and the call goes through — so a desk still gets a real message id. Reads (`GET`, `HEAD`, `OPTIONS`) pass. A host with no granted secret is refused as always |
| the sandbox | secrets whose name says they can send — `RESEND_API_KEY`, `TWILIO_*`, `GETREACH_API_KEY`, `GITHUB_TOKEN`, `MONDAY_API_TOKEN`, `OI_CRM_API_KEY`, `CLOUDFLARE_*`, `LINKEDIN_*`, `MEDIUM_COOKIES`, `TIKTOK_*` — are **withheld**: the env var reads `TEST_MODE_WITHHELD`, so a script that never checked fails at the provider with an auth error rather than sending. A step granting a script tool marked `outward: true` gets no real secret at all; one granting a tool marked `test_mode: allow` gets them all. The sandbox also has `FOLDRUN_TEST_MODE=1` and `FOLDRUN_RUN_TEST=1`, for scripts that branch on it. The http tools still go through the proxy, where the table above applies |
| the browser | the step is handed no account [browser pod](tools#where-the-browser-runs): the tool launches Chromium inside the run pod, which the run namespace's policy denies the internet, so a `web action=browse` call fails closed rather than fetching the world through a pod the policy does not select |
| the write-back | `state/` and `storage/` go into the sandbox as they are; what the step wrote there comes out under `runs/<id>/test-writes/state/…` and `…/storage/…`, and the workspace's copies are untouched. Each later step of the run gets those writes laid over its copy, times kept, so a flow that hands work on through `storage/` is tested as it runs live — the step's log says how many files it sees. Nothing is harvested to the file store and nothing under `storage/public/` is published |
| the record | `test: true`; the summary opens with `[test]`; a **TEST** badge beside the status in the runs list and on the run page; every refusal, redirect, diversion and withheld secret is an event carrying an `effect`, and the run page's **Test run** panel lists them — "would have written state/sends.md, +3 lines" |
| the rest | gates still park, and the approve page says it is a test run; notifications go out only for `failed`; a `trigger: flow` chained on a test run starts as a test run |

Locally (`foldrun run --test`) there is no egress proxy, so the first row does
not apply: a script that ignores `FOLDRUN_TEST_MODE` and has its own way to a
provider is stopped only by the withheld secret. The other rows hold.

The list of hosts an outward write may reach, the secret-name patterns and
the Resend rewrite live in one table in core (`src/test-mode.ts`), with unit
tests, so "what does a test run refuse" is a file and not a search.

## Stopping, re-running, promoting

**Stop** ends the run and destroys its sandbox, not just the record. A
stopped run is recorded as stopped; it never quietly completes.

**Re-run with an edit.** On a finished run, a step's **edit & re-run** opens
its instruction: change it and re-run from that step, with the earlier steps
carried as context. The new instruction is for that one run — the flow file is
not changed — so you can try a fix on the real input before writing it in.
The new run says where it came from (`rerunOf`). From the terminal:
`foldrun rerun <run-id> --from <n> --instruction "…"`.

**Stop and re-run in bulk.** `POST /api/workspaces/<ws>/runs/bulk` applies
one of those two actions to every run a small filter names — statuses, a
flow, a time window, or an explicit list of ids. It is the tool for the
morning when one broken thing failed seventy runs. A call naming no filter is
refused rather than treated as everything, `dryRun: true` shows what would be
touched, and each run is its own outcome so one that cannot be stopped does
not abort the rest. On the runs pages, tick runs and choose **Stop** or
**Rerun**: the bar makes this call, once per workspace in the selection.

**Re-run from a group** (`from: N`) starts a new run at group N with the
earlier groups recorded as skipped, not invented — the step reads what earlier
steps wrote to `storage/` and `state/`, which is the durable handoff. Use it
to redo the interesting half after a fix.

**Promote** turns a run that worked into an eval case: its task and the
result it should reproduce. The eval runs on every push from then on.

## Why nothing happened

The hardest question this platform gets is not about a run — it is about a
run that does not exist. Every honest answer to it is a thing that
deliberately did not happen: a duplicate delivery, a burst still being
waited out, a throttled trigger, a flow switched off after a bad week, an
`overlap: skip`, a fire missed while nothing was running.

The Triggers page on each workspace records all of it: one row per flow
saying how often its trigger fired, how often that became a run, and what
the difference was, with the key in the flow file that decided each one. Its
last section is the delivery log, which answers the separate and earlier
question of whether a request arrived at all and was authentic — a bad token
never reaches a flow rule, so it appears there and nowhere else.

`GET /api/workspaces/<ws>/triggers` is the same thing as JSON.

## Handoffs

A step is handed the replies of **every earlier group**, oldest first, capped
at about 30,000 characters with the newest kept. For a list that a later step
must get exactly, or a report a person should also read, have the step write
it to `storage/` — a tool that takes an `out=` path and tees its own output
is the reliable way, because a model asked to copy a long report by hand
shortens it.

## What a run costs, and what stops it

Every step records what it cost. A flow's `budget:` is checked between
groups: the group that crosses it is the last that runs, and the run fails
saying so. The workspace's and the account's `budget:` over time sit above
that. See [Budgets and billing](budgets-and-billing).

Finished runs older than the install's retention are pruned. Their headline
survives in the eval history and in what agents can recall.

## The runs list

Beside the records sits `runs/.index.json`: one row per run with what a
list needs — id, flow, status, summary, times, and each step's agent,
status, cost, tokens, seconds and last error — never a reply or a trace. It
is written with the record and repaired from the directory by any reader
that finds a row missing, stale, or orphaned, so it is never trusted over
the files. The runs pages and the account-wide list read it; a run still
live is read whole; a finished run's reply and trace are opened by id.

## What survives the platform

A step is a sandbox that keeps its own log and files until the platform
has read them back. On a cluster, the record carries which sandbox a
running step is in and how much of its output has been applied — so when
the worker that started it goes away, a deploy rolling it or a crash, the
next worker **re-attaches** to the same sandbox and carries on from that
line. Finished steps stay finished; the interrupted one is neither re-run
nor lost, and the trace says `driver changed mid-step — re-attaching`. A
deploy no longer costs a run; a step that was quiet for an hour inside a
long tool call is still the same step afterwards.

Only a sandbox that has actually ended — the cluster killed it, or nobody
came back for it within forty minutes — is reported as such, in the
cluster's own words (`OOMKilled`, `Evicted`), and handed to the step's
`retry:` policy. Locally, with steps in containers rather than pods, an
interrupted step is run again from its start, as before.

A step whose program exits without reporting a result — it crashed after
its last tool call — no longer waits out those forty minutes. The platform
notices the exit within about half a minute, reads the whole log once more
in case only the stream missed the result, and otherwise fails the step
with `the step's program exited (code N) without reporting a result`
followed by the last lines the program printed on stderr. The sandbox is
still held at that point, so the files the step wrote are kept.
