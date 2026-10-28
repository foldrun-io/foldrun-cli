# Evals

An eval is a markdown file under `evals/` that runs an agent or a flow against
a task and asserts something about the reply. It is how a change to a prompt
stops being a guess.

```markdown
---
name: writer-quality
agent: writer            # or `flow: publish`
model: fast              # the judge's model, not the agent's
---

## mentions the audience
task: Write a short draft about cleaning a rain gauge.
expect:
  - contains: farmer
  - not-contains: leverage
  - judge: speaks to working farmers, not to gardeners

## quotes the real price
task: Write one line quoting the price of the RG-40.
expect:
  - contains: $34
```

Each `##` heading is one case: a `task:` and the `expect:` list it must
satisfy. The heading is the case's name, so make it the thing being checked.

## Frontmatter

| field | |
|---|---|
| `name` | the eval's identity |
| `agent` **or** `flow` | what runs. A flow eval runs the whole flow per case |
| `model` | the **judge's** tier, not the subject's — cases run the agent on its own model. Unset, the workspace's `judge:` in `AGENTS.md` (see [The four jobs](four-jobs#judge--the-evaluation-default)), else the fast tier |
| `effort` | the judge's effort. PASS/FAIL against one sentence is not deep work |
| `trigger` | `deploy` (default), `manual`, or `runs` — grade real finished runs instead of running cases (see [Grading live runs](#grading-live-runs)) |
| `sample` | `trigger: runs` — the percent of finished runs graded, 0 to 100 (default 25) |
| `improve` | `trigger: runs` — `true` (5) or a count: once that many graded runs failed, a fix is proposed for a person to review (see [Proposed fixes](#proposed-fixes)) |
| `inputs` | `true` makes the file a flow's saved inputs, not a test: its cases are named tasks for [Run with…](flows#run-with-saved-inputs) and `foldrun invoke --inputs`, and nothing runs them as an eval |
| `live` | an eval's runs are [test runs](runs#test-runs) — nothing outward, `state/` untouched — unless this says `true`. A flow eval that must really send to prove itself opts in; nothing opts in by accident |

## Assertions

| | |
|---|---|
| `contains:` | the text must appear |
| `not-contains:` | the text must not appear |
| `matches:` | a JavaScript regular expression over the reply, case-insensitive, given a quarter of a second (a pattern that backtracks fails the check). No inline flags such as `(?m)`: write `(^\|\n)` for the start of a line. `foldrun check` reports one that does not compile |
| `file:` | the path exists and is non-empty |
| `run:` | a shell command that must exit 0 — `foldrun eval` on your machine only: an install that isolates runs refuses it (the check fails, saying so), because there it would run on the platform's own web server rather than in a sandbox |
| `judge:` | a model grades the reply against this sentence |

**Deterministic checks run first and cost nothing.** The judge only runs if they
pass — there is no point paying a model to grade output already known to be
wrong. The same vocabulary is a step's `verify:`, so a flow and an eval say
"the output must mention the price" in one sentence.

## When they run

`trigger: deploy` — the default — runs the eval on every deploy of the
workspace, which is what makes it a regression test rather than a thing someone
remembers to click. Results land in `evals/.results/`, and a dated line goes to
`history.jsonl` so movement is visible across weeks.

On a platform an eval's run goes through the same queue as every other run,
so it counts against the account's `concurrency:` and waits its turn.

`trigger: manual` keeps it off every push. **Use it for `flow:` evals**: a flow
eval runs the entire flow once per case, so a three-case eval on an hour-long
flow is three hours and the full cost, on every deploy.

## Grading live runs

An eval tests the cases someone wrote. A grader tests the runs that actually
happened: the 3am desk run nobody watched, held to the same checks. It is an
eval with `trigger: runs` and no tasks — each `##` heading is a check, with
only an `expect:` list:

```markdown
---
name: digest-quality
flow: weekly-digest      # or agent: writer — that agent's steps, in any flow
trigger: runs
sample: 25               # percent of finished runs graded
model: fast              # the judge
---

## cites its sources
expect:
  - judge: every claim names the source it came from

## no placeholders
expect:
  - not-contains: lorem ipsum
```

- **What it grades.** For `flow:`, every step's reply joined; for `agent:`,
  that agent's replies, in whichever flow it ran. The judge is also given
  the run's task, so it grades the reply against what was asked.
- **Which runs.** Completed ones — a crash is already an
  [issue](runs#issues). Not test runs, not eval runs, and only those that
  finished after the grader was first deployed: a new grader starts from
  now, it does not grade a week of runs at once. The sample is chosen by a
  hash of the run id, so the same run is always in or out.
- **When.** The platform grades a few runs every five minutes, at most four
  per account a pass, so a backlog drains steadily rather than spending at
  once. A paused account or workspace is not graded.
- **The checks.** `contains:`, `not-contains:` and `judge:`, cheap ones
  first; the judge only runs when they pass. `file:` and `run:` are refused
  (`foldrun check` and the deploy say so): a finished run's sandbox is gone,
  and they would act on the platform's host instead. `matches:` is refused
  too — a regular expression over whatever a run said, on the platform's
  scheduler, could stall it. A `task:` in a grader does nothing and is
  refused as well.
- **A judge that does not answer** (a spent usage cap, a provider outage)
  leaves the run *not decided*, which is not a failure. It is tried again
  after an hour, three times at most.
- **What it costs.** One judge call per `judge:` line per graded run — at
  most five lines in a grader — on the account's own model key like any
  eval judge. A paused account or workspace is not graded, by the pass or
  by **Grade a run**. The card shows what the
  judges cost; the runs' own cost is on the runs.

The grades are on the Evals page: each grader's card has its pass rate over
7 and 30 days, a bar per day, the recent failures with the check that failed
and the judge's reason, and **Grade a run** to grade any finished run now,
sampled or not (a run graded again shows its newer grade). A run's own page
lists every grade it got. From the CLI, `foldrun eval grades <eval> --to
<workspace>` (`--status fail`, `--days 7`) and `foldrun eval grade <eval>
--run <id> --to <workspace>`; the API is `GET …/evals/<eval>/grades` and
`POST …/evals/<eval>/grade`. Grades live in `evals/.results/grades/`, kept
90 days; a deploy never touches them.

A grader never runs as cases: not on deploy, not from Run, not from
`foldrun eval`.

## Proposed fixes

A failure that keeps happening should turn into a change someone can look
at, not sit on a card. A grader with `improve: true` (or `improve: 3` — how
many failures) opens a **proposal** on its own once that many graded runs
have failed and no proposal has covered them, or once the oldest such failure
is a week old:

```yaml
trigger: runs
improve: true        # 5 failed grades nobody has looked at → a proposal
```

- **The assistant drafts it.** It is given a short digest of the failures —
  at most ten, each the run, the check and the judge's reason — and reads
  the agent, the flow, their skills and the runs themselves. It is asked for
  the smallest change that fixes the cause, never to loosen a check, and to
  propose nothing when the fault is not in the files (a missing secret, an
  outage).
- **Only agents, flows and skills.** A proposal may change
  `agents/<name>/agent.md`, `flows/<name>.md` and `skills/<name>/…`; anything
  else the assistant proposes is left out, and the proposal says so.
- **Nothing is written until you apply it.** Apply checks that every file
  still reads what the proposal was drawn against and can be written, then
  writes them all, each a revision by you (so History can take it back). A
  file someone changed since is refused — dismiss it and propose again. A
  check error the deploy would refuse blocks Apply.
- **At most one open proposal per eval**, and the automatic ones at most one
  a day per grader. A failure is *looked at* once a proposal covers it —
  drafting, ready, applied or dismissed; a draft that failed releases its
  failures so they count again. A draft that has not finished in half an
  hour has failed.
- **What it costs**: one assistant reply, paid the way Ask AI is.

They are on the eval's card under **Proposed fixes**: what failed, the
assistant's reasoning, a diff per file, and Apply or Dismiss. **Propose a
fix** asks for one now — for a grader, from the failures no proposal has
covered; for an eval that runs cases, from its last result's failed cases.
Ready proposals are in your [inbox](runs#your-inbox). From the CLI: `foldrun
eval improve <eval> --to <workspace>` asks for one and waits for the draft;
`foldrun proposals --to <workspace>` (`--status ready`), `foldrun proposals
show|apply|dismiss <id> --to <workspace>`. The API: `POST
…/evals/<eval>/improve`, `GET …/proposals`, `GET`/`POST …/proposals/<id>`.

## Comparing models

"Could this step run on the fast model?" is answered from the cases you
already have. **Compare models** on an eval's card runs every case under two
to four settings — a model (`fast`, `default`, `max`, or a model id), an
effort, and for a flow eval either every step or one agent's — and puts them
side by side: how many passed, what the runs and their judges cost, the cost
and time per run, and each case under each setting, so you see where they
differ.

- **The model is forced on the steps**, so it wins over the agent's own
  `model:` and the flow's defaults. "every step" forces all of a flow's
  steps; naming an agent forces only that agent's.
- **Every run is a test run**, whatever the eval or the flow says about
  `live:` — a comparison is never the reason something was sent.
- **The judge is the eval's own** and the same for every setting: what
  changes is the subject, never the grader.
- **`repeat`** (1–5) runs each case more than once; one run each tells you
  little where the model is not deterministic. Repeats interleave — each
  setting once, then again — so a provider that slows down mid-way slows
  every setting alike.
- **Bounded twice**: at most 60 runs (cases × settings × repeat), and a spend
  limit (default $5, at most $100) — once the runs and judges have spent it,
  the rest are recorded as not run and the result says it stopped early.
- **Time per run** is from a worker picking the run up to its end; time in
  the queue is left out, so a busy account does not read as a slow model.
- **What it writes**: the comparison's own result, kept with the last 20 —
  never the eval's latest result or its history. One comparison of an eval
  at a time.

It runs on the platform and can take as long as its runs do; leave the page
and come back. From the CLI: `foldrun eval compare <eval> --models
fast,default,max --to <workspace>` (`--models fast:low,max:high` for
efforts, `--agent <name>`, `--repeat 3`, `--max-usd 10`; `--list` and `--run
<id>` read the kept ones). The API is `POST …/evals/<eval>/compare`, then
`GET …/compare?run=<id>`. A grader (`trigger: runs`) has no cases, so it
cannot be compared, and neither can an eval with a `run:` check — a
comparison repeats every check many times, and `run:` executes a command.

## Promoting a run

A run is a case you already have — the task is on record. A run that worked
is kept with **Save as eval** on its page: its task, and a judge that holds the
next run to the same conclusion. A run that went wrong (failed, BLOCKED or
BAD) is kept with **Turn into a test**: you say what it should have done, and
that is the judge's claim — its own answer is not the one to keep. Either way
the case goes into `evals/<flow or agent>-regressions.md`, so the fix has a
test before it has a diff. `foldrun promote <run-id>` does the same (`--should
"…"` for one that went wrong, `--expect` for assertion lines). A run that was
itself an eval case is refused: promote the run it was checking.

## The loop

```sh
foldrun check           # free — no model is called
foldrun eval            # the assertions
foldrun run <agent>     # the real thing
```

`check` is the typecheck: a step naming an agent that does not exist, a tool or
skill that resolves to nothing, a `delegate:` or `on-fail:` that names nobody,
a cron that fires eleven times where you meant once. It costs nothing, so run
it on every edit and let evals cover what only a model can answer.
