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
| `model` | the **judge's** tier, not the subject's — cases run the agent on its own model |
| `effort` | the judge's effort. PASS/FAIL against one sentence is not deep work |
| `trigger` | `deploy` (default) or `manual` |
| `live` | an eval's runs are [test runs](runs#test-runs) — nothing outward, `state/` untouched — unless this says `true`. A flow eval that must really send to prove itself opts in; nothing opts in by accident |

## Assertions

| | |
|---|---|
| `contains:` | the text must appear |
| `not-contains:` | the text must not appear |
| `matches:` | a regular expression over the reply |
| `file:` | the path exists and is non-empty |
| `run:` | a shell command that must exit 0 |
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

## Promoting a run

A run that went wrong is a case you already have — the task is on record, and
so is the answer. **Promote to eval** on the run page writes it into `evals/`
with the task filled in, so the fix has a test before it has a diff. A run that
was itself an eval case is refused: promote the run it was checking.

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
