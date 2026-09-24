# How it works

Eight nouns, one reference syntax, and a flow that is a numbered list. Nothing
here is a framework you import — every one of these is a markdown file you can
open, diff and review.

## The eight nouns

Four are **grants**: an agent has them because its file says so, and reading
that one file tells you the blast radius.

| | |
|---|---|
| **agent** | one role — a folder with an `agent.md` |
| **flow** | orchestration — a numbered list of steps |
| **tool** | what it may call: an API, a script, or an MCP server |
| **skill** | a capability it loads when a task matches |

Four are **places**: always there, never granted. They differ only by who may
write.

| | who writes | |
|---|---|---|
| **knowledge/** | nobody | given to it; reading is denied to nothing, writing to everything |
| **memory/** | the agent | what it learned, one fact per file, indexed |
| **state/** | the workspace | the bookmark between runs |
| **storage/** | anyone | bytes, not source — PDFs, CSVs, images |

The line between the last two is worth learning early: a value **regenerated**
each run is `storage/`; a value **accumulated** across runs is `state/`.

Capability is opt-in, knowledge cascades. `tools:` grants nothing until you
name it. `skills:` is the opposite — leave it out and the agent inherits every
skill in scope; write it and it becomes an allowlist. An empty `skills: []`
therefore withholds all of them, which is legal and almost never what someone
means.

## `[[name]]` — the one reference syntax

The rule is one sentence: **if it names a file, you can link it.** Agents,
flows, skills, tools, knowledge and memory are files. Secrets, `model:`,
`size:` and `effort:` are values, and are never linked.

| where | what it means |
|---|---|
| first link on a step line | **structural** — the agent that step runs |
| `[[flow:weekly]]` on a step line | a whole flow, composed in place |
| in any prose | resolved to the real relative path before the model sees it |
| `[[storage/leads.csv]]` | that file |
| `[[storage/]]`, `[[state/]]` | the folder, when you mean *where* rather than *which* |
| in `tools:`, `skills:`, `agents:`, `delegate:`, `after:` | the same name, spelled as a link |

Names match on filename **or** the document's own `title:`/`name:`, blind to
case, hyphens and underscores — so a link survives a rename that a literal
path would not. Anything unmatched passes through as written: the syntax is
sugar over paths, never a gate, and a typo never breaks a run.

Two details worth knowing:

- **Links expand only where text becomes a prompt** — an agent's body, a step's
  instruction, an eval's task. Inside a knowledge or tool document they stay
  literal, because there the link is for the person reading.
- **In `tools:`, the brackets mean "mine."** A bare `search` is the platform's
  search group; `[[search]]` is your `tools/search.md`. That is the only way
  to grant a tool named after a built-in.

```yaml
tools:
  - read              # a built-in group
  - [[site_repo]]     # your own tools/site_repo.md
```

Use the block form when you link. To YAML, `[[x]]` is a nested list, so the
inline `tools: [read, [[site_repo]]]` parses correctly but reads badly.

The idiom to write by: **link what you read, spell out what you write.** A link
points at something that exists — an input. An output destination does not
exist yet, so it stays a literal path.

## A flow is a numbered list

Steps run in ascending order, and each receives the previous group's results.
Output passing is the default, not configuration.

```markdown
1. [[researcher]] — gather this week's competitor updates
2. [[writer]] — turn the research into a 300-word digest at outputs/digest.md
```

**Steps sharing a number run in parallel**, and the next group receives every
result, labelled per agent. The number is the whole scheduling model:

```markdown
1. [[researcher]] — gather the facts
2. [[optimist]] — argue the bull case
2. [[skeptic]] — argue the bear case
3. [[editor]] — weigh both and write the verdict
```

`2?` marks a step optional — it fails without failing the flow. `2!` parks it
for a human.

### Routing

`case:` steps in one group are exclusive branches: the first whose text appears
in the previous results runs, and an `else:` step runs when none matched.

```markdown
1. [[classifier]] — reply with exactly one word, BUG or QUESTION
2. [[debugger]] — investigate and fix
   case: BUG
2. [[writer]] — answer it clearly
   case: QUESTION
2. [[triager]] — neither label fit; say what is missing
   else: true
```

`when:` is the non-exclusive sibling — every matching step runs. That is why
routing has its own word instead of being a mode on `when:`.

### The critic loop

```markdown
1. [[writer]] — draft the post
2. [[editor]] — review it; end your reply with APPROVED when it is ready
   loop: 3
   until: APPROVED
```

The marker must stand **alone on its own line**. "APPROVED once the citation is
fixed" contains the word but is a rejection, and reading it as a pass would end
the loop with the correction unmade — which is the failure the loop exists to
prevent. Generate–critique–revise, with the model deciding only whether to say
the word and the file deciding the shape.

### Fan-out

```markdown
1. [[scout]] — list the competitor URLs, one per line
2. [[analyst]] — analyse this one site
   each: lines
   max: 10
```

The declared shape stays one line in the file; the width comes from the data.
`each: items` fans out over the array an earlier `output: json` step returned,
and `each: rows of ../../storage/leads.csv` over a CSV.

### Composition

A step may name a flow instead of an agent — `1. [[flow:weekly]] — …` — and its
steps run in place, keeping their own parallelism. Cycles, and nesting past
three levels, are errors.

## Working as a team

Three ways for agents to reach each other, in increasing order of how much the
model decides:

**Steps** — you decide who runs next. The default, and the one to prefer.

**Consult** (`agents:`) — a specialist answers one question, inline:

```yaml
agents:
  - [[fact-checker]]
  - [[researcher]]
```

Each becomes a `consult_<name>(question)` tool. The colleague's persona answers
one self-contained question as a **toolless** call, with the spend landing on
the calling step. Depth is one — consultants cannot consult further. It is
deliberately weak: a consult is asking a specialist what they think, not handing
over the task.

**Delegate** (`delegate:`) — the model picks, from a list you wrote:

```markdown
2. [[triager]] — decide who should take this
   delegate: enricher, emailer, writer
```

The agent ends its reply with `agent: instruction` lines, choosing only from the
declared set (at most five). The picks run as a fresh group immediately after,
and both the set and the picks are on the record. Choosing nobody is a normal
outcome.

What all three have in common is the line the format holds: a model chooses
*what to do within a step*; the **file** decides what happens after it. There is
no free-form handoff between agents, because that pattern's common failure is a
loop where every agent re-plans and nobody owns the task.

## Gates, failure and cost

| option | what it does |
|---|---|
| `approve: true` / `ask: <question>` | park until a person releases it; the answer typed at the gate reaches the prompt |
| `wait: 3d` / `wait: event` | hold for a duration, or until something POSTs the run's event URL |
| `retry: <n>` | attempts after the first, up to 5 |
| `on-fail: <agent>` | another agent takes the step over, with the failure as context |
| `verify: <command>` | a shell command, or `contains:` / `matches:` / `file:` / `judge:` |
| `timeout: <seconds>` | **the only clock there is** |

Two of those deserve emphasis. **Without `timeout:`, a step runs until it
finishes** — the platform sets no clock of its own anywhere, so every limit that
exists is one written in a markdown file. And **`verify:` is where anything
decided by arithmetic goes**: step options are matched as text, deliberately, so
a threshold belongs in a command that can be tested — `verify: jq -e '.total > 0'`
— rather than in a comparison in frontmatter.

## Picking the model

`model:` takes a tier — `fast`, `default`, `max` — rather than a model id, so
agents do not rot when models are renamed. `effort:` is the orthogonal half:
which brain, versus how long it thinks. `fast` + `max` is a real pairing — the
cheap model, told to take its time.

Resolution is nearest-wins — the step, then the flow, then the agent — and the
run trace names which level won, so "why did this run on haiku" is answerable
from the run rather than by opening three files.

```markdown
---
name: digest
model: fast              # every step, unless the step says otherwise
---

1. [[scout]] — list the URLs
2. [[analyst]] — the one hard step
   model: max
   effort: xhigh
```

Match the tier to the work, not to the importance of the desk. A step that
reads a page and pulls out three fields is a `fast` step even when the report
it feeds is the point of the week; a step that weighs two arguments and picks
one is not. See [Providers](providers) for pointing a tier at your own
endpoint, which is how a tier becomes cheaper still.

## Choosing between the shapes

| you want | use |
|---|---|
| a second opinion inside one step | `agents:` consult |
| the model to pick who is next, from a short list | `delegate:` |
| you to decide who is next | numbered steps |
| N of the same work | `each:` |
| a quality gate | `loop:` + `until:` |
| reuse across flows | `[[flow:name]]` |
| a person | `approve:` / `ask:` |

`foldrun check` validates all of this offline, before any model is called: a
step naming an agent that does not exist, a `delegate:` or `on-fail:` that
names nobody, a tool or skill that resolves to nothing. Run it the way you
would run a typecheck.
