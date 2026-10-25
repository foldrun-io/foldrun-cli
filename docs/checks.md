# Checks

`foldrun check` answers two questions about a workspace before anything
runs: **will it run?** (a tool that exists, a step that names a real agent,
an option the parser can read) and **is it safe to run?** (a key pasted into
a prompt, a knowledge file carrying hidden instructions, an agent that reads
the open web, holds a secret and can send it anywhere). It is offline, calls
no model and costs nothing, so run it after every edit, the way you would run
a typecheck, and in CI on every pull request.

```sh
foldrun check                      # everything, as text
foldrun check --security           # only the security rules; fails on a warning
foldrun check --changed            # only files changed against git HEAD
foldrun check --format sarif --out check.sarif   # for GitHub code scanning
foldrun check --rules              # every rule, its level, what it guards against
```

The same findings appear in four other places, from the same rules in
`@foldrun/core`:

- **The dashboard**: the workspace's **Checks** page lists every finding on
  the deployed copy, grouped by rule, each linking to its file. The editor
  shows a file's own findings above it.
- **The API**: `GET /api/workspaces/<ws>/check` answers with the same
  findings as JSON (`?security=1`, `?rule=`). See [api](api).
- **A save**: saving a file in the dashboard editor checks the workspace as
  it would be with that file. An error a deploy would refuse is refused
  there too and nothing is written, because a saved file goes live at once;
  **Save anyway** writes it. Warnings never stop a save. A History restore
  is saved as picked and says when it fails today's checks. Files a deploy
  does not carry, such as `state/`, are not checked. Through the API it is
  `check: true` on `PUT …/source`, and every save answers with the
  file's findings.
- **A deploy**: what a deploy refuses is still refused. A credential written
  into a file and hidden text are reported as deploy warnings: the deploy
  goes ahead and says so, unless `deploy_block:` says to refuse it (below).

## Reading a finding

```
   warn  knowledge/setup.md:6  an Anthropic key (sk-a…a5) is written into the file — move it to the vault and write `${NAME}`  secret/hardcoded
```

The level, the file and line, what is wrong, and the **rule id** at the end.
A secret is never printed whole: the first four characters and the last two
are enough to find it, and too few to use it.

| Level | Means | Fails `check` |
|---|---|---|
| `error` | it will not work, or a deploy refuses it | yes |
| `warn` | it works, and something about it should change | with `--fail-on warn` or `--security` |
| `info` | worth knowing; often a judgement call | with `--fail-on info` |

Every rule added with the scanner is a warning for now, so a workspace that
passed yesterday still passes. To fail a build on them, use `--security` (which
fails on a warning) or `--fail-on warn`.

## Options

| Flag | Does |
|---|---|
| `--security` | only the categories `secret`, `security`, `content` and `supply-chain`; exits 1 on a warning |
| `--rule <id>` | only this rule, or a whole category (`secret`, `config`, …); repeat it, or comma-separate |
| `--fail-on <level>` | exit 1 on a finding at `error` (the default), `warn`, `info`, or `never` |
| `--format text\|json\|sarif` | how to print it; `--json` is `--format json`. `--out <file>` writes it to a file |
| `--changed` | only findings in files changed against git `HEAD`, tracked or new; `--base <ref>` compares with that ref (`--base origin/main` in CI) |
| `--write-baseline` | accept every current finding into `.foldrun/check-baseline.json`; later checks show only new ones. `--no-baseline` ignores the file |
| `--rules` | list every rule (`--json` for the table) |
| `--to <ws>` | check the copy deployed on the platform instead of this folder |

## Blocking a deploy

By default the scanner's findings never stop a deploy: they are warnings,
listed with it. `deploy_block:` in `AGENTS.md` turns them into refusals:

| `deploy_block:` | refuses a deploy that carries |
|---|---|
| `none` (default) | nothing — findings are warnings |
| `secrets` | a key or password written into a file (`secret/hardcoded`) |
| `security` | any security finding: `secret/*`, `content/*`, `security/*`, `supply-chain/*`, and `flow/outward-ungated` (a step that acts outside with no check or approval) |

Set it in the account's `AGENTS.md` for every workspace, or in one
workspace's `AGENTS.md`, which wins. Settings → Governance → **Refuse a
deploy on**, or `foldrun account set deploy_block secrets`. A refused
deploy names each finding and its rule; a `foldrun-ignore` with a reason
(below) still accepts one.

## Online checks and the daily rescan

`foldrun check` stays offline. Two checks need the network, so they run on
the platform against the deployed copy: known vulnerabilities for exact
runtime pins ([`supply-chain/known-vulnerability`](#supply-chainknown-vulnerability))
and the tool text of MCP servers reached by URL
([`content/mcp-tool-text`](#contentmcp-tool-text)).

- **When you ask:** Checks → **Online checks**, `foldrun check --to <ws>
  --online`, or `GET /api/workspaces/<ws>/check?online=1`.
- **Every day by itself:** the platform rescans every workspace, offline and
  online. The first rescan of each source records what is there. After
  that, a security finding that was not there before goes to the
  workspace's `notify:` as the `security` event, once. A finding that goes
  away and comes back is new again.
- **What is never done:** a server started as a command is never run to
  check it, and no credential is sent. A server that needs one is reported
  as not checked.
- **Not checked is never clean:** OSV unreachable, a malformed answer, or a
  server that did not answer is listed as not checked, and keeps what it
  found last time.
- **A rescan that fails or never finishes** (the platform restarted in the
  middle of it) is not tried again for a day. Findings waiting to be told
  are still sent.

Online findings are warnings and never block a deploy, even with
`deploy_block: security`: a deploy does not wait on the network.

## Ignoring one

Put a comment on the line before the finding, or on the same line, naming
the rule and saying why:

```markdown
<!-- foldrun-ignore secret/hardcoded: a revoked key, kept to show the format -->
```

```sh
# foldrun-ignore supply-chain/pipe-to-shell: the vendor's pinned installer, checksum verified below
```

`foldrun-ignore-file <rule>: <reason>` anywhere in a file covers all of it.
A category (`secret`) covers its rules. **The reason is required**: an ignore
without one ignores nothing and is reported itself
(`check/ignore-needs-reason`), because "why is this allowed?" is the question
the next reviewer will ask. The same comments work for every rule, check's
own included, in the CLI, the dashboard and the API.

Ignores in `memory/` are not honoured. Agents write their memory
themselves, so an ignore there could have been written by whatever an agent
read: an injection that silences its own finding.

## Adopting it on an existing workspace

A workspace with years of history will have findings on day one. Do not fix
them all before the check can be useful:

```sh
foldrun check --write-baseline     # accept what is there today
git add .foldrun/check-baseline.json && git commit -m "check: baseline"
foldrun check --security           # from now on, only new findings fail
```

A baseline entry is matched by the rule, the file and the text of the
flagged line, not by its line number, so adding a paragraph above an
accepted finding does not bring it back. Changing the flagged line does,
because then it is a different line. A baseline that is not valid JSON
hides nothing. `.foldrun/` is never deployed.

## In CI

```yaml
# .github/workflows/check.yml
on: [pull_request]
permissions: { contents: read, security-events: write }
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm i -g foldrun
      - run: foldrun check --format sarif --out check.sarif --fail-on never
      - uses: github/codeql-action/upload-sarif@v3
        with: { sarif_file: check.sarif }
      - run: foldrun check --security --changed --base origin/${{ github.base_ref }}
```

The SARIF upload puts each finding on the line it is about, in the pull
request. The last step fails the build on a new security finding in the
files the pull request touched. Each result carries a stable fingerprint,
so code scanning tracks a finding across commits instead of opening a new
one every time.

As a pre-commit hook: `foldrun check --security --changed`.

## The rules

The OWASP ids are from the
[OWASP Top 10 for Agentic Applications (2026)](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026).

### secret/hardcoded

*warn · ASI03.* A credential is written into a file: an Anthropic, OpenAI,
AWS, GitHub, GitLab, Slack, Google, Stripe, SendGrid, Twilio, Telegram, npm,
Hugging Face, Linear, DigitalOcean, Shopify or Resend key, a JSON web token,
a private key, a webhook URL that carries its own secret, a password inside a
URL, or a field named like a credential (`api_key:`, `token:`, `password=`)
holding a literal value that looks random. Everything in a workspace is
deployed, versioned, readable by every agent and shown to the model.

Move it to the vault (`foldrun secrets set NAME`), write `${NAME}` where it
was, and bind it to the sites it is for (`foldrun secrets sites NAME
api.example.com`) so it never enters a sandbox at all. Then **rotate the
key**: it has already been copied, into git history if nowhere else.
References (`${NAME}`, `$NAME`, `process.env.X`), names, and obvious samples
(`your-key-here`, `xxxx`, AWS's `…EXAMPLE`) are not findings.

### content/hidden-unicode

*warn · ASI01, ASI04, ASI06.* Zero-width characters, bidirectional overrides
or Unicode tag characters: invisible to a person reading the file, read as
text by the model, and the standard way to hide an instruction from a
reviewer. Tag characters are decoded in the message so you can read what
they say. Delete them. A byte-order mark at the very start of a file is
allowed.

### content/injection-phrase

*warn · ASI01, ASI06.* A line in knowledge, memory, a skill or a tool's
description that reads as an order to the agent: "ignore previous
instructions", "you are no longer…", "new instructions:", a fake `<system>`
tag, "do not tell the user", "send the secrets to…". Agents read those files
as material, and a line like that is either an attack that arrived with the
content or a paste that will confuse the model. Remove it, or quote it as an
example inside a fenced code block, where it is not flagged. An agent's own
prompt is not checked, since a guard agent may need to talk about exactly
this.

### content/encoded-blob

*info · ASI01, ASI04.* Three hundred or more characters of base64 in a
markdown file. A reviewer cannot read it and the model can. Move data to a
file and link it. An inline image (`data:image/…;base64,`) says what it is
and is not flagged.

### security/lethal-trifecta

*warn · ASI01, ASI02, ASI03.* One agent that **reads untrusted content** (the
`web` tool, or a browse/fetch/scrape tool), **holds something private** (a
secret, an `apis:` entry, an MCP server) and **has a way out** (an open
network, which is the default for an agent that reads the web, a tool marked
`outward: true`, or an API it may POST, PUT, PATCH or DELETE to). Any page it
reads can tell it to send what it holds anywhere it can reach.

Take a leg away:
- take it off the open network: `network: { level: trusted, allow:
  [api.example.com] }`, or `network: trusted` ([Network](network)). A bare
  list of sites only adds to a level, so an agent that reads the web stays
  `open` with one. The level is resolved the way a run resolves it: the
  agent's, then the workspace's `AGENTS.md`, then the account's;
- split it into a reader with no secrets and a sender that reads nothing
  untrusted;
- guard its calls with a `hooks:` gate ([Hooks](hooks)).

`permissionMode: plan` also clears it. An approval (`!`) on each outward step
is the other answer, though this rule looks at the agent, not the flow.

### security/subagent-wider

*info · ASI03.* A sub-agent declares tools its parent does not have. A
sub-agent never gets more than its parent, so they are dropped inside the
delegation. Grant them to the parent, or remove them from the sub-agent.
A sub-agent with `sandbox: own` is not this rule's: its tools are its own
([below](#securitysubagent-own-sandbox)).

### security/subagent-own-sandbox

*info · ASI03.* A sub-agent with `sandbox: own` holds tools its parent does
not. That is what `sandbox: own` is for: each job it is handed runs in a
sandbox of its own, with its own tools, secrets and network, and only its
reply reaches the parent. The finding says what it holds, so the choice
stays visible ([agents](agents#isolated-sub-agents-sandbox-own)).

### flow/outward-ungated

*the step's level · ASI02, ASI09.* A step whose agent holds an `outward:
true` tool, with no `verify:` and no approval. Give it a `verify:` that reads
what it did, or a `!`, so a wrong post or send is caught before it happens
again. An error in `foldrun check`, a warning at deploy.

### supply-chain/pipe-to-shell

*warn · ASI04, ASI05.* `curl … | sh` (or `wget`, `bash`, `zsh`) runs whatever
the server returns today, unreviewed, in the sandbox that holds the
workspace. Declare the package under `runtime: system:` or `packages:`, or
download it, verify a checksum, then run it.

### supply-chain/unpinned-mcp

*warn · ASI04.* An MCP server started with `npx`, `bunx`, `pnpx` or `uvx`
with no version, or at `@latest`. Every run installs whatever was published
last, so a compromised release reaches you the moment it ships. Pin it:
`npx -y some-server@1.4.2`.

### supply-chain/unpinned-package

*info · ASI04.* A `runtime: packages:` or `npm:` entry with no version. Pin a
range (`pandas>=2,<3`, `lodash@^4`) so tomorrow's run uses what was tested
today.

### supply-chain/known-vulnerability

*warn · ASI04 · online.* A `runtime: packages:` or `npm:` entry pinned to an
exact version (`requests==2.19.0`, `lodash@4.17.15`) that
[OSV.dev](https://osv.dev) lists advisories for. Upgrade to a fixed version.
Only exact pins are asked about; ranges and transitive dependencies are not
resolved.

### content/mcp-tool-text

*warn · ASI01, ASI04 · online.* What an MCP server reached by `url:` tells
the model about its tools (names, titles, descriptions, argument
descriptions) carries hidden characters or an instruction. That text reaches
the model as guidance: a server can steer your agent through it. It is
scanned as untrusted text, so a `foldrun-ignore` or a code fence inside it
cannot hide it; a `foldrun-ignore` in your own file still accepts one.

### config/unknown-field

*warn or info.* A frontmatter key that this kind of file does not read. There
are three cases, each with its own message:
- **A near-miss** of a real field (`tolls:`, `triger:`, `disallowed_tools:`) is
  a warning that names the field it meant. YAML accepts a typo, so it is
  silently ignored, and `tolls: [web]` leaves the agent with no tools.
- **A field read somewhere else** is a warning that says where it goes.
  `timeout: 3600` on an agent is a step option, so it belongs under the step
  in the flow. `language:` on a flow is read from the agent or `AGENTS.md`.
- **A field like nothing foldrun reads** (`favourite_colour:`) is a note,
  since another tool may own it.

### config/wrong-type

*warn.* The right field holding the wrong kind of value: a map where a list
of names goes (`tools: {web: true}`), a list where one word goes. The runtime
does not read it. The message says what the field takes.

### config/invalid-value

*warn.* A value that does nothing, or quietly does something else:
- `effort: extreme` runs at the model's default;
- `size: giant` becomes `large`;
- `permissionMode:` other than `plan` is ignored;
- `trigger: sometimes` never fires;
- a `schedule:` the scheduler cannot read (`every day`) never fires. This is
  checked with the scheduler's own cron parser;
- an unknown HTTP method in `methods:` is dropped;
- a duration that is not one (`debounce: soon`).

Aliases count as valid: `effort: quick` is `low`. Fields another rule already
checks in depth (`network:`, `limits:`, `timezone:`, `web:`) are left to it,
so nothing is reported twice.

### config/missing-field

*warn.* A required field is absent: a skill with no `description:` is never
loaded, because the model chooses skills by their descriptions.

Every field these four rules know is listed, with its type and values, in one
place in `@foldrun/core` (`frontmatter-fields.ts`). The editor's completions
come from the same list, so what the editor suggests and what `check`
accepts cannot drift apart.

### config/conflict

*error.* A field written twice: at the top of the frontmatter and inside its
job block (`limits:` and `guardrail: {limits: …}`). Only the top one would be
read, so the file is refused until one is removed. See
[The four jobs](four-jobs).

### config/misplaced

*error.* A setting inside the wrong job's block — `network:` under
`governance:` — is not read, so a protection you wrote would not apply; the
file is refused until it moves. The message names the block it belongs in, or
says to write it at the top when it does none of the four jobs. A key foldrun
does not read at all, inside a block, is only a note.

### config/invalid-frontmatter

*warn.* Frontmatter that YAML cannot read. The commonest cause is a value
holding a colon followed by a space, which ends the value early:
`description: the file format (Markdown, frontmatter, ::: directives)`.
Quote it: `description: "the file format (…, ::: directives)"`. The
message gives YAML's own error and its line.

A **skill** like that still runs: foldrun reads a skill by quoting such a
value and trying again. But the dashboard editor and the source API refuse
to save it, and other tools that read skills may not load it. When even the
second read fails, the skill has no name or description and is never loaded.
For the account library's agents, tools and hooks, the runtime cannot read
the file at all. A workspace's own agent, flow, tool, eval, hook or
`AGENTS.md` with broken YAML is not this warning: a deploy refuses it, under
that file's own rule (`agent/config`, `flow/config` …).

### check/ignore-needs-reason

*warn.* A `foldrun-ignore` with no reason after a colon. It ignores nothing
until it has one.

### check's own rules

These are what `check` has always reported, now with ids so they can be
filtered, ignored and baselined. Each problem keeps its own level.

| Rule | Covers |
|---|---|
| `agent/config` | frontmatter that cannot be read; a tool, skill, colleague, sub-agent or hook that does not exist; retired tool names |
| `flow/config` | a step naming nothing, an option the parser cannot read, `verify:` written as prose, a `verify: matches:` that is not a valid JavaScript regular expression, an arrangement that cannot have what its instruction asks for |
| `tool/config` | a `run:` program that is missing, an import nothing declares, a leftover `type:` |
| `skill/config` | a `SKILL.md` without a usable name or description |
| `eval/config` | an eval that names nothing, has no cases, or has a `matches:` that is not a valid JavaScript regular expression |
| `hook/config` | a hook folder that is not a valid hook; a `hooks:` name that resolves to nothing |
| `knowledge/okf` | a knowledge or memory document that is not a conformant bundle entry, an unreadable date, a stale document |
| `workspace/config` | an `AGENTS.md` setting that cannot be read; a path a deploy refuses |
| `library/config` | the same, in the account's shared library |
| `paths/workspace-spelling` | `../../storage/x` where `workspace/storage/x` reads the same everywhere |

## What it does not do

It reads files; it does not run them. Static rules catch what the files
say, not what a model will do with a page it has not read yet, so they are
the first line, not the only one: [network](network) policy, bound
[secrets](secrets), [hooks](hooks) and approvals hold at run time whatever
the files say. MCP servers are never started to inspect their tools, and no
URL is fetched.

On the platform (the Checks page, the editor, `GET …/check` and the daily
rescan) the checks read a bounded amount. In `state/` and `memory/` (the
workspace's, or one agent's), which is what agents write as they run, a file
over 5 MiB is not read, and nor is anything past 32 MiB or 5,000 files in all.
The rescan lists what it left out, and keeps what it found in those files
before. If everything else in the workspace is over 64 MiB, the workspace is
not checked at all, and the check says so (`GET …/check` answers 413).
`foldrun check` on your own machine reads everything.

Everywhere, `foldrun check` included, one rule is listed at most 100 times in
one file. The rest are counted in one more finding ("and N more like this").
