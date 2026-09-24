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
| `events` | tool calls, script runs with their timing, verify verdicts, refusals |
| `costUsd`, `tokens`, `computeSecs`, `startupSecs` | what it cost and how long the sandbox lived — **summed across its attempts** |
| `tries` | one row per attempt, oldest first: `n`, `status`, `costUsd`, `tokens`, `computeSecs`, `startedAt`, `finishedAt`, and the attempt's last `error` when it failed. A `retry: 2` step that failed twice and then passed has three rows, and its `costUsd` is all three — the run's spend, the flow's `budget:` and the bill read the step's figure, so the figure is the total. A retry is handed what is left of the budget after the failed attempt spent, and nothing left means no retry, said on the record |
| `item` | for a fan-out instance, which item this one handled |

The run's `summary` is the **first meaningful line of the last step's
conclusion** — heading marks and bullets stripped. It is the row in the runs
list, the subject of the notification, and what a later run sees through
`recall_runs()`. Nothing declares it; the runtime asks every agent to open its
reply with one sentence saying what it concluded, and reads the line it wrote.
An agent that opens with "I'll start by…" makes all three useless.

## The run page

The step list on the left, the trace on the right, and a timeline above it —
one bar per step with its tool calls marked in milliseconds, so a slow run
says which step was slow. Every step shows its instruction, what it was
handed from earlier groups, what it returned, its cost, and how many times it
reached for a path it was not allowed and was refused (see [Security](security)).

The page follows the run as it moves, gates included, without a reload: a
**live** dot beside the status says the stream is connected (amber while it
reconnects), and the browser tab reads the state and the step — `● running ·
step 3/7` — so you can switch away and still see where it is. Only the step
that is happening is open; a finished step folds to one line with its
headline, duration, tokens and cost, and the next step opens as it starts.
Click a step to pin it open or shut, or use **expand all** / **collapse
all** above the column. A **json** link beside the cost opens the run record
exactly as the runner wrote it.

Each agent also has an **Activity** page: every step it has ever run, across
flows and direct runs, with that step's own headline. It is where "how has
this agent been going" is answered without opening runs one at a time.

## Gates

A step marked `2!` or carrying `approve: true` / `ask: <question>` parks the
run until a person decides. Three doors open it, and the trace says which:

- **the dashboard** — Approve or Reject on the run page, with a note that is
  kept on the record;
- **the emailed link** — the notification carries approve and reject links
  when the install has a public URL;
- **an external event** — a `wait: event` step is released by a POST to the
  run's event URL, and what was posted reaches the next step.

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
runs, and so is every run in a preview workspace (`<ws>-preview-<branch>`),
unless the eval or the flow says `live: true` in its frontmatter — the safe
default is opted out of, never into. A re-run of a test run, or a run started
from one of its steps, stays a test.

What the platform does on a test run, in the order a step meets it:

| where | what |
|---|---|
| the egress proxy | any `POST`, `PUT`, `PATCH` or `DELETE` to a host that is not a model provider or a read-only service is **refused** with `403` and a JSON body `{ "test_mode": true, "would_have": { method, host, path, to, body } }`. A Resend `POST /emails` is instead **redirected**: the recipients become `delivered@resend.dev` (Resend's sink), the subject is prefixed `[TEST] `, and the call goes through — so a desk still gets a real message id. Reads (`GET`, `HEAD`, `OPTIONS`) pass. A host with no granted secret is refused as always |
| the sandbox | secrets whose name says they can send — `RESEND_API_KEY`, `TWILIO_*`, `GETREACH_API_KEY`, `GITHUB_TOKEN`, `MONDAY_API_TOKEN`, `OI_CRM_API_KEY`, `CLOUDFLARE_*`, `LINKEDIN_*`, `MEDIUM_COOKIES`, `TIKTOK_*` — are **withheld**: the env var reads `TEST_MODE_WITHHELD`, so a script that never checked fails at the provider with an auth error rather than sending. A step granting a script tool marked `outward: true` gets no real secret at all; one granting a tool marked `test_mode: allow` gets them all. The sandbox also has `FOLDRUN_TEST_MODE=1` and `FOLDRUN_RUN_TEST=1`, for scripts that branch on it. The http tools still go through the proxy, where the table above applies |
| the browser | the step is handed no account [browser pod](tools#where-the-browser-runs): the tool launches Chromium inside the run pod, which the run namespace's policy denies the internet, so a `web_browse` call fails closed rather than fetching the world through a pod the policy does not select |
| the write-back | `state/` and `storage/` go into the sandbox as they are; what the step wrote there comes out under `runs/<id>/test-writes/state/…` and `…/storage/…`, and the workspace's copies are untouched. Nothing is harvested to the file store and nothing under `storage/public/` is published |
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

**Stop and re-run in bulk.** `POST /api/workspaces/<ws>/runs/bulk` applies
one of those two actions to every run a small filter names — statuses, a
flow, a time window, or an explicit list of ids. It is the tool for the
morning when one broken thing failed seventy runs. A call naming no filter is
refused rather than treated as everything, `dryRun: true` shows what would be
touched, and each run is its own outcome so one that cannot be stopped does
not abort the rest.

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
