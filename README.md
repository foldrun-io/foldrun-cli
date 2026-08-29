# foldrun

**Agents are folders.** An agent is a markdown file with frontmatter. A flow is
a numbered list naming agents. You write them, read them, diff them in a pull
request, and run them from this CLI.

Everything here works on a plain folder — no account, no server, no network
beyond the model call itself.

```sh
npm install -g foldrun
export ANTHROPIC_API_KEY=sk-ant-…

foldrun init competitor-watch
cd competitor-watch
foldrun check          # free — no model calls
foldrun run publish
```

Requires Node 22 or newer. `init` and `check` need no API key.

## What `init` gives you

```
competitor-watch/
├── AGENTS.md                    what every agent here shares
├── agents/
│   ├── researcher/agent.md
│   └── writer/agent.md
├── flows/publish.md             the steps, in order
├── knowledge/house-style.md     given to them; they may read, never write
├── memory/what-worked.md        what they learned; they write here
└── evals/writer-quality.md      what "good" means, as a test
```

An agent is frontmatter for the machine and prose for the model:

```markdown
---
name: researcher
description: Finds one thing worth writing about, and says why.
model: fast
effort: high
tools:
  - web
  - read
---

Pick exactly one topic, in a short paragraph, and say who it helps and why now.
Do not write the article.
```

A flow is the numbers, not the order of the lines — same number runs at the
same time, different numbers run one after another:

```markdown
---
name: publish
trigger: manual
---

1. [[researcher]] — find one topic worth writing about
2. [[writer]] — draft it
```

`model:` takes a tier — `fast`, `default`, `max` — rather than a model id, so a
workspace doesn't rot when models are renamed. `effort:` is the other half: not
which brain, but how long it thinks.

## Giving an agent real capabilities

A **script tool** is a folder holding its definition and the program it runs:

```
tools/wordcount/
├── tool.md      transport: script · run: run.py · args: {text: …}
└── run.py       a real file — lint it, test it, run it by hand
```

The agent calls it by name with typed arguments and never composes a shell
command. Arguments arrive as `--flags`, stdout comes back, a non-zero exit is a
failure. An agent opts in with `use: [wordcount]`.

An **HTTP tool** is one markdown file declaring a base URL, allowed methods and
headers, with `${SECRET}` placeholders the platform resolves at call time — so
the model gets the capability and never sees the key. An **MCP server** is
declared the same way.

## Commands

| | |
|---|---|
| `foldrun init [dir]` | create a workspace you can run immediately |
| `foldrun check [dir]` | validate agents, flows, tools, evals and knowledge |
| `foldrun run <target>` | run an agent or a flow |
| `foldrun eval [name]` | run one eval, or all of them |
| `foldrun extract [dir]` | move single-file script tools into folders |
| `foldrun probe <model>` | live check: can this model hold a tool loop here? |
| `foldrun logs [run-id]` | recent runs, or one run's full event trail |
| `foldrun secrets set NAME` | store a secret, prompted and never echoed |
| `foldrun deploy [dir]` | push a workspace into an installation |
| `foldrun invoke <flow>` | start a flow on a running platform |

`foldrun --help` lists every flag.

**`check` is the one to run in CI.** It costs nothing and catches what
otherwise surfaces as a confidently wrong answer at 3am: a step naming an agent
that doesn't exist, a tool whose program isn't on disk, an eval pointing at a
flow that was renamed, a knowledge bundle whose index disagrees with its own
files.

## Secrets

Declared by name in an agent's frontmatter, never by value:

```yaml
secrets:
  - SLACK_WEBHOOK_TOKEN
```

`foldrun secrets set SLACK_WEBHOOK_TOKEN` prompts for it and stores it
encrypted. Declared secrets are injected as environment variables into the
agent's scripts and substituted into HTTP headers. They are never returned by
an API and never reach the model.

## Running it somewhere else

`foldrun deploy` pushes a workspace into an installation — your own, or a
hosted one — and `foldrun invoke <flow> --wait` starts a flow there and prints
the result. A deploy never touches run history, state, secrets, or memory an
agent wrote: those belong to the installation, not to your git repo.

```sh
foldrun deploy --url https://your-platform --token $FOLDRUN_TOKEN
foldrun invoke publish --wait
```

## License

Apache-2.0.
