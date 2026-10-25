# The four jobs

Running agents is four jobs, and every setting that controls them does one:

| Job | What it decides |
|---|---|
| **Governance** | who answers for it, and what it may spend, decide and ship |
| **Guardrail** | what it may reach and call, and what stops it mid-run |
| **Observability** | what is recorded, and who is told |
| **Evaluation** | how its work is judged |

These are the same settings foldrun has always had. You can write each one at
the top of the file, as before, or group them under the job they do:

```yaml
---
name: blog-desk
governance:
  owner: ops@acme.io
  budget: 60/month
  deploy_block: secrets
guardrail:
  limits: {calls: 300, repeat: 5}
  network: trusted
observability:
  notify: {email: ops@acme.io, events: [failed]}
  alerts: {failure_rate: 30%, new_host: true}
evaluation:
  judge: {model: fast}
---
```

reads exactly as `owner:`, `budget:`, `limits:` and the rest written at the
top. Either way works, and the two can be mixed in one file.

## Which field belongs to which job

| File | `governance:` | `guardrail:` | `observability:` | `evaluation:` |
|---|---|---|---|---|
| `AGENTS.md` | `owner`, `budget`, `priority`, `concurrency`, `deploy_block` | `limits`, `network`, `network_enforce`, `hooks` | `alerts`, `telemetry`, `notify`, `capture` | `judge` |
| an agent | `owner`, `budget` | `limits`, `network`, `hooks`, `disallowedTools`, `permissionMode`, `secrets`, `sandbox` | — | — |
| a flow | `owner`, `approvers`, `approve_within`, `budget`, `priority` | `throttle`, `debounce`, `overlap`, `disable_after`, `live` | `issues`, `sla` | — |

A field that does none of the four, such as `name`, `model`, `tools`,
`trigger` or `schedule`, is written at the top. Step options in a flow, such
as `verify:` and `limits:` under a step, stay where they are.

## The rules

- **One place, not both.** A field written at the top *and* inside its block
  is refused: `foldrun check` and a deploy stop on
  [`config/conflict`](checks#config-conflict) until one is removed.
- **The right block.** A setting inside another job's block is not read —
  a guardrail under `governance:` would guard nothing — so check refuses it
  and says which block it belongs in
  ([`config/misplaced`](checks#config-misplaced)).
- **Editing keeps the form.** Settings, the CLI and the flow canvas edit a
  field where it is written, inside its block or at the top, and add a new
  one at the top. A block written on one line (`guardrail: {network: [a.com]}`)
  is not rewritten for you: the edit is refused (`409`) and asks for the block
  one key per line.
- **Only the three settings files.** Blocks are read in an agent's
  `agent.md`, a flow and `AGENTS.md`. In knowledge, memory, skills and every
  other document, `governance:` and the rest are that document's own words
  and are left as written.
- **The cascade is unchanged.** The account's `AGENTS.md`, then the
  workspace's, then the agent, then the step: a block at one level and a flat
  key at another combine exactly as two flat keys would.

## `judge:` — the evaluation default

`judge: {model, effort}` in `AGENTS.md` is the model, and how hard it
thinks, for every grader in the workspace: each eval's `judge:` checks and
every flow step's `verify: judge:`. An eval that names its own `model:` keeps
it. Unset, judges run on the fast tier. Field by field, the workspace's wins:
a workspace that sets only `effort` keeps the account's `model`.

## Where each job shows

| Job | In the dashboard | In the CLI |
|---|---|---|
| Governance | Settings → Governance: owner, budget, deploy rules, pause, team, API | `foldrun jobs`, `foldrun account set governance.<field>` |
| Guardrail | Settings → Guardrail: network enforcement; each agent's page | `foldrun check --security`, `foldrun agent network` |
| Observability | Settings → Observability: notify, alerts, telemetry; Observe, Issues | `foldrun issues`, `foldrun account telemetry` |
| Evaluation | Settings → Evaluation: the judge; the Evals page | `foldrun eval --to <workspace>` |

`foldrun jobs` prints all four; with `--to <workspace>`, each field's value
there, the account's, and how the two combine. They do not all simply
override: `network_enforce` is on when either turns it on, a workspace's
`budget` and the account's both apply, `hooks` run from both, `network`
takes its level from the nearest setting and its sites from every level, `limits` merge key by key, `judge`
field by field, and `priority` and `concurrency` are read from the account
alone. The rest — `owner`, `notify`, `alerts`, `telemetry` and others — the
workspace's replaces the account's whole. Fields the CLI cannot set (`limits`,
`network`, `hooks`, `capture`, …) are written in `AGENTS.md`.
