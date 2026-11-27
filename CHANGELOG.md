# Changelog

Notable changes to the `foldrun` CLI. The format is
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html) from 1.0.0:
a patch is a bug fix, nothing new; a minor adds something and breaks
nothing; a major breaks something, and its entry opens with Breaking
changes. Pre-releases (`1.3.0-rc.1`) are published under npm's `next` tag.

Entries are drafted from the commit subjects by `npm run release` and then
edited by a person.

<!-- releases -->

## [34.14.0] — 2026-11-27

### docs

- sync bundled docs (FOL-418's agents.md and cli.md), unblocks the dev gate ([7057756](https://github.com/foldrun-io/foldrun-cli/commit/7057756))

### FOL-418

- /model second — a second opinion from another provider's model (#349) ([55f7fe2](https://github.com/foldrun-io/foldrun-cli/commit/55f7fe2))

## [34.13.1] — 2026-11-27

### deps

- @foldrun/core 30.1.0 ([bc6b226](https://github.com/foldrun-io/foldrun-cli/commit/bc6b226))

## [34.13.0] — 2026-11-27

- test(billing): the pay-as-you-go refusal's new words (FOL-385, e808b66) — main was red on the old ones ([e988074](https://github.com/foldrun-io/foldrun-cli/commit/e988074))
- feat(billing): a wallet-only account in billing, billing plans and pay-as-you-go — no plan, the wallet pays as it goes, its limit a month (FOL-385) ([e808b66](https://github.com/foldrun-io/foldrun-cli/commit/e808b66))
- test(code): cli-code-session.test.ts in three files — it ran 5.5 min after FOL-434 and CI cuts a file at 3 min ([a8c3b9f](https://github.com/foldrun-io/foldrun-cli/commit/a8c3b9f))
- feat(code): one keyboard reader; / and @ lists during a turn; questions wait for a typing pause (FOL-434) ([5f43c3e](https://github.com/foldrun-io/foldrun-cli/commit/5f43c3e))

### docs

- sync bundled docs — pay as you go with no plan (FOL-385) ([0bb7df2](https://github.com/foldrun-io/foldrun-cli/commit/0bb7df2))

## [34.12.0] — 2026-11-27

- test(code): the coder upgrade against the templates releases wrote, and only over the file it read (FOL-415, Codex) ([6a95e9e](https://github.com/foldrun-io/foldrun-cli/commit/6a95e9e))
- feat(code): the cloud coder carries koder's mark; an unedited coder from an earlier foldrun code is brought up to date (FOL-415) ([0b73886](https://github.com/foldrun-io/foldrun-cli/commit/0b73886))

## [34.11.0] — 2026-11-27

- feat(code): koder's mark carries foldrun's logo on pull requests, issues and exports (FOL-415) ([0bd5b21](https://github.com/foldrun-io/foldrun-cli/commit/0bd5b21))

## [34.10.1] — 2026-11-27

### docs

- sync agents.md (FOL-438) ([e8e17b6](https://github.com/foldrun-io/foldrun-cli/commit/e8e17b6))

## [34.10.0] — 2026-11-27

- test(code): koder's mark test in its own file — cli-code-session.test.ts went past the 180 s per-file limit on CI (FOL-415) ([b952dbc](https://github.com/foldrun-io/foldrun-cli/commit/b952dbc))
- test(code): the table timing bound fits a CI runner (1262 ms there; main red since 66ec8e1) ([392993f](https://github.com/foldrun-io/foldrun-cli/commit/392993f))
- fix(code): koder's User-Agent on the library, version, usage and transcribe requests (FOL-415, Codex) ([43b22cc](https://github.com/foldrun-io/foldrun-cli/commit/43b22cc))
- fix(code): koder's mark stays out of a cloud task (the person's words, shown as the run's task); MCP sessions and sign-in carry koder's names (FOL-415, Codex) ([c4ed202](https://github.com/foldrun-io/foldrun-cli/commit/c4ed202))
- feat(code): koder's mark on commits, pull requests, issues, exports, User-Agent and MCP (FOL-415) ([e297fb8](https://github.com/foldrun-io/foldrun-cli/commit/e297fb8))

## [34.9.0] — 2026-11-27

- feat(code): trusted sessions — messages into a running turn, the answer sent back (FOL-345) ([66ec8e1](https://github.com/foldrun-io/foldrun-cli/commit/66ec8e1))
- fix(usage): rates says tokens come from the wallet, plan credits first, when the account's terms say so (FOL-384) ([bf77b79](https://github.com/foldrun-io/foldrun-cli/commit/bf77b79))

### docs

- sync budgets-and-billing and cli from foldrun-docs (FOL-384) ([29eab7d](https://github.com/foldrun-io/foldrun-cli/commit/29eab7d))

## [34.8.0] — 2026-11-27

- fix(code): turnSteps in the CodePrefs type (the release's typecheck failed on 883c1cc) ([79c04dc](https://github.com/foldrun-io/foldrun-cli/commit/79c04dc))
- feat(code): no step limit per turn by default; /permissions steps <n>|off sets one, kept for the person (owner, 27 Nov 2026) ([883c1cc](https://github.com/foldrun-io/foldrun-cli/commit/883c1cc))
- fix(code): a turn that did not finish always says why and how to go on — the step limit, a cut-off reply, no result (FOL-426) ([cd07e9f](https://github.com/foldrun-io/foldrun-cli/commit/cd07e9f))
- fix(code): a paste never sends — it waits on the line and Enter sends it, with or without the terminal's paste marks (FOL-423) ([d960935](https://github.com/foldrun-io/foldrun-cli/commit/d960935))

## [34.7.1] — 2026-11-27

### docs

- sync api-usage, cli and runs from foldrun-docs (FOL-386 left them stale; dev's gate failed on it) ([c3d9749](https://github.com/foldrun-io/foldrun-cli/commit/c3d9749))

## [34.7.0] — 2026-11-27

- feat(billing): `billing` and `billing plans` show the storage the plan includes (FOL-386) ([053dc7c](https://github.com/foldrun-io/foldrun-cli/commit/053dc7c))
- fix(code): line editing during a turn is grapheme-safe — widths, cuts and the cursor by grapheme (emoji, flags, vowel signs), a paste is text not keys, Esc then Enter sends, repaint after a reflow (FOL-348, Codex rounds 1–8) ([a3eac8d](https://github.com/foldrun-io/foldrun-cli/commit/a3eac8d))
- feat(code): the cursor shows in the input line while a turn runs, and ←/→/Home/End edit the typed line (FOL-348) ([a7b57c3](https://github.com/foldrun-io/foldrun-cli/commit/a7b57c3))

## [34.6.0] — 2026-11-27

- feat(routes): production's Iran front approved for api.foldrun.io (FOL-402) ([87dccb2](https://github.com/foldrun-io/foldrun-cli/commit/87dccb2))

## [34.5.0] — 2026-11-27

- feat(billing): foldrun billing plan starter|pro|max — Starter listed, bought, a move down at the renewal (FOL-413) ([ac3c2ff](https://github.com/foldrun-io/foldrun-cli/commit/ac3c2ff))

### test

- the old-plan refusal is shown with scale; starter is a size now (FOL-413) ([ebfca1e](https://github.com/foldrun-io/foldrun-cli/commit/ebfca1e))

## [34.4.1] — 2026-11-27

### docs

- sync api-usage (foldrun_debate server tool, FOL-416) ([7daab52](https://github.com/foldrun-io/foldrun-cli/commit/7daab52))

## [34.4.0] — 2026-11-27

- feat(cli): doctor's road test, route fallback to approved fronts, Claude Code address move (FOL-402) ([6e8c626](https://github.com/foldrun-io/foldrun-cli/commit/6e8c626))

## [34.3.0] — 2026-11-27

- feat(code): every tool foldrun's API runs is on by default — search, fetch and browse without tools: [web], and extract, generate, docs as the API offers them (FOL-412) ([47b6ec3](https://github.com/foldrun-io/foldrun-cli/commit/47b6ec3))

## [34.2.1] — 2026-11-27

- test(code): the stub's unanswered cloud call waits 2 s, not 30 s — the file went past its 180 s cap on dev's gate ([0a2d0e5](https://github.com/foldrun-io/foldrun-cli/commit/0a2d0e5))

### deps

- @foldrun/core 29.7.1 ([0a8b4ec](https://github.com/foldrun-io/foldrun-cli/commit/0a8b4ec))

## [34.2.0] — 2026-11-26

- chore(hooks): hooks synced from foldrun-infra — CircleCI removed (FOL-404) ([3d24d17](https://github.com/foldrun-io/foldrun-cli/commit/3d24d17))
- feat(code): /permissions bypass asks no question — every yes/no koder asks is answered yes (FOL-411) ([bfb7b61](https://github.com/foldrun-io/foldrun-cli/commit/bfb7b61))

## [34.1.1] — 2026-11-26

### docs

- sync from foldrun-docs (FOL-397's /permissions page) — dev's gate failed on the stale copy ([96f96e8](https://github.com/foldrun-io/foldrun-cli/commit/96f96e8))

## [34.1.0] — 2026-11-26

- feat(code): cloud_jobs path — a job on one repository inside a folder of repositories; identity re-checked before pack, apply and /undo (FOL-351) ([9f2a96e](https://github.com/foldrun-io/foldrun-cli/commit/9f2a96e))

## [34.0.0] — 2026-11-26

### Breaking changes

- /permissions bypass no longer ends with the session; it (ca559f2)

- feat(code): /permissions remembers the last choice for the next session (FOL-397) ([ca559f2](https://github.com/foldrun-io/foldrun-cli/commit/ca559f2))

## [33.7.3] — 2026-11-26

### deps

- @foldrun/core 29.7.0 ([3972431](https://github.com/foldrun-io/foldrun-cli/commit/3972431))

## [33.7.2] — 2026-11-26

- fix(code): /where web says why search and fetch were not offered; a failed gateway ask is made again at the next message (FOL-332) ([feb918d](https://github.com/foldrun-io/foldrun-cli/commit/feb918d))

## [33.7.1] — 2026-11-26

- fix(code): a server started outside the sandbox says it lasts the turn, and a later turn is told why its job is gone (FOL-331) ([faccb25](https://github.com/foldrun-io/foldrun-cli/commit/faccb25))

## [33.7.0] — 2026-11-26

### New in the public API

- the `--resources` flag
- the `--no-resources` flag

- fix(code): --resources and --no-resources set this session's budget, a value that cannot be read is refused (FOL-330) ([b026060](https://github.com/foldrun-io/foldrun-cli/commit/b026060))

## [33.6.1] — 2026-11-26

### deps

- @foldrun/core 29.6.1 ([c699299](https://github.com/foldrun-io/foldrun-cli/commit/c699299))

## [33.6.0] — 2026-11-26

- feat(code): cloud jobs take many tasks on both paths, start at once and return as each finishes; the platform's room is the limit (FOL-382) ([ad0a8c7](https://github.com/foldrun-io/foldrun-cli/commit/ad0a8c7))

## [33.5.0] — 2026-11-26

- perf(code): FOL-383 — the local web module and the frontmatter reader load only when the agent has web (FOL-265 ceilings) ([303e51d](https://github.com/foldrun-io/foldrun-cli/commit/303e51d))
- fix(code): FOL-383 Codex round 3 — the site limits shown with a search, asking said for this computer's turns, a page read in its own charset ([5f3a8b0](https://github.com/foldrun-io/foldrun-cli/commit/5f3a8b0))
- fix(code): FOL-383 Codex round 2 — direct connections only, the whole query or address shown, the web follows a cloud session, one wording for web asking, one deadline over redirects ([44f3d28](https://github.com/foldrun-io/foldrun-cli/commit/44f3d28))
- fix(code): FOL-383 Codex round 1 — web needs the agent's grant, no server tools on plan turns, scripts do not drive a browser unasked, mapped IPv6 and redirect checks ([0187523](https://github.com/foldrun-io/foldrun-cli/commit/0187523))
- feat(code): the web in the cloud by default, search, fetch and browse here with /where web here; web calls unasked unless /permissions web ask (FOL-383) ([78ac822](https://github.com/foldrun-io/foldrun-cli/commit/78ac822))

## [33.4.1] — 2026-11-26

- test(code): FOL-380's terminal tests in their own file — cli-code-session.test.ts ran past the 180 s per-file limit on CI with them ([27e8d3e](https://github.com/foldrun-io/foldrun-cli/commit/27e8d3e))
- fix(code): a slash command typed during a turn runs beside it or after it, never sent to the agent (FOL-380) ([7ed4ea0](https://github.com/foldrun-io/foldrun-cli/commit/7ed4ea0))

## [33.4.0] — 2026-11-26

- feat(code): the transcript tells apart what the person sent (❯/┃), koder's answer (◆) and the coding (│ gutter); scripts' output unchanged; whitespace-only edits shown (FOL-356) ([dea47e3](https://github.com/foldrun-io/foldrun-cli/commit/dea47e3))

### deps

- @foldrun/core 29.6.0 ([e8702a9](https://github.com/foldrun-io/foldrun-cli/commit/e8702a9))

## [33.3.1] — 2026-11-26

### deps

- @foldrun/core 29.5.1 ([fbdae37](https://github.com/foldrun-io/foldrun-cli/commit/fbdae37))

## [33.3.0] — 2026-11-26

- feat(code): the running-turn screen drawn in place, roomier, setup reads in parallel (FOL-342); background jobs under the working line, /status jobs on|off (FOL-343) ([e714991](https://github.com/foldrun-io/foldrun-cli/commit/e714991))

### deps

- @foldrun/core 29.5.0 (jobs option, FOL-343; sandbox git scan, FOL-334) ([2f83b33](https://github.com/foldrun-io/foldrun-cli/commit/2f83b33))

### docs

- sync cli.md (/status jobs, FOL-343) ([c666cb5](https://github.com/foldrun-io/foldrun-cli/commit/c666cb5))

## [33.2.0] — 2026-11-26

- fix(code): the lead on a running turn's input line is joined by a no-break space, so it is never taken for the idle prompt (FOL-339) ([72f8417](https://github.com/foldrun-io/foldrun-cli/commit/72f8417))
- feat(code): the input line under a running turn carries the prompt's lead, account · project (FOL-339) ([775ec97](https://github.com/foldrun-io/foldrun-cli/commit/775ec97))

### deps

- @foldrun/core 29.4.0, pinned exactly — a core release no longer breaks a fresh install ([5dd9671](https://github.com/foldrun-io/foldrun-cli/commit/5dd9671))

### docs

- sync (FOL-337, FOL-338, FOL-340) ([b932fee](https://github.com/foldrun-io/foldrun-cli/commit/b932fee))

## [33.1.2] — 2026-11-26

### deps

- @foldrun/core ^29.2.2 ([7657323](https://github.com/foldrun-io/foldrun-cli/commit/7657323))

## [33.1.1] — 2026-11-26

- build(deps): bump actions/create-github-app-token (#244) ([03b3f90](https://github.com/foldrun-io/foldrun-cli/commit/03b3f90))

## [33.1.0] — 2026-11-25

### New in the public API

- the `--auto` flag

- ci(release-merge): read a ci run's conclusion itself — the API's status=success filter missed a green re-run ([a4c9789](https://github.com/foldrun-io/foldrun-cli/commit/a4c9789))
- feat(code): /update — take the latest foldrun and start again, check, auto-update on/off; /restart merged in (FOL-335) (#298) ([e52ccbd](https://github.com/foldrun-io/foldrun-cli/commit/e52ccbd))
- fix(code): a patch that was refused is not listed as a change — the footer waits for the call's result (FOL-294) ([d7cb94f](https://github.com/foldrun-io/foldrun-cli/commit/d7cb94f))

### feat

- one command to qualify a vendor's browser through the vendor door — on-list loads, off-list refused, key never shown (FOL-151) ([6ab26d2](https://github.com/foldrun-io/foldrun-cli/commit/6ab26d2))

## [33.0.3] — 2026-11-25

### deps

- @foldrun/core ^29.2.1 — the local sandbox runs commands in a folder that is no git repository on Linux (FOL-333) ([45bbaa1](https://github.com/foldrun-io/foldrun-cli/commit/45bbaa1))

### test

- npm test runs with its own temp root under /tmp, so stray project files in the system temp folder cannot fail it ([c259de0](https://github.com/foldrun-io/foldrun-cli/commit/c259de0))

## [33.0.2] — 2026-11-25

- fix(koder): --version names the version that runs — a staged update after foldrun update or an auto-update — not the installed files ([f154ad1](https://github.com/foldrun-io/foldrun-cli/commit/f154ad1))
- fix(code): the memory watchdog finds ps by its path — a turn replaces PATH, and it saw nothing (FOL-240) ([d389eae](https://github.com/foldrun-io/foldrun-cli/commit/d389eae))
- fix(cli): load commands with a Windows-compatible module specifier ([0006c64](https://github.com/foldrun-io/foldrun-cli/commit/0006c64))

### ci

- Windows smoke job (the CLI installed and run from PowerShell) (#292) ([a564d34](https://github.com/foldrun-io/foldrun-cli/commit/a564d34))

## [33.0.1] — 2026-11-25

### docs

- sync (FOL-327) ([027b149](https://github.com/foldrun-io/foldrun-cli/commit/027b149))

## [33.0.0] — 2026-11-25

### Breaking changes

- the CLI now runs on @foldrun/core 29.2.0, a new major. (79d7f70)

- fix(code): a cloud agent's question in a script's turn (-p, or no terminal) is told on stderr with the command that answers it, never a list (FOL-298) ([6c73734](https://github.com/foldrun-io/foldrun-cli/commit/6c73734))
- fix(code-worker): lsof's mount warning compared case-folded on a Mac and by its name as written (Codex round 2) ([a984a54](https://github.com/foldrun-io/foldrun-cli/commit/a984a54))
- fix(code-worker): a mount lsof cannot stat elsewhere is no doubt about the copy — with Docker running, a worker's slot never came back ([2f5bf56](https://github.com/foldrun-io/foldrun-cli/commit/2f5bf56))
- test(code): the FOL-298 terminal tests end bounded — they hung CI and the release for hours; test steps get limits ([3857667](https://github.com/foldrun-io/foldrun-cli/commit/3857667))

### deps

- @foldrun/core ^29.2.0 ([79d7f70](https://github.com/foldrun-io/foldrun-cli/commit/79d7f70))

## [32.8.2] — 2026-11-25

### docs

- sync (FOL-215) ([3caf75a](https://github.com/foldrun-io/foldrun-cli/commit/3caf75a))

## [32.8.1] — 2026-11-25

- fix(code): a cloud question waiting behind another is asked only while still open; cleanup runs however following ends; the Esc hint names the question (Codex, FOL-298) ([22ca952](https://github.com/foldrun-io/foldrun-cli/commit/22ca952))

### deps

- @foldrun/core ^27.12.0 (Symbols, FOL-297) ([bd844c6](https://github.com/foldrun-io/foldrun-cli/commit/bd844c6))

### docs

- sync (FOL-297 symbols) ([a930c29](https://github.com/foldrun-io/foldrun-cli/commit/a930c29))
- sync (FOL-298) ([bcd3021](https://github.com/foldrun-io/foldrun-cli/commit/bcd3021))

## [32.8.0] — 2026-11-25

### New in the public API

- the `--media` flag

- feat(code): a cloud agent's question in a cloud turn — shown here as a local one is, the answer sent to the run; taken back when answered elsewhere or the run ends; in a script's turn said on stderr with the command that answers it (FOL-298) ([ce6b014](https://github.com/foldrun-io/foldrun-cli/commit/ce6b014))
- test(code): the ask_person PTY test needs no sandbox — on Linux CI none starts (no bubblewrap) and the turn stopped before the question (FOL-314) ([faf7b88](https://github.com/foldrun-io/foldrun-cli/commit/faf7b88))
- fix(code): a Symbols location from an added folder marks the turn private, as Read does (Codex, FOL-297) ([9a310e6](https://github.com/foldrun-io/foldrun-cli/commit/9a310e6))
- fix(code): Symbols is unasked exactly when a command inside the sandbox is — its server can write the folder (Codex, FOL-297) ([674a769](https://github.com/foldrun-io/foldrun-cli/commit/674a769))
- feat(code): Symbols on this computer — offered inside the sandbox, unasked like Read, its language servers installed into the project's package cache and run inside the walls (FOL-297) ([312f888](https://github.com/foldrun-io/foldrun-cli/commit/312f888))
- fix(code): long ask choices measured in screen cells (Codex, FOL-314) ([e1abeb3](https://github.com/foldrun-io/foldrun-cli/commit/e1abeb3))
- fix(code): the ask list closes when the turn is stopped or the keyboard closes; long choices shown whole (Codex, FOL-314) ([b36c737](https://github.com/foldrun-io/foldrun-cli/commit/b36c737))
- feat(code): ask_person in local turns — the platform's shape, a list of choices or the person's own words at the keyboard, refused with nobody to ask or for a sub-agent; only an answer the question gave counts (FOL-314) ([2d4f27e](https://github.com/foldrun-io/foldrun-cli/commit/2d4f27e))
- fix(code): only a launch the person was asked about ends what ran on inside (Codex, FOL-296) ([8a89625](https://github.com/foldrun-io/foldrun-cli/commit/8a89625))
- fix(code): a server outside the sandbox — starting it ends what ran on inside; while it lives no earlier always stands; its groups watched apart from the job list (Codex, FOL-296) ([46d5a66](https://github.com/foldrun-io/foldrun-cli/commit/46d5a66))
- fix(code): a server outside the sandbox is live while its group is; none starts while jobs run inside; cloud agents' changes are asked while it runs (Codex, FOL-296) ([a052818](https://github.com/foldrun-io/foldrun-cli/commit/a052818))
- fix(code): while a server runs outside the sandbox, the agent's commands and changes here are asked, and the question says why; outside jobs run /bin/bash (Codex, FOL-296) ([3465cc0](https://github.com/foldrun-io/foldrun-cli/commit/3465cc0))
- feat(code): a dev server outside the sandbox — bash_outside run_in_background (asked), job o1 read unasked, typed into asked, never reachable from Bash; the agent is told how to test its app in the browser (FOL-296) ([fd29a3f](https://github.com/foldrun-io/foldrun-cli/commit/fd29a3f))
- fix(code): /undo's copy of an Edit across files — the same 16 MB bound as core, kept under the real file (Codex, FOL-294) ([a56111d](https://github.com/foldrun-io/foldrun-cli/commit/a56111d))
- fix(code): /undo groups an Edit's files as core does — by the real file (Codex, FOL-294) ([0a188e7](https://github.com/foldrun-io/foldrun-cli/commit/0a188e7))
- feat(code): Edit across files — asked once with every change under its file, inside only when all are, /undo keeps and takes back each file (FOL-294) ([a3cb5ff](https://github.com/foldrun-io/foldrun-cli/commit/a3cb5ff))
- feat(code): background jobs — input asked every time outside the sandbox with no always, reading and stopping unasked, shown in the transcript (FOL-293) ([b8b6848](https://github.com/foldrun-io/foldrun-cli/commit/b8b6848))
- fix(code): allowed_domains as a call argument is refused on this computer too (Codex, FOL-267) ([1c792cf](https://github.com/foldrun-io/foldrun-cli/commit/1c792cf))
- fix(code): an agent held to allowed_domains is refused on this computer — the window kept open cannot keep the hold between calls; web.actions checked on every core (Codex, FOL-267) ([465960a](https://github.com/foldrun-io/foldrun-cli/commit/465960a))
- fix(code): web.browse locally — account file unreadable refuses, web.actions holds, url on every call when held to sites, files read again after 30 s, context settings named not applied (Codex, FOL-267) ([c47a294](https://github.com/foldrun-io/foldrun-cli/commit/c47a294))
- feat(code): the agent's web.browse block holds on this computer as in the cloud — kept, refused by name, or noted (FOL-267) ([1559913](https://github.com/foldrun-io/foldrun-cli/commit/1559913))
- fix(browser): browser mcp's web — a cancelled call is skipped or stopped; the first list waits for the gallery (FOL-267, Codex) ([2badbd3](https://github.com/foldrun-io/foldrun-cli/commit/2badbd3))
- feat(browser): browser mcp serves the cloud's full web tool beside the six (FOL-267) ([a32ea85](https://github.com/foldrun-io/foldrun-cli/commit/a32ea85))
- fix(code): web on this computer checks all of work/ for links, and a scan it could not finish refuses (FOL-267, Codex) ([65cd418](https://github.com/foldrun-io/foldrun-cli/commit/65cd418))
- fix(code): web on this computer — the question says it runs outside the sandbox and shows every step; state refused; links and a stopped turn run nothing (FOL-267, Codex) ([54b0b87](https://github.com/foldrun-io/foldrun-cli/commit/54b0b87))
- feat(code): the local agent browses with the cloud's web action=browse, in this computer's Chrome window (FOL-267) ([2078a16](https://github.com/foldrun-io/foldrun-cli/commit/2078a16))
- feat(keys): keys set <id> --media text|as-is (FOL-268) ([ee4bfd5](https://github.com/foldrun-io/foldrun-cli/commit/ee4bfd5))
- test(code): FOL-318's fake stdin passes the typecheck (cast through unknown) ([2e2f473](https://github.com/foldrun-io/foldrun-cli/commit/2e2f473))
- test(code): /permissions rm's question now ends with (Esc to go back) (FOL-318) ([da37d0b](https://github.com/foldrun-io/foldrun-cli/commit/da37d0b))
- fix(code): Esc leaves a menu's follow-up question instead of typing ^[ into it (FOL-318) ([e95c6da](https://github.com/foldrun-io/foldrun-cli/commit/e95c6da))

### deps

- @foldrun/core ^27.10.0 (background jobs, Edit edits, ENGINE_TOOLS from engine-loop, ctx.shell — FOL-293–296) ([8b97dff](https://github.com/foldrun-io/foldrun-cli/commit/8b97dff))

### docs

- sync (FOL-297) ([099659e](https://github.com/foldrun-io/foldrun-cli/commit/099659e))
- sync bundled docs (FOL-321 web_search cache) ([f3bbf1d](https://github.com/foldrun-io/foldrun-cli/commit/f3bbf1d))
- sync (FOL-313 web_browse) ([219d4f4](https://github.com/foldrun-io/foldrun-cli/commit/219d4f4))
- sync (FOL-319, FOL-320) ([763b0b5](https://github.com/foldrun-io/foldrun-cli/commit/763b0b5))
- sync (FOL-314) ([fad6064](https://github.com/foldrun-io/foldrun-cli/commit/fad6064))
- sync cli.md (FOL-296) ([b3e6f64](https://github.com/foldrun-io/foldrun-cli/commit/b3e6f64))
- sync agents.md, hooks.md (FOL-294) ([0ffdabc](https://github.com/foldrun-io/foldrun-cli/commit/0ffdabc))
- sync agents.md, cli.md (FOL-293) ([366be54](https://github.com/foldrun-io/foldrun-cli/commit/366be54))
- sync from foldrun-docs (security#people anchors, FOL-317) ([cccff41](https://github.com/foldrun-io/foldrun-cli/commit/cccff41))
- sync browser.md (FOL-267) ([3c16c71](https://github.com/foldrun-io/foldrun-cli/commit/3c16c71))
- sync browser.md, cli.md, tools.md (FOL-267) ([002b118](https://github.com/foldrun-io/foldrun-cli/commit/002b118))
- sync api.md, cli.md (FOL-268 mediaToText) ([8aa2903](https://github.com/foldrun-io/foldrun-cli/commit/8aa2903))
- sync api.md, notifications.md, security.md (FOL-317) ([f9be412](https://github.com/foldrun-io/foldrun-cli/commit/f9be412))

## [32.7.0] — 2026-11-25

- fix(code): a gitignored image is not offered as it is in the cloud — the cloud's copy leaves it out (FOL-268, Codex) ([38b7140](https://github.com/foldrun-io/foldrun-cli/commit/38b7140))
- fix(code): media: read with core's YAML reader; in the cloud an image inside the folder can be looked at as it is (FOL-268, Codex) ([c8f9e1c](https://github.com/foldrun-io/foldrun-cli/commit/c8f9e1c))
- feat(code): the agent's media: as-is starts a named image's list at 'as it is' (FOL-268) ([b02ec78](https://github.com/foldrun-io/foldrun-cli/commit/b02ec78))
- fix(code): the cursor comes back on a signal during the working line; no working line with --output-format json (Codex) ([8ac2b08](https://github.com/foldrun-io/foldrun-cli/commit/8ac2b08))
- fix(code): a chosen file's identity includes size and change times — a reused inode number is not the same file (dev gate, FOL-268) ([8cde9f6](https://github.com/foldrun-io/foldrun-cli/commit/8cde9f6))
- fix(code): 'working' shows the moment Enter sends a message (the setup's round trips left the screen still for a second); the cursor hidden while it redraws ([2a55fa4](https://github.com/foldrun-io/foldrun-cli/commit/2a55fa4))
- feat(code): an image named in a message can go to the model as it is, with its token estimate, kept in the conversation (FOL-268 slice 2; needs core 27.9.0) ([8784843](https://github.com/foldrun-io/foldrun-cli/commit/8784843))
- Revert "docs: sync from foldrun-docs" — it carried another session's uncommitted docs edits (api.md, security.md) ([45c2722](https://github.com/foldrun-io/foldrun-cli/commit/45c2722))
- fix(code): chosen file opened non-blocking and its size checked again (FOL-268, Codex) ([41bdcbb](https://github.com/foldrun-io/foldrun-cli/commit/41bdcbb))
- fix(code): named files — a hidden file always asked, the bytes read are the file chosen (inode, no link followed), a file outside the folder shown by its path (FOL-268, Codex) ([15d0cf3](https://github.com/foldrun-io/foldrun-cli/commit/15d0cf3))
- fix(code): named files — a link shown and sent as its target, a kept choice only for an @path inside the folder, no upload without a terminal to ask, a skipped file keeps the message (FOL-268, Codex) ([ff3cb5e](https://github.com/foldrun-io/foldrun-cli/commit/ff3cb5e))
- feat(code): files named in a message are read into text on foldrun's servers — into text for the agent, or just the text with no model call; kept per kind, listed in /permissions (FOL-268 slice 1) ([ab77fab](https://github.com/foldrun-io/foldrun-cli/commit/ab77fab))

### deps

- @foldrun/core ^27.9.0 (images on the engine, FOL-295/FOL-268) ([b7f742e](https://github.com/foldrun-io/foldrun-cli/commit/b7f742e))

### docs

- sync agents.md (media:, FOL-268) ([251b931](https://github.com/foldrun-io/foldrun-cli/commit/251b931))
- sync api.md and security.md from foldrun-docs (FOL-316) ([c21deed](https://github.com/foldrun-io/foldrun-cli/commit/c21deed))
- sync from foldrun-docs (server tools on the gateway, FOL-313; and pages changed upstream) ([74b88cd](https://github.com/foldrun-io/foldrun-cli/commit/74b88cd))
- sync api.md and security.md from foldrun-docs (FOL-315) ([c74896a](https://github.com/foldrun-io/foldrun-cli/commit/c74896a))
- sync from foldrun-docs ([0ff666f](https://github.com/foldrun-io/foldrun-cli/commit/0ff666f))

## [32.6.1] — 2026-11-25

### deps

- @foldrun/core ^27.8.2 ([fd467d8](https://github.com/foldrun-io/foldrun-cli/commit/fd467d8))

## [32.6.0] — 2026-11-25

### New in the public API

- the `--sent` flag
- the `--with` flag

- fix(code): --with check reads the flag's type, so the switch test sees no boolean (FOL-307) ([8a6b2e0](https://github.com/foldrun-io/foldrun-cli/commit/8a6b2e0))
- fix(code): --json refuses an older platform's inbox for --with/--sent too (FOL-307, Codex) ([24f377d](https://github.com/foldrun-io/foldrun-cli/commit/24f377d))
- fix(code): /sessions <id> keeps the id's case; an older platform's inbox is never shown as a thread; only a time is printed from at (FOL-307, Codex) ([d3afd13](https://github.com/foldrun-io/foldrun-cli/commit/d3afd13))
- feat(code): /sessions <id> shows the thread with a session; a sent message is a line of it; sessions messages --with/--sent (FOL-307) ([46308d5](https://github.com/foldrun-io/foldrun-cli/commit/46308d5))
- fix(code): during a turn's setup every question hands the keyboard back after it too (FOL-306, Codex) ([3054b69](https://github.com/foldrun-io/foldrun-cli/commit/3054b69))
- fix(code): the keyboard is handed back only when the turn's setup asks; a draft is cut by characters (FOL-306, Codex) ([158ce91](https://github.com/foldrun-io/foldrun-cli/commit/158ce91))
- fix(code): the turn's end reads the draft after the handing back (FOL-306, Codex) ([b7ea41f](https://github.com/foldrun-io/foldrun-cli/commit/b7ea41f))
- fix(code): one handing back, its text taken by the first caller only (FOL-306, Codex) ([0df450d](https://github.com/foldrun-io/foldrun-cli/commit/0df450d))
- fix(code): every caller of stop() shares one handing back; a draft keeps its spaces across a prompt (FOL-306, Codex) ([c408f5b](https://github.com/foldrun-io/foldrun-cli/commit/c408f5b))
- fix(code): a draft survives a prompt, keys are read through the turn's lookups, job tickers show what is typed, the keyboard comes back unless the turn is over (FOL-306, Codex) ([60df4c9](https://github.com/foldrun-io/foldrun-cli/commit/60df4c9))
- fix(code): on a turn on this computer what is typed shows on the working line as it is typed (FOL-306) ([7b7de41](https://github.com/foldrun-io/foldrun-cli/commit/7b7de41))

### docs

- sync (FOL-306) ([6e4c00b](https://github.com/foldrun-io/foldrun-cli/commit/6e4c00b))

## [32.5.0] — 2026-11-25

- fix(code): messages_gone passes through codeLocalTurn's own catch (FOL-305, Codex) ([bc10919](https://github.com/foldrun-io/foldrun-cli/commit/bc10919))
- fix(code): a message taken between list and hold is a skipped turn with its notes kept (FOL-305, Codex) ([8dff20c](https://github.com/foldrun-io/foldrun-cli/commit/8dff20c))
- fix(code): a messages-only turn that sends nothing keeps its notes, stops a goal, and is still messages-only on the allowance retry (FOL-305, Codex) ([2435f9a](https://github.com/foldrun-io/foldrun-cli/commit/2435f9a))
- fix(code): a yes at the prompt is taken by the next turn whatever happens; a turn for messages with none left sends nothing (FOL-305, Codex) ([e34bef8](https://github.com/foldrun-io/foldrun-cli/commit/e34bef8))
- feat(code): a message from another session shows at an idle prompt; Enter on an empty line shows it whole and asks once (FOL-305) ([05787ad](https://github.com/foldrun-io/foldrun-cli/commit/05787ad))

### docs

- sync (FOL-305) ([9668d71](https://github.com/foldrun-io/foldrun-cli/commit/9668d71))

## [32.4.0] — 2026-11-25

- fix(code): marginLines counts widths once, linear in the text (FOL-311, Codex) ([a5ac813](https://github.com/foldrun-io/foldrun-cli/commit/a5ac813))
- fix(code): a message is shown whole, a deep indent stays inside the row, a long cut is counted once (FOL-311, Codex) ([509876f](https://github.com/foldrun-io/foldrun-cli/commit/509876f))
- feat(code): the transcript reads as separate blocks — thinking and messages wrap under their margin and keep their line breaks (FOL-311) ([93081ba](https://github.com/foldrun-io/foldrun-cli/commit/93081ba))
- fix(code): pass askSite as core's trailing argument (FOL-312) ([5d0b3e3](https://github.com/foldrun-io/foldrun-cli/commit/5d0b3e3))
- fix(code): a site question still open when the turn ends is withdrawn, its keyboard given back (FOL-312, Codex) ([f02acb1](https://github.com/foldrun-io/foldrun-cli/commit/f02acb1))
- fix(code): a site's yes is for its port, bypass keeps nothing, a question after the turn is a no; deny and reset take asked sites away (FOL-312, Codex) ([1693ec9](https://github.com/foldrun-io/foldrun-cli/commit/1693ec9))
- feat(code): a site the sandbox does not list is asked about by name while the command runs, not sent outside the sandbox (FOL-312) ([fe58549](https://github.com/foldrun-io/foldrun-cli/commit/fe58549))

### deps

- @foldrun/core ^27.8.0 ([1a8afca](https://github.com/foldrun-io/foldrun-cli/commit/1a8afca))

### docs

- sync cli.md (FOL-311) ([3ae197e](https://github.com/foldrun-io/foldrun-cli/commit/3ae197e))

## [32.3.0] — 2026-11-25

- fix(code): tables of many rows — no spread into Math.max (FOL-310, Codex) ([747de42](https://github.com/foldrun-io/foldrun-cli/commit/747de42))
- fix(code): tables — water-fill columns never under the minimum, a wide character always fits its cut, huge tables, a trailing escaped bar (FOL-310, Codex) ([7f4102e](https://github.com/foldrun-io/foldrun-cli/commit/7f4102e))
- feat(code): markdown tables drawn as columns, cells wrapped; one block per row when too narrow (FOL-310) ([aa87624](https://github.com/foldrun-io/foldrun-cli/commit/aa87624))

## [32.2.0] — 2026-11-25

- fix(code): bypass ends with /permissions reset and with a new or resumed conversation; the list ticks it (FOL-308, Codex) ([509a7ac](https://github.com/foldrun-io/foldrun-cli/commit/509a7ac))
- test(code): /permissions list moved by Bypass (FOL-308) ([2ba6e61](https://github.com/foldrun-io/foldrun-cli/commit/2ba6e61))
- feat(code): /permissions bypass — nothing asked for the session, red in the status line (FOL-308) ([0734b38](https://github.com/foldrun-io/foldrun-cli/commit/0734b38))
- fix(code): a this-computer-only session is told the person answers other sessions (/sessions send), not a session_send it does not have (FOL-309) ([a2c2e1c](https://github.com/foldrun-io/foldrun-cli/commit/a2c2e1c))
- fix(doctor): foldrun's koder from another install (global beside a checkout) is not another program ([f606784](https://github.com/foldrun-io/foldrun-cli/commit/f606784))
- feat(code): the header says koder from foldrun.io ([409aae6](https://github.com/foldrun-io/foldrun-cli/commit/409aae6))

### deps

- @foldrun/core ^27.7.0 ([a00d5bd](https://github.com/foldrun-io/foldrun-cli/commit/a00d5bd))
- @foldrun/core ^27.6.0 ([9659713](https://github.com/foldrun-io/foldrun-cli/commit/9659713))
- @foldrun/core ^27.5.1 ([db1b4c4](https://github.com/foldrun-io/foldrun-cli/commit/db1b4c4))

### docs

- sync — edits that would not parse (FOL-292) ([4b74af2](https://github.com/foldrun-io/foldrun-cli/commit/4b74af2))

## [32.1.2] — 2026-11-24

### docs

- sync the bundled docs (git offered only for the cloud, FOL-274) ([0e7c245](https://github.com/foldrun-io/foldrun-cli/commit/0e7c245))

## [32.1.1] — 2026-11-24

- fix(code): a folder that cannot be read leaves the folder-of-repos check unsure, and git is then not offered (FOL-274, Codex round 16) ([2e0f6ff](https://github.com/foldrun-io/foldrun-cli/commit/2e0f6ff))
- fix(code): the folder-of-repos check looks six levels down, and a search it had to cut short offers no git (FOL-274, Codex round 15) ([ff59a22](https://github.com/foldrun-io/foldrun-cli/commit/ff59a22))
- fix(code): /where local+cloud no longer asks for git; the folder-of-repos check looks three levels down, hidden and bare too; the home folder by where it leads (FOL-274, Codex round 14) ([5bd6484](https://github.com/foldrun-io/foldrun-cli/commit/5bd6484))
- fix(code): git is offered only when the session works in the cloud, never in the home folder or around a folder of repositories; a cloud job that would take the folder without git is refused with how to go on (FOL-274) ([5cd6112](https://github.com/foldrun-io/foldrun-cli/commit/5cd6112))

## [32.1.0] — 2026-11-24

### New in the public API

- the `koder` program
- `foldrun sessions`
- the `--output-format` flag
- the `--input-format` flag

- fix(code): messages are held right before the model call, after the MCP servers start, and no text stands in for them; a capped turn count shows N+ (FOL-236, Codex round 12) ([f2fa554](https://github.com/foldrun-io/foldrun-cli/commit/f2fa554))
- fix(code): messages are held just before the turn is sent, read is a call's start, and settling never blocks the reply (FOL-236, Codex round 11) ([529f32b](https://github.com/foldrun-io/foldrun-cli/commit/529f32b))
- fix(code): messages are used the moment the model reads the turn; a renamed project is the session's from then on; /resume <n> picks from the list shown (FOL-236, FOL-264, Codex round 10) ([2aad44b](https://github.com/foldrun-io/foldrun-cli/commit/2aad44b))
- feat(code): one /rename — this conversation (here and on the platform) or this project; /resume lists the project's cloud conversations too (FOL-264) ([12fac98](https://github.com/foldrun-io/foldrun-cli/commit/12fac98))
- fix(code): messages a local turn carries are held, then used only once the model read it; MCP site rules with the sandbox off and mid-turn (FOL-236, FOL-222, Codex round 9) ([4fe61c9](https://github.com/foldrun-io/foldrun-cli/commit/4fe61c9))
- feat(sessions): foldrun sessions lists the project's conversations; a turn on this computer marks the messages it carried used once it was sent (FOL-236) ([49c2b6b](https://github.com/foldrun-io/foldrun-cli/commit/49c2b6b))
- fix(code): a remote MCP server adds one literal site, never back one the person took away, and before the turn's walls go up (FOL-222) ([7357512](https://github.com/foldrun-io/foldrun-cli/commit/7357512))
- feat(code): a server at a web address goes through the sandbox's site list, its site allowed by the person's yes (FOL-222) ([bbdefed](https://github.com/foldrun-io/foldrun-cli/commit/bbdefed))
- test(code): the leftover-job test finds and ends only its own job, by an id in its command line ([c9a679f](https://github.com/foldrun-io/foldrun-cli/commit/c9a679f))
- fix(code): git's top folder keeps a trailing \r; the light test cleans up only its own job; a test follows -p's new where-message ([c4350ea](https://github.com/foldrun-io/foldrun-cli/commit/c4350ea))
- test(code): a ceiling on what an idle session and a turn load, and nothing left running after a turn or /quit (FOL-273) ([933f5ee](https://github.com/foldrun-io/foldrun-cli/commit/933f5ee))
- fix(code): -p — an early Ctrl-C stops the turn before the model and refuses every tool call; applied reads git's config at the repo's top ([978fa74](https://github.com/foldrun-io/foldrun-cli/commit/978fa74))
- fix(code): -p's applied runs git only as the looks-only commands do, from the repo's top; no saved rule under -p; any Ctrl-C is cancelled ([9f34810](https://github.com/foldrun-io/foldrun-cli/commit/9f34810))
- fix(code): -p on this computer — commands need --yes too; applied from git; asks nothing at setup; Ctrl-C is cancelled; the sandbox is closed ([2fa540f](https://github.com/foldrun-io/foldrun-cli/commit/2fa540f))
- feat(code): -p on this computer — no questions; file changes only with --yes, commands in the sandbox (FOL-223) ([8fd0025](https://github.com/foldrun-io/foldrun-cli/commit/8fd0025))
- fix(code): JSON mode holds from the start and to the last byte; stdin messages taken as they come; a failed run says why (FOL-223, FOL-266, Codex) ([9daa284](https://github.com/foldrun-io/foldrun-cli/commit/9daa284))
- test(code): the no-terminal message names -p first (FOL-223) ([fd72d3e](https://github.com/foldrun-io/foldrun-cli/commit/fd72d3e))
- feat(code): -p and JSON output for a script's turn (FOL-223, cloud) ([32258d3](https://github.com/foldrun-io/foldrun-cli/commit/32258d3))
- fix(code): npm install works in the local sandbox; /status says where spent comes from; one session id (FOL-272) ([6bdd260](https://github.com/foldrun-io/foldrun-cli/commit/6bdd260))
- feat(code): koder, the short name for foldrun code; the sandbox said in plain words (FOL-266, FOL-271) ([b0bc8b0](https://github.com/foldrun-io/foldrun-cli/commit/b0bc8b0))

### deps

- @foldrun/core ^27.5.0 (proxy fetch, conversation list and names, hold/use/free); docs synced ([1c9fd8d](https://github.com/foldrun-io/foldrun-cli/commit/1c9fd8d))

### docs

- sync agents.md (FOL-275 reply language) ([b2ba99f](https://github.com/foldrun-io/foldrun-cli/commit/b2ba99f))

### test

- the e2e file has its own script and is not in npm test ([2ca2c9b](https://github.com/foldrun-io/foldrun-cli/commit/2ca2c9b))
- npm test runs every test file; eight were never run, one failing since workspace became project ([902e4c5](https://github.com/foldrun-io/foldrun-cli/commit/902e4c5))

## [32.0.0] — 2026-11-24

### Breaking changes

- foldrun code's removed slash commands no longer work; use the (ba1fbf0)

- feat(code)!: one command per job — /where, /model, /setup, /status; git only for the cloud (FOL-263, FOL-274) ([ba1fbf0](https://github.com/foldrun-io/foldrun-cli/commit/ba1fbf0))

## [31.6.0] — 2026-11-24

- feat(code): suggest cloudhost.ir when the person wants a site, app or API online (FOL-270) ([b614e61](https://github.com/foldrun-io/foldrun-cli/commit/b614e61))

### docs

- sync cli.md from foldrun-docs — /status line and saving tokens (FOL-262, FOL-269) ([ee852a0](https://github.com/foldrun-io/foldrun-cli/commit/ee852a0))

## [31.5.0] — 2026-11-24

- feat(code): a status line under the prompt (FOL-269) ([b6fb925](https://github.com/foldrun-io/foldrun-cli/commit/b6fb925))

## [31.4.0] — 2026-11-24

- feat(code): token hints before a turn that re-reads the conversation (FOL-262) ([febeffc](https://github.com/foldrun-io/foldrun-cli/commit/febeffc))
- perf(code): load the MCP engine only when a server connects; model words from their own module (FOL-265) ([4d10fc7](https://github.com/foldrun-io/foldrun-cli/commit/4d10fc7))

## [31.3.1] — 2026-11-24

### deps

- @foldrun/core ^27.4.0 ([bc91b9c](https://github.com/foldrun-io/foldrun-cli/commit/bc91b9c))

## [31.3.0] — 2026-11-24

- test(code): /st suggests /restart too (FOL-261) ([5b66027](https://github.com/foldrun-io/foldrun-cli/commit/5b66027))
- feat(code): a long session hears of a newer foldrun; /restart takes it (FOL-261) ([e347231](https://github.com/foldrun-io/foldrun-cli/commit/e347231))

## [31.2.0] — 2026-11-24

- feat(code): the session names its account — box, /status, prompt (FOL-260) ([3be16bf](https://github.com/foldrun-io/foldrun-cli/commit/3be16bf))

## [31.1.0] — 2026-11-24

- feat(code): a command typed alone opens its list, as /model does (FOL-259) ([e7789ff](https://github.com/foldrun-io/foldrun-cli/commit/e7789ff))

## [31.0.0] — 2026-11-24

### Breaking changes

- the agent's tools cloud_agents and agent { where: cloud } (e1d675a)
- the `--no-sandbox` flag is gone (it was never deprecated)

- feat(code)!: one cloud model — two places at the start, one kind of cloud job, /cloud-jobs (FOL-258) ([e1d675a](https://github.com/foldrun-io/foldrun-cli/commit/e1d675a))

## [30.9.0] — 2026-11-24

- feat(code): /effort — how hard the model thinks, low to max (FOL-256) ([ae03446](https://github.com/foldrun-io/foldrun-cli/commit/ae03446))

### deps

- @foldrun/core ^27.3.0 ([338616a](https://github.com/foldrun-io/foldrun-cli/commit/338616a))

## [30.8.0] — 2026-11-24

### New in the public API

- `foldrun home`
- `foldrun home migrate`

- fix(home): migrate sets each copied entry's mode from its source (FOL-254) ([00dcd1b](https://github.com/foldrun-io/foldrun-cli/commit/00dcd1b))

### feat

- XDG config, state and cache folders; foldrun home [migrate] (FOL-254) ([251e711](https://github.com/foldrun-io/foldrun-cli/commit/251e711))

## [30.7.0] — 2026-11-24

- feat(code): a local sub-agent's own MCP servers, by the cloud's mcpServers: field (FOL-253) ([9232f14](https://github.com/foldrun-io/foldrun-cli/commit/9232f14))
- feat(code): wait in the open session and carry on when the allowance resets (FOL-252) ([8a7347d](https://github.com/foldrun-io/foldrun-cli/commit/8a7347d))

## [30.6.0] — 2026-11-24

### New in the public API

- `foldrun sessions search`
- the `--here` flag
- the `--session` flag

- feat(code): take a cloud patch file by file — f at the apply question (FOL-251) ([9ccdfdc](https://github.com/foldrun-io/foldrun-cli/commit/9ccdfdc))
- feat(code): /search, /rename and foldrun sessions search — find a conversation by what was said in it (FOL-250) ([5537e28](https://github.com/foldrun-io/foldrun-cli/commit/5537e28))
- feat(code): /cost explain and foldrun usage --session — where a session's spend went (FOL-249) ([1a60310](https://github.com/foldrun-io/foldrun-cli/commit/1a60310))

## [30.5.0] — 2026-11-24

- feat(code): /thinking, and commands kept for a folder (f at a question) ([9576aae](https://github.com/foldrun-io/foldrun-cli/commit/9576aae))

### deps

- @foldrun/core ^27.2.0 ([7bc52f5](https://github.com/foldrun-io/foldrun-cli/commit/7bc52f5))

## [30.4.0] — 2026-11-24

- feat(code): queue a message for after the turn — Tab while a turn runs, /queue ([3b739da](https://github.com/foldrun-io/foldrun-cli/commit/3b739da))

## [30.3.0] — 2026-11-24

### New in the public API

- the `--local-only` flag
- the `--no-sandbox` flag

- feat(code): three places to work — this computer only, this computer with cloud agents, the cloud ([eeb0828](https://github.com/foldrun-io/foldrun-cli/commit/eeb0828))
- feat(code): the agent's commands on this computer run in a sandbox, as Claude Code's do (FOL-214, part 2) ([c8b4774](https://github.com/foldrun-io/foldrun-cli/commit/c8b4774))

## [30.2.1] — 2026-11-24

- fix(code): the agent answers in the language the person wrote in, here and in the cloud ([0d2ca29](https://github.com/foldrun-io/foldrun-cli/commit/0d2ca29))

### deps

- @foldrun/core ^27.1.1 ([906ee74](https://github.com/foldrun-io/foldrun-cli/commit/906ee74))

## [30.2.0] — 2026-11-23

- feat(code): MCP servers, sub-agents here and in the cloud, a todo list, added folders ([6193bcf](https://github.com/foldrun-io/foldrun-cli/commit/6193bcf))
- feat(code): /rewind takes back the agent's Write and Edit; /goal --check takes the person's command's word ([4703516](https://github.com/foldrun-io/foldrun-cli/commit/4703516))
- feat(code): commands that only look run without a question; /resume, /doctor; a goal is checked a second time ([8b65597](https://github.com/foldrun-io/foldrun-cli/commit/8b65597))
- fix(models): with own keys off, a no-plan account is told it needs a plan, not an API key ([5e44984](https://github.com/foldrun-io/foldrun-cli/commit/5e44984))
- feat(code): /goal, /plan, /compact, /context, /usage; a turn's tokens say how much was cached ([313a3dd](https://github.com/foldrun-io/foldrun-cli/commit/313a3dd))

### docs

- sync api.md from foldrun-docs ab66ca9 ([28d7ee0](https://github.com/foldrun-io/foldrun-cli/commit/28d7ee0))

## [30.1.0] — 2026-11-23

- feat(code): the agent knows the folder and foldrun; / shows the commands; one session moves between this computer and the cloud; sessions message each other ([e21d298](https://github.com/foldrun-io/foldrun-cli/commit/e21d298))

## [30.0.0] — 2026-11-23

### Breaking changes

- a signed-in machine's local runs, evals and probes now (daa7c22)
- the CLI now runs on @foldrun/core 27.0.0, a new major. (64ef8ea)

### New in the public API

- the `--own-key` flag

- test(run-door): its own fake Messages API, not another test file's ([61f5467](https://github.com/foldrun-io/foldrun-cli/commit/61f5467))
- feat(run)!: a signed-in account's local runs go through its platform's model door ([daa7c22](https://github.com/foldrun-io/foldrun-cli/commit/daa7c22))

### deps

- @foldrun/core ^27.0.0 ([64ef8ea](https://github.com/foldrun-io/foldrun-cli/commit/64ef8ea))

## [29.1.0] — 2026-11-23

- feat(billing): the subscription view, billing extra-usage, and what to do about each refusal code (FOL-235) ([6dfce58](https://github.com/foldrun-io/foldrun-cli/commit/6dfce58))

## [29.0.1] — 2026-11-23

### docs

- bundle foldrun-docs main, not the held subscription branch ([f93e282](https://github.com/foldrun-io/foldrun-cli/commit/f93e282))

## [29.0.0] — 2026-11-23

### Breaking changes

- the CLI now runs on @foldrun/core 26.0.0, a new major. (05c3bf5)

- feat(code): /model lists every model behind foldrun's proxy ([f53d562](https://github.com/foldrun-io/foldrun-cli/commit/f53d562))

### deps

- @foldrun/core ^26.0.0 ([05c3bf5](https://github.com/foldrun-io/foldrun-cli/commit/05c3bf5))

## [28.2.1] — 2026-11-23

### deps

- @foldrun/core ^25.1.0 ([4f3ea1b](https://github.com/foldrun-io/foldrun-cli/commit/4f3ea1b))

## [28.2.0] — 2026-11-23

- feat(billing): a refused billing change opens the Billing page ([dc0de42](https://github.com/foldrun-io/foldrun-cli/commit/dc0de42))

## [28.1.0] — 2026-11-23

### New in the public API

- `foldrun billing pay-as-you-go on`
- the `--no-limit` flag

- feat(billing): foldrun billing plan pro|max and pay-as-you-go ([24b4836](https://github.com/foldrun-io/foldrun-cli/commit/24b4836))

### deps

- @foldrun/core ^25.0.1 ([0bfca92](https://github.com/foldrun-io/foldrun-cli/commit/0bfca92))

## [28.0.0] — 2026-11-23

### Breaking changes

- the CLI now runs on @foldrun/core 25.0.0, a new major. (7feafe3)
- the CLI calls /v1/... only, so it needs a platform on the (e96e882)

- feat(cli)!: every call is /v1/<route>; the per-profile path plan is gone ([e96e882](https://github.com/foldrun-io/foldrun-cli/commit/e96e882))

### chore

- old dev names out of comments and tests; docs synced ([af96c55](https://github.com/foldrun-io/foldrun-cli/commit/af96c55))

### deps

- @foldrun/core ^25.0.0 ([7feafe3](https://github.com/foldrun-io/foldrun-cli/commit/7feafe3))

### docs

- sync (Stripe's webhook on the API host) ([e13c4cb](https://github.com/foldrun-io/foldrun-cli/commit/e13c4cb))

## [27.10.1] — 2026-11-23

- fix(cli): keep the run stream's literal URL for the coverage scan ([81d48c6](https://github.com/foldrun-io/foldrun-cli/commit/81d48c6))

## [27.10.0] — 2026-11-23

- feat(cli): call the platform under /v1 where the API address serves it ([f62ab02](https://github.com/foldrun-io/foldrun-cli/commit/f62ab02))
- fix(code): a kept model key goes to the platform's models address now, not the one it was made at ([e1ab0ad](https://github.com/foldrun-io/foldrun-cli/commit/e1ab0ad))

### deps

- @foldrun/core ^24.13.0 ([fa1c372](https://github.com/foldrun-io/foldrun-cli/commit/fa1c372))

### docs

- account model key may be a Claude subscription token ([fee7794](https://github.com/foldrun-io/foldrun-cli/commit/fee7794))

## [27.9.0] — 2026-11-22

- feat(account): account model says when own model keys are off on the platform, and offers no own key ([d039869](https://github.com/foldrun-io/foldrun-cli/commit/d039869))

### docs

- sync — one API, Anthropic's error body from API 2026-11-22 ([e6d7f4d](https://github.com/foldrun-io/foldrun-cli/commit/e6d7f4d))

## [27.8.0] — 2026-11-22

### New in the public API

- `foldrun keys create ci`
- the `--model-access` flag

- fix(code): the sign-in key's kind is in its JSDoc type — the dev pipeline's CLI typecheck refused d75bea7 ([253b94d](https://github.com/foldrun-io/foldrun-cli/commit/253b94d))
- feat(code): one key — the sign-in is the model key when it has model access ([d75bea7](https://github.com/foldrun-io/foldrun-cli/commit/d75bea7))

## [27.7.2] — 2026-11-22

### deps

- @foldrun/core ^24.12.0 ([bebef2b](https://github.com/foldrun-io/foldrun-cli/commit/bebef2b))

### docs

- sync budgets-and-billing from foldrun-docs (warm build disk + billing) ([8f09687](https://github.com/foldrun-io/foldrun-cli/commit/8f09687))

## [27.7.1] — 2026-11-22

### deps

- @foldrun/core ^24.11.0 ([0a8c319](https://github.com/foldrun-io/foldrun-cli/commit/0a8c319))

## [27.7.0] — 2026-11-22

- feat(code): the folder is shown, and asked about, before it goes to the cloud (FOL-212) ([56f7745](https://github.com/foldrun-io/foldrun-cli/commit/56f7745))
- feat(code): Enter sends a message into a running local turn (FOL-213) ([536d762](https://github.com/foldrun-io/foldrun-cli/commit/536d762))

### deps

- @foldrun/core ^24.10.0 ([b63fca4](https://github.com/foldrun-io/foldrun-cli/commit/b63fca4))
- @foldrun/core ^24.9.1 ([0b105ae](https://github.com/foldrun-io/foldrun-cli/commit/0b105ae))
- @foldrun/core ^24.9.0 ([2f3e04b](https://github.com/foldrun-io/foldrun-cli/commit/2f3e04b))

## [27.6.0] — 2026-11-22

- chore(lint): drop unused parameters ([9257cbc](https://github.com/foldrun-io/foldrun-cli/commit/9257cbc))
- feat(code): --local keeps the compacted conversation (FOL-213) ([15b30a5](https://github.com/foldrun-io/foldrun-cli/commit/15b30a5))

### deps

- @foldrun/core ^24.8.1 ([8894d64](https://github.com/foldrun-io/foldrun-cli/commit/8894d64))

## [27.5.1] — 2026-11-21

- fix(code): a turn that did not finish shows why and keeps its own words (FOL-211) ([3743b1f](https://github.com/foldrun-io/foldrun-cli/commit/3743b1f))

### deps

- @foldrun/core ^24.8.0 ([e936970](https://github.com/foldrun-io/foldrun-cli/commit/e936970))

## [27.5.0] — 2026-11-21

- feat(login): calls go to the platform's API address, pages stay on the dashboard ([351da94](https://github.com/foldrun-io/foldrun-cli/commit/351da94))
- revert(keys): no OpenAI-format lines after keys create --gateway ([b72662e](https://github.com/foldrun-io/foldrun-cli/commit/b72662e))
- feat(keys): keys create --gateway prints the OpenAI-format setup too ([19b2804](https://github.com/foldrun-io/foldrun-cli/commit/19b2804))

### docs

- sync api-usage (gateway key's place) ([28a49a0](https://github.com/foldrun-io/foldrun-cli/commit/28a49a0))

## [27.4.6] — 2026-11-21

### deps

- @foldrun/core ^24.7.2 ([c1ce710](https://github.com/foldrun-io/foldrun-cli/commit/c1ce710))

## [27.4.5] — 2026-11-20

### docs

- sync self-hosting (stable after production, old images removed) ([8083dc0](https://github.com/foldrun-io/foldrun-cli/commit/8083dc0))

## [27.4.4] — 2026-11-20

### deps

- @foldrun/core ^24.7.1 ([0d0486f](https://github.com/foldrun-io/foldrun-cli/commit/0d0486f))

## [27.4.3] — 2026-11-20

- fix(cli): each command's --help lists --to, --task and connect's --provider; every docs example is checked against the help ([e0ac796](https://github.com/foldrun-io/foldrun-cli/commit/e0ac796))

## [27.4.2] — 2026-11-20

- fix(cli): invoke's bare --to check reads as a value check, not a switch (BOOLEAN_FLAGS test) ([45bca46](https://github.com/foldrun-io/foldrun-cli/commit/45bca46))
- fix(cli): invoke refuses a bare --to and names the folder's projects when it asks ([877b312](https://github.com/foldrun-io/foldrun-cli/commit/877b312))

## [27.4.1] — 2026-11-20

- fix(cli): `update --help` shows help instead of updating; no background update on any help ([bf443b3](https://github.com/foldrun-io/foldrun-cli/commit/bf443b3))

## [27.4.0] — 2026-11-20

### New in the public API

- the `--wallet` flag

- feat(keys): account keys — keys create --account/--wallet, keys set --wallet; foldrun code makes one (FOL-208) ([b7fbb15](https://github.com/foldrun-io/foldrun-cli/commit/b7fbb15))

## [27.3.0] — 2026-11-20

- feat(code): local sessions are paid by the foldrun plan first, on foldrun's tiers (FOL-208) ([a3e52b8](https://github.com/foldrun-io/foldrun-cli/commit/a3e52b8))

## [27.2.0] — 2026-11-20

### New in the public API

- `foldrun update`

- feat(cli): keeps itself current — foldrun update, a staged release beside the installed one ([eb77514](https://github.com/foldrun-io/foldrun-cli/commit/eb77514))
- test(code): answer the local engine's questions a moment after they print ([97a9ede](https://github.com/foldrun-io/foldrun-cli/commit/97a9ede))
- fix(code): a 402 names the billing page that exists, not a Settings tab ([667752b](https://github.com/foldrun-io/foldrun-cli/commit/667752b))

## [27.1.0] — 2026-11-19

- feat(code): every session asks where it works; exit or quit leaves, as in Claude Code ([49f83d8](https://github.com/foldrun-io/foldrun-cli/commit/49f83d8))

## [27.0.0] — 2026-11-19

### Breaking changes

- `foldrun code --engine claude` is refused, and a folder (fc354a8)

- feat(code)!: foldrun's own agent is the only engine on this computer; Claude Code is gone ([fc354a8](https://github.com/foldrun-io/foldrun-cli/commit/fc354a8))

## [26.20.0] — 2026-11-19

- feat(code): cloud agents from this computer; the turn line names the foldrun plan ([4194210](https://github.com/foldrun-io/foldrun-cli/commit/4194210))

## [26.19.0] — 2026-11-19

- feat(code): on this computer, choose the engine — Claude Code or the foldrun engine ([77d463a](https://github.com/foldrun-io/foldrun-cli/commit/77d463a))

## [26.18.0] — 2026-11-19

### New in the public API

- the `--cloud` flag

- feat(code): on this computer or in the cloud — asked once per folder; local runs Claude Code on your own Claude sign-in ([647d023](https://github.com/foldrun-io/foldrun-cli/commit/647d023))

## [26.17.1] — 2026-11-19

### deps

- @foldrun/core ^24.5.0 ([d50e713](https://github.com/foldrun-io/foldrun-cli/commit/d50e713))

## [26.17.0] — 2026-11-19

- feat(code): the prompt is the project's name and ❯, not "you ›" ([e272fc5](https://github.com/foldrun-io/foldrun-cli/commit/e272fc5))

## [26.16.0] — 2026-11-19

- feat(code): colour — a framed header, a brand sweep, a colour per kind of thing ([0fac278](https://github.com/foldrun-io/foldrun-cli/commit/0fac278))

## [26.15.1] — 2026-11-19

### deps

- @foldrun/core ^24.4.2 ([0f71db2](https://github.com/foldrun-io/foldrun-cli/commit/0f71db2))

## [26.15.0] — 2026-11-19

- feat(code): /model is a picker; the reply is drawn for the terminal ([c63ccc3](https://github.com/foldrun-io/foldrun-cli/commit/c63ccc3))

## [26.14.1] — 2026-11-19

### test

- two timing tests that failed on a busy machine measure what they mean ([abd6ac0](https://github.com/foldrun-io/foldrun-cli/commit/abd6ac0))

## [26.14.0] — 2026-11-19

- feat(code): type your next message while a turn runs — and it never answers 'apply it?' ([b683ab6](https://github.com/foldrun-io/foldrun-cli/commit/b683ab6))

## [26.13.0] — 2026-11-19

- feat(code): Ctrl-R searches what you typed before ([f3d96c6](https://github.com/foldrun-io/foldrun-cli/commit/f3d96c6))
- feat(code): say once how to see file names and commands, and what that keeps ([082bf84](https://github.com/foldrun-io/foldrun-cli/commit/082bf84))

## [26.12.1] — 2026-11-19

### deps

- @foldrun/core ^24.4.1 ([b64e147](https://github.com/foldrun-io/foldrun-cli/commit/b64e147))

## [26.12.0] — 2026-11-19

- feat(code): /model — the agent's model, and change it from the session ([487c13f](https://github.com/foldrun-io/foldrun-cli/commit/487c13f))
- fix(code): the working line and line editing on a real terminal; bracketed paste ([dc4f95a](https://github.com/foldrun-io/foldrun-cli/commit/dc4f95a))

### docs

- sync (code patch leaves out tool caches) ([d7d23e8](https://github.com/foldrun-io/foldrun-cli/commit/d7d23e8))

## [26.11.1] — 2026-11-19

- fix(code): what a live turn on staging showed — failed tools, tool names, binary diffs ([146810a](https://github.com/foldrun-io/foldrun-cli/commit/146810a))

## [26.11.0] — 2026-11-19

### New in the public API

- the `--continue` flag
- the `--no-beep` flag

- feat(code): a session that is easy to work in, and says what is going on ([841443e](https://github.com/foldrun-io/foldrun-cli/commit/841443e))

## [26.10.1] — 2026-11-19

### deps

- @foldrun/core ^24.4.0 ([898ae65](https://github.com/foldrun-io/foldrun-cli/commit/898ae65))

## [26.10.0] — 2026-11-19

### New in the public API

- `foldrun sessions send`
- `foldrun sessions messages`
- the `--include-messages` flag
- the `--waiting` flag

- feat(code): /send and /messages; foldrun sessions send|messages ([972b61b](https://github.com/foldrun-io/foldrun-cli/commit/972b61b))

## [26.9.0] — 2026-11-18

- feat(cli): foldrun code shows the session (turns, spend, model, context) and survives a dropped connection ([bd98b8b](https://github.com/foldrun-io/foldrun-cli/commit/bd98b8b))
- fix(cli): foldrun code prints the reply once when an error or sub-agent event follows it ([fad435a](https://github.com/foldrun-io/foldrun-cli/commit/fad435a))
- fix(cli): foldrun code no longer shows the limits setup note as a refusal ([ed79210](https://github.com/foldrun-io/foldrun-cli/commit/ed79210))

## [26.8.0] — 2026-11-18

### New in the public API

- the `--verbose` flag

- fix(cli): foldrun code shows the work, not the platform's setup notes, and the reply once ([2d53a71](https://github.com/foldrun-io/foldrun-cli/commit/2d53a71))

### deps

- @foldrun/core ^24.3.1 ([2ce3a8b](https://github.com/foldrun-io/foldrun-cli/commit/2ce3a8b))

## [26.7.1] — 2026-11-18

- fix(cli): two foldrun commands at once no longer undo each other's sign-in changes ([2d62bf5](https://github.com/foldrun-io/foldrun-cli/commit/2d62bf5))

## [26.7.0] — 2026-11-18

### New in the public API

- `foldrun workspaces use`

- feat(cli): foldrun workspaces use <name> — a default project for commands that name none ([64fe960](https://github.com/foldrun-io/foldrun-cli/commit/64fe960))

## [26.6.2] — 2026-11-18

- test(cli): assistant leaves with 0 on Ctrl-D at a later prompt, on a real terminal ([ce77744](https://github.com/foldrun-io/foldrun-cli/commit/ce77744))

## [26.6.1] — 2026-11-18

- fix(cli): foldrun code's live view — tool summaries, one reply, no terminal control ([f7a0b06](https://github.com/foldrun-io/foldrun-cli/commit/f7a0b06))

## [26.6.0] — 2026-11-18

### New in the public API

- `foldrun code`
- the `--snapshot` flag
- the `--apply` flag
- the `--dir` flag

- fix(cli): live runs show every step again; foldrun code makes a missing project ([355ed59](https://github.com/foldrun-io/foldrun-cli/commit/355ed59))
- fix(code): harden applying a run's patch, and Ctrl-C in foldrun code (Codex review) ([e883d92](https://github.com/foldrun-io/foldrun-cli/commit/e883d92))
- feat(code): foldrun code — code with an agent in a sandbox, apply its patch ([48e1da2](https://github.com/foldrun-io/foldrun-cli/commit/48e1da2))

## [26.5.2] — 2026-11-17

- chore(hooks): pre-push links console/node_modules into the worktree it checks ([630c1f1](https://github.com/foldrun-io/foldrun-cli/commit/630c1f1))

### deps

- @foldrun/core ^24.3.0 ([a5c546c](https://github.com/foldrun-io/foldrun-cli/commit/a5c546c))

### docs

- sync api.md from foldrun-docs ([ed637fd](https://github.com/foldrun-io/foldrun-cli/commit/ed637fd))

## [26.5.1] — 2026-11-17

### docs

- sync runs.md — the end customer's id is kept inside foldrun ([00e4ad7](https://github.com/foldrun-io/foldrun-cli/commit/00e4ad7))

## [26.5.0] — 2026-11-17

### perf

- read a project's files, library and status together ([6355296](https://github.com/foldrun-io/foldrun-cli/commit/6355296))

## [26.4.0] — 2026-11-17

- feat(keys): foldrun keys delete <id> ([19d8c35](https://github.com/foldrun-io/foldrun-cli/commit/19d8c35))

### docs

- sync api-usage (Idempotency-Key with ?wait, 503) ([f5f5bfb](https://github.com/foldrun-io/foldrun-cli/commit/f5f5bfb))

## [26.3.6] — 2026-11-17

### deps

- @foldrun/core ^24.2.3 ([971e350](https://github.com/foldrun-io/foldrun-cli/commit/971e350))

## [26.3.5] — 2026-11-17

### fix

- CLI help and messages say "project" ([b2f2ed3](https://github.com/foldrun-io/foldrun-cli/commit/b2f2ed3))

### test

- the remote check reads core's "project" wording as well as the old one ([ddd0857](https://github.com/foldrun-io/foldrun-cli/commit/ddd0857))

## [26.3.4] — 2026-11-17

### deps

- @foldrun/core ^24.2.2 ([0c4df64](https://github.com/foldrun-io/foldrun-cli/commit/0c4df64))

## [26.3.3] — 2026-11-16

- test(browser): type the screenshot results so the typecheck passes ([dc25f80](https://github.com/foldrun-io/foldrun-cli/commit/dc25f80))
- fix(browser): screenshot takes the viewport unless full_page; refuse one too big to send ([e2ea8d6](https://github.com/foldrun-io/foldrun-cli/commit/e2ea8d6))
- fix(browser): a closed window is closed even while Chrome still runs (macOS) ([b7052e6](https://github.com/foldrun-io/foldrun-cli/commit/b7052e6))

## [26.3.2] — 2026-11-16

- fix(browser): reset signals only the Chrome it checked, re-asking before each signal ([cbbd689](https://github.com/foldrun-io/foldrun-cli/commit/cbbd689))

## [26.3.1] — 2026-11-16

- fix(browser): a stale live record is no running Chrome — reset never stops another program ([151ae1d](https://github.com/foldrun-io/foldrun-cli/commit/151ae1d))
- fix(browser): reset stops Chrome before removing its profile; calls load setup's Playwright ([871365f](https://github.com/foldrun-io/foldrun-cli/commit/871365f))

## [26.3.0] — 2026-11-16

### New in the public API

- `foldrun browser`
- the `--scope` flag

- ci(security): ask the registry again when it leaves out a signing key ([1058978](https://github.com/foldrun-io/foldrun-cli/commit/1058978))
- fix(keys): keys create --to scopes the key to that workspace; an unscoped answer is revoked, never shown ([d372d77](https://github.com/foldrun-io/foldrun-cli/commit/d372d77))
- feat(browser): `foldrun browser` — a real Chrome on this computer for an AI app ([1ec42a0](https://github.com/foldrun-io/foldrun-cli/commit/1ec42a0))

### deps

- @foldrun/core ^24.2.1 ([56b0673](https://github.com/foldrun-io/foldrun-cli/commit/56b0673))
- @foldrun/core ^24.2.0 ([82f59a4](https://github.com/foldrun-io/foldrun-cli/commit/82f59a4))

## [26.2.2] — 2026-11-16

### deps

- @foldrun/core ^24.1.1 ([096adca](https://github.com/foldrun-io/foldrun-cli/commit/096adca))

## [26.2.1] — 2026-11-15

### deps

- @foldrun/core ^24.1.0 ([3465ec0](https://github.com/foldrun-io/foldrun-cli/commit/3465ec0))

## [26.2.0] — 2026-11-15

- feat(account model): show when the account runs on its Claude subscription ([52e5a22](https://github.com/foldrun-io/foldrun-cli/commit/52e5a22))

## [26.1.0] — 2026-11-15

- feat(account): foldrun account beta [on|off] — beta features first ([11eb176](https://github.com/foldrun-io/foldrun-cli/commit/11eb176))

### docs

- sync from foldrun-docs (beta features, account beta) ([7b8b497](https://github.com/foldrun-io/foldrun-cli/commit/7b8b497))

## [26.0.0] — 2026-11-15

### Breaking changes

- the CLI now runs on @foldrun/core 24.0.0, a new major. (8f5679f)

### deps

- @foldrun/core ^24.0.0 ([8f5679f](https://github.com/foldrun-io/foldrun-cli/commit/8f5679f))

## [25.2.5] — 2026-11-15

### deps

- @foldrun/core ^23.4.0 ([437377b](https://github.com/foldrun-io/foldrun-cli/commit/437377b))

## [25.2.4] — 2026-11-15

### deps

- @foldrun/core ^23.3.0 ([a61a72f](https://github.com/foldrun-io/foldrun-cli/commit/a61a72f))
- @foldrun/core ^23.2.0 ([3ac23bb](https://github.com/foldrun-io/foldrun-cli/commit/3ac23bb))

## [25.2.3] — 2026-11-15

### deps

- @foldrun/core ^23.1.3 ([f6eecd9](https://github.com/foldrun-io/foldrun-cli/commit/f6eecd9))

## [25.2.2] — 2026-11-15

### deps

- @foldrun/core ^23.1.2 ([7a3b177](https://github.com/foldrun-io/foldrun-cli/commit/7a3b177))

## [25.2.1] — 2026-11-14

### deps

- @foldrun/core ^23.1.0 ([247a662](https://github.com/foldrun-io/foldrun-cli/commit/247a662))

## [25.2.0] — 2026-11-14

### New in the public API

- `foldrun usage meters`
- `foldrun usage rates`

- feat(usage): foldrun usage meters — the period's meters, credit pots and tokens by model (FOL-125) ([63e3dbf](https://github.com/foldrun-io/foldrun-cli/commit/63e3dbf))

## [25.1.3] — 2026-11-13

- build(deps): Bump @hono/node-server from 2.1.5 to 2.1.8 (#156) ([9c81ab2](https://github.com/foldrun-io/foldrun-cli/commit/9c81ab2))
- build(deps): Bump hono from 4.13.13 to 4.13.18 (#158) ([1706197](https://github.com/foldrun-io/foldrun-cli/commit/1706197))

## [25.1.2] — 2026-11-13

### deps

- @foldrun/core ^23.0.4 ([cbf0f7f](https://github.com/foldrun-io/foldrun-cli/commit/cbf0f7f))

## [25.1.1] — 2026-11-13

### deps

- @foldrun/core ^23.0.3 ([3d66589](https://github.com/foldrun-io/foldrun-cli/commit/3d66589))

## [25.1.0] — 2026-11-13

- feat(keys): keys create --gateway --login --plan pro|max (FOL-173) ([2323306](https://github.com/foldrun-io/foldrun-cli/commit/2323306))

## [25.0.2] — 2026-11-13

- fix(keys): a login gateway key is described as the account's plan, not billed per call (FOL-173) ([ad079fa](https://github.com/foldrun-io/foldrun-cli/commit/ad079fa))

## [25.0.1] — 2026-11-13

### deps

- @foldrun/core ^23.0.2 ([d383df5](https://github.com/foldrun-io/foldrun-cli/commit/d383df5))

## [25.0.0] — 2026-11-13

### Breaking changes

- the CLI now runs on @foldrun/core 23.0.1, a new major. (af7cec2)

### deps

- @foldrun/core ^23.0.1 ([af7cec2](https://github.com/foldrun-io/foldrun-cli/commit/af7cec2))

## [24.0.5] — 2026-11-13

### docs

- gallery skills listed without cloudhost-deploy ([372273c](https://github.com/foldrun-io/foldrun-cli/commit/372273c))

## [24.0.4] — 2026-11-13

### docs

- sync — default step limits (calls 1000, repeat 25) ([016f6b2](https://github.com/foldrun-io/foldrun-cli/commit/016f6b2))

## [24.0.3] — 2026-11-13

### deps

- @foldrun/core ^22.4.0 ([807cc7d](https://github.com/foldrun-io/foldrun-cli/commit/807cc7d))

## [24.0.2] — 2026-11-13

### deps

- @foldrun/core ^22.3.0 ([cd4ef9b](https://github.com/foldrun-io/foldrun-cli/commit/cd4ef9b))

## [24.0.1] — 2026-11-13

### deps

- @foldrun/core ^22.2.0 ([931c90f](https://github.com/foldrun-io/foldrun-cli/commit/931c90f))
- @foldrun/core ^22.1.0 ([5fd407c](https://github.com/foldrun-io/foldrun-cli/commit/5fd407c))

## [24.0.0] — 2026-11-13

### Breaking changes

- the CLI now runs on @foldrun/core 22.0.0, a new major. (2f26b6a)

### deps

- @foldrun/core ^22.0.0 ([2f26b6a](https://github.com/foldrun-io/foldrun-cli/commit/2f26b6a))

### feat

- gallery tools docs and video, gallery skills, in check and gallery ([7e6601a](https://github.com/foldrun-io/foldrun-cli/commit/7e6601a))

## [23.0.2] — 2026-11-13

### deps

- @foldrun/core ^21.2.0 ([e61a38f](https://github.com/foldrun-io/foldrun-cli/commit/e61a38f))

## [23.0.1] — 2026-11-12

### deps

- @foldrun/core ^21.1.0 ([9d73022](https://github.com/foldrun-io/foldrun-cli/commit/9d73022))

## [23.0.0] — 2026-11-12

### Breaking changes

- the CLI now runs on @foldrun/core 21.0.0, a new major. (7da94b8)

### deps

- @foldrun/core ^21.0.0 ([7da94b8](https://github.com/foldrun-io/foldrun-cli/commit/7da94b8))

## [22.0.2] — 2026-11-12

### deps

- @foldrun/core ^20.3.0 ([86899b9](https://github.com/foldrun-io/foldrun-cli/commit/86899b9))

## [22.0.1] — 2026-11-12

### deps

- @foldrun/core ^20.2.0 ([851736d](https://github.com/foldrun-io/foldrun-cli/commit/851736d))
- @foldrun/core ^20.1.0 ([736453f](https://github.com/foldrun-io/foldrun-cli/commit/736453f))

## [22.0.0] — 2026-11-12

### Breaking changes

- the CLI now runs on @foldrun/core 20.0.0, a new major. (44df43c)

### New in the public API

- `foldrun storage text`
- `foldrun text`
- the `--no-write` flag
- the `--ocr` flag

- feat(cli): `foldrun text <file>` and `foldrun storage text <path>` — files to text ([c96c91c](https://github.com/foldrun-io/foldrun-cli/commit/c96c91c))

### deps

- @foldrun/core ^20.0.0 ([44df43c](https://github.com/foldrun-io/foldrun-cli/commit/44df43c))

## [21.3.1] — 2026-11-11

### deps

- @foldrun/core ^19.3.0 ([ebf3edb](https://github.com/foldrun-io/foldrun-cli/commit/ebf3edb))

## [21.3.0] — 2026-11-11

### New in the public API

- the `--require-customer` flag
- the `--max-open-runs` flag
- the `--daily-model-usd` flag

- feat(cli): keys create --require-customer, keys set <id> --customer required|optional (FOL-168) ([8da017c](https://github.com/foldrun-io/foldrun-cli/commit/8da017c))
- feat(cli): customers usage, and --max-open-runs / --daily-model-usd on customers limits (FOL-168 phase 2) ([b8396e3](https://github.com/foldrun-io/foldrun-cli/commit/b8396e3))

### test

- the --all help line names runs first now — match secrets workspaces anywhere on it ([7a04911](https://github.com/foldrun-io/foldrun-cli/commit/7a04911))

## [21.2.1] — 2026-11-11

### deps

- @foldrun/core ^19.2.0 ([a83c579](https://github.com/foldrun-io/foldrun-cli/commit/a83c579))

## [21.2.0] — 2026-11-11

### New in the public API

- `foldrun talk`
- the `--lang` flag
- the `--silence` flag
- the `--mic` flag
- the `--plain` flag

- feat(cli): foldrun talk, and Claude Code's /talk — speak a prompt, foldrun transcribes it ([75df97c](https://github.com/foldrun-io/foldrun-cli/commit/75df97c))

### deps

- @foldrun/core ^19.1.0 ([0179345](https://github.com/foldrun-io/foldrun-cli/commit/0179345))

## [21.1.1] — 2026-11-11

### docs

- say which model sees run images, and that audio never reaches one ([1f6b156](https://github.com/foldrun-io/foldrun-cli/commit/1f6b156))

## [21.1.0] — 2026-11-11

### New in the public API

- `foldrun customers`
- the `--starts-per-minute` flag
- the `--gateway-rpm` flag
- the `--gateway-concurrency` flag
- the `--customer` flag

- feat(cli): foldrun customers, and --customer on invoke, agent run and runs (FOL-168) ([2cedd9b](https://github.com/foldrun-io/foldrun-cli/commit/2cedd9b))

## [21.0.0] — 2026-11-11

### Breaking changes

- the CLI now runs on @foldrun/core 19.0.0, a new major. (351159d)

### deps

- @foldrun/core ^19.0.0 ([351159d](https://github.com/foldrun-io/foldrun-cli/commit/351159d))

## [20.11.0] — 2026-11-11

### New in the public API

- `foldrun gateway status-line`
- the `--cache` flag

- feat(cli): --file hands a run files — storage paths, or ./local uploaded first (FOL-163) ([fd6018e](https://github.com/foldrun-io/foldrun-cli/commit/fd6018e))
- feat(cli): gateway status-line — a gateway key's spend in Claude Code's status line ([5b28040](https://github.com/foldrun-io/foldrun-cli/commit/5b28040))

## [20.10.0] — 2026-11-11

- feat(cli): --context on invoke, agent run and runs (FOL-162) ([81eae8f](https://github.com/foldrun-io/foldrun-cli/commit/81eae8f))

### deps

- @foldrun/core ^18.5.0 ([5fc8ce1](https://github.com/foldrun-io/foldrun-cli/commit/5fc8ce1))

## [20.9.5] — 2026-11-11

### docs

- sync secrets.md (MCP anchor fix) ([432d9f6](https://github.com/foldrun-io/foldrun-cli/commit/432d9f6))
- sync providers.md (Persian results after the prompt fix) ([0156a7a](https://github.com/foldrun-io/foldrun-cli/commit/0156a7a))

## [20.9.4] — 2026-11-11

### deps

- @foldrun/core ^18.4.0 ([037f92e](https://github.com/foldrun-io/foldrun-cli/commit/037f92e))

## [20.9.3] — 2026-11-11

### docs

- sync providers.md (Persian by tier) ([dd7d45b](https://github.com/foldrun-io/foldrun-cli/commit/dd7d45b))
- sync secrets.md, tools.md (MCP secrets) ([240b42b](https://github.com/foldrun-io/foldrun-cli/commit/240b42b))

## [20.9.2] — 2026-11-11

### docs

- sync notifications.md (asking) ([1e2e5ad](https://github.com/foldrun-io/foldrun-cli/commit/1e2e5ad))

## [20.9.1] — 2026-11-11

### docs

- sync api.md (stream deltas) ([bdd4772](https://github.com/foldrun-io/foldrun-cli/commit/bdd4772))

## [20.9.0] — 2026-11-11

- feat(report): a run's money — charged once settled, its estimate until then (FOL-157) ([5bbee70](https://github.com/foldrun-io/foldrun-cli/commit/5bbee70))

## [20.8.1] — 2026-11-11

### deps

- @foldrun/core ^18.3.2 ([b4115b0](https://github.com/foldrun-io/foldrun-cli/commit/b4115b0))

## [20.8.0] — 2026-11-11

- feat(account): deploy sends the account's own AGENTS.md, pull fetches it (GET/PUT /v1/account/agents-md) ([0da23ee](https://github.com/foldrun-io/foldrun-cli/commit/0da23ee))

### docs

- sync checks.md (bidi marks) ([b4da4f8](https://github.com/foldrun-io/foldrun-cli/commit/b4da4f8))

## [20.7.2] — 2026-11-11

### deps

- @foldrun/core ^18.3.1 ([8127808](https://github.com/foldrun-io/foldrun-cli/commit/8127808))

### docs

- sync checks.md (joiners) ([099af43](https://github.com/foldrun-io/foldrun-cli/commit/099af43))

## [20.7.1] — 2026-11-10

- build(deps): Bump softprops/action-gh-release (#121) ([aefc1b7](https://github.com/foldrun-io/foldrun-cli/commit/aefc1b7))

### deps

- @foldrun/core ^18.3.0 ([2881564](https://github.com/foldrun-io/foldrun-cli/commit/2881564))

## [20.7.0] — 2026-11-10

### New in the public API

- `foldrun keys create laptop`
- the `--claude-code` flag

- fix(keys): --claude-code's settings helpers typecheck (JSDoc types for the values that start null) ([e6150f5](https://github.com/foldrun-io/foldrun-cli/commit/e6150f5))
- feat(keys): keys create --gateway --claude-code writes the key into Claude Code's settings ([dd5a41e](https://github.com/foldrun-io/foldrun-cli/commit/dd5a41e))

### docs

- sync (claude-code page removed from the public docs) ([3326dcb](https://github.com/foldrun-io/foldrun-cli/commit/3326dcb))

### test+docs

- key fixtures by kind (fr_api_/fr_a2a_), api/checks/mcp/a2a docs synced (FOL-154) ([568b2c0](https://github.com/foldrun-io/foldrun-cli/commit/568b2c0))

## [20.6.0] — 2026-11-10

### New in the public API

- `foldrun snapshot push`

- feat(snapshot): foldrun snapshot push — send a git folder for an agent to work on (Part B3) ([62010bf](https://github.com/foldrun-io/foldrun-cli/commit/62010bf))

### docs

- sync api.md (agent run snapshot) ([8c509ec](https://github.com/foldrun-io/foldrun-cli/commit/8c509ec))

## [20.5.3] — 2026-11-10

### deps

- @foldrun/core ^18.2.0 ([ff9065f](https://github.com/foldrun-io/foldrun-cli/commit/ff9065f))

### docs

- sync api.md (snapshots route) ([ccabeab](https://github.com/foldrun-io/foldrun-cli/commit/ccabeab))

## [20.5.2] — 2026-11-10

### docs

- sync (MCP run_agent and list_agents) ([adb202b](https://github.com/foldrun-io/foldrun-cli/commit/adb202b))

## [20.5.1] — 2026-11-10

### deps

- @foldrun/core ^18.1.0 ([8e783a2](https://github.com/foldrun-io/foldrun-cli/commit/8e783a2))

## [20.5.0] — 2026-11-10

- feat(account): account model use foldrun names zai, qwen, minimax and mimo; docs synced ([44d2c5b](https://github.com/foldrun-io/foldrun-cli/commit/44d2c5b))

## [20.4.0] — 2026-11-10

### New in the public API

- `foldrun keys set`
- the `--sonnet` flag
- the `--opus` flag
- the `--haiku` flag

- feat(keys): `foldrun keys set <id> --sonnet openai/gpt-6` — a gateway key's model map ([f59a9d2](https://github.com/foldrun-io/foldrun-cli/commit/f59a9d2))
- fix(keys): a login gateway key's mint says it is not metered, not "shows what it has spent" ([aad32fa](https://github.com/foldrun-io/foldrun-cli/commit/aad32fa))

### deps

- @foldrun/core ^18.0.1 ([b099eaf](https://github.com/foldrun-io/foldrun-cli/commit/b099eaf))

### docs

- sync (OpenAI and Gemini through the gateway) ([b09fe43](https://github.com/foldrun-io/foldrun-cli/commit/b09fe43))
- sync (other providers through the gateway) ([64ab6bd](https://github.com/foldrun-io/foldrun-cli/commit/64ab6bd))
- sync (gateway settings, the key's 429) ([c19c0af](https://github.com/foldrun-io/foldrun-cli/commit/c19c0af))

## [20.3.0] — 2026-11-10

### New in the public API

- `foldrun accounts prune`
- the `--unreachable` flag

- feat(accounts): list only sign-ins that work; `accounts prune` forgets the rest ([d451ce5](https://github.com/foldrun-io/foldrun-cli/commit/d451ce5))

## [20.2.0] — 2026-11-09

### New in the public API

- the `--login` flag

- feat(keys): `keys create --gateway --login`: on the operator's Claude login ([6676101](https://github.com/foldrun-io/foldrun-cli/commit/6676101))

## [20.1.0] — 2026-11-09

### New in the public API

- the `--gateway` flag
- the `--cap` flag
- the `--daily` flag

- feat(keys): `foldrun keys create --gateway --cap <usd> [--daily <usd>]` ([86e25fc](https://github.com/foldrun-io/foldrun-cli/commit/86e25fc))

## [20.0.0] — 2026-11-09

### Breaking changes

- the CLI now runs on @foldrun/core 18.0.0, a new major. (d1b0aaf)

### deps

- @foldrun/core ^18.0.0 ([d1b0aaf](https://github.com/foldrun-io/foldrun-cli/commit/d1b0aaf))

## [19.3.2] — 2026-11-09

### deps

- @foldrun/core ^17.4.0 ([cb79053](https://github.com/foldrun-io/foldrun-cli/commit/cb79053))

## [19.3.1] — 2026-11-08

### deps

- @foldrun/core ^17.3.0 ([d3a58c0](https://github.com/foldrun-io/foldrun-cli/commit/d3a58c0))

## [19.3.0] — 2026-11-08

- feat(agent network): say a doorable vendor may be held through the platform's vendor door (FOL-145) ([e4dcfc3](https://github.com/foldrun-io/foldrun-cli/commit/e4dcfc3))

## [19.2.7] — 2026-11-08

### docs

- sync network.md (a held WebKit trusts the egress CA, FOL-144) ([84470a2](https://github.com/foldrun-io/foldrun-cli/commit/84470a2))

## [19.2.6] — 2026-11-08

### deps

- @foldrun/core ^17.2.0 ([2ae79aa](https://github.com/foldrun-io/foldrun-cli/commit/2ae79aa))

## [19.2.5] — 2026-11-08

### docs

- sync network.md (a held Firefox trusts the egress CA, FOL-144) ([a243b1c](https://github.com/foldrun-io/foldrun-cli/commit/a243b1c))

## [19.2.4] — 2026-11-08

### deps

- @foldrun/core ^17.1.1 ([9483eb5](https://github.com/foldrun-io/foldrun-cli/commit/9483eb5))

## [19.2.3] — 2026-11-08

- fix(docs): every Settings → … names a tab or section that exists ([a970ffe](https://github.com/foldrun-io/foldrun-cli/commit/a970ffe))

## [19.2.2] — 2026-11-08

### docs

- bundled docs synced — the check-rule and anchor link fixes (foldrun-docs efedad3) ([9a3cde6](https://github.com/foldrun-io/foldrun-cli/commit/9a3cde6))

## [19.2.1] — 2026-11-07

### deps

- @foldrun/core ^17.1.0 ([3ceb0cc](https://github.com/foldrun-io/foldrun-cli/commit/3ceb0cc))

## [19.2.0] — 2026-11-07

### New in the public API

- `foldrun signup status`

- feat(cli): foldrun signup status — the open /v1/signup, no key sent ([a3dc64a](https://github.com/foldrun-io/foldrun-cli/commit/a3dc64a))
- fix(cli): the default platform is https://dash.foldrun.io ([f12fc9a](https://github.com/foldrun-io/foldrun-cli/commit/f12fc9a))

## [19.1.0] — 2026-11-07

- feat(cli): foldrun onboarding --to <workspace> shows its checklist; points at /dashboard/welcome ([ce1d048](https://github.com/foldrun-io/foldrun-cli/commit/ce1d048))

## [19.0.2] — 2026-11-05

### deps

- @foldrun/core ^17.0.1 ([1aa2795](https://github.com/foldrun-io/foldrun-cli/commit/1aa2795))

## [19.0.1] — 2026-11-05

- fix(cli): a key typed or pasted into a terminal — account model set --key - asked nothing and threw EAGAIN; the hidden prompt never saw a pasted Enter ([88666d2](https://github.com/foldrun-io/foldrun-cli/commit/88666d2))

## [19.0.0] — 2026-11-05

### Breaking changes

- the CLI now runs on @foldrun/core 17.0.0, a new major. (62fcd9e)

### deps

- @foldrun/core ^17.0.0 ([62fcd9e](https://github.com/foldrun-io/foldrun-cli/commit/62fcd9e))

## [18.1.0] — 2026-11-05

- docs(guide): a held step searches through the search door; name search at none (FOL-128) ([71d5b3a](https://github.com/foldrun-io/foldrun-cli/commit/71d5b3a))
- feat(agent network): say how a walled step searches (FOL-128) ([3b6d583](https://github.com/foldrun-io/foldrun-cli/commit/3b6d583))

### docs

- sync security.md (the browse service holds the browser only) ([6c65ef9](https://github.com/foldrun-io/foldrun-cli/commit/6c65ef9))
- sync network.md and security.md (the browse service, FOL-128 phase 2) ([b83dce1](https://github.com/foldrun-io/foldrun-cli/commit/b83dce1))
- sync agents.md (snapshots survive code-only releases, FOL-50) ([451f995](https://github.com/foldrun-io/foldrun-cli/commit/451f995))

## [18.0.1] — 2026-11-05

### docs

- sync (flow-step POST and DELETE removed) ([b980163](https://github.com/foldrun-io/foldrun-cli/commit/b980163))

## [18.0.0] — 2026-11-05

### Breaking changes

- the CLI now runs on @foldrun/core 16.0.0, a new major. (597d9d5)

### deps

- @foldrun/core ^16.0.0 ([597d9d5](https://github.com/foldrun-io/foldrun-cli/commit/597d9d5))

## [17.1.2] — 2026-11-05

### docs

- sync network.md from foldrun-docs (FOL-128) ([9da4c19](https://github.com/foldrun-io/foldrun-cli/commit/9da4c19))
- sync — a run's wide event and the ops trace (FOL-122) ([993d302](https://github.com/foldrun-io/foldrun-cli/commit/993d302))
- sync checks and security from foldrun-docs (FOL-130) ([aff9f61](https://github.com/foldrun-io/foldrun-cli/commit/aff9f61))

## [17.1.1] — 2026-11-05

### docs

- sync (FOL-129 sealed snapshots) ([1f0d395](https://github.com/foldrun-io/foldrun-cli/commit/1f0d395))

## [17.1.0] — 2026-11-05

### New in the public API

- the `--accept-risk` flag
- the `--clear-accept-risk` flag

- feat(runs): why a run failed in `report` and `runs`; `runs rm --until` (FOL-124) ([7df1e39](https://github.com/foldrun-io/foldrun-cli/commit/7df1e39))
- fix(a2a): --accept-risk repeats; a2a ls's accept line names every agent of the flow (FOL-112, Codex review) ([28c3042](https://github.com/foldrun-io/foldrun-cli/commit/28c3042))
- feat(cli): runs rm <id> <id>… deletes through runs/bulk, as the dashboard does (FOL-75) ([271f99a](https://github.com/foldrun-io/foldrun-cli/commit/271f99a))
- feat(a2a): a2a publish --accept-risk, a2a ls lists secret-and-code agents (FOL-112) ([122268f](https://github.com/foldrun-io/foldrun-cli/commit/122268f))

### ci

- also run against core's main — on core's dispatch, nightly, or by hand (FOL-92) ([4aadf60](https://github.com/foldrun-io/foldrun-cli/commit/4aadf60))

### deps

- @foldrun/core ^15.1.0 ([a2de7d2](https://github.com/foldrun-io/foldrun-cli/commit/a2de7d2))

### docs

- sync (FOL-73/75/112/124/123/50 merges, retention default) ([c288518](https://github.com/foldrun-io/foldrun-cli/commit/c288518))
- sync agents.md (system: snapshots, FOL-50) ([7b99c5e](https://github.com/foldrun-io/foldrun-cli/commit/7b99c5e))
- synced from foldrun-docs (FOL-73) ([c7d5efd](https://github.com/foldrun-io/foldrun-cli/commit/c7d5efd))

## [17.0.1] — 2026-11-05

### docs

- sync security.md — what our telemetry carries (FOL-121) ([683c7c0](https://github.com/foldrun-io/foldrun-cli/commit/683c7c0))

## [17.0.0] — 2026-11-05

### Breaking changes

- the CLI now runs on @foldrun/core 15.0.0, a new major. (3ef0dce)

### deps

- @foldrun/core ^15.0.0 ([3ef0dce](https://github.com/foldrun-io/foldrun-cli/commit/3ef0dce))

## [16.1.0] — 2026-11-05

- feat(agent network): say where a browsing agent's list holds (FOL-110 phase 3) ([f3ca793](https://github.com/foldrun-io/foldrun-cli/commit/f3ca793))
- feat(cli): usage compute shows runs waiting against the limit; waiting_cap hint (FOL-100) ([4f46321](https://github.com/foldrun-io/foldrun-cli/commit/4f46321))

## [16.0.3] — 2026-11-05

### deps

- @foldrun/core ^14.5.0 ([d9ae92d](https://github.com/foldrun-io/foldrun-cli/commit/d9ae92d))

## [16.0.2] — 2026-11-05

- fix(observe): start-up table shows when each phase began and which ran in parallel (FOL-74) ([b1e6329](https://github.com/foldrun-io/foldrun-cli/commit/b1e6329))

## [16.0.1] — 2026-11-04

### deps

- @foldrun/core ^14.4.0 ([807fa0c](https://github.com/foldrun-io/foldrun-cli/commit/807fa0c))

## [16.0.0] — 2026-11-04

### Breaking changes

- a bare `foldrun observe` covers the last 7 days, as the (9709069)

### New in the public API

- `foldrun eval trends`
- `foldrun runs outputs`
- `foldrun usage budget`
- `foldrun billing invoices`

- fix(cli): runs reaches a deep --page, and --json on an empty account is still JSON ([dceaec8](https://github.com/foldrun-io/foldrun-cli/commit/dceaec8))
- fix(cli): every billing verb says when there is no billing; runs --all and budget edge cases ([8e11f9e](https://github.com/foldrun-io/foldrun-cli/commit/8e11f9e))
- feat(observe)!: the account Observe analysis in `foldrun observe`; `foldrun eval trends` ([9709069](https://github.com/foldrun-io/foldrun-cli/commit/9709069))
- feat(runs): foldrun runs pages (--before, --page, --all, --json) and foldrun runs outputs lists what a run archived ([e57970d](https://github.com/foldrun-io/foldrun-cli/commit/e57970d))
- feat(cli): usage budget and billing invoices ([187a1bb](https://github.com/foldrun-io/foldrun-cli/commit/187a1bb))

## [15.0.0] — 2026-11-04

### Breaking changes

- `foldrun keys create <label>` with no --expires made a key (a260a09)

- feat(cli)!: keys create defaults to 90 days, as the dashboard does ([a260a09](https://github.com/foldrun-io/foldrun-cli/commit/a260a09))
- fix(cli): source share asks the platform to move it, in one call ([b2053ba](https://github.com/foldrun-io/foldrun-cli/commit/b2053ba))

## [14.4.1] — 2026-11-04

### deps

- @foldrun/core ^14.3.5 ([d48ba5c](https://github.com/foldrun-io/foldrun-cli/commit/d48ba5c))

## [14.4.0] — 2026-11-04

### New in the public API

- `foldrun flow inputs`
- `foldrun flow inputs save`
- `foldrun runs views save`
- `foldrun runs views rm`
- `foldrun mcp clients add`
- `foldrun storage ls`
- `foldrun billing wallet clear email`
- `foldrun billing details set`
- `foldrun account clear compute`
- `foldrun workspace clear compute`
- `foldrun secrets ls`
- `foldrun secrets rm`
- `foldrun source put`
- `foldrun source share`
- the `--no-task` flag
- the `--isolated` flag
- the `--page` flag
- the `--write` flag
- the `--token-auth` flag
- the `--jwks-file` flag
- the `--event-wait` flag
- the `--clear-address` flag
- the `--clear-email` flag
- the `--clear-abn` flag
- the `--use` flag
- the `--backup` flag
- the `--oauth2` flag
- the `--with-client` flag
- the `--if-workspaces` flag
- the `--empty` flag
- the `--clear-name` flag
- the `--clear-description` flag
- the `--clear-examples` flag
- the `--return-immediately` flag
- the `--subject-secret` flag
- the `--requested-token-type` flag
- the `--generate-key` flag
- the `--revoke-url` flag
- the `--dpop` flag
- the `--device` flag
- …and 2 more

- fix(cli): a source share that stops mid-delete names every file still to remove ([016d735](https://github.com/foldrun-io/foldrun-cli/commit/016d735))
- fix(cli): source share deletes only the files it copied, never their folder ([20f536e](https://github.com/foldrun-io/foldrun-cli/commit/20f536e))
- feat(cli): dashboard parity C — what the dashboard did that the CLI could not ([bb496b8](https://github.com/foldrun-io/foldrun-cli/commit/bb496b8))
- feat(cli): clear what the dashboard clears one at a time; usage prints by flow and by agent ([5ae3267](https://github.com/foldrun-io/foldrun-cli/commit/5ae3267))
- feat(cli): dashboard parity — secret health, trigger log, storage ls --all, model set --use ([3c6a38d](https://github.com/foldrun-io/foldrun-cli/commit/3c6a38d))
- feat(cli): saved run views, run selections, reject a wait: event step, mark all read, assistant --page ([1bbcef5](https://github.com/foldrun-io/foldrun-cli/commit/1bbcef5))

## [14.3.1] — 2026-11-04

### docs

- the mail sender is set signed in, never by a key (synced) ([59cfc11](https://github.com/foldrun-io/foldrun-cli/commit/59cfc11))

## [14.3.0] — 2026-11-04

### New in the public API

- `foldrun me`
- `foldrun me name`
- `foldrun team invite`
- `foldrun team role`
- `foldrun team access`
- `foldrun team remove`
- the `--no-send` flag

- feat(team): foldrun team invite|role|access|remove and foldrun me (name, timezone) ([cb76400](https://github.com/foldrun-io/foldrun-cli/commit/cb76400))

## [14.2.3] — 2026-11-04

### fix

- four CLI parity bugs from the dashboard audit ([0369512](https://github.com/foldrun-io/foldrun-cli/commit/0369512))

## [14.2.2] — 2026-11-04

### deps

- @foldrun/core ^14.3.4 ([b77bb81](https://github.com/foldrun-io/foldrun-cli/commit/b77bb81))

## [14.2.1] — 2026-11-04

- ci(release): retry GitHub 5xx; a failed merge hint no longer turns ci red ([ba49c80](https://github.com/foldrun-io/foldrun-cli/commit/ba49c80))

### chore

- read job blocks through core alone, no CLI copy of the fold (FOL-93) ([892c908](https://github.com/foldrun-io/foldrun-cli/commit/892c908))

### deps

- @foldrun/core ^14.3.3 ([1e45b6f](https://github.com/foldrun-io/foldrun-cli/commit/1e45b6f))

## [14.2.0] — 2026-11-04

- feat(billing): billing wallet shows the foldrun.ir link to pay in Toman ([9aeb515](https://github.com/foldrun-io/foldrun-cli/commit/9aeb515))

## [14.1.3] — 2026-11-04

### deps

- @foldrun/core ^14.3.2 ([0c04bcd](https://github.com/foldrun-io/foldrun-cli/commit/0c04bcd))

## [14.1.2] — 2026-11-04

- chore(deps-dev): bump @types/node (#59) ([66995c1](https://github.com/foldrun-io/foldrun-cli/commit/66995c1))

## [14.1.1] — 2026-11-03

- ci(release): publish with npm provenance ([bcf5cbb](https://github.com/foldrun-io/foldrun-cli/commit/bcf5cbb))

### deps

- @foldrun/core ^14.3.1 ([09ffeea](https://github.com/foldrun-io/foldrun-cli/commit/09ffeea))

## [14.1.0] — 2026-11-03

- feat(flow): flow set takes max_output_tokens; docs synced ([a6f1ca4](https://github.com/foldrun-io/foldrun-cli/commit/a6f1ca4))

## [14.0.7] — 2026-11-03

### deps

- @foldrun/core ^14.3.0 ([832b415](https://github.com/foldrun-io/foldrun-cli/commit/832b415))

## [14.0.6] — 2026-11-03

### deps

- @foldrun/core ^14.2.1 ([4762335](https://github.com/foldrun-io/foldrun-cli/commit/4762335))

## [14.0.5] — 2026-11-03

### deps

- @foldrun/core ^14.2.0 ([d9cb755](https://github.com/foldrun-io/foldrun-cli/commit/d9cb755))

## [14.0.4] — 2026-11-03

### docs

- sync — config/effort-fitted ([f0a4ea2](https://github.com/foldrun-io/foldrun-cli/commit/f0a4ea2))

## [14.0.3] — 2026-11-03

### deps

- @foldrun/core ^14.1.0 ([40ad100](https://github.com/foldrun-io/foldrun-cli/commit/40ad100))

## [14.0.2] — 2026-11-03

### docs

- sync — GPT-6 effort levels ([12b2cb8](https://github.com/foldrun-io/foldrun-cli/commit/12b2cb8))

## [14.0.1] — 2026-11-03

### deps

- @foldrun/core ^14.0.1 ([ad39c5c](https://github.com/foldrun-io/foldrun-cli/commit/ad39c5c))

### docs

- sync — OpenAI over Responses; effort per provider ([da71fb6](https://github.com/foldrun-io/foldrun-cli/commit/da71fb6))

## [14.0.0] — 2026-11-03

### Breaking changes

- the CLI now runs on @foldrun/core 14.0.0, a new major. (254e925)

### deps

- @foldrun/core ^14.0.0 ([254e925](https://github.com/foldrun-io/foldrun-cli/commit/254e925))

## [13.2.0] — 2026-11-03

- feat(account): use foldrun --provider deepseek|moonshot (OpenRouter dropped); docs synced ([ccafa59](https://github.com/foldrun-io/foldrun-cli/commit/ccafa59))

## [13.1.1] — 2026-11-03

### deps

- @foldrun/core ^13.1.1 ([eaf8c7b](https://github.com/foldrun-io/foldrun-cli/commit/eaf8c7b))

## [13.1.0] — 2026-11-03

- feat(account): `account model use foldrun --provider <p>`, `use own`, `prices` ([c570fa4](https://github.com/foldrun-io/foldrun-cli/commit/c570fa4))

### docs

- sync — foldrun's models in providers, billing, FAQ, getting started ([ee108ee](https://github.com/foldrun-io/foldrun-cli/commit/ee108ee))

## [13.0.1] — 2026-11-03

### deps

- @foldrun/core ^13.1.0 ([6bce694](https://github.com/foldrun-io/foldrun-cli/commit/6bce694))

## [13.0.0] — 2026-11-02

### Breaking changes

- the CLI now runs on @foldrun/core 13.0.0, a new major. (c1383bd)

### deps

- @foldrun/core ^13.0.0 ([c1383bd](https://github.com/foldrun-io/foldrun-cli/commit/c1383bd))

## [12.0.6] — 2026-11-02

### deps

- @foldrun/core ^12.2.0 ([d95e538](https://github.com/foldrun-io/foldrun-cli/commit/d95e538))

## [12.0.5] — 2026-11-02

### deps

- @foldrun/core ^12.1.0 ([82cce4a](https://github.com/foldrun-io/foldrun-cli/commit/82cce4a))

## [12.0.4] — 2026-11-02

- chore(hooks): pre-push names where the suites run now (each repo's CI, the dev pipeline) ([34eade6](https://github.com/foldrun-io/foldrun-cli/commit/34eade6))

### deps

- @foldrun/core ^12.0.3 ([99dea9f](https://github.com/foldrun-io/foldrun-cli/commit/99dea9f))
- @foldrun/core ^12.0.2 ([f0df81c](https://github.com/foldrun-io/foldrun-cli/commit/f0df81c))

## [12.0.3] — 2026-11-02

### ci

- one security gate in every repo (.githooks/security.sh) ([5e0a8b1](https://github.com/foldrun-io/foldrun-cli/commit/5e0a8b1))

## [12.0.2] — 2026-11-02

### deps

- @foldrun/core ^12.0.1 ([afec2cf](https://github.com/foldrun-io/foldrun-cli/commit/afec2cf))

## [12.0.1] — 2026-11-02

- chore(hooks): foldrun.checksHost github — the suites run on GitHub CI ([49f1bb3](https://github.com/foldrun-io/foldrun-cli/commit/49f1bb3))

## [12.0.0] — 2026-11-02

### Breaking changes

- the CLI now runs on @foldrun/core 12.0.0, a new major. (2191efc)

### deps

- @foldrun/core ^12.0.0 ([2191efc](https://github.com/foldrun-io/foldrun-cli/commit/2191efc))

## [11.1.0] — 2026-11-02

- fix(agent network): read network.browses loosely so the CLI typechecks against the published core ([b215e07](https://github.com/foldrun-io/foldrun-cli/commit/b215e07))
- feat(agent network): say when a browsing agent is not held to its list (FOL-110 phase 1) ([85bc4bb](https://github.com/foldrun-io/foldrun-cli/commit/85bc4bb))

## [11.0.5] — 2026-11-01

### deps

- @foldrun/core ^11.2.2 ([145a16d](https://github.com/foldrun-io/foldrun-cli/commit/145a16d))

## [11.0.4] — 2026-11-01

- ci(hooks): box checks use a short TMPDIR and install nested packages ([6d6a44d](https://github.com/foldrun-io/foldrun-cli/commit/6d6a44d))
- ci(hooks): pre-push can run the repo checks on another machine (foldrun.checksHost) ([697c806](https://github.com/foldrun-io/foldrun-cli/commit/697c806))

### docs

- sync the bundled docs (mcp.md: a machine client's revoke ends that token only) ([ad66372](https://github.com/foldrun-io/foldrun-cli/commit/ad66372))

## [11.0.3] — 2026-11-01

### deps

- @foldrun/core ^11.2.1 ([591b3bd](https://github.com/foldrun-io/foldrun-cli/commit/591b3bd))

## [11.0.2] — 2026-11-01

### deps

- @foldrun/core ^11.2.0 ([b0e9e8b](https://github.com/foldrun-io/foldrun-cli/commit/b0e9e8b))

## [11.0.1] — 2026-11-01

### deps

- @foldrun/core ^11.1.0 ([f1f939e](https://github.com/foldrun-io/foldrun-cli/commit/f1f939e))

## [11.0.0] — 2026-11-01

### Breaking changes

- @foldrun/core ^11.0.0 (d8cea08)

- feat(secrets): --kind token-exchange (part I) ([01ab5d7](https://github.com/foldrun-io/foldrun-cli/commit/01ab5d7))
- feat(connect): --dpop, and --token-auth mtls with --cert-file and --key-file (part H) ([61db081](https://github.com/foldrun-io/foldrun-cli/commit/61db081))
- feat(mcp): foldrun mcp clients add — register a machine client (part G) ([c2c5a20](https://github.com/foldrun-io/foldrun-cli/commit/c2c5a20))
- feat(connect): --device — connect with a code, through the platform or locally (part F) ([979c245](https://github.com/foldrun-io/foldrun-cli/commit/979c245))
- feat(connect): --token-auth jwt with --key-file, --cert-file or --generate-key (part E) ([6c0c8c5](https://github.com/foldrun-io/foldrun-cli/commit/6c0c8c5))

### deps

- @foldrun/core ^11.0.0 ([d8cea08](https://github.com/foldrun-io/foldrun-cli/commit/d8cea08))

## [10.6.0] — 2026-11-01

- feat(connect): --issuer discovery, --revoke-url, PAR; secrets rm revokes (parts B, C) ([c36f6fd](https://github.com/foldrun-io/foldrun-cli/commit/c36f6fd))

### deps

- @foldrun/core ^9.5.0 ([eac447a](https://github.com/foldrun-io/foldrun-cli/commit/eac447a))
- @foldrun/core ^9.4.0 ([0202136](https://github.com/foldrun-io/foldrun-cli/commit/0202136))

## [10.5.0] — 2026-11-01

- feat(connect): --token-auth basic|post|none; core's token request builder ([4b41e9e](https://github.com/foldrun-io/foldrun-cli/commit/4b41e9e))

## [10.4.0] — 2026-11-01

### New in the public API

- `foldrun mcp connections`
- `foldrun mcp disconnect`

- feat(mcp): foldrun mcp connections / disconnect — the AI apps connected over OAuth ([8dac2f8](https://github.com/foldrun-io/foldrun-cli/commit/8dac2f8))

## [10.3.1] — 2026-11-01

### deps

- @foldrun/core ^9.2.1 ([3d3a9e7](https://github.com/foldrun-io/foldrun-cli/commit/3d3a9e7))

## [10.3.0] — 2026-11-01

### New in the public API

- `foldrun mcp`
- the `--read-only` flag

- feat(mcp): foldrun mcp — this account as MCP tools for an AI app, over stdio ([0d5977b](https://github.com/foldrun-io/foldrun-cli/commit/0d5977b))

## [10.2.0] — 2026-11-01

### New in the public API

- `foldrun keys create`
- `foldrun a2a ls`
- `foldrun a2a publish`
- `foldrun a2a unpublish`
- `foldrun a2a card`
- `foldrun a2a call`
- `foldrun a2a status`
- the `--a2a` flag
- the `--flows` flag
- the `--max-tasks` flag
- the `--example` flag
- the `--public-card` flag
- the `--private-card` flag
- the `--key-env` flag
- the `--context` flag
- the `--max-wait` flag
- the `--card` flag

- feat(a2a): foldrun a2a ls|publish|unpublish|card|call|status|cancel and A2A keys ([7ec0a35](https://github.com/foldrun-io/foldrun-cli/commit/7ec0a35))

### deps

- @foldrun/core ^9.2.0 ([fc81562](https://github.com/foldrun-io/foldrun-cli/commit/fc81562))

## [10.1.1] — 2026-10-30

### deps

- @foldrun/core ^9.1.0 ([22be59e](https://github.com/foldrun-io/foldrun-cli/commit/22be59e))

## [10.1.0] — 2026-10-30

### New in the public API

- `foldrun secrets workspaces`
- the `--none` flag
- the `--workspaces` flag

- feat(secrets): secrets workspaces / set --workspaces; masked share ids; check --online note ([2bc54f1](https://github.com/foldrun-io/foldrun-cli/commit/2bc54f1))

## [10.0.0] — 2026-10-30

### Breaking changes

- the CLI now runs on @foldrun/core 9.0.0, a new major. (790a0cb)

- fix(storage): send the file size when asking for an upload URL ([11f13c7](https://github.com/foldrun-io/foldrun-cli/commit/11f13c7))

### deps

- @foldrun/core ^9.0.0 ([790a0cb](https://github.com/foldrun-io/foldrun-cli/commit/790a0cb))

## [9.0.3] — 2026-10-30

### deps

- @foldrun/core ^8.0.1 ([d36fa9d](https://github.com/foldrun-io/foldrun-cli/commit/d36fa9d))

## [9.0.2] — 2026-10-30

### chore

- remove dead code, and refuse unused locals at typecheck ([174de9e](https://github.com/foldrun-io/foldrun-cli/commit/174de9e))

## [9.0.1] — 2026-10-30

- fix(flags): the platform's operator changes flags, not a super admin ([9fe926f](https://github.com/foldrun-io/foldrun-cli/commit/9fe926f))

## [9.0.0] — 2026-10-29

### Breaking changes

- the CLI now runs on @foldrun/core 8.0.0, a new major. (ea452b5)

### deps

- @foldrun/core ^8.0.0 ([ea452b5](https://github.com/foldrun-io/foldrun-cli/commit/ea452b5))

## [8.1.2] — 2026-10-29

### deps

- @foldrun/core ^7.0.2 ([4ce4b3d](https://github.com/foldrun-io/foldrun-cli/commit/4ce4b3d))

## [8.1.1] — 2026-10-29

### deps

- @foldrun/core ^7.0.1 ([7855d3a](https://github.com/foldrun-io/foldrun-cli/commit/7855d3a))

### docs

- sync from foldrun-docs (CLI renewal retry and unwritable credentials) ([d71e311](https://github.com/foldrun-io/foldrun-cli/commit/d71e311))

### fix

- renewal never loses the new key, and runs on every remote command (FOL-71 review) ([1f3b21f](https://github.com/foldrun-io/foldrun-cli/commit/1f3b21f))

## [8.1.0] — 2026-10-29

### feat

- renew CLI-login keys; clearer login and network_enforce output; pull into an empty folder stays there (FOL-71, FOL-105, FOL-104) ([1155ae6](https://github.com/foldrun-io/foldrun-cli/commit/1155ae6))

### fix

- --wait shows why a run failed (FOL-106) ([d77fc92](https://github.com/foldrun-io/foldrun-cli/commit/d77fc92))

## [8.0.0] — 2026-10-29

### Breaking changes

- the CLI now runs on @foldrun/core 7.0.0, a new major. (dbf2b2e)

### deps

- @foldrun/core ^7.0.0 ([dbf2b2e](https://github.com/foldrun-io/foldrun-cli/commit/dbf2b2e))

## [7.1.0] — 2026-10-29

### New in the public API

- `foldrun team invites`
- `foldrun team invites revoke`

- feat(team): foldrun team invites [--all] and team invites revoke <id> ([83a03b4](https://github.com/foldrun-io/foldrun-cli/commit/83a03b4))

## [7.0.0] — 2026-10-29

### Breaking changes

- the CLI now runs on @foldrun/core 6.0.0, a new major. (2ae2d0a)

### deps

- @foldrun/core ^6.0.0 ([2ae2d0a](https://github.com/foldrun-io/foldrun-cli/commit/2ae2d0a))

## [6.0.0] — 2026-10-28

### Breaking changes

- the CLI now runs on @foldrun/core 5.0.0, a new major. (ac33b83)

### deps

- @foldrun/core ^5.0.0 ([ac33b83](https://github.com/foldrun-io/foldrun-cli/commit/ac33b83))

## [5.0.2] — 2026-10-28

- fix(security): pull and downloads never write outside their folder; browser opens web pages only ([7d4af08](https://github.com/foldrun-io/foldrun-cli/commit/7d4af08))

## [5.0.1] — 2026-10-28

### docs

- sync api.md, budgets-and-billing.md, cli.md, feature-flags.md, status.md ([99fd980](https://github.com/foldrun-io/foldrun-cli/commit/99fd980))

## [5.0.0] — 2026-10-28

### Breaking changes

- the CLI now runs on @foldrun/core 4.0.0, a new major. (53a02dd)

### deps

- @foldrun/core ^4.0.0 ([53a02dd](https://github.com/foldrun-io/foldrun-cli/commit/53a02dd))

## [4.0.1] — 2026-10-28

### docs

- sync agents.md, team-and-access.md ([8bee35e](https://github.com/foldrun-io/foldrun-cli/commit/8bee35e))

## [4.0.0] — 2026-10-28

### Breaking changes

- the CLI now runs on @foldrun/core 3.0.0, a new major. (7a3494f)

### deps

- @foldrun/core ^3.0.0 ([7a3494f](https://github.com/foldrun-io/foldrun-cli/commit/7a3494f))

## [3.0.1] — 2026-10-28

### deps

- @foldrun/core ^2.14.3 ([52ada05](https://github.com/foldrun-io/foldrun-cli/commit/52ada05))

### docs

- sync security.md and api.md (FOL-96) ([444f07d](https://github.com/foldrun-io/foldrun-cli/commit/444f07d))
- sync self-hosting note (FOL-96) ([e913958](https://github.com/foldrun-io/foldrun-cli/commit/e913958))

## [3.0.0] — 2026-10-28

### Breaking changes

- `foldrun billing credit` is gone (it was never deprecated)

- fix(cli): retire billing credit, point at billing top-up (FOL-94) ([7922099](https://github.com/foldrun-io/foldrun-cli/commit/7922099))

## [2.10.12] — 2026-10-27

### docs

- sync api.md, budgets-and-billing.md ([1333baa](https://github.com/foldrun-io/foldrun-cli/commit/1333baa))
- sync api.md ([94cb521](https://github.com/foldrun-io/foldrun-cli/commit/94cb521))

## [2.10.11] — 2026-10-27

### docs

- sync budgets-and-billing.md ([66bb1bc](https://github.com/foldrun-io/foldrun-cli/commit/66bb1bc))

## [2.10.10] — 2026-10-27

### docs

- sync budgets-and-billing.md ([a1527b7](https://github.com/foldrun-io/foldrun-cli/commit/a1527b7))

## [2.10.9] — 2026-10-27

### docs

- sync budgets-and-billing.md ([74d2ed4](https://github.com/foldrun-io/foldrun-cli/commit/74d2ed4))

## [2.10.8] — 2026-10-27

### docs

- sync security.md (dashboard CSP) ([12cf7de](https://github.com/foldrun-io/foldrun-cli/commit/12cf7de))

## [2.10.7] — 2026-10-27

### docs

- synced (extra credits, pay as you go) ([9bd9d99](https://github.com/foldrun-io/foldrun-cli/commit/9bd9d99))

## [2.10.6] — 2026-10-27

### docs

- synced (cold-start wait) ([ebeebc6](https://github.com/foldrun-io/foldrun-cli/commit/ebeebc6))

## [2.10.5] — 2026-10-27

### deps

- @foldrun/core ^2.14.2 ([abd3f79](https://github.com/foldrun-io/foldrun-cli/commit/abd3f79))

## [2.10.4] — 2026-10-27

- ci(release): the same change rule and release recovery as core ([7a31780](https://github.com/foldrun-io/foldrun-cli/commit/7a31780))

## [2.10.3] — 2026-10-27

- ci(release): bump-core starts over from a fresh main when its push loses, forward only ([c44e8e6](https://github.com/foldrun-io/foldrun-cli/commit/c44e8e6))

### deps

- @foldrun/core ^2.14.1 ([d2d32f3](https://github.com/foldrun-io/foldrun-cli/commit/d2d32f3))

## [2.10.2] — 2026-10-27

- ci(release): bump-core waits for the core it was told of — npm's latest lags the dispatch ([4f02749](https://github.com/foldrun-io/foldrun-cli/commit/4f02749))

## [2.10.1] — 2026-10-27

- ci(release): release-merge looks for its own evidence; connect tests take free ports ([1ca98cb](https://github.com/foldrun-io/foldrun-cli/commit/1ca98cb))
- ci(release): automatic CLI releases — move onto each new core, merge the release PR once ci passes ([184ab6f](https://github.com/foldrun-io/foldrun-cli/commit/184ab6f))

## [2.10.0] — 2026-10-27

### New in the public API

- `foldrun flow compute`

- feat(compute): flow compute, workspace and account compute with disk, every level in usage compute ([f1f757f](https://github.com/foldrun-io/foldrun-cli/commit/f1f757f))
- feat(usage): foldrun usage compute lists the steps waiting for room ([7b359fe](https://github.com/foldrun-io/foldrun-cli/commit/7b359fe))

### deps

- @foldrun/core ^2.14.0 — compute at four levels, disk, flow compute: in check ([3951ae1](https://github.com/foldrun-io/foldrun-cli/commit/3951ae1))

### docs

- synced (cloudflare trust mode) ([723a388](https://github.com/foldrun-io/foldrun-cli/commit/723a388))

## [2.9.1] — 2026-10-26

### docs

- synced (installer needs a local Docker) ([587b53a](https://github.com/foldrun-io/foldrun-cli/commit/587b53a))
- synced (setup link and tunnel) ([7796f79](https://github.com/foldrun-io/foldrun-cli/commit/7796f79))
- synced (setup link on 127.0.0.1) ([1ce2c0e](https://github.com/foldrun-io/foldrun-cli/commit/1ce2c0e))
- synced (self-hosting setup link and checks) ([d1d1227](https://github.com/foldrun-io/foldrun-cli/commit/d1d1227))
- synced (the installer sets Docker up) ([52ceb56](https://github.com/foldrun-io/foldrun-cli/commit/52ceb56))
- synced (a step's disk is scratch space) ([cfff659](https://github.com/foldrun-io/foldrun-cli/commit/cfff659))

## [2.9.0] — 2026-10-26

### New in the public API

- `foldrun usage compute`

### deps

- @foldrun/core ^2.13.0 (resources:, compute:, the compute pool) ([ac8bd2a](https://github.com/foldrun-io/foldrun-cli/commit/ac8bd2a))

### docs

- synced (the compute pool needs k8s isolation) ([c5946a3](https://github.com/foldrun-io/foldrun-cli/commit/c5946a3))
- size: and resources: in the agent guide; synced docs ([cac0b2d](https://github.com/foldrun-io/foldrun-cli/commit/cac0b2d))
- synced (size classes cap cores) ([e0bba39](https://github.com/foldrun-io/foldrun-cli/commit/e0bba39))
- synced (self-hosting: one command, ready-made images) ([e5337f0](https://github.com/foldrun-io/foldrun-cli/commit/e5337f0))

### feat

- foldrun usage compute, and foldrun account set compute vcpu <n> memory <GiB> ([322df02](https://github.com/foldrun-io/foldrun-cli/commit/322df02))

## [2.8.1] — 2026-10-26

### ci

- read the public foldrun-core with the job's own token ([0cfa6b8](https://github.com/foldrun-io/foldrun-cli/commit/0cfa6b8))

### deps

- @foldrun/core ^2.12.1 ([15220fa](https://github.com/foldrun-io/foldrun-cli/commit/15220fa))
- TypeScript 7.0.2 ([af89c00](https://github.com/foldrun-io/foldrun-cli/commit/af89c00))

## [2.8.0] — 2026-10-25

### billing

- print the platform's notices instead of guessing from the numbers ([a7a7118](https://github.com/foldrun-io/foldrun-cli/commit/a7a7118))

### ci

- GitHub's hosted runners, now that this repository is public ([7513582](https://github.com/foldrun-io/foldrun-cli/commit/7513582))

### deps

- @foldrun/core ^2.12.0 (the FSL release) ([2d68eb5](https://github.com/foldrun-io/foldrun-cli/commit/2d68eb5))

### docs

- synced (API version 2026-10-26) ([b4a87c0](https://github.com/foldrun-io/foldrun-cli/commit/b4a87c0))
- the billing verbs are the hosted platform's; synced docs; a neutral test desk ([0162f6d](https://github.com/foldrun-io/foldrun-cli/commit/0162f6d))
- synced — source-available, and your own server ([4241442](https://github.com/foldrun-io/foldrun-cli/commit/4241442))

### licence

- Functional Source License 1.1 (Apache 2.0 future licence) ([1861a19](https://github.com/foldrun-io/foldrun-cli/commit/1861a19))

## [2.7.0] — 2026-10-25

### New in the public API

- `foldrun flow filter`
- `foldrun eval compare`
- `foldrun eval improve`
- `foldrun proposals`
- `foldrun eval grades`
- `foldrun eval grade`
- `foldrun inbox`
- `foldrun inbox read`
- the `--models` flag
- the `--repeat` flag
- the `--max-usd` flag
- the `--no-wait` flag
- the `--team` flag
- the `--unread` flag
- the `--dismissed` flag
- the `--started` flag
- the `--mine` flag

- fix(deps): zod 4.6.7, body-parser 2.4, fast-uri (npm audit) ([d78d5af](https://github.com/foldrun-io/foldrun-cli/commit/d78d5af))

### deps

- @foldrun/core ^2.11.0 ([64e16b7](https://github.com/foldrun-io/foldrun-cli/commit/64e16b7))

### docs

- sync (fetch: anthropic answered by foldrun's fetch) ([b534a1e](https://github.com/foldrun-io/foldrun-cli/commit/b534a1e))
- sync network.md (browser scripts need the proxy credentials) ([e2e8bdb](https://github.com/foldrun-io/foldrun-cli/commit/e2e8bdb))
- sandbox: own hands back its files too; synced docs (on-fail/retry after a spent cap) ([eaf5d73](https://github.com/foldrun-io/foldrun-cli/commit/eaf5d73))

### feat

- eval grades/grade/compare/improve, proposals, inbox, flow filter ([e4f27da](https://github.com/foldrun-io/foldrun-cli/commit/e4f27da))

### fix

- read sandbox and network from the guardrail block (FOL-77) (#35) ([3103947](https://github.com/foldrun-io/foldrun-cli/commit/3103947))

## [2.6.0] — 2026-10-22

### Deprecated

Still here and still working; to be removed in a later major. Move off them now.

- the `--provider` flag

### New in the public API

- the `--authorize-param` flag

- feat(agent link): --isolated writes sandbox: own on the worker ([4dd7b39](https://github.com/foldrun-io/foldrun-cli/commit/4dd7b39))

### deps

- @foldrun/core ^2.8.0 (sandbox: own sub-agents) ([39bc630](https://github.com/foldrun-io/foldrun-cli/commit/39bc630))

### feat

- --authorize-param name=value on connect and secrets clients add; --provider deprecated ([fec978f](https://github.com/foldrun-io/foldrun-cli/commit/fec978f))

## [2.5.0] — 2026-10-22

### New in the public API

- `foldrun identity`
- the `--basic-user` flag
- the `--basic-password` flag
- the `--subject` flag
- the `--cert-file` flag
- the `--passphrase` flag
- the `--export` flag
- the `--audience` flag
- the `--no-pkce` flag
- the `--issuer` flag

- feat(identity): foldrun identity; secrets set --kind identity --audience ([f6a8255](https://github.com/foldrun-io/foldrun-cli/commit/f6a8255))
- feat(secrets): --kind client-cert (--cert-file, --key-file, --passphrase, --export) ([2633cfe](https://github.com/foldrun-io/foldrun-cli/commit/2633cfe))
- feat(secrets): --subject for service accounts; --basic-user/--basic-password for api secrets ([37d4860](https://github.com/foldrun-io/foldrun-cli/commit/37d4860))
- feat(connect): PKCE by default, public apps, --no-pkce and --issuer ([e250b12](https://github.com/foldrun-io/foldrun-cli/commit/e250b12))
- feat(connect): --client <saved> --scopes asks for this connection's own scopes ([acbd329](https://github.com/foldrun-io/foldrun-cli/commit/acbd329))

### deps

- @foldrun/core ^2.7.0 (public apps, Basic, client certificates, identities on this machine) ([a0e36bb](https://github.com/foldrun-io/foldrun-cli/commit/a0e36bb))

## [2.4.0] — 2026-10-21

### New in the public API

- `foldrun jobs`
- the `--last` flag
- the `--run` flag

- feat(cli): eval --to starts async and polls its own run; --run <id> and --last read verdicts ([151d654](https://github.com/foldrun-io/foldrun-cli/commit/151d654))
- fix(cli): init scaffolds in the directory it is given ([c74e3fd](https://github.com/foldrun-io/foldrun-cli/commit/c74e3fd))

### deps

- @foldrun/core ^2.6.0 (the four job blocks in foldrun check) ([b69c361](https://github.com/foldrun-io/foldrun-cli/commit/b69c361))

### docs

- sync checks, evals and flows from foldrun-docs 4717659 ([8ae181f](https://github.com/foldrun-io/foldrun-cli/commit/8ae181f))

### feat

- foldrun jobs; account/workspace set <job>.<field>; owner, alerts, judge ([36b9de7](https://github.com/foldrun-io/foldrun-cli/commit/36b9de7))

## [2.3.0] — 2026-10-21

### New in the public API

- `foldrun runs views`
- `foldrun runs doctor`
- `foldrun insights`
- `foldrun issues`
- `foldrun issues show`
- `foldrun issues doctor`
- the `--stale` flag
- the `--online` flag
- the `--should` flag
- the `--outcome` flag
- the `--tool-error` flag
- the `--min-tokens` flag
- the `--min-secs` flag
- the `--view` flag
- the `--compare` flag
- the `--tree` flag
- the `--calls` flag
- the `--for` flag
- the `--times` flag
- the `--reason` flag
- the `--stop` flag

- feat(cli): account telemetry — set, clear, test ([25359f6](https://github.com/foldrun-io/foldrun-cli/commit/25359f6))
- feat(cli): agent ls shows the last run; --stale [days] ([8274df8](https://github.com/foldrun-io/foldrun-cli/commit/8274df8))
- feat(cli): account and workspace pause / resume, with --reason and --stop ([6785a92](https://github.com/foldrun-io/foldrun-cli/commit/6785a92))
- feat(cli): set network_enforce on|off for the account and a workspace ([d28bd27](https://github.com/foldrun-io/foldrun-cli/commit/d28bd27))
- feat(cli): agent ls shows each agent's owner ([a07d208](https://github.com/foldrun-io/foldrun-cli/commit/a07d208))
- ci(dependabot): say that the bot key must be a Dependabot secret too ([e9e81e7](https://github.com/foldrun-io/foldrun-cli/commit/e9e81e7))
- build(deps): bump actions/create-github-app-token (#33) ([327a4f6](https://github.com/foldrun-io/foldrun-cli/commit/327a4f6))
- feat(cli): foldrun issues doctor <id> — the run doctor on an issue's newest run ([fc1fdeb](https://github.com/foldrun-io/foldrun-cli/commit/fc1fdeb))
- fix(cli): check reports an agent whose frontmatter does not parse; parse without gray-matter's cache ([58d7547](https://github.com/foldrun-io/foldrun-cli/commit/58d7547))
- docs(cli): tools: [peers] in the managed AGENTS.md block and synced docs ([aa54b11](https://github.com/foldrun-io/foldrun-cli/commit/aa54b11))
- feat(cli): foldrun report says why a step's prompt cache missed ([45a6886](https://github.com/foldrun-io/foldrun-cli/commit/45a6886))
- fix(cli): saved views apply every filter as the dashboard does (Codex review of FOL-72) ([fc16640](https://github.com/foldrun-io/foldrun-cli/commit/fc16640))
- feat(cli): promote --should (FOL-72 step 10) ([b33c162](https://github.com/foldrun-io/foldrun-cli/commit/b33c162))
- feat(cli): runs --tool/--tool-error/--agent/--model/--min-tokens/--min-secs/--view; runs views (FOL-72 step 9) ([b149458](https://github.com/foldrun-io/foldrun-cli/commit/b149458))
- feat(cli): foldrun insights (FOL-72 step 8) ([07f0cbf](https://github.com/foldrun-io/foldrun-cli/commit/07f0cbf))
- feat(cli): issues snooze --times; regressed and missed shown (FOL-72 step 7) ([d4f3901](https://github.com/foldrun-io/foldrun-cli/commit/d4f3901))
- feat(cli): report --compare; rerun --instruction (FOL-72 step 6) ([3640c0d](https://github.com/foldrun-io/foldrun-cli/commit/3640c0d))
- feat(cli): foldrun report --tree (FOL-72 step 5) ([33da831](https://github.com/foldrun-io/foldrun-cli/commit/33da831))
- feat(cli): report --calls and report <run> call <id> (FOL-54 step 4) ([ddec975](https://github.com/foldrun-io/foldrun-cli/commit/ddec975))
- feat(cli): foldrun issues [show|ack|snooze|resolve|reopen] (FOL-54 step 3) ([537b994](https://github.com/foldrun-io/foldrun-cli/commit/537b994))
- feat(cli): runs shows credits charged (FOL-54) ([5b7d717](https://github.com/foldrun-io/foldrun-cli/commit/5b7d717))
- feat(cli): foldrun runs --outcome (FOL-54) ([df63a82](https://github.com/foldrun-io/foldrun-cli/commit/df63a82))
- feat(cli): foldrun check --to <ws> --online (FOL-58) ([002f82e](https://github.com/foldrun-io/foldrun-cli/commit/002f82e))
- feat(cli): foldrun account set deploy_block none|secrets|security (FOL-58) ([a74de7b](https://github.com/foldrun-io/foldrun-cli/commit/a74de7b))
- feat(cli): history restore says when the version fails today's checks (FOL-57) ([40ea73e](https://github.com/foldrun-io/foldrun-cli/commit/40ea73e))
- feat(cli): foldrun runs doctor <run-id> — the run doctor from a terminal (FOL-22) ([35ae8d0](https://github.com/foldrun-io/foldrun-cli/commit/35ae8d0))

### ci

- run directly in the CI VM as its runner user, not in a root container (FOL-62) (#34) ([daa7c65](https://github.com/foldrun-io/foldrun-cli/commit/daa7c65))
- run tests on the self-hosted ci runner (FOL-62) (#31) ([483c24c](https://github.com/foldrun-io/foldrun-cli/commit/483c24c))

### deps

- @foldrun/core ^2.5.0 — owner:, network_enforce, pause, stale/behaviour alerts, limits: repeat, telemetry ([a473820](https://github.com/foldrun-io/foldrun-cli/commit/a473820))

### docs

- sync checks.md (config/invalid-frontmatter) ([de2ee36](https://github.com/foldrun-io/foldrun-cli/commit/de2ee36))
- sync — limits: repeat and the behaviour alerts ([221a07d](https://github.com/foldrun-io/foldrun-cli/commit/221a07d))
- sync checks.md (what the platform's checks leave unread) ([de6674a](https://github.com/foldrun-io/foldrun-cli/commit/de6674a))
- sync the prompt-caching page ([6d1b33e](https://github.com/foldrun-io/foldrun-cli/commit/6d1b33e))
- sync (alerts:) ([b59cdc2](https://github.com/foldrun-io/foldrun-cli/commit/b59cdc2))
- sync (FOL-64, FOL-66) ([f7b0c02](https://github.com/foldrun-io/foldrun-cli/commit/f7b0c02))
- clearer team refusal text, team changes are browser-only (FOL-64) (#32) ([a5d2aef](https://github.com/foldrun-io/foldrun-cli/commit/a5d2aef))
- sync — model-named secrets (FOL-19) ([95a05a6](https://github.com/foldrun-io/foldrun-cli/commit/95a05a6))

## [2.2.0] — 2026-10-18

- feat(cli): report says each step's turns; observe shows turns and result sizes ([ee6069f](https://github.com/foldrun-io/foldrun-cli/commit/ee6069f))

### deps

- @foldrun/core ^2.3.0 ([b6a6833](https://github.com/foldrun-io/foldrun-cli/commit/b6a6833))

### docs

- sync — judge and draft through the translator (FOL-16) ([fa37d89](https://github.com/foldrun-io/foldrun-cli/commit/fa37d89))
- sync — model key onboarding step (FOL-15) ([7992f39](https://github.com/foldrun-io/foldrun-cli/commit/7992f39))
- sync — long results only spilled for agents that can read them ([e170c43](https://github.com/foldrun-io/foldrun-cli/commit/e170c43))
- sync — long tool results kept and previewed ([b44f8e1](https://github.com/foldrun-io/foldrun-cli/commit/b44f8e1))

## [2.1.0] — 2026-10-17

- feat(cli): report, usage and observe print the prompt-cache share ([673b1be](https://github.com/foldrun-io/foldrun-cli/commit/673b1be))
- fix(cli): a refused API version stops every command with what to install (FOL-41) ([9eac6dd](https://github.com/foldrun-io/foldrun-cli/commit/9eac6dd))

### deps

- @foldrun/core ^2.2.0 ([53d1736](https://github.com/foldrun-io/foldrun-cli/commit/53d1736))

### docs

- sync — fetch's per-page cap (FOL-28) ([26dab3b](https://github.com/foldrun-io/foldrun-cli/commit/26dab3b))

## [2.0.0] — 2026-10-17

### Breaking changes

- foldrun repo and keys create --for/--access are removed. (17cfc23)
- `foldrun repo ls` is gone (it was never deprecated)
- the `--for` flag is gone (it was never deprecated)
- the `--access` flag is gone (it was never deprecated)

- feat(cli)!: foldrun repo and keys create --for go with the platform's own git ([17cfc23](https://github.com/foldrun-io/foldrun-cli/commit/17cfc23))
- feat(restore): revisions by their full id; repo is deprecated ([32cb104](https://github.com/foldrun-io/foldrun-cli/commit/32cb104))
- feat(observe, report): start-up phases — a table per phase in observe --to, a start-up label per step (FOL-29) ([0d5feb6](https://github.com/foldrun-io/foldrun-cli/commit/0d5feb6))

### deps

- @foldrun/core ^2.0.0 ([2617f2f](https://github.com/foldrun-io/foldrun-cli/commit/2617f2f))

### docs

- sync — weighted turns between accounts ([119ab5c](https://github.com/foldrun-io/foldrun-cli/commit/119ab5c))
- sync — fair share, room to start, schedule spread ([5d4ca61](https://github.com/foldrun-io/foldrun-cli/commit/5d4ca61))
- sync — an account's own concurrency lowers its share, never raises it ([a72aa44](https://github.com/foldrun-io/foldrun-cli/commit/a72aa44))

### fix

- strip markdown from published links (FOL-45) (#29) ([1bccc49](https://github.com/foldrun-io/foldrun-cli/commit/1bccc49))

## [1.3.0] — 2026-10-17

- feat(check): frontmatter values from core's schema; a skill's missing description said once ([d2ff4ca](https://github.com/foldrun-io/foldrun-cli/commit/d2ff4ca))

### deps

- @foldrun/core ^1.4.0 — frontmatter values validated from core's schema ([4a83451](https://github.com/foldrun-io/foldrun-cli/commit/4a83451))

## [1.2.0] — 2026-10-17

### New in the public API

- the `--security` flag
- the `--rules` flag
- the `--fail-on` flag
- the `--rule` flag
- the `--changed` flag
- the `--base` flag
- the `--write-baseline` flag
- the `--no-baseline` flag

- fix(check): library findings at the account root, single-file subagents at their own path, -z for --changed ([4b4b43e](https://github.com/foldrun-io/foldrun-cli/commit/4b4b43e))
- feat(check): the security scanner, rule ids, --security, JSON/SARIF, ignores, baseline, --changed ([9d4f70f](https://github.com/foldrun-io/foldrun-cli/commit/9d4f70f))

### chore

- proprietary licence; repository private ([7da93e2](https://github.com/foldrun-io/foldrun-cli/commit/7da93e2))

### ci

- read foldrun-core with the App token (#25) ([6153d42](https://github.com/foldrun-io/foldrun-cli/commit/6153d42))

### deps

- @foldrun/core ^1.3.0, which the security scanner needs (#26) ([329c31e](https://github.com/foldrun-io/foldrun-cli/commit/329c31e))
- @foldrun/core ^1.3.0 — the scanner, with Codex's review fixes ([13a0488](https://github.com/foldrun-io/foldrun-cli/commit/13a0488))

### licence

- proprietary from this release; LICENSE clarified, lockfile matches (#24) ([1b05493](https://github.com/foldrun-io/foldrun-cli/commit/1b05493))

## [1.1.2] — 2026-10-16

### docs

- sync assistant page (network line) ([6dee78b](https://github.com/foldrun-io/foldrun-cli/commit/6dee78b))

## [1.1.1] — 2026-10-16

- build(deps-dev): bump typescript from 5.9.3 to 6.0.3 (#20) ([4530d06](https://github.com/foldrun-io/foldrun-cli/commit/4530d06))
- build(deps): bump actions/setup-node (#19) ([1f880a0](https://github.com/foldrun-io/foldrun-cli/commit/1f880a0))
- build(deps-dev): bump @types/node (#18) ([521487a](https://github.com/foldrun-io/foldrun-cli/commit/521487a))

### ci

- release — Dependabot's build(deps) commits are a patch, not a feature ([020b345](https://github.com/foldrun-io/foldrun-cli/commit/020b345))

## [1.1.0] — 2026-10-16

### New in the public API

- `foldrun agent network`
- `foldrun assistant`
- `foldrun assistant history`
- `foldrun secrets sites`
- the `--add` flag
- the `--remove` flag
- the `--conversation` flag
- the `--q` flag
- the `--site` flag
- the `--clear` flag

- agent network, secrets sites and --site — the sites a sandbox may reach, from the terminal ([b27740c](https://github.com/foldrun-io/foldrun-cli/commit/b27740c))

### ci

- npm ci, not npm install, in CI and the release ([d61cef3](https://github.com/foldrun-io/foldrun-cli/commit/d61cef3))

### deps

- @foldrun/core ^1.1.0 — the CLI's agent network uses @foldrun/core/network, new in 1.1.0 ([1196b3f](https://github.com/foldrun-io/foldrun-cli/commit/1196b3f))

### docs

- sync assistant ([163662a](https://github.com/foldrun-io/foldrun-cli/commit/163662a))
- sync tools (script tool arguments) ([2af12ce](https://github.com/foldrun-io/foldrun-cli/commit/2af12ce))
- sync the assistant's limits ([d9906db](https://github.com/foldrun-io/foldrun-cli/commit/d9906db))
- sync flows (on-fail) ([fb54668](https://github.com/foldrun-io/foldrun-cli/commit/fb54668))

### feat

- foldrun assistant history / show / rm, and --conversation to carry one on ([9399d48](https://github.com/foldrun-io/foldrun-cli/commit/9399d48))
- foldrun assistant creates a proposed workspace and shows tokens and the charge ([caa5464](https://github.com/foldrun-io/foldrun-cli/commit/caa5464))
- foldrun assistant (also foldrun ai) — the dashboard's assistant from a terminal ([34efe26](https://github.com/foldrun-io/foldrun-cli/commit/34efe26))

### fix assistant

- typecheck — the proposed workspace is passed in, not read from a variable ask() sets ([a0ec141](https://github.com/foldrun-io/foldrun-cli/commit/a0ec141))

## [1.0.0] — 2026-10-13

### New in the public API

- `foldrun hook ls`
- `foldrun hook add`
- `foldrun hook test`
- `foldrun hook rm`
- the `--runs` flag
- the `--on` flag
- the `--tool` flag
- the `--library` flag

### cli

- hook ls --to lists a deployed workspace's hooks; sync-docs runs only as a program ([118d714](https://github.com/foldrun-io/foldrun-cli/commit/118d714))
- foldrun api version shows your last 30 days and any deprecated route you still call ([495104b](https://github.com/foldrun-io/foldrun-cli/commit/495104b))
- nothing a platform sends can write escape sequences to your terminal ([4ec3c3e](https://github.com/foldrun-io/foldrun-cli/commit/4ec3c3e))
- platform text printed without escape sequences; the update notice needs a bare version ([059a30e](https://github.com/foldrun-io/foldrun-cli/commit/059a30e))
- foldrun changelog leads with the API — version, breaks, deprecations ([b5538c3](https://github.com/foldrun-io/foldrun-cli/commit/b5538c3))
- foldrun library ls|put|rm take hooks ([32d6006](https://github.com/foldrun-io/foldrun-cli/commit/32d6006))
- foldrun hook ls | add | test | rm, and hooks in foldrun check ([61a5f51](https://github.com/foldrun-io/foldrun-cli/commit/61a5f51))

### deps

- @foldrun/core ^1.0.0 ([b5fcb9d](https://github.com/foldrun-io/foldrun-cli/commit/b5fcb9d))

### docs

- sync state + state_key cookie seeding from foldrun-docs ([4e952b9](https://github.com/foldrun-io/foldrun-cli/commit/4e952b9))
- sync backups-and-restore from foldrun-docs (no nightly snapshot) ([ed0d32c](https://github.com/foldrun-io/foldrun-cli/commit/ed0d32c))

### release

- a CLI deprecation is a marker on its help line, not the word in a sentence ([a5ddbae](https://github.com/foldrun-io/foldrun-cli/commit/a5ddbae))
- same release.mjs as core — the first declared API lists no additions ([aa261fc](https://github.com/foldrun-io/foldrun-cli/commit/aa261fc))
- full SemVer 2.0.0 — the help is the public API, breaks found from it ([42b8d64](https://github.com/foldrun-io/foldrun-cli/commit/42b8d64))

## [0.9.0] — 2026-10-11

- build(deps-dev): bump @types/node from 22.20.2 to 26.6.4 (#15) ([891f4ed](https://github.com/foldrun-io/foldrun-cli/commit/891f4ed))
- flow hook prints a flow's webhook URL without rotating it; runtimes list apt: packages ([8138a74](https://github.com/foldrun-io/foldrun-cli/commit/8138a74))
- foldrun workspaces --json ([5948ccd](https://github.com/foldrun-io/foldrun-cli/commit/5948ccd))
- foldrun export / foldrun import — a workspace, flow or agent as a .zip (FOL-23) ([93d7029](https://github.com/foldrun-io/foldrun-cli/commit/93d7029))

### check

- error on an agent.md whose frontmatter has no opening --- ([be1ee5c](https://github.com/foldrun-io/foldrun-cli/commit/be1ee5c))

### cli

- a verb for every API route — workspaces show/new --platform, agent ls/new --platform/import --list, flow ls/new --platform, eval new, tool new --platform, source new, library new + memory kind, backups requests, status --history, team (read), stop/rerun --until, billing credit, approve --payload for wait: event; observe/triggers send days; docs synced ([47bfd73](https://github.com/foldrun-io/foldrun-cli/commit/47bfd73))
- foldrun new makes a blank workspace (--starter for the example); foldrun agent import <ws>/<agent> ([7cc3967](https://github.com/foldrun-io/foldrun-cli/commit/7cc3967))

### deps

- @modelcontextprotocol/sdk 1.32.1 (and sharp 0.35.5 in web) for new advisories ([b65b930](https://github.com/foldrun-io/foldrun-cli/commit/b65b930))

### docs

- sync tool.md body note from foldrun-docs ([a0b59f2](https://github.com/foldrun-io/foldrun-cli/commit/a0b59f2))
- sync judge: wording from foldrun-docs ([cc54349](https://github.com/foldrun-io/foldrun-cli/commit/cc54349))
- sync FOLDRUN_API_URL from foldrun-docs ([fbd8415](https://github.com/foldrun-io/foldrun-cli/commit/fbd8415))
- sync (automatic retries, web brings Read) ([b720ebe](https://github.com/foldrun-io/foldrun-cli/commit/b720ebe))
- sync (export carries a tool's run script) ([c6ca6ae](https://github.com/foldrun-io/foldrun-cli/commit/c6ca6ae))
- synced (flows: rescuer owes verify) ([b238575](https://github.com/foldrun-io/foldrun-cli/commit/b238575))
- synced (workspaces: engine files) ([2366869](https://github.com/foldrun-io/foldrun-cli/commit/2366869))
- sync flows.md (plain approval of an ask: gate) ([f3103d3](https://github.com/foldrun-io/foldrun-cli/commit/f3103d3))

### Docs sync

- the install tool ([d38a686](https://github.com/foldrun-io/foldrun-cli/commit/d38a686))
- system package snapshots ([29ed322](https://github.com/foldrun-io/foldrun-cli/commit/29ed322))

### flags

- foldrun flags — the account's feature flags, on or off and why (--json); docs synced ([cbf8a07](https://github.com/foldrun-io/foldrun-cli/commit/cbf8a07))

### foldrun account model

- show, set <provider> --key, remove ([b98da6e](https://github.com/foldrun-io/foldrun-cli/commit/b98da6e))

### foldrun import

- list what the zip held that is not imported ([3bd1835](https://github.com/foldrun-io/foldrun-cli/commit/3bd1835))

## [0.8.0] — 2026-10-03

- --help shows each verb exactly its options — `api --help` listed secrets' --kind (its text has "api (… Name: value"), `restore --help` listed nothing ([2c0a447](https://github.com/foldrun-io/foldrun-cli/commit/2c0a447))
- flow <unknown verb> names set, trigger, move-step, copy-step, paste and draft — the dispatcher had them since b87c9b5, the error's list did not ([bed1887](https://github.com/foldrun-io/foldrun-cli/commit/bed1887))
- flow draft on a pipe without --yes exits 1 — it printed "nothing saved" and returned 0 after a paid model call, so a script read an unsaved draft as done ([2cfc76f](https://github.com/foldrun-io/foldrun-cli/commit/2cfc76f))
- flow set to a value the step already has is "nothing to change" — core re-emits the managed lines at the top of the step, so the old next === raw test never fired and the reorder was written (a platform revision for no change) ([a3122ab](https://github.com/foldrun-io/foldrun-cli/commit/a3122ab))
- flow set refuses effort, timeout, retry, loop and max values core's rewriter would drop or clamp — timeout=15m deleted `timeout: 900` and exited 0, retry=abc wrote 0 ([8c55222](https://github.com/foldrun-io/foldrun-cli/commit/8c55222))

### credentials

- a Claude login token (CLAUDE_CODE_OAUTH_TOKEN, from claude setup-token) is accepted beside an API key; doctor says which a local run uses ([2c03143](https://github.com/foldrun-io/foldrun-cli/commit/2c03143))

### deps

- @foldrun/core ^0.6.0 — model credentials, docker script fixes, workspace/ prompts ([d9cc3cd](https://github.com/foldrun-io/foldrun-cli/commit/d9cc3cd))

### docs

- sync — a test run's later steps see its earlier steps' writes ([24bb26a](https://github.com/foldrun-io/foldrun-cli/commit/24bb26a))
- sync — local runs load no claude.ai connectors or on-disk MCP config ([8d3db4e](https://github.com/foldrun-io/foldrun-cli/commit/8d3db4e))

### e2e

- reads the account layout init makes, and skips without an API key instead of failing ([e3734ac](https://github.com/foldrun-io/foldrun-cli/commit/e3734ac))

### release automation

- every push to main keeps a "release X.Y.Z" pull request open; merging it publishes and tags ([9c12bb0](https://github.com/foldrun-io/foldrun-cli/commit/9c12bb0))

### release-pr

- approve the release pull request's own ci run — it waits for approval, and the required checks are its jobs ([f174f9a](https://github.com/foldrun-io/foldrun-cli/commit/f174f9a))

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

- the platform's status, each component and any live incident or maintenance, from the open /v1/status; plain status opens with the one-line verdict; docs synced (status, security, api, cli) ([bf1864c](https://github.com/foldrun-io/foldrun-cli/commit/bf1864c))

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
