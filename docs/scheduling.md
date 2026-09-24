# Scheduling and triggers

A flow starts when its trigger fires. The default is a person — a button, an
API call, `foldrun invoke` — and everything else is a line in the flow's
frontmatter.

## Triggers

| `trigger` | starts when | the first step is handed |
|---|---|---|
| `manual` (default) | a person clicks Run, `foldrun invoke`, or an API call | an optional task |
| `schedule` | the cron matches | nothing |
| `once` | the instant in `at:` passes — fires once | nothing |
| `webhook` | an HTTP POST reaches the flow's hook URL | the request body |
| `email` | a message arrives at the flow's inbox URL | from, to, subject, text |
| `flow` | the flow in `after:` settles the way `on:` says | that run's id, status, summary, result |
| `storage` | a file lands under `path:` in this workspace's storage | the paths and who wrote them |
| `watch` | the content at `url:` changes (polled every `every:`, default 15m) | the new content |

A flow may not chain on itself. `watch` records its first sighting without
firing. A `once` more than six hours gone at first sighting is recorded and
never fired, so a flow deployed late does not run yesterday's job today.

## Schedules

```yaml
---
name: rankings
trigger: schedule
schedule: "0 5 * * 3"          # five-field cron
timezone: Australia/Sydney     # IANA zone; UTC if unset
overlap: skip                  # or queue; unset, runs may overlap
catchup: last                  # or none — what a fire missed while down becomes
budget: 5
---
```

`overlap:` decides what a new fire does while a run of the same flow is
live: `skip` consumes the occurrence — a cron re-firing over yesterday's
long run almost never means "run two" — and `queue` starts it and holds it
until the live one finishes.

`catchup:` decides what a missed fire becomes. Nothing runs while the
platform is down, and when it comes back the default — `catchup: last` — makes
**one** make-up run, however many fires were missed. `catchup: none` skips it
and waits for the next real occurrence, which is what a 07:00 report wants
when it is noticed at 11:00. A fire a minute or so late is never treated as a
make-up run: that is a tick running slightly behind.

`throttle:`, `debounce:`, `idempotency:` and `disable_after:` shape how often
a trigger becomes a run at all, and are described in
[the flow reference](flows.md).

**The cron trap worth knowing.** When both day-of-month and day-of-week are
restricted, they are OR'd, not AND'd — by this scheduler and by cron itself.
`0 5 1-7 * 5` looks like "the first Friday" and fires every Friday *and*
every day of the first week: about eleven runs a month. For a monthly job,
use a plain day of month (`0 5 3 * *`) and let the weekday go.

## One desk per day

A pattern that has held up: give each scheduled flow its own morning, so a
day's spend and a day's failure are one thing to read about. Put the flow
that writes to a shared repository on the day nothing else does — two flows
committing to the same `main` in one morning is a merge conflict at best.
Run the cheap measurement before the expensive action, so the action reads a
fresh measurement.

## Webhooks and inboxes

A `webhook` flow has a hook URL —
`/api/hooks/<account>/<workspace>/<flow>?token=…` — and an `email` flow an
inbox URL of the same shape. The token is derived, not stored; rotating it
(`POST …/hooks/<flow>/rotate`) stops every old URL at once. A flow with
`signature: github | stripe | slack | hmac` and a `signing_secret:` also has
the provider's signature checked, and a Slack `url_verification` body is
answered with its challenge and starts nothing.

## Chaining

```yaml
trigger: flow
after: rankings
on: completed        # or failed, or any
```

The chained flow's first step is handed the finishing run's id, status and
summary — and its result, so a flow that reports on another flow reads what
it concluded rather than re-deriving it.

## Composition

A step may name a flow instead of an agent — `1. [[flow:weekly]] — …` — and
that flow's steps run in place, keeping their own parallelism. Cycles, and
nesting past three levels, are errors `foldrun check` reports.
