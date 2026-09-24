# Troubleshooting

The failures people actually hit, what the platform is telling you, and the
fix. Every one of these leaves its reason in the run's events; read those
before anything else.

## When a provider says no

The status code decides what happens next, and the runtime already acts on
the difference:

| code | what it means | what the runtime does |
|---|---|---|
| **400** | the request is malformed | fails the step — retrying sends the same thing |
| **401 / 403** | not signed in, or not allowed | tries the fallback provider if one is declared |
| **402** | out of credit | fallback provider; often a reservation against a large token ceiling rather than an empty account |
| **404** | no such model or path | fails; usually a base_url with the wrong `format:` |
| **422** | understood and refused | fails, with the reason in the step's output |
| **429** | too many requests | **waits and asks again** — up to three times, 2s / 4s / 8s with jitter, honouring a `retry-after` the provider names, on the same key. A 429 that mentions quota, credit or billing is the account, not the traffic, and goes to the fallback instead |
| **500 / 502 / 503 / 529** | broken or busy at their end | same wait-and-retry as 429 |

Every wait is a line in the run log (`provider busy … waiting 3.4s, attempt
1 of 3`), so a slow run reads as slow rather than mysterious. Only after the
retries are spent is the fallback provider tried.

## "verify … → no match"

The step's `verify: matches:` or `contains:` did not find its text in what
the agent concluded. The check reads the step's **final reply**, and its
first line is the run's headline — so a reporter that opened with "Done."
and put the verdict on line three fails a `^BAD` check with the right
verdict sitting there. Tell the agent the first line *is* the verdict, and
move a step that cannot manage it to a stronger tier.

## "each: the previous group produced no items"

`each: lines` splits what the previous step concluded into lines and found
none. Usually the step wrote its list to a file and replied with a sentence.
Either have it reply with the list, or use `each: rows of <file>` — a file
has no turns and is the better contract for a list that must arrive exactly.

## "over budget — $x spent of the flow's $y"

The run crossed its `budget:` between two groups; the remaining steps were
skipped. Look at which step spent it: a fast-tier agent writing a file one
line per call, re-sending its whole context each time, is the usual culprit.
Put `model:` on that step, tell the agent to write each file once, and set
the cap at two or three times a normal run so real work never trips it.

## "over budget — nothing left to spend before this step (budget: on the … agent)"

The agent's own `budget:` — the most it may spend in one run — was used up
by its earlier steps in this run, so this one was refused before it started.
Raise the number in that agent's `agent.md`, or take it out: unset is no
limit. The same line with `budget: in the flow file` is the flow's cap and
lives there instead.

## "is at its budget — $x spent today of $y/day"

A cap over time, reached. New runs refuse until the window turns — tomorrow,
next week, the new month — in the account's own `timezone:`. Raise it in
Settings or in the file, or remove the line.

## "was denied: … is outside this workspace"

The agent reached for a path outside its workspace — `/tmp/something`, an
absolute path, a checkout a tool made — and was refused. The message names
the path it probably meant. It costs a turn, nothing more; if one step
collects many, name the exact path in its prompt (`workspace/storage/x.md`,
`git_repo action=read path=…`).

## "this push is not live yet — runs in flight"

The push was accepted and will apply when the runs finish. A run parked at
an approval gate counts. Decide the gate, or wait; `foldrun deploy --force`
applies over a running flow when you mean it.

## "missing `type:` — OKF requires a non-empty type on every concept"

A file under `knowledge/` has no `type:` in its frontmatter. Add one
(`type: Reference` is fine for a table or a list); the push is refused
until it is there.

## The run is parked and nobody knows

Check the account's `notify:` — a workspace that declared its own block
replaced the account's whole, and may have dropped `awaiting-approval`. The
dashboard banner shows every parked run across workspaces regardless.

## It ran on the wrong model

`model:` resolves nearest-wins: the step, then the flow, then the agent. A
flow with `model: fast` in its frontmatter runs every step on the fast tier
whatever each agent says. The run trace names which level won
(`model: haiku — flow`). Put `model:` on the step to lift one.

## The schedule fired more often than it should

When day-of-month and day-of-week are both restricted, cron ORs them.
`0 5 1-7 * 5` fires every Friday and every day of the first week. Use a
plain day of month for a monthly job.

## Approval emails have no links

The install has no `FOLDRUN_PUBLIC_URL`, or it points at an address that no
longer resolves. The worker logs why, once. Set it to the origin people
actually reach the install on.

## A step's file never appeared in Storage

The agent wrote to `outputs/` (the run's scratch, archived with the run) or
to a path relative to somewhere it was not. Deliverables go to
`workspace/storage/`; the run page's Out column shows what actually landed
and where.

## The browser came back with `[page rendered empty]`

The page loaded, but nothing was on it — and the reason is in the same run
log, one line above `page: <url>`: `page errors:` (an uncaught error in the
page's own script), `page console:` (what it logged as an error),
`requests failed:` (a script or an API call that never landed) or
`requests refused:` (one the server answered 4xx/5xx). A single-page app
that renders after load usually shows as none of these — give it a
`wait_for` selector. A blocked resource you asked to `block` is never
counted. For the whole picture, call again with `mode: network`: the page's
own status and redirect chain first, then every request it made.

## A browser action on `"@e4"` failed

The number came from the last `mode=aria` in the same `session`, and the
next call loaded the page fresh, so the tool looked for what the number
pointed at — its role and name — and the message says which of three things
happened:

- `nothing is numbered yet` — no `mode=aria` ran in this `session` first,
  or it ran under a different `session` name. The numbers are per session.
- `is not on the page now` — the element is gone: a different page, a
  signed-out view, a list that changed. Read it again with `mode=aria`.
- `the page has 3 of those now and had 2` — the same button appears a
  different number of times than when it was numbered, so which one was
  meant is a guess the tool will not make. Read it again with `mode=aria`.

In each case the fix is the same: take a fresh `mode=aria`
(`interactive=true` for just the controls) and use its numbers. An element
with no role and no text — a bare wrapper — cannot be found again at all;
use a CSS selector for it.

## The browser's output was cut at 18,000 characters

The cap is on what the model sees, not on what was kept. `mode: markdown`
writes all of it to `outputs/page.md`, `meta` to `outputs/meta.json`,
`table` to `outputs/tables.json`, `network` to `outputs/network.json`, an
`extract` step to `outputs/extracted.json` — the truncation line names the
file. Read the file in the next step, or narrow the call: `wait_for` a
specific section, `block="image,font,media"` so the page is text, or an
`extract` step whose rows are exactly what you wanted.
