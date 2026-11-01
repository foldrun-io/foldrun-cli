# A2A: outside agents

[A2A](https://a2a-protocol.org/v1.0.0/specification/) (Agent2Agent) is an
open protocol for one agent to hand a task to another agent run by somebody
else. foldrun speaks the released **1.0** version, over JSON-RPC 2.0 on HTTP,
in both directions:

- **Serving:** you publish a flow, and an outside agent holding an A2A key
  sends it a request, follows the task, and reads the result.
- **Calling:** an agent of yours lists outside agents in `remotes:` and calls
  them with four tools.

Your own files do not change shape for either. A2A is a door at the edge: a
published flow is the same flow, and a remote is reached the way an `apis:`
entry is.

## Publishing a flow

A flow is served over A2A when its frontmatter says so:

```markdown
---
trigger: manual
a2a:
  publish: true
  name: Lead researcher               # the agent card's name; else the flow's
  description: Finds three qualified leads for a business type and city.
  examples: ["Dentists in Perth", "Accountants in Hobart"]
  public_card: false                  # true: the card is readable without a key
  input:                              # optional: a JSON Schema the request's data part must match
    type: object
    required: [city]
    properties: { city: { type: string } }
---

1. [[researcher]] — Find three leads for the request.
2. [[writer]] — Write them up as a short list.
```

| key | |
|---|---|
| `publish` | required, `true` or `false`. `false` keeps the block and serves nothing |
| `name` | the card's (and its one skill's) name, up to 100 characters. Unset: the flow's name |
| `description` | what a caller reads about it, up to 2,000 characters. Unset: the flow's `description:` |
| `examples` | up to 10 example requests, 500 characters each |
| `public_card` | `true` lets anyone read the card without a key. Calling the flow always needs one. Default `false` |
| `input` | a JSON Schema (up to 16,000 bytes as JSON). With it, every request must carry a data part that matches it, and a request that does not is refused before anything starts |

A block `foldrun check` cannot read publishes nothing — a typo never opens a
flow nobody meant to open. Whether a flow is published is the workspace's
policy, so changing `a2a:` needs the **admin** role (`workspace:manage`) by
every door: the editor, a deploy, `PATCH /flows/<f>`, `PUT /source`. An
editor's change that leaves `a2a:` as it was goes through.

From the dashboard: **Flows**, the flow's card, **Publish over A2A…**
(admins only; others see it read-only) — it edits the block through
`PATCH /api/workspaces/<ws>/flows/<f>` `{ a2a: {…} }` (merged over what the
flow says: a key sent replaces it, `null` removes it, `a2a: null` removes the
block) and shows the card URL and a `curl` to try it. From the terminal:

```sh
foldrun a2a publish lead-finder --to sales --name "Lead researcher" --description "Finds three leads"
foldrun a2a card lead-finder --to sales      # the card URL, and the card
foldrun a2a ls --to sales                    # what the workspace serves, and its recent tasks
foldrun a2a unpublish lead-finder --to sales
```

The workspace's **Triggers** page, section **Outside agents (A2A)** (and
`GET /api/workspaces/<ws>/a2a`), lists every
flow that says `a2a:`, its card and endpoint URLs, the workspace's A2A keys and
the newest tasks with the key that asked.

`foldrun check` warns on a published flow that is risky to open
([below](#security)).

## A2A keys

A caller needs an **A2A key**: a key of its own kind, minted by an admin of
the workspace, for one workspace and the flows it names.

```sh
foldrun keys create "Partner CRM" --a2a --to sales --flows lead-finder,quote --max-tasks 5
```

or **Settings → API keys**, kind **A2A key**: the workspace, the published
flows it may call, and how many tasks it may have open at once. The key is
shown once.

- It opens `/a2a/<account>/<workspace>/…` for its flows and nothing else.
  Every `/api` route refuses it (`403`): not runs, not source, not approvals,
  not storage, not secrets.
- A flow must be both **named by the key** and **published**. Both are read
  on every call, so unpublishing a flow closes it to every key at once.
- `maxTasks` — its tasks open at once, 1 to 100, default 10. Past it,
  `SendMessage` is refused with `TOO_MANY_TASKS` until one ends or is
  canceled.
- It expires, is revoked and is rotated like any key (`expires`,
  `foldrun keys rotate`). A task belongs to the key that made it; a rotated
  key keeps its predecessor's tasks, so the caller can still read and cancel
  them.
- It counts in its account's rate limit with its own bucket, like any key.

The API: `POST /api/keys { purpose: "a2a", workspace, flows, maxTasks?, label?, expires? }`
([api](api#account)).

## Calling a published flow

Each published flow has three addresses. `<account>` is your account's name;
the flow's page and `foldrun a2a card` show them whole.

| | |
|---|---|
| `GET /a2a/<account>/<ws>/flows/<flow>/.well-known/agent-card.json` | the agent card: name, description, examples, the endpoint, `streaming: false`, `pushNotifications: false`, and the bearer scheme. With a key that names the flow, or without one when `public_card: true` |
| `POST /a2a/<account>/<ws>/flows/<flow>` | the JSON-RPC endpoint |
| `GET /a2a/<account>/<ws>` | the flows this key may call here, each with its card and endpoint — a convenience index, not an A2A operation |

Every call sends the key as `Authorization: Bearer mda_…` and the protocol
version as `A2A-Version: 1.0` (or `?A2A-Version=1.0`). A request without the
header is A2A 0.3, which is not served: it is answered
`VersionNotSupportedError` (`-32009`). A session cookie never opens `/a2a`.

Send a request:

```sh
curl -sS https://foldrun.example.com/a2a/acme/sales/flows/lead-finder \
  -H "authorization: Bearer $A2A_KEY" \
  -H "a2a-version: 1.0" \
  -H "content-type: application/json" \
  -d '{
    "jsonrpc": "2.0", "id": 1, "method": "SendMessage",
    "params": {
      "message": {
        "messageId": "req-2026-11-01-001",
        "role": "ROLE_USER",
        "parts": [
          { "text": "Dentists, please." },
          { "data": { "city": "Perth" }, "mediaType": "application/json" }
        ]
      },
      "configuration": { "returnImmediately": true }
    }
  }'
```

The answer is the task:

```json
{ "jsonrpc": "2.0", "id": 1, "result": { "task": {
  "id": "6f0c…", "contextId": "b41e…",
  "status": { "state": "TASK_STATE_SUBMITTED", "timestamp": "2026-11-01T09:00:00.000Z" },
  "history": [ { "messageId": "req-2026-11-01-001", "role": "ROLE_USER", "parts": [ … ] } ]
} } }
```

Then poll it until it ends:

```sh
curl -sS https://foldrun.example.com/a2a/acme/sales/flows/lead-finder \
  -H "authorization: Bearer $A2A_KEY" -H "a2a-version: 1.0" -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"GetTask","params":{"id":"6f0c…"}}'
```

From the terminal, `foldrun a2a call <card-url> "<text>" [--data '{"city":"Perth"}'] [--key-env A2A_KEY]`
does the same against any A2A 1.0 agent, and `foldrun a2a status|cancel <task-id> --card <url>`
follows one.

### What is served

| method | |
|---|---|
| `SendMessage` | starts the flow. **Blocking by default**: it waits up to 25 seconds (`FOLDRUN_A2A_WAIT_MS`, at most 120) for the run to end, then answers the task as it stands — the caller polls `GetTask` from there. `configuration.returnImmediately: true` answers at once. `configuration.historyLength` trims the history. `acceptedOutputModes` must include `text/plain` or `application/json` (or a wildcard) |
| `GetTask` | the task by `id`, with `historyLength` |
| `ListTasks` | this key's tasks on this flow, newest state change first: `pageSize` (1–100, default 50), `pageToken`, `status` (a `TASK_STATE_*`), `contextId`, `statusTimestampAfter`, `includeArtifacts`, `historyLength`. Answers `tasks`, `nextPageToken` (empty on the last page), `pageSize`, `totalSize` |
| `CancelTask` | stops the run; its trail says "cancelled by A2A caller <key label>". Idempotent: a canceled task canceled again is answered as it is. A task that already ended otherwise is `TaskNotCancelableError` (`-32002`), and so is one still starting (try again in a moment) |

Not served, each answered with the error the spec names: `SendStreamingMessage`
and `SubscribeToTask` (`UnsupportedOperationError`, `-32004` — poll instead),
the four push-notification methods and a `taskPushNotificationConfig` on a
send (`PushNotificationNotSupportedError`, `-32003`), and
`GetExtendedAgentCard` (`-32004`). An unknown method is `-32601`. Batches are
not taken: one request object per call.

A task takes **one message**. A follow-up `SendMessage` with the task's
`taskId` is refused (`-32004`); send a new message without `taskId`, with the
`contextId` to keep the conversation together.

### Retries: `messageId`

`messageId` is the request's identity. Send the same message again with the
same `messageId` — after a timeout, a dropped connection — and you get the
task it already made; nothing starts twice. The same `messageId` with a
different message (other parts, context or metadata) is refused
(`-32602`, `InvalidParams`): a new message needs a new id. The JSON-RPC `id`
is only correlation and plays no part. A refused start (busy, paused, out of
funds) makes no task, so the same message may be sent again later as it is.

### What a request may carry

Text and JSON only. At most 16 parts; the text parts together at most 32,000
characters; one data part (`application/json`) of at most 64,000 bytes; a
request body at most 1 MiB. A `raw` or `url` part (a file) is refused with
`ContentTypeNotSupportedError` (`-32005`). With `input:`, the data part must
match the schema, and the refusal names each field that does not.

The request reaches the flow's first step fenced and marked as coming from an
outside agent — data to work on, not instructions that change the agent's
role, tools or limits.

### Task states

| the run | the task |
|---|---|
| queued, not started | `TASK_STATE_SUBMITTED` |
| running, waiting (`wait:`), parked for a person | `TASK_STATE_WORKING` |
| completed | `TASK_STATE_COMPLETED` |
| failed | `TASK_STATE_FAILED` |
| stopped (by `CancelTask` or a person) | `TASK_STATE_CANCELED` |

**A person's part stays with your people.** A step with an approval (`!`),
an `ask:`, or an agent asking a question (`tools: [ask]`) shows the caller
`TASK_STATE_WORKING` with the status message "waiting for a person" — never
who, never a link, never an address. No A2A call can approve, reject or
answer: those are your team's, in the dashboard, the inbox or the emailed
link, as for any run. A blocking `SendMessage` waits through a gate only as
long as its bound, then answers WORKING.

On `TASK_STATE_COMPLETED` the task carries one artifact, `result`: the
flow's final result as a text part (`text/plain`, at most 64,000 characters),
and a data part (`application/json`, at most 256,000 bytes) when the last
step answered `output: json`. Nothing else of the run is shown — no run id,
steps, agents, costs, approvers or files. No files go out, no stream, no push.

### Errors

Errors are JSON-RPC error objects with a `google.rpc.ErrorInfo` in `data`. A
request foldrun cannot take **now** is `-32000` with a foldrun reason:

| reason | |
|---|---|
| `BUSY` | the flow is `overlap: skip` and a run is live — send the same message later |
| `PAUSED` | the workspace or account is paused |
| `UNAVAILABLE` | out of budget or funds, or otherwise not taking work |
| `RATE_LIMITED` | the key's rate limit (`429` from the proxy carries `Retry-After`) |
| `TOO_MANY_TASKS` | the key has `maxTasks` open |
| `UNAUTHENTICATED` | no key, or a wrong, revoked or expired one (HTTP `401`) |
| `PERMISSION_DENIED` | a key that is not an A2A key (HTTP `403`) |
| `AGENT_NOT_FOUND` | the flow is not published, not named by the key, or not there — all alike (HTTP `404`) |

A task of another key, flow or workspace is `TaskNotFoundError` (`-32001`),
never "not yours".

A run started over A2A goes through the same admission as one started from
the dashboard: pause, money, `budget:`, plan limits and `overlap:` hold for an
outside agent exactly as for a person. In the runs list and on the run page
it shows **A2A · <key label>**.

## Calling outside agents: `remotes:`

An agent of yours may call A2A agents somebody else runs. You list them; the
agent calls them by name.

```yaml
---
name: buyer
remotes:
  - name: invoice-checker
    card: https://agents.example.com/.well-known/agent-card.json
    secret: INVOICE_AGENT_TOKEN       # optional: a vault NAME, sent as a bearer token
    description: Checks an invoice against its purchase order.
limits: { a2a: 10 }
---
```

It gets four tools — `a2a_send`, `a2a_status`, `a2a_reply`, `a2a_cancel` —
that work by **handle**: a send answers a handle at once and waits a bounded
time (default 60 seconds, at most 300) for the answer; a wait that runs out
says "still running", and `a2a_status` picks it up. A slow remote is never
sent the request twice. The model never sees the card URL or the token.

- The card's own site joins the agent's [network](network), and nothing the
  card says does: a card whose interface is at another origin is refused.
- The secret is bound to the card's origin and filled by the egress proxy on
  the way out; it never enters the sandbox.
- What a remote answers is untrusted — fenced as data from someone else's
  system.
- `limits: {a2a: N}` caps the messages a step sends; `a2a.status` caps
  polling apart from sending.
- Test runs send nothing.

Every field and rule is in [agents](agents#calling-an-outside-agent-remotes).

## Limits

| | |
|---|---|
| card name / description | 100 / 2,000 characters |
| examples | 10, of 500 characters each |
| `input:` schema | 16,000 bytes as JSON |
| a request | 16 parts; 32,000 characters of text; one data part of 64,000 bytes; 1 MiB body |
| a result | 64,000 characters of text; 256,000 bytes of JSON |
| an A2A key | up to 50 flows; 1–100 tasks open (default 10) |
| a blocking `SendMessage` | 25 s by default, at most 120 s (`FOLDRUN_A2A_WAIT_MS`) |
| `ListTasks` | 100 a page |
| a calling step | 50 messages and 600 polls, whatever `limits:` says |

Ended tasks are kept 90 days.

## Security

- **Everything a caller sends is untrusted input.** It reaches the first step
  as data, fenced; your tool grants, network, bound secrets and human gates
  hold whatever it says. Publishing does not widen what an agent may do — it
  widens who can ask.
- **`foldrun check` warns on two shapes** of published flow (warnings, not
  errors): [`security/published-flow-trifecta`](checks#securitypublished-flow-trifecta)
  — a step agent that holds something private and has a way out, which a
  caller could steer into sending it; and
  [`security/published-flow-ungated`](checks#securitypublished-flow-ungated)
  — a step that acts outside the workspace with no approval or `ask:` before
  it, which any key holder starts. Put a gate (`2!.`) on it, or take a leg
  away.
- **A public card is metadata only**: the name, description and examples you
  wrote, the endpoint and the auth scheme — never steps, agents or files.
  It never lets anyone call the flow. Anonymous card reads are rate-limited.
  Without a key, a private card and no card answer the same `401`.
- **Tokens never enter a sandbox**, in either direction: an A2A key is
  checked at the edge and never reaches the run; a remote's secret is filled
  by the egress proxy for that remote's origin alone.
- **Nothing a caller does reaches your people's decisions.** Approvals and
  questions stay in foldrun; the caller sees only "waiting for a person".
