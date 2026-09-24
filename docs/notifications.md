# Notifications

An agent that runs while the laptop is closed needs a way to say "I
finished", "I failed", and above all "I am waiting for you". A run parked at
an approval nobody hears about is a run that never happens. Notifications are
one destination — an email address or a webhook URL — declared once in
`AGENTS.md`, and a short list of the events that should reach it.

## Declaring one

```yaml
notify:
  email: ops@example.com
  events: [failed, awaiting-approval, completed]
```

or, for people who live in a channel rather than an inbox:

```yaml
notify:
  url: ${SLACK_WEBHOOK_URL}        # a secret name, or a literal URL
  events: [failed, awaiting-approval]
```

A bare string is whichever destination it looks like: `notify: ops@example.com`.

A webhook can also be signed, so the receiver can tell a real notification
from anyone who learned the URL:

```yaml
notify:
  url: ${OPS_WEBHOOK_URL}
  signing_secret: OPS_WEBHOOK_SIGNING_KEY   # a secret NAME, never its value
```

Every delivery then carries `x-foldrun-timestamp` and
`x-foldrun-signature: sha256=<hex>`, the hex HMAC-SHA256 of
`"<timestamp>.<body>"` keyed by that secret. The timestamp is inside the
signed string, so a captured delivery cannot be replayed later with a fresh
one. Beside it, `x-signature` is the plain HMAC of the body — the scheme an
inbound `signature: hmac` flow verifies — so one foldrun install can notify
another's webhook flow and be accepted. Name no secret and nothing is
signed, which is what every existing destination keeps doing.

The default events are `failed` and `awaiting-approval`. `completed` is
opt-in on purpose: a schedule that works is the quiet kind of good news, and
a channel that pings on every success gets muted — which un-pings the
failures too. Turn it on when the run's headline is the thing you want to
read each morning, which for a scheduled desk it usually is.

Even with `completed` on, an eval case (`eval:<name>`) or an adhoc
single-agent run (`adhoc:<agent>`) completing sends nothing: the person who
started it is watching it, and a desk that emailed every test would bury
its weekly verdict. A test that fails, or parks at a gate, still sends.

## `blocked` — a run that finished but did nothing

Every desk ends its last step on a verdict word: `GOOD`, `BAD`, `QUIET` or
`BLOCKED`. The platform reads that word from the run's summary and records it
beside the status. A run can be `completed` — every step ran, nothing
crashed — and still be `BLOCKED`: the publisher checked, saw something
wrong, and refused to push. That is a success of the machine and a failure
of the work, and a green tick hid it.

So a completed run whose verdict is `BLOCKED` is sent as its own event,
`blocked`, with the headline `⛔ <flow> blocked` and `verdict: "BLOCKED"`
in the body. **It follows `failed`**, like the alerts below: a destination
that hears about failures hears about it, and a `completed`-only list does
not. Name `blocked` alone to hear only those. Every run notification's body
carries `verdict` — `GOOD`, `BAD`, `QUIET`, `BLOCKED`, or `null` when the
summary leads with none.

## The three that are about nothing happening

`failed`, `completed`, `blocked` and `awaiting-approval` are all about a run. Three
more events are about a run that **did not** happen, or has not finished,
which is the class of failure that otherwise reaches nobody:

| event | sent when |
|---|---|
| `quarantined` | a flow's `disable_after:` tripped and it has stopped firing |
| `sla` | a run has passed its flow's `sla:` and is still going |
| `budget` | a workspace has spent 80%, then 95%, of its `budget:` for the window — today, this week or this month |

Each is sent once per occurrence, not once per check: an alarm that repeats
every thirty seconds gets muted, and a muted alarm is the same as no alarm.
The budget marks reset with the month, and a quarantine is forgotten as soon
as the flow succeeds again, so the next outage is announced as its own.

**They follow `failed`.** If a destination is told about failures it is told
about these too, because each one is a failure that produces no failed run —
and nobody thinks to opt in to hearing about something that has not
happened. Naming one explicitly in `events:` also turns it on. To have none
of them, leave `failed` out of the list.

## Proving it arrives

A notification path that has never been tested is not a notification path.
Every message here is sent when nobody is watching, to a destination nobody
has checked, through a mail domain nobody has verified — and on 2026-09-06
every run email had been going to a bin for weeks, with silence as the only
symptom. Silence looks exactly like nothing having gone wrong.

Workspace settings has a button that sends one real message to the saved
destination and reports what came back, including the provider's own words
on a failure. Those words are the value: "domain not verified" and "you can
only send to your own address" send you to two different pages, and a status
code sends you to neither. `POST /api/workspaces/<ws>/notify/test` is the
same thing.

## Where it is set, and the rule that bites

`notify:` lives in the account's `AGENTS.md` and every workspace inherits it.
A workspace may declare its own — and when it does, its block **replaces**
the account's whole, it does not merge. A workspace that wants the account's
destination and events simply says nothing.

## What arrives

**The subject is the run's headline** — the first line of the last step's
reply — followed by its summary. Ids and costs are in the body. The subject
is meant to be read on a phone: "BAD — 3 targets fell out of the top 20" is
the whole message; "run-mtmv20up-oote completed" is not.

The body, and the webhook's JSON:

```json
{
  "text": "BAD — 3 targets fell out of the top 20 · rank-desk/run-… · $1.01",
  "workspace": "rank-desk", "runId": "run-…", "flow": "rankings",
  "status": "completed", "summary": "…", "costUsd": 1.01,
  "startedAt": "…", "finishedAt": "…",
  "approveUrl": "…", "rejectUrl": "…",
  "links": [{ "step": 3, "agent": "publisher", "approveUrl": "…", "rejectUrl": "…" }]
}
```

`text` is what Slack, Discord and ntfy render as-is; the rest is for anything
that wants the data. A webhook URL is the one integration: those services,
and every phone-push relay, all accept a POST of that shape.

## Approve and reject links

A run parked on a person sends its notification with two links per waiting
step — `links` carries every pair, `approveUrl`/`rejectUrl` the first.
Clicking one opens a page that shows what is waiting and asks for the
decision — it never decides on the GET, because inbox link-checkers follow
links. The token in a link is bound to that one step, to a moment (the
flow's `approve_within:`, else a week), and — when the mail went to an
address in the flow's `approvers:` — to that person, so a forwarded mail
decides as nobody. It is derived, never stored; a key rotation kills every
old link at once, and a link that has decided is spent. A `wait: event` park
gets no link: it is waiting for a machine.

The links exist only when the install knows its own public address
(`FOLDRUN_PUBLIC_URL`). Without it the notification goes out without them and
the run is approved from the dashboard.

## Email

Notification email is **your mail**: a desk telling its owner what it
found comes from the sender you chose. Set `RESEND_API_KEY` and
`EMAIL_FROM` as account secrets — the same connection your agents' `email`
tool uses — and every notification goes out through your key, from your
address, under your domain's reputation and your inbox's rules. `EMAIL_FROM`
must be an address the Resend account behind that key may send from (a
verified domain, or Resend's onboarding sender for testing).

An account that has set neither still gets its notifications: they fall
back to the platform's connection and come from `foldrun <hello@foldrun.io>`.
An invite and a low-balance warning are the platform's own mail and always
come from foldrun; the platform never sends those through your key.
