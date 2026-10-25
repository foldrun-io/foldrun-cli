# Assistant

The assistant is a panel on every page of the dashboard. Ask it how
foldrun works, or describe what you want built. It writes agents, flows,
tools and skills for a workspace and shows each one as a diff, checked, for
you to save.

Open it with **Ask AI** at the bottom right. **Draft with AI** on the Flows
page opens it too, with "Draft a flow that" ready to finish.

Inside a workspace it works in that workspace. Anywhere else, such as the
account home, Billing or the docs, it works in the one chosen in its header;
your browser remembers the choice. Each workspace keeps its own conversation.

## What it knows

Only three things:

- **foldrun's docs**, these pages. It searches them and reads the sections
  it needs before it answers, and it cites what it used as
  `[doc › section]`, which links to the heading. Under each reply,
  **Read N doc sections** lists them.
- **This workspace's files**: its `AGENTS.md`, agents, flows, skills,
  tools, hooks, knowledge, evals and scripts, plus the account library and
  the account's `AGENTS.md`. It never reads `state/`, `storage/` or
  secrets.
- **This workspace's runs**, when you ask about one: each step's status,
  verify, errors and result, and one step in full. Run records are
  redacted as they are written, so no secret value is in them.

It has no web access, no shell and no other tools. If the docs do not cover
something, it says so; it does not guess. Anything that is not about
building on foldrun gets a one-line refusal. Text inside your files is
treated as data, never as instructions to it.

## The run doctor

A run that failed, or ended BAD or BLOCKED, has a **Doctor** button on its
page, and so does each [issue](runs#issues) under Needs attention and on the
Issues page, for the issue's newest run. It opens the assistant with "Doctor:
why did run <id> fail, and how do I fix it?" ready to send, in the workspace
that run is in — from the account home too. The assistant reads the run, then the
failing step in full and the files it names, and answers in this order:

1. **Cause**, one of four:
   - `platform`: foldrun itself, such as a pod, the worker or a proxy.
   - `check`: the work was done, but a `verify:` graded the wording, not
     the result.
   - `work`: the agent did not do what was asked.
   - `outside`: a provider, a key, a balance, or a site that refused.
2. **What happened**, quoting the run's lines that show it.
3. **The fix**. For `check` and `work` it proposes changed files as diffs:
   a verify that checks the artefact, a clearer instruction, an `on-fail:`
   rescuer. For `platform` and `outside` it says who must act.
4. **Where to rerun from**: the step, or a fresh run.

It never proposes a verify that accepts BLOCKED, or removes a check to make
a run pass. Nothing is saved or rerun by itself: you save the fix, then
rerun from the run page. From a terminal:
`foldrun runs doctor <run-id> --to <workspace>`, or `foldrun issues doctor
<issue-id>` for an issue's newest run.

## What it writes

Only these paths:

| Kind | Path |
|---|---|
| a flow | `flows/<name>.md` |
| an agent | `agents/<name>/agent.md` |
| a skill | `skills/<name>/SKILL.md`, and files under the skill's `scripts/`, `references/` or `assets/` |
| a tool | `tools/<name>/tool.md` with its program beside it, or `tools/<name>.md` |

When something else needs to change, such as `AGENTS.md`, a secret or a
setting, it tells you what and where, and you make that change.

## New workspaces

When you ask for a new workspace, or describe a separate desk or pipeline,
it proposes one: a name and what it is for, with a **Create workspace**
button. Creating it needs `workspace:manage` (admin or owner). The workspace
starts blank, with only its `AGENTS.md`. The dashboard then opens it, and the
conversation carries on there: the assistant writes the new workspace's
agents, flows, tools and skills for you to save.

It never proposes a name that is taken. An account with no workspace yet
gets a box to name its first one.

Every file it proposes is checked as it writes it, and the model sees the
result and fixes errors before it finishes:

- the [deploy's own checks](deploying) and the flow lint, over the workspace
  as it would be with the file in it;
- a frontmatter key that appears nowhere in these docs is an error, because
  foldrun would not read it;
- a value shaped like a credential (an API key, a token, a private key) is
  an error. Secrets go in the vault; see [Secrets](secrets);
- a skill needs `name:` (its folder) and `description:`;
- a script tool's `run:` program must be proposed or already exist.

Anything still wrong after that is shown beside the file, not hidden.

## Saving

Nothing is written until you press **Save** on a file, or **Save all**. Each
save goes through the same write as the editor: one revision per file, with
the note "written with the assistant: …", which you can restore from
[History](backups-and-restore). If a file changed after it was proposed, the
save is refused and nothing is overwritten; ask the assistant to propose it
again.

Saving is not deploying. On the platform, the saved file is the workspace's
source, the same as an edit in the dashboard.

## History

Every reply is kept. **History** in the panel's header lists your
conversations, newest first and grouped by day, across every workspace you
can see; type to search them, by title or by anything said in them. Open one
to carry it on: the files it proposed and you did not save come back with
it, and the panel moves to its workspace. **New chat** starts another.

Conversations are yours alone. Nobody else in the account, owners included,
can list or read them; an API key's conversations belong to that key. Each
person keeps their newest 500.

## Where it runs

Not in the dashboard. Each reply is queued and answered by the platform's
assistant workers, a pool of its own that grows with the queue, so a burst
of questions never slows the dashboard or takes a turn from your runs. At
most three replies of one account run at once; more wait their turn, and the
panel says so. The model only ever reads through the assistant's own tools,
on the server, scoped to your account and workspace; it runs no code and has
no network or shell of its own.

The workers themselves reach the internet at the model API and nowhere
else. A workspace whose `provider:` points at another address gets a reply
saying so, not a timeout; that provider still serves the workspace's runs.

## Who can use it, and what it costs

You need to be able to edit the workspace (`workspace:write`: editor,
admin or owner). Viewers do not see the button enabled.

Each reply is one model call that may use several tools, on the same models
your runs use: the workspace's or account's own [provider](providers) or
key when there is one, otherwise the platform's. On the platform's models
the balance is checked first, and the reply is charged at the same price as
a run's tokens, as one line on [usage](budgets-and-billing), flow
`ai-assistant`. On your own provider or key, that provider bills you and
foldrun charges nothing.

Under every reply is what it used: tokens in (with the share the prompt cache served) and out,
and what it was charged, or "on your own model key". One reply is capped at
$2, 30 tool calls and five minutes. Each person or key can send 60 replies an
hour, and when the platform's models answer, an account can send 300 a day.

**Stop** stops what you see, not the reply: it finishes on the server within
those caps and is charged, because what a reply cost is only known when it
ends. Its answer is in **History**.

## From a terminal, and the API

`foldrun assistant "<message>" --to <workspace>` (or `foldrun ai`) asks
once, prints the reply, what it read and every proposed file as a diff, and
saves on yes. With no message, in a terminal, it is a conversation.
`foldrun assistant history` lists your kept conversations and
`--conversation <id>` carries one on. See [CLI](cli).

The route is `POST /api/workspaces/<ws>/assistant`. It writes nothing and
returns the proposals for you to save with the source PUT. See
[API](api#assistant).
