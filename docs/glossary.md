# Glossary

**account** — the top level: people, keys, the library, the wallet, and the
workspaces under it. Has one owner.

**agent** — one role: a folder with an `agent.md` whose frontmatter grants and
whose prose is the prompt.

**AGENTS.md** — context and defaults, at the account and at each workspace.
Prose accumulates downward; a frontmatter key replaces whole.

**budget** — a cap: per run (in a flow, or on an agent for its own steps),
per workspace over a day, week or month, per account the same. Unset is no
limit.

**conclusion** — a step's final reply, as opposed to every turn joined. What
checks and headlines read.

**desk** — an everyday name for a workspace that does one job on its own —
a blog desk, a Reddit desk — its agents and flows, running on a schedule.
Nothing in the format is called a desk; it is a workspace.

**deploy** — pushing a workspace's source tree to the platform, by
`foldrun deploy` or `git push`. Never touches runs, state, secrets or memory.

**eval** — a test for an agent or a flow: a task and what a good answer
must contain. Runs on every push.

**flow** — orchestration: a numbered list of steps. Same number, same time.

**gate** — a step that parks the run for a person (`!`, `approve:`, `ask:`).

**group** — the steps that share a number. A step is handed every earlier
group's replies.

**headline** — the first meaningful line of a step's conclusion. The run's
headline is the last step's.

**knowledge** — what people give an agent. Read by all, written by none.

**library** — the account's shared tools, skills, knowledge and memory.
Nearest wins: a workspace shadows it by defining the same name.

**memory** — what an agent learned, one fact per file. The one place it
writes without a grant.

**preview** — a copy of a workspace deployed from a branch, evals run,
schedules off, deleted with the branch.

**run** — the record of a flow being driven: every step, event and cost.

**sandbox** — where a step executes: a container or a gVisor pod, made for
the step and destroyed after it.

**share** — a public link to one file in `storage/`, tokened, expiring.

**skill** — a capability an agent loads when a task matches, in the open
Agent Skills format. Inherited unless allowlisted.

**state** — what the next run needs from this one. Travels with a deploy,
never overwritten by one.

**storage** — bytes a person reads or downloads. Regenerated each run.

**tier** — `fast`, `default`, `max`: which brain, resolved to a model by the
platform so agents do not rot when models are renamed.

**tool** — what an agent may call: an API, a script, an MCP server. Granted
by name in `tools:`; absent unless named.

**trigger** — how a flow starts: a person, a schedule, a webhook, an email,
another flow, a file, a URL that changed.

**verify** — a check on a step's outcome: a shell command, or `contains:`,
`matches:`, `file:`, `judge:`. Where arithmetic goes.

**workspace** — a folder, and the unit of editing, deploying, permission,
budget and backup.
