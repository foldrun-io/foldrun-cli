# Flows

A flow is a numbered list of steps in a markdown file under `flows/`. Steps run
in ascending group order, and each receives the results of **every** earlier
group, oldest first — a group-3 reporter sees what group 1 measured, not only
what group 2 diagnosed. Output passing is the default, not configuration.
The handoff is capped (about 30,000 characters); over it, the oldest groups
are dropped whole and the newest kept.

```markdown
---
name: weekly-digest
trigger: schedule
schedule: "0 8 * * MON"
timezone: Australia/Sydney
---

1. [[researcher]] — gather this week's competitor updates
2. [[writer]] — turn the research into a 300-word digest at outputs/digest.md
```

## The step line

```
<group><marker>. [[<agent>]] — <instruction>
```

- **Group** — steps sharing a number run **in parallel**; the next group starts
  when all of them finish and receives every result, labelled per agent.
- **Marker** — `?` makes the step optional (it fails without failing the flow);
  `!` parks it for a human, the shorthand for `approve: true`.
- **Target** — the first link on the line is structural: the agent that runs,
  or `[[flow:name]]` for a whole flow composed in place. Cycles, and nesting
  past three levels, are errors.
- **Instruction** — everything after the dash. Other `[[links]]` in it resolve
  to real paths before the model sees them.

Options are indented lines under the step.

## What a gate shows

A parked step's approval box shows the previous group's replies, rendered,
and every file under `storage/` those replies name — images as pictures,
markdown and text as text. `preview:` makes that explicit:

```
5! [[publisher]] — commit and push
   preview: draft/*.mdx, draft/images/*.webp
```

The globs are resolved against `storage/` at the moment the run parks, so
the approver reads the whole article and sees its cover before saying GO,
whether or not the reviewer remembered to name them. The rule for the step
before a gate is still to reply with a summary and name its files; the
declaration is what makes the preview not depend on that.

An instruction may wrap. Indent the continuation, the way an option is
indented, and the whole thing is one instruction:

```
1. [[writer]] — write the article and make sure it covers
   the three points we agreed, then hand it to the editor
   with a note about tone
   timeout: 900
```

**An instruction ends where the step ends.** A line joins the instruction
only if it follows the step line, or a line that already joined it, with
nothing in between: the first blank line, option, unindented line, heading,
bullet, quote or bold paragraph finishes the instruction, and everything
after it is prose. Without that rule a flow's commentary below the last step
became part of that step's orders — the indented *wrapped lines* of a bullet
list read as instructions while the `- ` lines around them did not.

Unindented prose between steps stays prose and is ignored, so a flow file's
commentary is undisturbed.

`foldrun check` notes every instruction that wraps. It is read in full, but
the parser had to decide where it stopped, and the line under a wrapped
instruction is one edit away from being a paragraph. Prefer one line, however
long, so what the agent is told does not depend on where the next paragraph
begins.

## Every step option

| option | |
|---|---|
| `when:` | run only if the **previous group's** result has a line **beginning** with this marker — non-exclusive, every match runs |
| `case:` | exclusive branch: the **first** `case:` whose marker begins a line of the previous group's result runs, the rest are routed past |
| `else:` | runs only when no `case:` in the group matched |
| `each:` | fan out — `lines`, `items`, or `rows of <path>` |
| `max:` | cap the fan-out (default 10, hard cap 20; dropped items are logged) |
| `parallel:` | how many of an `each:` step's instances run at once (1 to 20); unset is all of them |
| `loop:` | send the flow back one group up to N times (capped at 5) |
| `until:` | the marker that ends the loop |
| `output:` | `json` — the reply must end with one ```json block, parsed and passed on losslessly |
| `schema:` | with `output: json` — the JSON Schema the value must satisfy: one-line JSON, a YAML block under the key, or a file under the workspace |
| `model:` | override the tier for this step |
| `effort:` | override how hard it thinks for this step |
| `retry:` | attempts after the first, clamped to 5. Each retry waits — 15 s, 30 s, 1 m, 2 m, 4 m, jittered — holding no sandbox while it waits; a stop ends the wait. An attempt the cluster ended for want of memory or disk (OOMKilled, Evicted) is retried one `size:` class up |
| `timeout:` | seconds, or `90s` / `15m` / `4h` / `3d` — **the only clock there is** |
| `max_turns:` | the most model turns before the step is stopped (1 to 500) — the third bound beside `budget:` and `timeout:` |
| `verify:` | a shell command, or an assertion (`contains:`, `matches:`, `file:`, `judge:`) |
| `approve:` | park until a person releases it |
| `ask:` | the same gate carrying a question; the typed answer reaches the prompt |
| `preview:` | what the gate shows: paths under `storage/`, comma-separated, globs allowed — `draft/*.mdx, draft/images/*.webp` |
| `wait:` | `3d` (`s`/`m`/`h`/`d`, capped at 30 days) or `event` |
| `on-fail:` | another agent takes the step over, with the failure as context |
| `delegate:` | the step's agent picks who runs next, from this set |

### Routing

```markdown
1. [[classifier]] — reply with exactly one word, BUG or QUESTION
2. [[debugger]] — investigate and fix
   case: BUG
2. [[writer]] — answer it clearly
   case: QUESTION
2. [[triager]] — neither label fit; say what is missing
   else: true
```

`when:` is the non-exclusive sibling — every matching step runs — which is why
routing has its own vocabulary instead of a mode on `when:`.

**A marker leads a line.** `when: BLOCKED` and `case: BUG` look for a line
that begins with the marker, not for the word anywhere in the text. Markdown in front of it is
fine — a heading, a bullet, bold — and a longer word that merely starts the
same way is not a match.

**And it is the previous group's line.** The prompt hands a step every
earlier group; a gate reads only the nearest earlier group that produced a
result. A classifier's `BUG` two groups back does not reopen `case: BUG`
after the debugger has answered it, and a group routed past entirely is
looked through rather than read as silence.

This matters more than it sounds. It used to be a plain search of the whole
text, which meant an agent writing

> There are no BLOCKED items this week.

opened the gate. Saying a marker is absent necessarily names it, so the more
carefully an agent explained itself the more likely it was to trip its own
condition. Write verdicts as headlines — the line leads with the marker,
which is the house convention anyway — and both readings agree.

For `case:` it matters more, because routing is exclusive. A label picked
out of a sentence does not merely run an extra step: "this is not a
COMPLAINT, it is a QUESTION" used to reach the complaints handler and skip
the right branch entirely.

### The critic loop

```markdown
1. [[writer]] — draft the post
2. [[editor]] — review it; end your reply with APPROVED when it is ready
   loop: 3
   until: APPROVED
```

The marker must stand **alone on its own line** (case-insensitive; emphasis and
trailing punctuation are ignored). "APPROVED once the citation is fixed"
contains the word but is a rejection, and reading it as a pass would end the
loop with the correction unmade. Notes may follow on later lines, so an
approval with a list of nits still passes. When no such line appears, the
previous group and this one run again, at most `loop:` extra cycles; a loop
that exhausts its budget fails the step.

### Fan-out

```markdown
1. [[scout]] — list the competitor URLs, one per line
2. [[analyst]] — analyse this one site
   each: lines
   max: 10
```

`parallel: 2` under an `each:` step runs two instances at a time instead of
all of them — for twenty browser steps against one site, or one vendor's
rate limit. An instance waiting for a slot rents nothing, and the fan-out
event says `6 instances, 2 at a time (parallel:)`. Unset is what fan-out
always did: everything at once.

`each: lines` splits what the previous step **concluded** — its final reply,
not every turn it wrote along the way — into non-empty lines (list markers
stripped). An agent that narrates while it works ("Now let me write the
file…") does not fan those sentences out. For a list that must survive
exactly, have the step write a file and use `each: rows of`. `each: items` reads the array an earlier `output: json` step
returned. `each: rows of ../../storage/leads.csv` runs one instance per data
row, each receiving the header plus its row. Instances run in parallel and are
labelled by their item in the next group's context.

### Structured handoff

```markdown
1. [[extractor]] — return the rows you found
   output: json
2. [[checker]] — check this one row
   each: items
   verify: jq -e '.total > 0'
```

`output: json` is the one structured handoff in the grammar: the value reaches
the next group beside the prose as `<previous_step_data>` — a URL step 1 found
arrives at step 3 as the URL, not as a re-reading of step 1's paragraph — and
rides the run record as `data`. A shell `verify:` receives it on stdin.

`schema:` says what shape that value must have:

```markdown
1. [[extractor]] — return the rows you found
   output: json
   schema:
     type: array
     items:
       type: object
       required: [name, url]
       properties:
         url: { type: string, pattern: "^https://" }
```

One-line JSON works too (`schema: {"type": "array"}`), and so does a file
under the workspace (`schema: ../../schemas/lead.json`, JSON or YAML). The
schema is quoted whole in the step's prompt, so the model is told what it
must produce rather than left to guess from field names, and the value is
checked where it is parsed. One that does not fit fails the step with the
field named — `schema: the value does not fit — /0/url: does not match
^https://` — the same failure as no value at all. The check is the
hand-written subset of JSON Schema: types, `required`, `properties`,
`enum`, ranges, `pattern`, `items`, `additionalProperties`, `anyOf` /
`oneOf` / `allOf` / `not`, and a local `$ref`; formats are accepted and not
checked, so a date that must be a date belongs in a `verify:`.

### Verification is where arithmetic goes

Step options are matched as **text**, deliberately. Anything that must be
decided by a number belongs in a command that can be tested:

```markdown
   verify: jq -e '.total > 0'
   verify: contains: $34
   verify: judge: quotes the real price
```

`contains:`, `not-contains:` and `matches:` test the step's **conclusion** —
its final reply, the same text the run's headline is read from — so a step
that narrated between tool calls and then opened its answer with `BAD — …`
passes `matches: ^BAD\b`. `judge:` grades the whole result.

The command sees what the step's scripts saw — its secrets, `FOLDRUN_RUN_ID`,
`FOLDRUN_AGENT`, `FOLDRUN_WORKSPACE`, `FOLDRUN_DATE`, `TZ` — so a marker a step leaves on disk can
be checked to name *this* run. That matters: a run's copy-back never
propagates a deletion, so a marker from an earlier run rides into every later
sandbox. `judge:` is a toolless fast-tier grading call; the other four cost
nothing.

### Delegation

```markdown
2. [[triager]] — decide who should take this
   delegate: enricher, emailer, writer
```

The agent ends its reply with `agent: instruction` lines, choosing only from
the declared set (at most five). The picks run as a fresh group immediately
after, and both the set and the picks are on the record. Choosing nobody is a
normal outcome, recorded as one.

## Flow frontmatter

| field | |
|---|---|
| `name` | the flow's identity |
| `description` | what it is for |
| `trigger` | how it starts — see below |
| `schedule` / `timezone` | 5-field cron, and the zone it fires in — which is also the calendar every step in this flow works to (see below) |
| `at` | ISO 8601 instant, for `trigger: once` |
| `after` / `on` | the flow to chain on, and whether on `completed` (default), `failed` or `any` |
| `path` | the `storage/` prefix to watch, for `trigger: storage` |
| `url` / `every` | what to poll and how often (default 15m), for `trigger: watch` |
| `signature` / `signing_secret` | `github` \| `stripe` \| `slack` \| `hmac`, and the vault entry to check it against |
| `model` / `effort` | defaults for every step |
| `budget` | the most one run may spend, in USD — a number, or `unlimited`; unset is no limit |
| `overlap` | `skip` or `queue` when a run is already live |
| `priority` | `high`, `normal` or `low` — where this flow's runs stand in the queue against everyone else's |
| `idempotency` | the header (or `body:<field>`) that identifies a delivery, so the same one twice is one run |
| `throttle` | the least time between two runs of this flow |
| `debounce` | how long a burst of events must go quiet before it becomes one run |
| `catchup` | `last` (default) or `none` — what a schedule does about a fire the platform slept through |
| `disable_after` | consecutive failures after which this flow stops firing |
| `sla` | how long a run is expected to take; past it, one notification |
| `approvers` | who may decide this flow's gates — addresses, or `admins` |
| `approve_within` | how long a gate waits before the run is rejected |
| `live` | `true` to make this flow's runs real where the platform would otherwise make them [test runs](runs#test-runs): in a preview workspace, and as an eval's subject. Only ever an opt-out of the safe default |

Every duration here is written the way `wait:` is — `45s`, `10m`, `2h`, `3d`,
or bare seconds — and capped at thirty days.

### `timezone:` — the clock the steps work to

`timezone:` is one value doing two jobs: the cron fires in it, and every step
of the flow works to it. `TZ`, the date the agent is told, and `$FOLDRUN_DATE`
in its scripts and its `verify:` shell all follow it — so a flow scheduled at
08:00 Sydney writes files stamped with the Sydney date, not the container's.

It resolves nearest-wins, and each level inherits the one above unless it
says otherwise:

```
agent frontmatter → this flow's timezone: → workspace AGENTS.md →
account AGENTS.md → FOLDRUN_TIMEZONE → UTC
```

An agent that names its own zone overrides the flow's, for its steps only.
The value is either an IANA name (`Australia/Sydney`) or a plain fixed offset
— `UTC+10`, `GMT-5`, `+10:00`, `-05:30`, or a bare `UTC`:

```yaml
timezone: UTC+10
```

`foldrun check` refuses anything else. A bad value that reaches a run never
fails a step: the step falls through to the next level and says once, in the
trace, what it could not read and what it used instead.

### Triggers

| `trigger` | starts when | input |
|---|---|---|
| `manual` (default) | a person clicks Run, `foldrun invoke`, or an API call | optional task |
| `schedule` | the cron matches | none |
| `once` | the instant in `at:` passes — fires once | none |
| `webhook` | an HTTP POST reaches the flow's hook URL | the request body |
| `email` | a message arrives at the flow's inbox URL | from, to, subject, text |
| `flow` | the flow in `after:` settles the way `on:` says — `completed` (the default), `failed`, `blocked` or `any` | that run's id, status, verdict, summary, result |
| `storage` | a file lands under `path:` | the paths and who wrote them |
| `watch` | the content at `url:` changes | the new content |
| *(composed)* | another flow reaches a `[[flow:name]]` step | the previous step's results |

`on: completed` does **not** fire after a run whose verdict is `BLOCKED`: a
follow-up to a publish that refused itself should not run as if the publish
had happened. Write `on: blocked` for the flow that should react to exactly
that, or `on: any` for both.

A flow may not chain on itself. First sightings for `watch` record without
firing, and a `once` instant more than six hours gone at first sighting is
recorded and never fired.

### How many of those starts are real

A trigger says what happens. These four say how much of it becomes a run,
and each is a literal in the flow file rather than anything the platform
decides on your behalf.

`idempotency:` names where the delivery's own identifier lives — a request
header (`idempotency: x-github-delivery`) or a top-level field of a JSON
body (`idempotency: body:message_id`, case-sensitive, a scalar). The same identifier twice inside
twenty-four hours starts one run; the second delivery is answered `200`
with `started: false` and a reason, because a sender that retries must not
be told to try again. It is a **name**, never an expression: nothing is
computed, combined or nested. Only `trigger: webhook` and `trigger: email`
carry a delivery to read one from.

`throttle: 15m` is a floor between runs. A trigger arriving inside the
window is dropped and logged. Every run resets the window, including one a
person started, because the window is about how often the work happens.

`debounce: 2m` waits for the burst to stop. Each event pushes the moment
out; when the events stop for the whole window, one run starts with the
**last** event as its task and a note saying how many collapsed. A deploy
that writes forty files under a watched prefix is one run, not forty.

`catchup:` is what a schedule does about a fire that happened while nothing
was running. `last` — the default, and the behaviour that always applied —
makes one run for however many were missed. `none` skips it and waits for
the next real occurrence, for a desk whose 07:00 report is worth nothing at
11:00. A fire under a minute and a half late is never a make-up run; that is
a tick running slightly behind.

`disable_after: 5` stops firing a flow whose last five automatic runs all
failed, and sends one notification saying so. It is worked out from the runs
themselves rather than stored as a flag, so it clears itself: run the flow by
hand after a fix and one success is enough. A run a person started counts
only when it succeeds; its failure is a test, not a verdict. A run someone
stopped is not a failure of the flow either, so bulk-stopping runs after a
bad deploy never switches flows off.

`sla: 20m` is an expectation, not a limit. A run still going well past it is
reported once and **left running**: the platform sets no clock of its own,
and a slow run may still be doing the work. What to do about it is yours.

### Who answers a gate

`approvers:` is the list of email addresses that may decide this flow's
gates, or the single word `admins` for anyone at admin or above. Unset, the
existing rule applies: anyone who can run the workspace can answer.

Whatever the list says, **nobody approves a run they started themselves**. A
gate exists so a second person looks, and a run someone kicked off and then
waved through is a gate that never happened. Rejecting your own run is
always allowed — stopping something needs no second opinion. An API key
carries a role but no address, so a key passes this rule and only an
`approvers:` list constrains it.

`approve_within: 2d` stops a gate waiting forever. The deadline is stamped
when the gate opens, not when the run started, so it means two days from
being asked. Past it the gate is **rejected** and the run fails, which is
the only safe way for a clock to answer a question a person was asked.
Unset, a gate waits indefinitely, which remains the default.

### Cost and overlap

`budget: 5` is a hard cap. Between groups, a run that has reached it does
not start the next group — the rest are skipped as "over budget" and the
run fails saying so. What counts as spent is the whole bill — the tokens
**and** the sandbox seconds behind them — so a step that calls no model is
capped too. Within a group, each step launched together is given
an equal share of what is left and **stops itself mid-turn** when its
share is spent — the step's usage is priced as each turn arrives, from the
catalogue's rate for the model (a conservative Opus-class rate when the
catalogue has none) — so a fan-out of twenty steps cannot end the run
twenty steps over: the shares sum to the remainder. The stopped step fails
with `over budget — this step reached $x of its $y ceiling mid-turn`. It is
a literal, never an expression, so the cap is readable off the file. An
agent's own `budget:` — the most it may spend in one run — applies to its
steps too, and the tighter of the two wins. The workspace's and the
account's caps over time still apply on top.

`overlap:` decides what a new fire does while a run of the same flow is live.
`skip` consumes the occurrence — a cron refiring over yesterday's long run
almost never means "run two". `queue` starts it but holds it until the live one
finishes. Unset, runs may overlap.

`priority:` decides where the flow's runs stand when the platform has more
runs than slots. `high` is claimed before the round-robin, `low` after it,
`normal` (unset) takes its turn. It adds to the account's own `priority:`
(the plan's lane, set in the account's `AGENTS.md`), so a high flow on a low
account is normal. The account's `concurrency:` still bounds how many of its
runs are live at once — a high lane jumps the queue, it does not hold the
fleet.

## Model resolution

Nearest wins: the step, then the flow, then the agent's own frontmatter. The
run trace names which level won, so "why did this run on haiku" is answerable
from the run rather than by opening three files.

The consequence people miss: a flow with `model: fast` in its frontmatter
runs **every** step on the fast tier, whatever each agent's own `model:`
says. To lift one step, put `model:` on that step. A file-composing step is
the one to check — on the fast tier an agent asked to write a long file may
write it a line per call, re-sending its whole context each time; one
translator did that 92 times and cost $22 for twelve lines. The run trace
shows the tier (`model: haiku — flow`) and the write count.

## What the platform never does

It sets **no clock of its own** — not on a step, a script tool, an HTTP tool, a
verify command, a consult, or a wait for a person. Every limit that exists is
one written in a markdown file. The run's events say which it is (`timeout:
3000s` or `no timeout`) at every step start.

Three bounds a step can carry, one each for money, time and turns:
`budget:` (on the flow or the agent) stops it mid-turn at its share;
`timeout: 15m` stops it at the clock, whether or not a message has arrived
— a step waiting on one long tool call is cut at the limit, with the files
it wrote so far kept; `max_turns: 20` stops it after that many model turns
(a reply and its tool calls is one), failing with `stopped after 20 turns
(max_turns: in the flow file)` and what it spent on the record.

A value the option cannot read is a check error, never a guess: `timeout:
abc`, `retry: 9`, `loop: 0`, `each: columns`, `output: yaml` each fail
`foldrun check` naming the line. Before this, `timeout: 15m` ran as one
second.

A required step failing fails the flow, and the remaining groups are skipped. A
workspace with one agent and no flows is normal — `foldrun run <agent>` runs it
as a one-step flow, so there is a single execution path either way.
