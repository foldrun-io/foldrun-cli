# Budgets and billing

Money on this platform is a cap at three levels and a meter underneath. The
caps are yours to set and the thing to set first: an agent with a tool loop
and no ceiling can spend in an hour what a month was meant to.

## Four caps

| level | where | what it does when reached |
|---|---|---|
| **an agent, per run** | `budget: 2` in the agent's `agent.md` | the most that agent may spend in one run, across every step it takes in it — its step stops itself mid-turn at what is left, and a later step of its own in the same run is refused before it starts. Its steps running at once share what is left, as a group shares the run's: the copies of a fan-out split the cap, they are not each handed the whole of it |
| **a run** | `budget: 6` in a flow's frontmatter | a hard cap: between groups the next group does not start; within a group each step gets an equal share of the remainder and stops itself mid-turn when it is spent — the run cannot end over the cap |
| **a workspace, over time** | `budget: 60` in the workspace's `AGENTS.md`, or Settings | new runs refuse until the window turns |
| **the account, over time** | `budget: 500` in the account's `AGENTS.md`, or Settings | the same, for everything |

**Unset means no limit.** No file, no key, `budget: unlimited` — all the
same: the platform invents no cap on its own. The two caps over time take
a period: `budget: 60` alone is per month, as it always was; `budget: 60/day`
and `budget: 60/week` say so. The window is measured in the account's own
calendar (`timezone:` in `AGENTS.md`, nearest wins), so a daily cap resets
at midnight where the customer is, not at midnight UTC. The two per-run
caps take no period — an agent has no calendar, and writing one there is a
mistake the editor names rather than a cap it quietly keeps.

When an agent's cap and the flow's both apply to one step, the tighter one
wins, and the step's error says which line set it: `budget: in the flow
file` or `budget: on the writer agent`.
| **runs at once** | `concurrency: 3` in the account's `AGENTS.md`, or Settings → Governance | the fourth run waits its turn in the queue — never refused, only later. Empty means the install's share (`FOLDRUN_ACCOUNT_CONCURRENCY`), or no cap. Your own number can lower that, never raise it. Plans are not sold on runs at once but on [compute at once](#compute-at-four-levels): paid by the second, it is the real limit. On foldrun's hosted platform a ceiling on runs driven together guards against a loop gone wrong; it is not something a plan sells |
| **the queue lane** | the plan's lane (`high` \| `normal` \| `low`); `priority: low` in the account's `AGENTS.md` lowers it, and `high` there counts only with a plan that gives it | when slots are short, accounts take turns, weighted by lane — high 3, normal 2, low 1: every account's first run goes before anyone's second, a fast lane takes three turns to a slow lane's one and never all of them, an account with runs going waits behind one with none, and a run that has waited ten minutes moves up a turn. A flow's own `priority:` orders runs within that. The cap above still holds |
| **compute at once** | the plan's cores, GiB and disk (below); `compute: { vcpu: 4, memory: 8Gi, disk: 40Gi }` in the account's `AGENTS.md`, or Settings → Governance, lowers it — and a workspace's and a flow's `compute:` narrow it further ([four levels](#compute-at-four-levels)) | what all the account's running steps may hold together — each step's cores, memory and disk, its `size:` class's or its own `resources:` ([agents](agents#resources-your-own-numbers)). A step that would pass it waits to start, like a full node — `room: waiting to start — 6 of this account's 8 GiB is held by its running steps…` — and starts in turn when one of the account's steps ends ([waiting for room](#waiting-for-room)). A step that **alone** is bigger than the pool, or than the plan's most for one step, fails at once with that message: no step finishing would make room. Without a plan, the install's `FOLDRUN_ACCOUNT_VCPU` / `FOLDRUN_ACCOUNT_MEMORY_GIB` / `FOLDRUN_ACCOUNT_DISK_GIB`, or no cap. Your own number can lower it, never raise it. `foldrun usage compute` shows the pool and what is held now. Enforced on the hosted platform and any k8s install; a self-hosted Docker install caps each step at its class but not the pool |
| **room to start** | the install's `FOLDRUN_RUN_MEMORY_GIB`, `FOLDRUN_RUN_DISK_GIB` and `FOLDRUN_ACCOUNT_PODS` | a step whose sandbox would not fit, or whose account already has its most sandboxes running, waits to start — `room: waiting to start — …` on its trail — instead of failing. The wait is not billed and has no time limit; the run page's start-up chip shows it as `room` ([waiting for room](#waiting-for-room)) |

A cap is a literal, never an expression, so it is readable off the file. The
run cap is hard: a step that reaches its share of the remainder is stopped
mid-turn, so a runaway costs at most the cap, and the step's own error says
how much of its ceiling it reached.

**What counts as spent is the whole bill**, tokens and the sandbox seconds
behind them. This matters more than it sounds: a step that calls no model —
a script looping on a page that never loads, a browser waiting for a selector
that never appears — spends nothing in tokens and would once have been capped
by nothing at all, while the sandbox billed by the second. The platform sets
no clock of its own by design, so the cap is the only backstop there is, and
it counts everything.

The account's cap and a workspace's are checked separately and both apply:
the workspace one stops that desk, the account one stops everything.

**A cap over time warns before it refuses.** At 80% and again at 95% of a
workspace's `budget:`, the workspace's notification destination is told what
has been spent and what happens at the cap. Each mark is sent once per
window — today, this week, this month, whichever the cap is over — and
resets when the cap does. Without it the way a customer learns about the
cap is a desk failing to start on a Tuesday.

Size the run cap from the run records, at two or three times the median — real
work never trips it, a runaway is stopped where it went wrong, and the
failure notification says why. The dashboard's Usage page shows spend by
workspace and by meter.

### Compute at four levels

CPU, memory and disk are each capped at four levels (27 Oct 2026). Every
level only narrows the one above it; a step must fit all of them.

| level | where | what it caps |
|---|---|---|
| **account** | the plan (or the install's `FOLDRUN_ACCOUNT_*`); `compute:` in the account's `AGENTS.md`, Settings → Governance or `foldrun account set compute` lowers it | everything the account's running steps hold together |
| **workspace** | `compute:` in the workspace's `AGENTS.md`, its Settings → Governance, or `foldrun workspace set compute … --to <ws>` | what that workspace's running steps hold together |
| **run** | `compute:` in the flow, the flow's card, or `foldrun flow compute <flow> …` | what one run of the flow holds at once across its parallel steps — each run has its own |
| **step** | the agent's `size:` or `resources: { cpu, memory, disk }`; the plan's (or install's `FOLDRUN_STEP_MAX_*`) most for one step — on foldrun's hosted platform an account without a plan, or whose plan sets none, gets the entry plan's | one step's sandbox |

```yaml
# AGENTS.md (the account's or a workspace's), or a flow's frontmatter
compute: { vcpu: 4, memory: 8Gi, disk: 40Gi }
```

Any of the three may be left out. A step that would pass a cap waits, in
turn, and its trail says which level holds it — `room: waiting to start —
3 of this run's 4 vCPU is held by its running steps…`. A step that **alone**
is bigger than a level's whole cap fails at once, naming it. A workspace's
figure above the account's grants nothing: the account's still applies.
`foldrun usage compute` and `GET /api/usage/compute` show every level — the
account, each workspace and each live run — with what it holds. Before
27 Oct 2026 a workspace's `compute:` was read nowhere; it now caps that
workspace.

### Waiting for room

A step that finds no room — its run's, workspace's or account's pool, its
account's most sandboxes at once, or the node's memory or disk —
**waits; a wait never fails a step**. There
is no time limit (until 27 Oct 2026 a step failed after 30 minutes). Only a
step that alone is bigger than the pool or the plan's most for one step
fails, at once, because nothing finishing would make room.

- **In turn.** Within an account the oldest waiting step starts first: a
  later, smaller step never takes the gap an older, bigger one is waiting
  for. Across accounts, the node's last room is kept for the oldest step
  whose own account would let it start. A step's place in line is when it
  first found no room, and it keeps it.
- **In the queue, not on a worker.** After a minute of waiting
  (`FOLDRUN_ROOM_PARK_AFTER_SEC`), once nothing else of its group is
  running, the run goes back to the queue with its place and looks again
  every 20 seconds (`FOLDRUN_ROOM_RECHECK_SEC`), so waiting runs never hold
  the workers other accounts' runs need. A step whose sibling is still
  running waits beside it. A wait is not a try: it spends none of the
  step's `retry:`, and a stop ends it like any other.
- **Seen.** The run page says *Waiting for room to start*, why, and since
  when; Settings → Governance and `foldrun usage compute` list every
  waiting step, oldest first (`waiting` in `GET /api/usage/compute`).
- **Told.** After an hour (`FOLDRUN_ROOM_ALERT_MIN`) the workspace's
  `notify:` hears of it once, as event `room`, with what to change: ask for
  less (`size:`, `resources:`) or allow the account more compute.

- **In turn, by scope.** An older step goes first among the steps of the
  scope that holds it back: its run's own pool among that run's steps, its
  workspace's among that workspace's, otherwise among all its account's —
  so a step stuck behind a narrow pool of its own never holds back the rest.

Nothing is charged while a step waits — the meter starts when its sandbox
does. A sandbox the cluster has no node with room for yet — not enough cpu,
memory or disk free (it says so: *no node has room for this sandbox yet*)
— waits too, and that time is credited off the bill. So does one an
autoscaled cluster is adding a machine for (*a node is being added for
it*) or whose node pool is at its size cap (*the cluster is at its size
limit*); a sandbox placed on a machine that has just started gets its full
start-up time from the moment it is placed. One it can never place (a
claim that does not exist, no node that matches and none being added)
still fails. On a self-hosted Docker install there is no room gate, so nothing
waits.

### How many runs may wait

Waiting is the rule, but not without end. An account may have a limited
number of runs **waiting for their turn** at once — lined up and not yet
started, sent back to the queue to wait for room, or let out of an approval
or a `wait:` and waiting for a worker. A run asleep on its own `wait:` timer,
at an approval gate or waiting for an event does not count, nor does a run
that is running.

- **The limit.** On the hosted platform each plan sets its own number:
  **Free 10, Starter 100, Pro 400, Scale 1,000**. Without a plan figure it is 20 for each run
  the account may drive at once (its own `concurrency:`, or the install's),
  and never fewer than 50. The refusal below names the number and where it
  comes from. An install sets one number for every account with
  `FOLDRUN_MAX_WAITING_RUNS` (`0`: no limit), which wins over the plan.
- **Past it, a new run is refused at once** — never lined up and dropped
  later. A person or a key gets `409` with `code: "waiting_cap"`, `limit`
  and `waiting`, and the sentence: *this account already has 50 runs
  waiting for their turn, its limit … nothing was started*. The dashboard
  shows it where you pressed Run, and the CLI prints it. A webhook or an
  inbound email gets `503` with `Retry-After: 60`, so its sender tries
  again, and the delivery is not remembered as handled. An outside agent
  over A2A is told the agent is busy.
- **A trigger that fires into it is skipped, not delayed.** A schedule's
  fire, a watched page's change, a debounced burst, a chained or storage
  trigger: each is written on the workspace's Triggers page as
  *too many runs waiting*, with the sentence, and the flow waits for its
  next fire. (A webhook's sender retries; nothing else does.)
- **A threshold, not a ceiling.** The limit is checked when a new run is
  admitted. Runs already admitted still come back — out of a gate, a
  `wait:`, or back for room — so the count can pass the limit for a while;
  new runs are refused until it falls below. Two starts in the same instant
  may both take the last place.
- **Seen.** Settings → Governance → Compute and `foldrun usage compute`
  show *N of M runs waiting for their turn* (`runsWaiting` in
  `GET /api/usage/compute`).

### Fair share across accounts

The platform's workers are shared, and one account sending a thousand runs
does not make anyone else's wait (FOL-123). Four things hold it, in order:

- **Turns in the queue.** A run's place is its account's runs already going
  plus its place among its account's own waiting runs, so every account's
  first run goes before anyone's second, and an account with work running
  waits behind one with none. Within one account it is first come, first
  served. A plan's lane weighs it — a fast lane takes more turns than a slow
  one, never all of them — and a run that has waited long gains a turn
  every ten minutes, so nothing waits for ever. The test the platform is
  held to: one account floods 500 runs while three others keep sending
  theirs, and the others' longest wait stays where it was without the flood.
- **Runs at once** (above): an account at its number has its next run
  stepped over, not refused; it starts when one of its own ends.
- **Compute at once** (above): a step waits to start until its account's
  running steps leave room for it in the account's pool. This is where a
  plan's cores, memory and disk are enforced — before a sandbox exists, so
  a step over it waits instead of failing. It is not a Kubernetes
  `ResourceQuota`, on purpose: a quota refuses the pod at creation, which
  would fail the step, and does not queue anything. It is also not as hard
  as one: the gate is held by each worker for its own steps, so workers
  looking at the cluster in the same moment can each start one more step
  than the pool allows; a cluster that cannot be listed is not treated as
  full; and nothing outside the gate stops the extra pods from running if
  the cluster has the room. Each step's own limits are hard: its sandbox
  cannot use more cores, memory or disk than it holds.
- **How many may wait** (above): past it, new runs are refused with a
  reason, never dropped.

That is all the platform does on its own: it queues, it holds a step back,
it refuses a new run with a reason. It never suspends an account for its
load — that is a person's decision (the operator's), and the account sees
why. An unpaid invoice past its grace is the one automatic pause
([dunning](#the-billing-section)).

The operator watches it on the metrics scrape:
`foldrun_queue_account_pending`, `foldrun_queue_account_claimed` and
`foldrun_queue_account_oldest_pending_seconds`, each for the five busiest
accounts by rank (`rank="1"` … `"5"`) and never by name.

## Plans and credits

Usage is sold in **credits: one credit is one cent** of what a step consumes
at the platform's rates. The ledger stays in dollars underneath — every
statement, budget and refund reconciles to one column — and a credit is how
the money is shown and bought. Credits bought on top — on any plan, or on
none — are **1¢ each**; the falling figure below is what a plan's bundle
works out to, and it is the reason to pick a bigger plan rather than buy
more credits.

| plan | a month | credits a month | storage included | compute at once | one step, at most | workspaces | queue lane |
|---|---|---|---|---|---|---|---|
| **Free** | $0 | 300 | 2 GB | 2 vCPU · 4 GiB · 20 GiB disk | 2 vCPU · 4 GiB · 10 GiB disk | 2 | normal |
| **Starter** | $29 | 3,000 | 10 GB | 4 vCPU · 8 GiB · 40 GiB disk | 4 vCPU · 8 GiB · 20 GiB disk | 5 | normal |
| **Pro** | $99 | 11,000 | 100 GB | 16 vCPU · 32 GiB · 160 GiB disk | 8 vCPU · 16 GiB · 40 GiB disk | unlimited | fast |
| **Scale** | $499 | 60,000 | 1 TB | 64 vCPU · 128 GiB · 640 GiB disk | 8 vCPU · 16 GiB · 40 GiB disk | unlimited | fast |

Bigger than Scale: contact us for a custom plan.

Plans are sold on **compute at once**, not on runs at once: a run is one
flow execution, compute is paid by the second, and a step that does not fit
waits its turn. Free is a plan like the others, granted to every verified
account rather than bought.

**Compute at once** is what all of an account's running steps may hold
together, counted by the cores, memory and disk each step's sandbox is
capped at (disk is what a step may write: its `size:` class's — 2, 8 or 20
GiB — or its own `resources: { disk }`). **One step, at most** is the largest
single step the plan runs: `heavy` (4 vCPU · 8 GiB · 20 GiB disk) on every
plan, and up to 8 vCPU · 16 GiB · 40 GiB disk with `resources:` on Pro and
Scale.

**Two kinds of credit, kept apart.** One balance, two pots:

- **Plan credits** are the plan's monthly grant. They pay for compute,
  storage and network, and **never for tokens on foldrun's models**.
- **Bought credits** (a top-up by card, or in Toman on foldrun.ir) pay for
  anything, tokens on foldrun's models included.

Compute, storage and network draw on plan credits first, then bought
credits. Tokens on foldrun's models draw on bought credits only, so an
account that wants them buys credits. The Usage page and
`GET /api/usage` show the two pots separately.

**Free: 300 credits every month.** Free credits are plan credits, so they
never pay for tokens on foldrun's models. They **do not roll over**: what is
unused is lost at the end of the month (UTC), so an account cannot stockpile
them. The grant for a new month is made when the account has run something
since the last one, and an account gets it once a month however it is
opened or closed.

**How long a credit lasts.** On a paid plan, credits land when the invoice is
paid, and what is unused **rolls over** into the next cycle up to **twice** the
plan's monthly quota — so a balance of plan credits reaches at most three
times it: this cycle's, plus at most two carried. Anything above the cap
expires, and the statement line says how much rolled and how much did not.
The carry is lost on a **cancellation** or a **downgrade**, because the
rollover is a courtesy of the subscription continuing at its level; moving
up keeps it. Credits **bought** on top (Balance → Add credit) are separate:
rollover does not touch them and they last **twelve months** from the day
they were bought (`FOLDRUN_CREDIT_TTL_MONTHS`; `0` turns expiry off).
Whoever changes that number should know that prepaid credit sold to
Australian consumers can attract gift-card rules, which are three years.

Which credit a run spends is the order that favours the customer: the
plan's granted credits first, then bought credit oldest-first — so the
credit closest to expiring is always the credit being used. An account
without a paid plan is on Free: no card asked, credit bought on top costs
1¢ each. A paid plan is cheaper from the first month you would have spent
its fee anyway. Changing plan is charged at once, prorated by Stripe; the new plan
and its bundle land when that invoice is paid — a change whose payment
fails leaves you on the plan you had, with Stripe's page to pay it; paid
within 23 hours it goes through, otherwise Stripe drops it and voids the
invoice. Ending one ends it with the cycle.

**Seats are unlimited** on every plan: agents work, people supervise, and a
per-seat fee would tax the approver the safety story depends on.

**Bring your own model key** and tokens cost no credits at all — the model
is billed to your own provider account — so a plan then buys sandbox time
and the platform, which is most of what a BYOK customer's credits go on.
A step counts as BYOK when it ran on a key of the account's own (Settings →
Model, or a `provider:` block); the run page says which credential each step
used. On a hosted platform every customer account brings one
([providers](providers.md#your-accounts-own-model-key)).

**On foldrun's models** (hosted; [providers](providers.md#foldruns-models))
the tokens are bought from the platform instead: see
[foldrun's models](#foldruns-models) below.

**Going into minus.** Ordinarily an empty balance starts no run. The
platform can allow an account to run below zero — to a floor, or with none —
for a customer on invoice terms. It shows on that account's Balance page
and on the audit; it is a term, never a surprise.

**Charges an account does not pay.** The platform can waive any of the three
meters for one account: model tokens, sandbox time, network. It is set per
account by the platform, never as an install-wide rate, because a
rate turned off globally would quietly stop charging every customer. The
meters still run and the Usage page still shows everything measured; what
changes is the bill. Every run still writes a ledger line — at zero when
everything is waived — naming which legs were waived, so a statement that
totals nothing has a reason printed on it rather than looking like a fault.
It is for the accounts the platform runs itself, and for pilots and
partners whose compute is absorbed by arrangement.

## What a credit buys

Six meters, at the platform's rates. Every charge is recorded in **two
halves** — what the models cost and what the platform under them cost — and
the Usage page, the statement and its CSV all show them apart. They are
different questions: a customer on their own model key pays no model half
at all, and one whose bill moved needs to know which half moved. The halves
always sum to the charge; where a minimum-run fee applies it lands on the
platform half, never on a model number a customer can check against their
provider's own invoice.

| meter | what it counts |
|---|---|
| **tokens** | model usage at cost, times a margin. **Bring your own key and the margin does not apply** — a BYOK step is billed nothing for tokens. On foldrun's models, each call at foldrun's price list, times the margin ([below](#foldruns-models)) |
| **vCPU** | per second, the cores a step reserves while it runs |
| **RAM** | per second, the GiB a step reserves while it runs |
| **step disk** | per second, the GiB of disk the step may write; deleted when the step ends |
| **storage** | per GB-month, the files you keep between runs **over your plan's allowance**, accrued daily. Only the GB above what your plan includes are charged (Free 2 GB, Starter 10, Pro 100, Scale 1 TB). It counts your workspaces' files and your run history, as they are now; a GB is 2^30 bytes |
| **network** | per GB the sandbox moves, both directions |
| **search and browser pods** | an account's search engine and its browser run as pods of their own. Each is charged like a step: the vCPU and GiB it holds, for the seconds it lives (idle time included, until it is let go), at the same vCPU and RAM rates, plus the GB it moves at the network rate. A search pod holds 1 vCPU and 0.75 GiB, a browser pod 2 vCPU, 3 GiB and 4 GiB of disk; each pod's requests equal its limits, so you are charged for exactly what is reserved for it. A pod session is not a run, so no minimum run charge applies |
| **warm builds** | when you deploy, your workspace's environments (the packages an agent declares) are built ahead of its first step, in a short pod. **You pay for it**, because it is the work the first step would otherwise have done in its own sandbox: a small sandbox's vCPU and RAM for the seconds it ran, and the GB it downloaded. It is bounded (one build at a time, ten minutes at most) and shown as its own line, so it is never hidden in another |

The rates are on the Usage page's **Rates** tab, in `foldrun usage rates`,
in `GET /api/usage/rates` and, for anyone, in the public
`GET /api/pricing`. They are the rates charging uses, read when you look.
A default step (2 vCPU, 2 GiB) costs about 16 credits an hour. The Usage
page's **Compute** tab shows each meter with its quantity, rate and credits,
the plan fee as its own line, and what each step size costs per hour;
`foldrun usage meters` prints the same. The search pods, browser pods and
warm builds each have a line with their pod-hours, sessions and the GB they
moved; storage shows the GB held now against what your plan includes.

There is deliberately **no per-step fee**. Steps are sandbox-seconds, so a
step fee would charge compute twice and punish a well-factored flow for
having more, smaller steps. The Usage page shows every table in credits at
today's rates beside the meters, so a customer can read what a run will
cost from what the last one consumed.

### foldrun's models

An account on [foldrun's models](providers.md#foldruns-models) pays for each
model call at **foldrun's price list** — per million input, output,
cache-read and cache-write tokens, per model — times the margin in force.
Settings → Model provider shows the list as you pay it, and so does
`foldrun account model prices`. A model not on it is refused.

- **Metered per call**, by the platform's model gateway, from the usage the
  provider reports — not from what a step says it spent. A stream cut off
  before the provider reported usage is charged at the call's estimate.
  A call the provider refused costs nothing.
- **Charged within minutes**, as its own line on the statement — "foldrun's
  models: N calls (provider model, …)" — one per run, or per eval grade,
  draft or assistant conversation. The run's own charge (sandbox time,
  network, the run fee) is a separate line, as before.
- **A daily cap** per account (UTC), in what you pay. Before each call the
  gateway reserves its estimate against the cap, so twenty calls at once
  cannot all pass it; one past it is refused until the next day.
- **Bought credits pay for it, and only bought credits.** A call starts only
  while the account has bought credit above zero; plan credits, a Free
  grant included, are not spent on tokens.
- **A run that has started finishes.** A run already using foldrun's models
  may go a little past zero bought credit to end (up to
  `models.supply.finish_grace_usd`, $1 a run by default); a new run, or a new
  call from an account not already in one, is refused at zero.
- **Your own key costs no credits.** The Usage page's Tokens tab lists those
  calls at 0 credits so you can still see what was used.

## Prompt caching

Every step's model calls are cached by prefix, on the provider's side: a
request whose opening bytes match one the model has seen reads the model's
work on them instead of paying for it again. The opening is the agent's
tools and system prompt, then the conversation so far. Each turn of a step
re-reads what the turn before sent, and steps of the same agent share the
same opening. Nothing has to be switched on.

A read from the cache is priced at a tenth of fresh input, and a write at a
quarter more; a step's cost uses those rates, both against its `budget:` and
on the ledger. The record keeps the counts apart (`tokens.cacheRead`,
`tokens.cacheWrite`, see [Runs](runs#the-record)), and the run page, the
Usage and Observe pages, `foldrun report`, `foldrun usage` and
`foldrun observe` show the **cache hit rate**: cache reads over all input,
counted over the steps that report the split (from 18 Oct 2026).

### How the prompt is laid out for it

A byte that differs invalidates everything after it, so the system prompt
is assembled in **layers**, the ones that never change first (from 20 Oct
2026): the agent's prose, its locale and place, `AGENTS.md`, skills,
knowledge, scripts, APIs, tools, secrets and the platform's rules; then
what moves between runs — the memory index, the state files and the clock.
The prompt is built once per step and cached as one block, so every turn
of a step re-reads it, and so do the agent's other steps in the same run
while it is unchanged. When an agent's memory or state changes, its next
step writes the prompt again; across runs a day apart that costs nothing
extra, since the cache has expired by then anyway. Each layer's name,
length and hash ride on the step record as `promptLayers`.

A **fan-out** of one agent (`each:`) starts one instance first and holds
the rest until its first response has begun, then starts them together:
the cache entry a request writes is readable only once its response has
begun, and twenty copies started at once would each write the same prefix
and none read it. It waits for the response, not for a fixed time — each
copy spends seconds starting its sandbox before it calls the model, and a
timer would release the rest before there was anything to read. The
waiting copies say so on their trace (`prompt cache: waiting for the first
… step's reply`); `parallel:` still caps how many run at once after that.
On dev, 20 Oct 2026, the waiting copies of a three-way fan-out read 88% of
their input from the cache, against 19% for the one that went first.

### When a step wrote instead of read

A step that wrote a fifth or more of its input to the cache gets a
**prompt cache** line on the run page and in `foldrun report`, saying why:
`memory, clock changed since step 2` compares its layers with the same
agent's previous step in the run; `the agent's first step in this run` is
the write every run pays once; `the same prompt as step 2; the entry had
expired or was still being written` means nothing in the prompt moved —
the gap was longer than the cache lives, or two copies raced.

The cache keeps a prefix for an hour on a Claude subscription and five
minutes on an API key. A low rate usually means one of:

- the agent's prose changes from run to run — keep per-item data in the
  step's instruction, not in `agent.md` or `AGENTS.md`;
- re-reads further apart than the cache lives — a `wait:` or a slow
  fan-out on an API key;
- a short agent with few turns, where there is little to re-read.

Providers on the OpenAI format (`provider:` with `format: openai` or
`responses`) cache on their own side; the share they report comes back as
`cacheRead` too. Where the endpoint routes its cache by a key (OpenAI,
Mistral), every request of an agent carries the same `prompt_cache_key`,
one per agent and account, so its requests land where its prefix is. Other
endpoints get the layered prompt and nothing else; a self-hosted model
(vLLM, Ollama) caches prefixes in its own memory and benefits the same way.

## What each desk costs

The Usage page's per-workspace tables are rolled up from the run records,
which is right for step counts and pod seconds and wrong for money over
time: run records are pruned, so a desk's cost history disappears exactly
when it becomes interesting, and a record holds what a run consumed rather
than what it was charged.

So every charge also carries the flow it was, and that charge split across
the agents that did the work — in proportion to what each step actually
consumed, normalised so the shares add up to the charge. The fixed parts of
a bill are spread the same way, which is the ordinary treatment and the only
one where a column of shares equals the invoice.

The Usage page shows both, by week, with the change between the last two
**complete** periods so a partial week never reads as a collapse. Charges
written before attribution existed appear as a remainder rather than being
quietly dropped: a breakdown that does not add up is worse than one that
admits what it cannot place. `GET /api/usage/history?days=` is the same
thing as JSON.

## The Billing section

Money is one subject, and the dashboard treats it as one section under the
avatar, with eight tabs:

| tab | what it is |
|---|---|
| **Balance** | the number, large, with how long it lasts in words, thirty days of spend as a sparkline, what is held against runs in flight, and Add credit with the amount that covers a month already chosen |
| **Plan** | the plan you are on, this cycle's credits and when they reset, and the plans you could move to |
| **Usage** | what was consumed, from the run records, and what each flow and agent cost by week from the ledger |
| **Statement** | the ledger as a statement: grouped by day, human labels, month-to-date, filters, and a CSV for the month |
| **Invoices** | a tax invoice for every card payment — the plan's fee and each top-up — hosted by Stripe, and a statement for every month; `foldrun billing invoices` lists the invoices and receipts in a terminal |
| **Payment** | the saved card and the auto top-up rule, with defaults derived from the burn |
| **Details** | who the invoices are made out to: legal name, ABN, address and the invoice email |
| **Spend limits** | the account's cap and each workspace's — over a day, a week or a month — as bars with the warning marks drawn where they fire, editable in place; `foldrun usage budget` shows the same standing in a terminal |

The balance also sits in the header of every page, tinted by runway, and a
banner appears across the dashboard when the balance is under a week's cover
or empty, carrying the one button that fixes it. A refused run says why at
the button that was clicked, with a link to add credit when money was the
reason. The old `/dashboard/wallet` address redirects here.

Adding credit is the owner's to do. Anyone else sees why the button is not
there, and who to ask, rather than a button that fails.

**Tax invoices.** Every payment is invoiced to the account's one Stripe
customer, made on the first payment and carrying what Details holds — the
legal name, the invoice email, the address, and the ABN as the customer's
tax id (checked against the ABN rule before it is kept). A top-up's
checkout asks Stripe for a numbered invoice, not just a receipt, so a
business can claim the GST on credits as well as on the plan. With
`STRIPE_TAX=1` (Stripe Tax enabled on the Stripe account), checkout works
the tax out from the address, collects the address and a tax id if they
are missing, and writes them back to the customer. Saving Details updates
the customer at Stripe at once; without Stripe, or when Stripe refuses,
they are kept and sent with the next save or payment.

**Manage in Stripe.** The Payment, Plan, Invoices and Details tabs carry a
button into Stripe's Billing Portal — the card, every invoice as a PDF, the
plan — for the owner. Its look and what it allows (cancelling, switching
plan) are set once at Stripe, under Settings → Billing → Customer portal.

**When a plan payment fails.** Stripe retries the card on its own
schedule. On the first failure of an invoice the owner is emailed once —
the amount, Stripe's page to pay that invoice, and the way to update the
card — and a grace period starts (`FOLDRUN_DUNNING_GRACE_DAYS`, default 7).
Runs go on meanwhile, and an amber banner across the dashboard says until
when. If the invoice is still unpaid when the grace ends, the hourly sweep
suspends the account for new runs with the reason **payment overdue**, and
one more email says so; the banner turns red. Runs in flight finish, people
can still sign in, nothing is deleted. The moment `invoice.paid` arrives
for it — or `invoice.voided` or `invoice.marked_uncollectible`, which is
how a debt is written off — the suspension is lifted, and a payment gets a
thank-you email. The subscription ending does not settle it: the plan
ends, but an invoice it left unpaid is still owed and still payable, and
the account stays paused until it is paid or written off. Every step is once per invoice, however often
Stripe retries or redelivers; a second invoice failing during the grace
does not restart it. Dunning lifts only a suspension it placed: an account
the platform's operator suspended for another reason stays suspended. The
operator sees where it stands on the customer's overview.

**Your data, and leaving.** Settings → Your data gives the owner one JSON
file with the account's workspaces, members, an index of every run and the
whole ledger (`GET /api/account/export`). The same place holds **Close
account**: type the account's name and it is suspended at once — no new
runs, schedules stop firing — while the platform team settles the last
invoice and any refund. Nothing is deleted by the request itself; people can
still sign in and take the copy.

## The wallet

Usage is settled from a credit balance. Add credit by card, once or with
auto top-up; set a low-balance email so the empty wallet is never a
surprise. With billing on, an empty balance refuses *new* runs — runs in
flight finish. Every run is charged exactly once; the ledger is a database
table with that as a constraint, not a promise.

### Paying in Toman (foldrun.ir)

People who pay with an Iranian (Shetab) card top up at
[foldrun.ir](https://foldrun.ir) in Toman, through Zarinpal. It is the same
wallet: the payment adds dollars of credit to the account, exactly like a
card top-up here — it does not buy a plan. Billing → Balance (and
`foldrun billing wallet`) links to foldrun.ir's charge page with the
account filled in, wherever foldrun.ir is selling.

1. On foldrun.ir the customer types the account's sign-in email (any
   member's) or its account id, and an amount in dollars ($5–$500).
   foldrun.ir shows the account masked (`o•••r@a•••e.co · ac••`) and the
   price in Toman at today's rate.
2. Confirming opens an order here with that Toman figure locked for 30
   minutes, and sends the customer to Zarinpal to pay it.
3. When Zarinpal has verified the payment, the order's dollars land as a
   top-up (`zarinpal:<receipt> order:<id>` on the statement) — once,
   however many times the confirmation arrives. A payment that clears after
   the 30 minutes, or after the customer pressed back, is still credited —
   within a day of the order; later than that the platform team credits it
   by hand (Zarinpal returns a payment nobody verified within 72 hours).

The credit is bought credit like any other: it expires 12 months after
purchase if unused. The platform operator sets, in the console's Settings
under Billing:

| Setting | |
|---|---|
| `billing.ir_toman_per_usd` | Toman per dollar of credit — the market rate plus the gateway's fee and any margin. Empty: foldrun.ir does not sell |
| `billing.ir_rate_max_age_hours` | hours before a saved rate goes stale and sales stop (default 48; 0 never) |
| `billing.ir_daily_usd` | most foldrun.ir may open orders for in 24 hours, open, paid and failed together (default 1000; 0 no ceiling) |
| `billing.ir_site_url` | foldrun.ir's address, for the Billing page link |

foldrun.ir signs every call with `FOLDRUN_PARTNER_IR_SECRET` (32 characters
or more, in the platform's secret store and foldrun.ir's own). It can only
open orders and report them paid; it never names an amount to credit. The
routes are in [api.md](api#billing).

## How the money is kept straight

The bookkeeping rules behind the numbers, for whoever has to answer "why is
my balance this".

**One grant per plan cycle.** A cycle is the subscription, the plan and the
end of the period it pays for, and that is the grant's key. A grant needs
the money: a paid checkout (or one with nothing to pay), the checkout
returning paid, or `invoice.paid` — whichever arrives first grants and the
rest find it done. `customer.subscription.updated` moves the plan's
status, never its credits: Stripe applies a price change even when its
invoice then fails. Each invoice grants the plan **it** paid for, read off
its own lines, not whatever the subscription has moved to since; and a
paid invoice for a period older than the one already granted grants
nothing. A plan change inside a period is a new cycle on the new plan; a
renewal is a new period. A change inside a period grants the new plan's bundle **pro-rated
by the share of the period left**, the way Stripe prorates the charge; a
renewal grants it whole. Going back to a plan already granted this period
switches the plan and its gates back but grants nothing again. Downgrades
still lose the carry.

**The low-balance guard runs every hour**, and right after a run whose
charge takes the balance across the warning line. Per crossing of the line
it makes at most **one** auto top-up attempt and sends at most **one**
email; a declined card is not retried every hour — the email goes instead —
and both re-arm once the balance is back above the line.

**Tax.** A top-up credits the price before tax: with Stripe Tax on, the
Checkout price is tax-inclusive, so a $50 top-up costs $50 and credits $50.
An auto top-up is a bare charge with no Stripe Tax and no tax invoice.

**Refunds.** A refunded top-up takes off the credits it added — the charge's
own amount caps it, scaled to the pre-tax share when the charge carried tax — and the balance is **not** floored at zero: credit
refunded after it was spent leaves the account in the red, and admission
refuses the next run until it is topped up. A refunded plan fee does not
touch the wallet: the credits it bought were a grant, and they end with the
cycle.

**Chargebacks.** The disputed amount comes off when the dispute opens (the
card network already has the money). The account is found through the
disputed charge — its metadata, its payment's, then the saved customer. Won
(or an inquiry closed without a chargeback): the same amount goes back on,
once. Lost: it stays off. As with refunds, a dispute on a plan fee does not
touch the wallet; it is logged and left to the platform's operator.

**Every line says why it exists.** Each ledger line carries a reason —
usage, pod, fee, checkout, auto-topup, manual, operator, refund, dispute,
dispute-won, plan, trial, grant-expired, credits-expired — and lines written
before the field have theirs derived from their key and note. Statements
label lines by it. **Burn**, the 30-day spend and month-to-date count usage
and the daily fees only — not expiries, refunds, chargebacks or an
operator's debit.

**Hand-placed plans renew.** A plan the platform's operator grants runs a month and
is renewed by the hourly sweep at its period's end, with the same grant and
rollover rules. Granting a plan to an account Stripe is billing is refused
(end it first, or change it at Stripe); ending a Stripe-billed plan cancels
the subscription at Stripe first, at once, and changes nothing if Stripe
refuses.

**Stripe.** Every call pins its API version (`2025-03-31.basil`;
`STRIPE_API_VERSION` overrides) — create the webhook endpoint on the same
version — and charges in `FOLDRUN_CURRENCY` (default `usd`), which is also
the unit of every balance. Set the currency before any money is on the
books; Stripe will not mix currencies on one customer. The webhook endpoint
is `<public url>/api/billing/stripe`, sending exactly:

| event | what it does |
|---|---|
| `checkout.session.completed` | a top-up credited, or a plan's first cycle granted |
| `invoice.paid` | a plan cycle granted: signup, renewal, or a change; an overdue invoice settled |
| `invoice.payment_failed` | the plan goes past due; dunning starts |
| `invoice.voided` | an overdue invoice cancelled; dunning ends |
| `invoice.marked_uncollectible` | an overdue invoice written off; dunning ends |
| `customer.subscription.updated` | a plan swap, or a status change |
| `customer.subscription.deleted` | the plan it paid for ends; what it left unpaid stays owed (dunning and its pause stay) |
| `payment_intent.succeeded` | an auto top-up credited |
| `payment_intent.payment_failed` | an auto top-up refused; the warning goes |
| `charge.refunded` | a refunded top-up's credits come off |
| `charge.dispute.created` | a chargeback's amount comes off |
| `charge.dispute.closed` | won: it goes back on; lost: it stays off |

Every delivery is logged — the event, the account, what was done or the
error, and a hash of the payload. Since 28 Oct 2026 the event itself is
kept too, for the types above only, up to 256 KB, set when it first
arrives and emptied after **180 days**: Stripe keeps events for 30, and a
replay after that needs a copy. It carries what Stripe sends (names,
emails, addresses, a card's last four digits — never a full card number),
so it is never shown to the account. The platform can replay an event
through the same handler — Stripe's copy while Stripe has it, the kept
copy after; every write it makes is keyed once, so a replay of an event
that was handled changes nothing.

## Plan gates

Two more limits come with the plan rather than the wallet: how many
workspaces an account may create (beyond it, creation refuses with `402`),
and how many runs may execute in parallel (beyond it, runs **wait** — they
are never refused, because a queued run is work that will happen and a
refused one is work that will not).

## On your machine

None of this meters. `budget:` still caps a run and every step's cost is on
its record — the model bill is yours, paid to your provider directly.
