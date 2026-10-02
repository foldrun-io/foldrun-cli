# Changelog

Notable changes to the `foldrun` CLI. The format is
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semantic versioning](https://semver.org/), with the 0.x rule that a
breaking change is a minor bump until 1.0.0.

Entries are drafted from the commit subjects by `npm run release` and then
edited by a person.

<!-- releases -->

## [0.7.2] — 2026-10-02

The first 0.7 on npm. 0.7.0 and 0.7.1 were tagged but their release jobs
failed before publishing (a test that read the sibling core checkout, then
prepack's docs check with no docs checkout). The changes are listed under
0.7.0 below.

- sync-docs --check passes with no ../foldrun-docs when docs/ has pages — the release job has no docs checkout (private), and its prepack failed v0.7.1 unpublished ([c29e505](https://github.com/foldrun-io/foldrun-cli/commit/c29e505))

## [0.7.1] — 2026-10-02

0.7.0 was tagged but never reached npm: its release job failed on a test that
read the sibling core checkout. 0.7.1 is 0.7.0 with that test fixed; the
changes are listed under 0.7.0 below.

### report test

- core's wording through @foldrun/core, not the sibling checkout — the release job has no sibling, and v0.7.0 failed there unpublished ([f8ac942](https://github.com/foldrun-io/foldrun-cli/commit/f8ac942))

## [0.7.0] — 2026-10-02

- workspace/storage/ is the spelling the agent rules and the docs teach; check notes ../../ as info ([6e82932](https://github.com/foldrun-io/foldrun-cli/commit/6e82932))
- agent link / unlink in this folder: refuse a file that changed since it was read ([db8754e](https://github.com/foldrun-io/foldrun-cli/commit/db8754e))
- flow add / rm-step / dup-step in this folder: refuse a file that changed since it was read ([3821a2f](https://github.com/foldrun-io/foldrun-cli/commit/3821a2f))
- flow add / rm-step / dup-step --to: send expect, so a stale step number is refused ([b1d87a1](https://github.com/foldrun-io/foldrun-cli/commit/b1d87a1))
- foldrun audit; keys create --expires, keys rotate --grace, keys ls shows last use and expiry; docs synced ([6fbe1e5](https://github.com/foldrun-io/foldrun-cli/commit/6fbe1e5))
- foldrun webhooks deliveries|redeliver, foldrun notifications [set <category> on|off]; docs synced ([1383771](https://github.com/foldrun-io/foldrun-cli/commit/1383771))
- foldrun restore <ws> --to <commit|time|age> [--dry-run], foldrun backups [request], foldrun onboarding; docs synced ([07f5e42](https://github.com/foldrun-io/foldrun-cli/commit/07f5e42))
- invoke --inputs <set>: start a flow with a saved input set ([a46af98](https://github.com/foldrun-io/foldrun-cli/commit/a46af98))
- deploy sends the confirmed removals; workspaces rm takes only a real workspace ([82cf668](https://github.com/foldrun-io/foldrun-cli/commit/82cf668))
- foldrun answer / foldrun message; approvals lists questions agents are asking ([cc75007](https://github.com/foldrun-io/foldrun-cli/commit/cc75007))
- --help never runs a command; deploy names where it goes and asks before deleting ([d4cc7a0](https://github.com/foldrun-io/foldrun-cli/commit/d4cc7a0))
- login <site> never sends the platform key to the site; concurrency must be a number ([18ed05f](https://github.com/foldrun-io/foldrun-cli/commit/18ed05f))
- check reports agent schedule:; deploy prints warnings; docs synced ([3edf52d](https://github.com/foldrun-io/foldrun-cli/commit/3edf52d))
- coding-agent rules as Next.js writes them: a block in AGENTS.md, CLAUDE.md importing it, and the docs shipped in the package ([44922e5](https://github.com/foldrun-io/foldrun-cli/commit/44922e5))
- rerun, storage put/rm, keys create --workspaces, invoke --once: the developer-account verbs the API had and the terminal did not ([a73b8f7](https://github.com/foldrun-io/foldrun-cli/commit/a73b8f7))
- storage share/shares/unshare, account providers, triggers: the account's records a developer could only reach from the dashboard ([2fdfbe7](https://github.com/foldrun-io/foldrun-cli/commit/2fdfbe7))
- foldrun login <site>: find Playwright where laptops actually keep it ([ed6cad8](https://github.com/foldrun-io/foldrun-cli/commit/ed6cad8))
- foldrun login <site>: a browser window to sign in by hand, the session stored ([a834518](https://github.com/foldrun-io/foldrun-cli/commit/a834518))
- one line per tool call in the run stream: the completion carries the duration, an unfinished call flushes its start ([d84e305](https://github.com/foldrun-io/foldrun-cli/commit/d84e305))
- tool test, agent run, and check against what is deployed ([927d609](https://github.com/foldrun-io/foldrun-cli/commit/927d609))
- foldrun agent new, flow new, tool new: scaffolding inside a workspace ([e2ffc11](https://github.com/foldrun-io/foldrun-cli/commit/e2ffc11))
- See what is waiting for a person, decide it, and read a run whole ([16ac482](https://github.com/foldrun-io/foldrun-cli/commit/16ac482))
- check refuses a timezone the deploy would refuse ([6f7b4f9](https://github.com/foldrun-io/foldrun-cli/commit/6f7b4f9))
- --workspace names a workspace inside an account, and run and eval say which is missing ([df11a69](https://github.com/foldrun-io/foldrun-cli/commit/df11a69))

### An account folder

- init makes the shape the platform keeps, and every command reads it ([13f1959](https://github.com/foldrun-io/foldrun-cli/commit/13f1959))

### answer

- a bare --option is a usage error, not option 1 ([b41174c](https://github.com/foldrun-io/foldrun-cli/commit/b41174c))

### backups

- foldrun backups says whether each snapshot is encrypted ([23be08c](https://github.com/foldrun-io/foldrun-cli/commit/23be08c))

### check

- a pinned user_agent on engine chromium is compared with the platform's Chromium ([a1d877f](https://github.com/foldrun-io/foldrun-cli/commit/a1d877f))
- warn on a pinned user_agent behind the platform's Chrome and on web.browse.session:; version prints browser versions; docs synced ([72d4fdc](https://github.com/foldrun-io/foldrun-cli/commit/72d4fdc))
- limits: — an unknown key or unreadable count is an error, a tool not granted a warning; docs synced ([1b1c073](https://github.com/foldrun-io/foldrun-cli/commit/1b1c073))
- a tool's listed secrets are granted with it — drop the 'does not declare' error ([bc98caa](https://github.com/foldrun-io/foldrun-cli/commit/bc98caa))
- an agent granting a tool must declare the secrets its file lists ([2f0d654](https://github.com/foldrun-io/foldrun-cli/commit/2f0d654))
- subagents: names that are nothing, no description, no tools left ([3225583](https://github.com/foldrun-io/foldrun-cli/commit/3225583))
- retired tool names use core's sentence; docs: files and bash retired ([9ac770a](https://github.com/foldrun-io/foldrun-cli/commit/9ac770a))
- retired web names are errors; the platform's web tools are never missing; docs: built-ins by category ([c33f8e6](https://github.com/foldrun-io/foldrun-cli/commit/c33f8e6))
- an unknown agent is reported once, by core; bundled docs synced ([acf45f1](https://github.com/foldrun-io/foldrun-cli/commit/acf45f1))
- work out which agents hold an outward tool, and tell the flow lint ([faf8f42](https://github.com/foldrun-io/foldrun-cli/commit/faf8f42))
- refuse region:, currency:, units: and calendar: values that cannot be read ([a3ec961](https://github.com/foldrun-io/foldrun-cli/commit/a3ec961))
- a language: that is not a tag is said here first ([b54543b](https://github.com/foldrun-io/foldrun-cli/commit/b54543b))
- report a web_search:, web_fetch: or web_browse: value that cannot work ([6a7102f](https://github.com/foldrun-io/foldrun-cli/commit/6a7102f))

### cli

- foldrun flow rm-step <flow> --step <n|agent> ([726b88d](https://github.com/foldrun-io/foldrun-cli/commit/726b88d))
- an old error does not block flow add; no colour escapes off a terminal ([f4f1675](https://github.com/foldrun-io/foldrun-cli/commit/f4f1675))
- everything the platform does — canvas patterns, and the missing routes ([1bf5d3a](https://github.com/foldrun-io/foldrun-cli/commit/1bf5d3a))
- web is the only web tool; drop web_search, web_fetch, web_browse ([10840d2](https://github.com/foldrun-io/foldrun-cli/commit/10840d2))
- deploy reports the environments it caused to be built; foldrun runtimes ([e74798c](https://github.com/foldrun-io/foldrun-cli/commit/e74798c))
- web in check and the browse block it prints; docs synced ([ba021f3](https://github.com/foldrun-io/foldrun-cli/commit/ba021f3))
- run links open the run's own page; docs: the run page and mission control ([162db4e](https://github.com/foldrun-io/foldrun-cli/commit/162db4e))
- gallery help names the three web tools; docs synced ([18d916c](https://github.com/foldrun-io/foldrun-cli/commit/18d916c))

### CLI

- Foldrun-Version on every call, an Idempotency-Key per write (reused on its retry), one wait on 429 then a clear message; foldrun api spec [--out] ([db59223](https://github.com/foldrun-io/foldrun-cli/commit/db59223))

### deps

- lock claude-agent-sdk 0.3.285 (via core) ([3f0aacd](https://github.com/foldrun-io/foldrun-cli/commit/3f0aacd))

### docs

- synced — a Node program started through workspace/ is its own main module ([e2bc005](https://github.com/foldrun-io/foldrun-cli/commit/e2bc005))
- sync tools.md — web search site= is a domain ([a4c54d2](https://github.com/foldrun-io/foldrun-cli/commit/a4c54d2))
- sync api-usage (rate-limit exemptions) ([70668bf](https://github.com/foldrun-io/foldrun-cli/commit/70668bf))
- sync — Appearance (light, dark or system) ([a379d8f](https://github.com/foldrun-io/foldrun-cli/commit/a379d8f))
- sync flows.md (the flow canvas) ([1668f31](https://github.com/foldrun-io/foldrun-cli/commit/1668f31))
- sync billing — details, tax invoices, portal, dunning ([b0af763](https://github.com/foldrun-io/foldrun-cli/commit/b0af763))
- sync billing — admin levers, accountant export, your data ([5032eb3](https://github.com/foldrun-io/foldrun-cli/commit/5032eb3))
- sync — billing's bookkeeping rules, the webhook's event list ([55428a5](https://github.com/foldrun-io/foldrun-cli/commit/55428a5))
- sync (cli/authorize decision) ([1ae493c](https://github.com/foldrun-io/foldrun-cli/commit/1ae493c))
- sync from foldrun-docs (api.md audit corrections + 7 pages behind) ([8efe55c](https://github.com/foldrun-io/foldrun-cli/commit/8efe55c))
- synced (pause_when) ([68bb177](https://github.com/foldrun-io/foldrun-cli/commit/68bb177))
- web actions and who does them ([52e2ca4](https://github.com/foldrun-io/foldrun-cli/commit/52e2ca4))
- sync — web_search settings block ([9c73d09](https://github.com/foldrun-io/foldrun-cli/commit/9c73d09))
- sync — web_browse live view, obscura, cdp ([c96f430](https://github.com/foldrun-io/foldrun-cli/commit/c96f430))
- sync — web_browse agent-browser parity ([e3030ad](https://github.com/foldrun-io/foldrun-cli/commit/e3030ad))
- sync — click/check keyboard fallback ([1bc14e5](https://github.com/foldrun-io/foldrun-cli/commit/1bc14e5))
- sync — web_browse live sessions ([b525f3d](https://github.com/foldrun-io/foldrun-cli/commit/b525f3d))
- sync — web_browse version: ([e693880](https://github.com/foldrun-io/foldrun-cli/commit/e693880))
- sync — engine: chrome is real Chrome ([9a11fc4](https://github.com/foldrun-io/foldrun-cli/commit/9a11fc4))
- sync — gallery is the three web tools ([9b22d5c](https://github.com/foldrun-io/foldrun-cli/commit/9b22d5c))
- headless: false now opens a window ([ed3482e](https://github.com/foldrun-io/foldrun-cli/commit/ed3482e))
- browser pod flags need run-server --unsafe; headless: accepted, not acted on yet ([f7a2093](https://github.com/foldrun-io/foldrun-cli/commit/f7a2093))
- a gate holds its group; check warns on a shared number or a gap ([d6adec0](https://github.com/foldrun-io/foldrun-cli/commit/d6adec0))
- when: rows of, FOLDRUN_REPLY_FILE, options under [[flow:x]] ([fea8588](https://github.com/foldrun-io/foldrun-cli/commit/fea8588))
- bundle the 10 MB body limit ([b4f723f](https://github.com/foldrun-io/foldrun-cli/commit/b4f723f))

### docs synced

- api ([03c240a](https://github.com/foldrun-io/foldrun-cli/commit/03c240a))
- flows (canvas run overlay and controls) ([5de3bee](https://github.com/foldrun-io/foldrun-cli/commit/5de3bee))
- tools ([2f48cbe](https://github.com/foldrun-io/foldrun-cli/commit/2f48cbe))
- runs ([f09ca7c](https://github.com/foldrun-io/foldrun-cli/commit/f09ca7c))
- the canvas verbs and the new platform verbs ([22d25c3](https://github.com/foldrun-io/foldrun-cli/commit/22d25c3))
- deploy keeps what runs wrote ([c9d508c](https://github.com/foldrun-io/foldrun-cli/commit/c9d508c))
- vendor browser sessions ([95b4f02](https://github.com/foldrun-io/foldrun-cli/commit/95b4f02))

### every CLI delete asks first

- storage rm, unshare, source rm, secrets rm, keys revoke, workspaces rm ([8a844bb](https://github.com/foldrun-io/foldrun-cli/commit/8a844bb))

### flow dup-step

- the canvas's Duplicate from a terminal ([f66152e](https://github.com/foldrun-io/foldrun-cli/commit/f66152e))

### foldrun account

- the account's defaults, read and set ([6809b30](https://github.com/foldrun-io/foldrun-cli/commit/6809b30))

### foldrun billing

- the balance, and what the money went on ([cd4a51f](https://github.com/foldrun-io/foldrun-cli/commit/cd4a51f))

### foldrun guide

- init writes CLAUDE.md, pull and guide keep it current, a person's notes are never touched ([5d30bd9](https://github.com/foldrun-io/foldrun-cli/commit/5d30bd9))

### foldrun schedule

- what fires on a clock, and when it fires next ([7c575cf](https://github.com/foldrun-io/foldrun-cli/commit/7c575cf))

### foldrun stop

- kill a run in flight ([7761e9a](https://github.com/foldrun-io/foldrun-cli/commit/7761e9a))

### foldrun storage

- what the agents produced, from the terminal ([2a9b330](https://github.com/foldrun-io/foldrun-cli/commit/2a9b330))

### gallery

- foldrun gallery, and local runs find the platform's tools ([62efc43](https://github.com/foldrun-io/foldrun-cli/commit/62efc43))

### git hooks

- pre-push checks the pushed commit in a worktree, not the working tree; a failed archive is not a clean scan ([58ee63d](https://github.com/foldrun-io/foldrun-cli/commit/58ee63d))
- run pre-push checks without git's GIT_DIR ([1f85b5e](https://github.com/foldrun-io/foldrun-cli/commit/1f85b5e))
- take the repo's own .gitleaks.toml when it has one ([de28833](https://github.com/foldrun-io/foldrun-cli/commit/de28833))
- secrets, typecheck and tests before the push, not in CI ([981594a](https://github.com/foldrun-io/foldrun-cli/commit/981594a))

### guide

- the managed AGENTS.md block names flow show/add/rm-step, agent link, and tool-granted secrets ([6ca4f28](https://github.com/foldrun-io/foldrun-cli/commit/6ca4f28))

### keys create/rotate

- a replayed answer has no secret — say so instead of printing null ([c9f2be4](https://github.com/foldrun-io/foldrun-cli/commit/c9f2be4))

### keys rotate

- an already-rotated key's refusal names the command for its replacement; keys ls shows rotated → <id> ([2c4f5ce](https://github.com/foldrun-io/foldrun-cli/commit/2c4f5ce))

### login --engine chrome

- sign in with real Google Chrome when installed ([13ea088](https://github.com/foldrun-io/foldrun-cli/commit/13ea088))

### message

- --step picks one of several running steps; docs synced ([9a93110](https://github.com/foldrun-io/foldrun-cli/commit/9a93110))

### parity with the dashboard

- flow set/trigger/move-step/copy-step/paste/draft, history restore, library, find, changelog, preferences, api version, billing plans/plan/top-up/card, secrets clients + set --kind, connect --client, schedule tick, workspaces demo, report live, workspace vocabulary, repo rm-branch/mirror/mirror-now ([b87c9b5](https://github.com/foldrun-io/foldrun-cli/commit/b87c9b5))

### probe

- say why the model's turn stopped ([70e2d94](https://github.com/foldrun-io/foldrun-cli/commit/70e2d94))

### pull

- a folder tool comes down with its program ([ba5cc33](https://github.com/foldrun-io/foldrun-cli/commit/ba5cc33))

### put

- type the upload-url answer, so the typecheck passes again ([6bbe84f](https://github.com/foldrun-io/foldrun-cli/commit/6bbe84f))

### report

- a lost browser pod never let a reconnect "through"; one that reached the pod and closed again says so; tries numbered #1, #2 ([0a397d8](https://github.com/foldrun-io/foldrun-cli/commit/0a397d8))
- when the browser pod was lost under a slim step, a "tries:" line — slim (lost), then full, each with its cost ([63d0475](https://github.com/foldrun-io/foldrun-cli/commit/63d0475))
- each step's runner image and what happened to the browser pod under a slim step ([901215a](https://github.com/foldrun-io/foldrun-cli/commit/901215a))

### runs

- a filtered list asks each workspace for everything, not its newest twenty ([2ee143c](https://github.com/foldrun-io/foldrun-cli/commit/2ee143c))

### runs/report

- show a completed run's verdict, ⛔ for BLOCKED; --verdict filter ([9bdbcd2](https://github.com/foldrun-io/foldrun-cli/commit/9bdbcd2))

### share and providers --check

- send the JSON body as a string, as every other remoteCall does; the unknown-verb test names all six verbs ([8249a75](https://github.com/foldrun-io/foldrun-cli/commit/8249a75))

### status

- type fetchPlatformStatus's answer (typecheck failed in CI); docs synced ([4ee6fb0](https://github.com/foldrun-io/foldrun-cli/commit/4ee6fb0))

### status --platform

- the platform's status, each component and any live incident or maintenance, from the open /api/status; plain status opens with the one-line verdict; docs synced (status, security, api, cli) ([bf1864c](https://github.com/foldrun-io/foldrun-cli/commit/bf1864c))

### storage put

- many files and whole folders, --into, presigned upload ([f32d53d](https://github.com/foldrun-io/foldrun-cli/commit/f32d53d))

### The CLI asks for core 0.5.0

- workspace/ spelling and the main-module preload ([546057c](https://github.com/foldrun-io/foldrun-cli/commit/546057c))

### version

- print the browsers the platform's runner image was built with; docs synced ([db30766](https://github.com/foldrun-io/foldrun-cli/commit/db30766))
- `foldrun version` (CLI, core, the platform's release and component shas; warns when the platform ships a newer CLI), `foldrun --version` offline, and a once-a-day notice in a terminal when X-Foldrun-Cli is newer; docs synced ([e943985](https://github.com/foldrun-io/foldrun-cli/commit/e943985))

### web_browse

- chrome and safari, the names people use ([75fd5ca](https://github.com/foldrun-io/foldrun-cli/commit/75fd5ca))

## [0.6.0] — 2026-09-15

- The CLI asks for the core it was written against ([5151460](https://github.com/foldrun-io/foldrun-cli/commit/5151460))
- gray-matter as a dev dependency: the e2e test reads frontmatter itself ([270deda](https://github.com/foldrun-io/foldrun-cli/commit/270deda))
- ci checks out the sibling core and links it, the way a checkout has it ([6993084](https://github.com/foldrun-io/foldrun-cli/commit/6993084))
- check fails on a flow option core refuses, not just warns ([63c0545](https://github.com/foldrun-io/foldrun-cli/commit/63c0545))
- NO_COLOR turns the escapes off ([9ffa571](https://github.com/foldrun-io/foldrun-cli/commit/9ffa571))
- a quiet run stream is reconnected, then given up on; a refused key says whose ([387564c](https://github.com/foldrun-io/foldrun-cli/commit/387564c))
- --url acts as the current account, and every remote command says which ([f080b60](https://github.com/foldrun-io/foldrun-cli/commit/f080b60))
- invoke --wait asks in 25-second pieces ([794880e](https://github.com/foldrun-io/foldrun-cli/commit/794880e))
- --test on run and invoke ([4f75235](https://github.com/foldrun-io/foldrun-cli/commit/4f75235))
- connect reuses the saved client; secrets status ([2262bd6](https://github.com/foldrun-io/foldrun-cli/commit/2262bd6))
- Bump the actions group with 3 updates (#1) ([e766085](https://github.com/foldrun-io/foldrun-cli/commit/e766085))

### foldrun doctor

- the path to the platform, one line per check ([f5d1dc8](https://github.com/foldrun-io/foldrun-cli/commit/f5d1dc8))

### invoke --wait

- report a failed run, not "HTTP 500" (#7) ([2d96b11](https://github.com/foldrun-io/foldrun-cli/commit/2d96b11))

### npm run typecheck

- the .mjs sources checked from their JSDoc ([1ec2b99](https://github.com/foldrun-io/foldrun-cli/commit/1ec2b99))

### README

- doctor in the command table ([8d1a489](https://github.com/foldrun-io/foldrun-cli/commit/8d1a489))

### the HTTP client

- a clock, the cause, a User-Agent, one retry ([19c510e](https://github.com/foldrun-io/foldrun-cli/commit/19c510e))

## [0.5.0] — 2026-09-09

### Added

- **`foldrun source`** — one workspace file on a platform, from the terminal:
  `ls [dir]`, `cat <path>`, `put <path>` (from `--file`, else stdin, with
  `--message` recorded on the revision), `mv`, `rm`. The same door the
  dashboard's editor uses, so every write is a revision with who and why.
  For a whole tree, `deploy`.
- **Named accounts.** A profile is one signed-in account on one platform.
  `foldrun accounts` lists every account signed in on this machine with the
  active one marked, `foldrun use <name>` switches, and `--profile <name>`
  acts as one for a single command. Two customers on the *same* platform
  used to overwrite each other, which made looking after several of them a
  matter of pasting `--token` every time.

### Changed

- **Credentials are an API key, and only that.** A claude.ai login sitting on
  the machine is no longer accepted as one: Anthropic does not allow products
  built on its Agent SDK to run on claude.ai subscriptions. Set
  `ANTHROPIC_API_KEY`, or give the agent its own `provider:`.

### Compatibility

- A credentials file written by 0.4.0 is read as it was and migrated on the
  next write, and the old per-URL map goes on being written — a machine that
  moves between versions is not signed out by the move.

## [0.4.0] — 2026-09-08

- depends on @foldrun/core 0.3.0 ([e544799](https://github.com/foldrun-io/foldrun-cli/commit/e544799))

### ignore the lockfile

- this package is installed, not deployed ([43eb1c0](https://github.com/foldrun-io/foldrun-cli/commit/43eb1c0))

### release

- only stage the lockfile when git tracks it ([dfd7689](https://github.com/foldrun-io/foldrun-cli/commit/dfd7689))
- publish by trusted publishing, not a stored token ([cf4807e](https://github.com/foldrun-io/foldrun-cli/commit/cf4807e))

### release engineering

- changelog, tagged releases, CI, and the community files ([1979795](https://github.com/foldrun-io/foldrun-cli/commit/1979795))

## [0.3.1] — 2026-09-07

- `init --from templates/<name>` resolves inside the installed
  `@foldrun/core` rather than relative to the caller, so a template works
  from any directory.

## [0.3.0] — 2026-09-07

- Depends on `@foldrun/core` 0.2.0.

## [0.2.3] — 2026-09-06

- Republished after the npm scope wipe; `0.1.x` and `0.2.0`–`0.2.2` are
  burned and cannot be reused.

## [0.2.0] — 2026-09-05

- `login`, `whoami` and `keys`: sign a machine in, see who it is, manage the
  account's API keys.

## [0.1.0] — 2026-09-05

First publish: `init`, `check`, `run`, `eval`, `probe`, `logs`, `secrets`,
`deploy`.

[0.3.1]: https://github.com/foldrun-io/foldrun-cli/releases/tag/v0.3.1
