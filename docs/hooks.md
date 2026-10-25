# Hooks

A hook is your own code at the points every step passes through: before a
tool runs, after it ran, when a step starts and when it ends. It can refuse
a call, rewrite it, add context, or rewrite the reply, and it does the same
thing on every model: Claude, or any other provider through the translator.

```
workspaces/<name>/hooks/no-force-push/
  hook.md     when it runs
  run.mjs     what it does
library/hooks/<name>/        the same, shared by every workspace
```

## Turning one on

```yaml
# agents/deployer/agent.md
hooks: [no-force-push]
```

`hooks:` in an agent's frontmatter turns hooks on for that agent. The same
key in a workspace's `AGENTS.md` turns them on for every agent in it, and in
the account's `AGENTS.md` for every agent in every workspace. They run in
that order (account, workspace, agent), each name once. A name is looked up
in the workspace's `hooks/` first, then the library's. A name that resolves
to nothing is a `foldrun check` error, and a step that names one is refused
rather than run without its hooks.

## hook.md

```markdown
---
on: tool.call            # tool.call | tool.result | step.start | step.end
tool: Bash               # which tools; Write|Edit, mcp__*, a short name like web
timeout: 30              # seconds, 1-120 (30 for tool.call/step.start, 60 otherwise)
description: Refuses force pushes and skipped git hooks.
---

Why this hook exists, for the next person who reads it.
```

| `on:` | when | it can |
|---|---|---|
| `tool.call` | before a tool runs | allow it, refuse it, or rewrite its input |
| `tool.result` | after a tool ran | see the input and the result; leave a note on the trail |
| `step.start` | before the model starts | add context to the task, or refuse the step |
| `step.end` | after the reply | see it, or replace it |

## run.mjs

One self-contained ES module, using Node's built-ins only (no relative
imports), at most 100 KB. The event arrives as one JSON object on stdin, and
the answer is the last line of JSON the hook prints:

```js
let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const event = JSON.parse(raw);
// { event: "tool.call", hook, run_id, step, agent, workspace,
//   tool: { name: "Bash", input: { command: "git push --force" } }, subagent? }

const cmd = String(event.tool?.input?.command ?? "");
if (/\bgit\s+push\b.*\s(--force|-f)(\s|$)/.test(cmd)) {
  console.log(JSON.stringify({ decision: "deny", reason: "force push — use --force-with-lease" }));
} else {
  console.log("{}");
}
```

| event | answer |
|---|---|
| `tool.call` | `{}` or `{"decision":"allow"}` lets it through; `{"decision":"deny","reason":"…"}` refuses it (the model reads the reason); `{"input":{…}}` replaces the tool's whole input |
| `tool.result` | `{}`, or `{"note":"…"}` for the trail |
| `step.start` | `{"context":"…"}` is added to the task; exit 2 refuses the step |
| `step.end` | `{"reply":"…"}` replaces the reply |

Exit code 2 refuses too, with what the hook printed to stderr as the reason,
which is the convention most agent tools share.

## When a hook goes wrong

A hook that guards (`tool.call`, `step.start`) and throws, times out, exits
with anything but 0 or 2, or answers with the wrong shape **refuses the
call**. A guard that crashes must not become an open door. A hook that
watches (`tool.result`, `step.end`) and fails is recorded, and the step goes
on, because what it was watching has already happened.

When several hooks match one call they run in order. The first refusal ends
it, and a rewrite is handed to the next hook, so the most restrictive answer
wins.

## What a hook can reach

No more than the agent. A hook runs inside the step's own sandbox, as a child
of the step, in the agent's directory, with an environment stripped to `PATH`
and the locale: no secrets, no model key, and a home folder of its own. Its
code is read when the step starts, so an agent that edits `run.mjs` mid-step
changes nothing that runs, and a sandbox never writes `hooks/` back.

A rewritten tool call goes through the same checks as the original (the
shell and path confinement, the agent's granted tools, its sub-agents), so a
hook can narrow what an agent does but never widen it.

## What a hook does not see

Tools the model provider runs on its own side never pass foldrun's dispatch.
With `web: {search: anthropic}` (or another provider's search) the search
runs at the provider, and a `tool.call` hook
cannot refuse or rewrite it. foldrun's own `web` tool, the default, goes
through hooks like every other tool. `foldrun check` warns when an agent with
a `tool.call` hook uses a provider's own search.

## On the run page

Every refusal, rewrite, added context and failure is a line on the step's
trail (`hook no-force-push denied Bash: force push — use --force-with-lease`)
and a badge on the run page. The workspace's Hooks page lists its hooks and
what each one refused or rewrote lately.

## Trying one

```sh
foldrun hook add no-force-push --on tool.call --tool Bash
foldrun hook test no-force-push --event '{"tool":{"name":"Bash","input":{"command":"git push -f"}}}'
foldrun check
```

`foldrun hook test` runs the hook on your machine exactly as a step runs it.
`POST /api/workspaces/<ws>/hooks/<name>/test` does the same on the platform
(see [API](api)).

## Two in the library to copy

- **no-force-push** refuses `git push --force` or `-f` (allowing
  `--force-with-lease`), and `--no-verify` or `SKIP_HOOKS=1`.
- **external-write-log**: when the shell calls `curl` to change something on
  an outside service (POST, PUT, PATCH, DELETE), it writes a line on the
  trail.
